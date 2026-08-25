import RAPIER from '@dimforge/rapier2d-compat';

import {
  AIR,
  CHAMBER_RADIUS,
  GRAVITY,
  REFERENCE_PIECE,
  type ChamberUpdate,
  type Medium,
} from './chamber';
import type { Shard } from './scene';
import type { Shape } from './shape';

/**
 * The object chamber on Rapier — a spike, being measured against the classic
 * solver in `lib/chamber.ts` rather than replacing it. See RESEARCH.md,
 * phase 6, for why it is worth trying: real polygon colliders where the
 * classic solver approximates every piece as a chain of circles, and a
 * rate-independent solver where the classic one's constants are per-pass —
 * which is the thing ROADMAP.md's "Make the solver rate-independent" asks
 * for, and what sets the ceiling that wedges the pile solid at 160 pieces.
 *
 * It is reached only through `lib/solver.ts`, which loads it dynamically so
 * the engine's WASM is never downloaded by anyone who has not asked for it.
 *
 * The contract is the classic solver's exactly: take the same `Shard[]` and
 * the same update, mutate the same fields, so the scene cannot tell the two
 * apart. Everything Rapier owns — the world, the bodies — is private to this
 * module and rebuilt whenever the glass it was built for changes.
 *
 * Two translations sit between the shards and the world:
 *
 * - **Scale.** Rapier's sleep thresholds are tuned for metres, and this cell
 *   is about one unit across — at that size a piece drifting visibly would
 *   count as asleep. So the world is built {@link WORLD_SCALE} times larger:
 *   positions, radii and accelerations are scaled going in and positions and
 *   velocities scaled back coming out, and the thresholds land near the
 *   classic solver's own sleep speeds.
 * - **The medium.** Rapier knows nothing about oil. In air the engine's own
 *   gravity and damping are the model, and the pile is left alone to sleep.
 *   In a liquid the velocities are scripted before each step exactly as the
 *   classic solver scripts them — buoyancy off the weight, drag against the
 *   swirling fluid rather than against rest, size deciding who sinks — and
 *   the engine keeps what it is good at: the contacts.
 */

/** Cell units to Rapier units. See the module note on sleep thresholds. */
const WORLD_SCALE = 10;

/** Substeps per frame, matched to the classic solver's. */
const SUBSTEPS = 4;

/** Segments the round wall is built from. */
const WALL_SEGMENTS = 128;

/** Glass barely bounces; what reads as glass is the sliding and the rolling. */
const RESTITUTION = 0.05;

let ready = false;

/** Loads the engine's WASM, once. Everything else here needs it first. */
export async function initRapier(): Promise<void> {
  if (!ready) {
    await RAPIER.init();
    ready = true;
  }
}

interface Built {
  world: RAPIER.World;
  bodies: RAPIER.RigidBody[];
  colliders: RAPIER.Collider[];
  /** What each body was built from, so a recut or reshape is noticed. */
  shards: Shard[];
  shapes: Shape[];
  radii: number[];
  /** What the world is currently tuned for, so a change retunes it once. */
  mediumId: Medium['id'];
  friction: number;
  drag: number;
  angularDrag: number;
  angle: number;
}

let built: Built | null = null;

