import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { CHAMBER_RADIUS, type ChamberView } from './chamber';
import { createMediaChamber } from './mediaChamber';
import type { MediaElement } from './media';

/** A photograph, as far as anything that draws one is concerned. */
function picture(width = 800, height = 600): MediaElement {
  return { naturalWidth: width, naturalHeight: height } as unknown as MediaElement;
}

const view = (over: Partial<ChamberView> = {}): ChamberView => ({
  scale: 100,
  rotation: 0,
  pan: { x: 0, y: 0 },
  drag: { x: 0, y: 0 },
  reach: CHAMBER_RADIUS,
  light: { x: 0, y: 1, z: 1 },
  ...over,
});

function painted(chamber: ReturnType<typeof createMediaChamber>, over?: Partial<ChamberView>) {
  const ctx: FakeContext = createFakeContext();

  chamber.paint(asContext(ctx), view(over));

  return ctx;
}

describe('createMediaChamber', () => {
  // The one chamber that is a tube you look down rather than a cell that caps
  // it, which is the whole of what decides whether a bead goes in front.
  it('is the open end of the tube', () => {
    expect(createMediaChamber().open).toBe(true);
  });

  it('paints nothing at all without a picture', () => {
    expect(painted(createMediaChamber()).countOf('drawImage')).toBe(0);
  });

  // Not ready is not the same as absent: a camera that has been asked for but
  // has not produced a frame has a size of nought, and drawing it paints
  // nothing while claiming to have painted something.
  it('waits for a picture to have pixels', () => {
    const chamber = createMediaChamber({ media: () => picture(0, 0), zoom: () => 1 });

    expect(painted(chamber).countOf('drawImage')).toBe(0);
  });

  // The one thing the body actually asks of a chamber. Whatever the zoom and
  // whatever the drag, the disc comes out covered — the picture is repeated in
  // mirror past its own edges, so there is no edge to fall off.
  it('covers its whole disc at any zoom and any drag', () => {
    for (const zoom of [0.05, 0.4, 1, 4]) {
      for (const drag of [0, 0.5, 1]) {
        const chamber = createMediaChamber({ media: () => picture(), zoom: () => zoom });
        const ctx = painted(chamber, { drag: { x: drag, y: -drag } });
        const stamps = ctx.argsOf('drawImage') as [unknown, number, number, number, number][];

        expect(stamps.length).toBeGreaterThan(0);

        // The picture is laid down at the origin and each copy translated into
        // place, so where a copy reaches is its own translate plus its size.
        // The first translate is the drag, which moves the whole tiling.
        const [, ...placed] = ctx.argsOf('translate') as [number, number][];
        const [, , , width, height] = stamps[0]!;
        const spread = {
          left: Math.min(...placed.map(([x]) => x)) - width / 2,
          top: Math.min(...placed.map(([, y]) => y)) - height / 2,
          right: Math.max(...placed.map(([x]) => x)) + width / 2,
          bottom: Math.max(...placed.map(([, y]) => y)) + height / 2,
        };
        const reach = CHAMBER_RADIUS * 100;
        const where = `zoom ${String(zoom)} drag ${String(drag)}`;

        expect(spread.left, where).toBeLessThanOrEqual(-reach);
        expect(spread.top, where).toBeLessThanOrEqual(-reach);
        expect(spread.right, where).toBeGreaterThanOrEqual(reach);
        expect(spread.bottom, where).toBeGreaterThanOrEqual(reach);
      }
    }
  });

  // A photograph does not fall. Gravity arrives every frame and is thrown away,
  // which is the honest answer rather than an oversight.
  it('ignores gravity', () => {
    const still = createMediaChamber({ media: () => picture(), zoom: () => 1 });
    const tipped = createMediaChamber({ media: () => picture(), zoom: () => 1 });

    for (let frame = 0; frame < 30; frame += 1) {
      still.update({ dt: 1 / 60, gravity: 0, turn: 0, touch: null });
      tipped.update({ dt: 1 / 60, gravity: Math.PI, turn: 0, touch: null });
    }

    expect(painted(still).argsOf('rotate')).toEqual(painted(tipped).argsOf('rotate'));
  });

  // Loose contents are dragged round by friction rather than bolted to the
  // wall: they trail while the tube is turning and settle once it stops.
  it('lets the picture trail the bearing while it turns, and settle after', () => {
    const chamber = createMediaChamber({ media: () => picture(), zoom: () => 1 });
    const turnedTo = (frames: number, turn: number) => {
      for (let frame = 0; frame < frames; frame += 1) {
        chamber.update({ dt: 1 / 60, gravity: 0, turn, touch: null });
      }
    };

    turnedTo(10, 2);
    const bearing = (10 * 2) / 60;
    const [turning] = painted(chamber, { rotation: bearing }).argsOf('rotate') as [[number]];

    expect(turning[0]).toBeLessThan(bearing);
    expect(turning[0]).toBeGreaterThan(0);

    turnedTo(120, 0);
    const [settled] = painted(chamber, { rotation: bearing }).argsOf('rotate') as [[number]];

    expect(settled[0]).toBeCloseTo(bearing, 3);
  });

  // Uncapped, the lag settles at rate over catchup, so a brisk swipe leaves the
  // picture half a turn behind and it goes on unwinding after the finger lifts.
  it('caps how far the picture can trail, however fast the turn', () => {
    const chamber = createMediaChamber({ media: () => picture(), zoom: () => 1 });

    for (let frame = 0; frame < 60; frame += 1) {
      chamber.update({ dt: 1 / 20, gravity: 0, turn: Math.PI * 4, touch: null });
    }

    const [turned] = painted(chamber, { rotation: 0 }).argsOf('rotate') as [[number]];

    expect(Math.abs(turned[0])).toBeLessThanOrEqual(0.3 + 1e-9);
  });
});
