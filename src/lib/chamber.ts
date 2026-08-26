/**
 * What a chamber is.
 *
 * A kaleidoscope is two parts that know almost nothing about one another. The
 * **body** is the tube: three mirrors, the framework they are set in, the
 * barrel, the eyehole and whatever glass is over the end. The **chamber** is
 * what is at the far end of it — loose glass, a cell of oil, a photograph, a
 * camera, a video, anything at all. Take one out and put another in and the
 * body does not change, because the body has never known what was in there.
 *
 * This file is the fitting between them, and it is deliberately small.
 *
 * ## The bargain
 *
 * The body promises:
 *
 * - The chamber is always the same size. {@link CHAMBER_RADIUS} is fixed and
 *   nothing the chamber does can change it — not the count of pieces, not the
 *   substance, not the zoom. Whatever is drawn is drawn into a disc of that
 *   radius, and the body scales that disc onto the mirror triangle.
 * - The chamber is handed a clean context every frame: cleared to its own
 *   {@link Chamber.ground}, with the middle of the cell at the origin and one
 *   cell unit worth {@link ChamberView.scale} pixels. Whatever the chamber
 *   leaves behind on the context is put back before anything else is drawn.
 * - Gravity arrives already worked out. Which way the mirrors are set, how far
 *   the tube is being held over, how far the chamber has been turned in its
 *   own bearing — all of that is the body's arithmetic, and what comes out of
 *   it is one angle in the chamber's own frame. A chamber never sees a mirror.
 *
 * The chamber promises one thing in return:
 *
 * - **It paints its whole disc.** Out to {@link ChamberView.reach}, which is a
 *   little past the wall, every pixel is covered. A chamber that leaves a gap
 *   is a chamber that puts a hole in the figure — the optics sample the disc
 *   all over, and what they find unpainted comes back as nothing at all.
 *
 * Keep that bargain and the triangle logic cannot break. This is not a hope:
 * the body's sampling is contained in the disc by construction — see the note
 * on the bead in `lib/body.ts` — so a chamber that fills the disc leaves the
 * optics nowhere to look that has not been painted.
 *
 * ## Writing a new one
 *
 * A chamber is an object with four members. There is no base class to extend
 * and nothing to register beyond one line in `lib/chambers.ts`. A chamber that
 * shows a video is a dozen lines: hold the element, paint it across the disc
 * in {@link Chamber.paint}, and ignore {@link Chamber.update} entirely — the
 * video has its own idea of time and does not want gravity.
 */

/**
 * Radius of every chamber, in cell units.
 *
 * The one fixed dimension of the fitting, and the reason a chamber can be
 * swapped without the body noticing. Everything inside a chamber is quoted in
 * these units, so a chamber never learns how many pixels it is being drawn at
 * and a body never learns what is inside it.
 *
 * The cell is round: a cylindrical tube with the mirror triangle inscribed in
 * it and a round chamber capping the end, which is how most kaleidoscopes are
 * built. The body maps this radius onto the triangle's circumradius, so the
 * corners of the view touch the wall, everything the mirrors can see is
 * simulated, and the glass beyond a mirror is the glass that would sit behind
 * it in a real tube.
 *
 * It used to be a triangle whose walls were the mirrors — a real but less
 * common construction, chosen on a measurement that did not support it: a disc
 * tried with *ten pieces in it* came out nearly bare, which shows that an
 * empty disc behaves badly, not that a disc does. A circle holds no direction
 * specially, so no wall can be the one the heap has fallen away from — the
 * bare strip that was the triangular cell's photographed defect — and the
 * sixty-degree corners the glass used to wedge into are gone, along with the
 * rounding-off that compromise needed. What the circle asks in exchange is
 * glass: the triangle is 41% of the disc, so the cell only reads as full when
 * it holds more than twice the pieces the triangle needed. See ROADMAP.md,
 * "Make the chamber round".
 */
export const CHAMBER_RADIUS = 1.15;

/** A finger in the chamber, in the chamber's own frame and its own units. */
export interface ChamberTouch {
  x: number;
  y: number;
  /** How fast it is moving, in cell units per second. */
  vx: number;
  vy: number;
}