/** Advances the chips in place, on Rapier. The classic solver's signature. */
export function updateChamberRapier(
  shards: Shard[],
  { dt, angle, medium = AIR, swirl = 0 }: ChamberUpdate,
): void {
  if (dt <= 0 || shards.length === 0 || !ready) {
    return;
  }

  const world = worldFor(shards, medium);
  const weight = GRAVITY * (1 - medium.density) * WORLD_SCALE;
  const downX = Math.sin(angle) * weight;
  const downY = Math.cos(angle) * weight;
  const liquid = medium.stir > 0;
  const flow = liquid ? swirl : 0;
  const step = dt / SUBSTEPS;

  world.timestep = step;

  // A sleeping island does not feel the world's gravity change, so turning
  // the tube has to wake the pile the way the classic solver's velocity pass
  // implicitly does.
  if (Math.abs(angle - built!.angle) > 1e-4) {
    for (const body of built!.bodies) {
      body.wakeUp();
    }
  }

  built!.angle = angle;

  if (!liquid) {
    // Air: the engine's own model is the right one. Gravity pulls, damping
    // stands in for the pile rattling energy out of itself, and the pile is
    // left alone so its islands can sleep.
    world.gravity.x = downX;
    world.gravity.y = downY;

    for (let pass = 0; pass < SUBSTEPS; pass += 1) {
      world.step();
    }
  } else {
    // Liquid: the classic solver's script, run against the engine's contacts.
    // Gravity is applied by hand inside the script, so the world holds none.
    world.gravity.x = 0;
    world.gravity.y = 0;

    for (let pass = 0; pass < SUBSTEPS; pass += 1) {
      for (let i = 0; i < shards.length; i += 1) {
        const body = built!.bodies[i]!;
        const shard = shards[i]!;
        const at = body.translation();
        // The fluid turns as one body, so its velocity here is the swirl
        // about the middle — already in world units, because the position is.
        const flowX = -flow * at.y;
        const flowY = flow * at.x;
        const velocity = body.linvel();
        const damping = dampingFor(shard, medium, step);
        const angularDamping = Math.max(0, 1 - medium.angularDrag * step);

        body.setLinvel(
          {
            x: flowX + (velocity.x + downX * step - flowX) * damping,
            y: flowY + (velocity.y + downY * step - flowY) * damping,
          },
          true,
        );
        body.setAngvel(flow + (body.angvel() - flow) * angularDamping, true);
      }

      world.step();
    }
  }

  for (let i = 0; i < shards.length; i += 1) {
    const shard = shards[i]!;
    const body = built!.bodies[i]!;
    const at = body.translation();
    const velocity = body.linvel();

    shard.x = at.x / WORLD_SCALE;
    shard.y = at.y / WORLD_SCALE;
    shard.vx = velocity.x / WORLD_SCALE;
    shard.vy = velocity.y / WORLD_SCALE;
    shard.rotation = body.rotation();
    shard.spin = body.angvel();
  }
}

/**
 * What fraction of its speed a piece keeps across one substep, in a fluid.
 *
 * The classic solver's own arithmetic — see `dampingFor` in `lib/chamber.ts`
 * for why the rate goes as one over the radius.
 */
function dampingFor(shard: Shard, medium: Medium, step: number): number {
  let rate = medium.drag;

  if (medium.dragBySize > 0 && shard.radius > 0) {
    const bySize = Math.min(3, Math.max(1 / 3, REFERENCE_PIECE / shard.radius));

    rate *= 1 + (bySize - 1) * medium.dragBySize;
  }

  return Math.max(0, 1 - rate * step);
}

/**
 * The world for this glass, built fresh when the glass changes.
 *
 * Identity says most of it: a scene's array is replaced when its glass is
 * recut, never grown in place. Shapes and radii are checked piece by piece as
 * well, because `applyCutShape` reshapes the pieces of an existing array once
 * a picture has been scored.
 */
function worldFor(shards: Shard[], medium: Medium): RAPIER.World {
  if (built && matches(built, shards)) {
    tune(built, medium);

    return built.world;
  }

  built?.world.free();

  const world = new RAPIER.World({ x: 0, y: GRAVITY * WORLD_SCALE });
  const bodies: RAPIER.RigidBody[] = [];
  const colliders: RAPIER.Collider[] = [];

  // The wall: a ring of segments, because an engine has convex shapes and a
  // cell is the inside of one. At this many segments the polygon is closer to
  // the circle than a piece's own size can feel.
  const ring = new Float32Array(WALL_SEGMENTS * 2);
  const joins = new Uint32Array(WALL_SEGMENTS * 2);

  for (let i = 0; i < WALL_SEGMENTS; i += 1) {
    const along = (i / WALL_SEGMENTS) * Math.PI * 2;

    ring[i * 2] = Math.cos(along) * CHAMBER_RADIUS * WORLD_SCALE;
    ring[i * 2 + 1] = Math.sin(along) * CHAMBER_RADIUS * WORLD_SCALE;
    joins[i * 2] = i;
    joins[i * 2 + 1] = (i + 1) % WALL_SEGMENTS;
  }

  const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const wall = world.createCollider(RAPIER.ColliderDesc.polyline(ring, joins), wallBody);

  wall.setFriction(medium.staticFriction);
  wall.setRestitution(RESTITUTION);

  for (const shard of shards) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(shard.x * WORLD_SCALE, shard.y * WORLD_SCALE)
        .setRotation(shard.rotation)
        .setLinvel(shard.vx * WORLD_SCALE, shard.vy * WORLD_SCALE)
        .setAngvel(shard.spin)
        .setLinearDamping(medium.stir > 0 ? 0 : medium.drag)
        .setAngularDamping(medium.stir > 0 ? 0 : medium.angularDrag),
    );

    for (const desc of colliderDescs(shard)) {
      const collider = world.createCollider(
        desc.setFriction(medium.staticFriction).setRestitution(RESTITUTION),
        body,
      );

      colliders.push(collider);
    }

    bodies.push(body);
  }

  built = {
    world,
    bodies,
    colliders,
    shards,
    shapes: shards.map((shard) => shard.shape),
    radii: shards.map((shard) => shard.radius),
    mediumId: medium.id,
    friction: medium.staticFriction,
    drag: medium.drag,
    angularDrag: medium.angularDrag,
    angle: 0,
  };

  return world;
}

/** True while the world still describes this glass. */
function matches(built: Built, shards: Shard[]): boolean {
  if (built.shards !== shards || built.shapes.length !== shards.length) {
    return false;
  }

  for (let i = 0; i < shards.length; i += 1) {
    if (built.shapes[i] !== shards[i]!.shape || built.radii[i] !== shards[i]!.radius) {
      return false;
    }
  }

  return true;
}

/** Brings a standing world onto a medium it was not built for. */
function tune(built: Built, medium: Medium): void {
  if (
    built.mediumId === medium.id &&
    built.friction === medium.staticFriction &&
    built.drag === medium.drag &&
    built.angularDrag === medium.angularDrag
  ) {
    return;
  }

  for (const collider of built.colliders) {
    collider.setFriction(medium.staticFriction);
  }

  for (const body of built.bodies) {
    // In a liquid the script below does the damping; the engine must not
    // damp on top of it.
    body.setLinearDamping(medium.stir > 0 ? 0 : medium.drag);
    body.setAngularDamping(medium.stir > 0 ? 0 : medium.angularDrag);
    body.wakeUp();
  }

  built.mediumId = medium.id;
  built.friction = medium.staticFriction;
  built.drag = medium.drag;
  built.angularDrag = medium.angularDrag;
}

/**
 * What a piece collides as.
 *
 * The hull of its traced silhouette where there is one — the whole point of
 * the spike, a splinter colliding as the splinter — and the classic chain of
 * circles where there is not, which is at least never a *worse* model than
 * the classic solver was running.
 */
function colliderDescs(shard: Shard): RAPIER.ColliderDesc[] {
  const size = shard.radius * WORLD_SCALE;
  const hull = shard.shape.hull;

  if (hull && hull.length >= 3) {
    const points = new Float32Array(hull.length * 2);

    for (let i = 0; i < hull.length; i += 1) {
      points[i * 2] = hull[i]!.x * size;
      points[i * 2 + 1] = hull[i]!.y * size;
    }

    const desc = RAPIER.ColliderDesc.convexHull(points);

    if (desc) {
      return [desc];
    }
  }

  return shard.shape.beads.map((bead) =>
    RAPIER.ColliderDesc.ball(bead.radius * size).setTranslation(bead.x * size, bead.y * size),
  );
}

/** Lets the world go, so a test can measure a rebuild or free the WASM's heap. */
export function dropWorld(): void {
  built?.world.free();
  built = null;
}