/** What the body tells the chamber, once per frame. */
export interface ChamberStep {
  /** Seconds since the previous frame. Already clamped by the body. */
  dt: number;
  /**
   * Which way is down, in the chamber's own frame, in radians.
   *
   * The whole of what the instrument does to what is inside it. The body has
   * already composed the three things that move it — how far the mirrors are
   * set, how far the phone is being held over, and how far the chamber has
   * been turned in its bearing — so a chamber takes this at face value and
   * never asks how the tube is being held.
   */
  gravity: number;
  /**
   * How fast the chamber is being turned, in radians per second.
   *
   * The wall's own rate, for chambers with something loose in them that the
   * wall can drag round. Nought when nothing is turning it.
   */
  turn: number;
  /** A finger stirring the contents, or nothing. */
  touch: ChamberTouch | null;
}

/** Where the body has put the chamber, and what the light is doing. */
export interface ChamberView {
  /** Cell units to device pixels. */
  scale: number;
  /**
   * How far the chamber has been turned in its bearing, in radians.
   *
   * The chamber's own rotation and nothing else. Turning the body turns the
   * mirrors and the chamber together, and the body has already applied that
   * to the whole figure — so what arrives here is only what the chamber has
   * been turned by on its own.
   */
  rotation: number;
  /**
   * How far the viewer has dragged the contents, each axis in `[-1, 1]`.
   *
   * A position rather than a velocity: it follows the pointer and stays where
   * it is let go. Left as a share of a full drag rather than converted to cell
   * units, because what a full drag is *worth* is the chamber's to say — a
   * pile of glass slides a little way across its cell, and a photograph has a
   * whole picture to travel over.
   */
  drag: { x: number; y: number };
  /**
   * How far out from the centre is worth painting, in cell units.
   *
   * A little past the wall. The mirrors' clips are bled outwards by a pixel or
   * two so that neighbouring reflections meet without a gap, and a chamber
   * that can cheaply paint past its own wall should paint out to here so the
   * bleed lands on its picture rather than on bare ground. A chamber whose
   * contents physically cannot leave the wall — a pile of glass — ignores it.
   */
  reach: number;
  /**
   * Where the room's light is, in the chamber's own frame.
   *
   * The light stays where it is and the instrument turns under it, which is
   * why anything shiny in a chamber fires in waves as the phone moves and sits
   * still when it does not.
   */
  light: { x: number; y: number; z: number };
}

/** What a chamber sounded like over one frame. */
export interface ChamberSound {
  /** Knocks between hard things, strongest first. */
  impacts: readonly { strength: number; size: number }[];
  /** How loudly the fluid in it is washing about, `0` to `1`. */
  wash: number;
}

/**
 * Something that can be put in the far end of a kaleidoscope.
 *
 * Four members, none of them about mirrors. See the file comment above for the
 * bargain each side is keeping.
 */
export interface Chamber {
  /**
   * What the body paints behind it, as a CSS colour.
   *
   * A cell is lit from behind, and what it is lit against is the chamber's
   * business: white for anything a dye or a coloured liquid is seen through,
   * because that is what makes them read as transmitted colour rather than as
   * paint; dark for something whose whole business is being brighter than what
   * is behind it.
   */
  readonly ground: string;
  /**
   * Whether this end of the tube is open.
   *
   * A teleidoscope is a kaleidoscope with an open end and a solid glass bead
   * over it, and it mirrors whatever it is pointed at. An object cell is the
   * other thing: it caps the tube, and there is no objective in front of it to
   * put a bead over. So the body puts its bead over an open chamber and never
   * over a closed one — which is the owner's standing decision that the bead
   * never touches the chamber, said once, here, in a way a new chamber can
   * answer for itself.
   */
  readonly open: boolean;
  /** Advances whatever is inside by one frame. A chamber with nothing moving in it may do nothing. */
  update(step: ChamberStep): void;
  /**
   * Paints the contents, centred on the origin.
   *
   * The context arrives cleared to {@link Chamber.ground}, with the middle of
   * the cell at `(0, 0)` and no rotation applied — turning with the bearing is
   * the chamber's own doing, since only the chamber knows what part of it the
   * bearing actually carries. Save and restore are the body's; a chamber may
   * leave the context in any state it likes.
   */
  paint(ctx: CanvasRenderingContext2D, view: ChamberView): void;
  /** What it sounded like, for a chamber that makes a noise. */
  listen?(): ChamberSound;
}
