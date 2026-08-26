import { CHAMBER_RADIUS, type Chamber, type ChamberStep, type ChamberView } from './chamber';
import { GROUND } from './color';
import { drawMedia, isMediaReady, type MediaElement } from './media';

/**
 * A chamber you can see through, with a picture behind it.
 *
 * A photograph, a live camera, a video, a canvas somebody else is drawing on —
 * anything that a browser will paint. This is the **teleidoscope**: a
 * kaleidoscope with an open end, mirroring whatever is out there rather than
 * a cell of glass. Which is why it is the one chamber that reports itself
 * {@link Chamber.open}, and so the one the body puts its bead over.
 *
 * Nothing here simulates anything. A picture has no physics: gravity arrives
 * every frame and is thrown away, because a photograph does not fall. The one
 * thing it does with the instrument's motion is lag behind the bearing a
 * little, the way anything loose in a tube does.
 *
 * ## Adding another one
 *
 * There is nothing to add. A video element is a {@link MediaElement} already,
 * so a video chamber is this chamber with a `<video>` handed to it. Something
 * that is not a media element — a shader, a page of text, a game — wants its
 * own file, and it needs exactly what this one has: a `ground`, an `open`, an
 * `update` it is free to ignore, and a `paint` that fills the disc.
 */

/**
 * How quickly the picture catches up with the bearing, per second.
 *
 * Loose contents are dragged round by friction rather than bolted to the wall:
 * they trail while the tube is turning and settle once it stops. Without this
 * lag the figure would revolve perfectly rigidly, which is the thing that reads
 * as a picture being rotated rather than an instrument being turned.
 */
const CATCHUP = 4;

/**
 * Furthest the picture may trail the bearing, in radians.
 *
 * Without a cap the lag settles at `rate / catchup`, so a brisk swipe leaves
 * the picture half a turn behind and it goes on unwinding for seconds after the
 * finger lifts — which reads as the tube still turning. Friction does not work
 * that way: past a point the contents simply get dragged along.
 */
const MAX_LAG = 0.3;

/**
 * How much of the cell a picture covers at zoom 1, in cell radii.
 *
 * More than the cell, and deliberately: `sqrt(3)` radii is the mirror
 * triangle's whole side, which is what a picture covered back when it was
 * drawn about the triangle's corner instead of about the cell. Keeping the
 * number means a photograph opens at the size it always has; what changed is
 * only *where* it is centred, which was the bug — see ROADMAP.md, "The media
 * axis".
 */
const COVER = Math.sqrt(3);

/** What a media chamber reads fresh every frame. */
export interface MediaChamberInputs {
  /**
   * The element to paint. A function, because a camera arrives late and a
   * picked photograph is replaced without the chamber being rebuilt.
   */
  media: () => MediaElement | null;
  /** The live magnification, from the pinch on the artwork. */
  zoom: () => number;
}

/**
 * Builds a chamber that shows whatever is in front of it.
 *
 * @param inputs Where to get the picture and how big to draw it. Left out, the
 *   chamber is an empty tube, which is what it looks like before a photograph
 *   has been picked or while the camera is still being asked for.
 */
export function createMediaChamber(
  inputs: MediaChamberInputs = { media: () => null, zoom: () => 1 },
): Chamber {
  // How far the picture is trailing the bearing, in radians. Its own, because
  // how loosely the contents are held is a property of the contents.
  let lag = 0;

  return {
    ground: GROUND,
    // The one open chamber there is. A teleidoscope's bead goes here.
    open: true,

    update(step: ChamberStep) {
      // Gravity is handed over every frame and ignored every frame, which is
      // the honest answer: a photograph does not fall.
      //
      // Exponential approach, clamped so a long frame cannot overshoot and
      // swing back, and capped so a flick does not leave the picture unwinding
      // for seconds afterwards.
      lag += (0 - lag) * Math.min(1, CATCHUP * step.dt) + step.turn * step.dt;

      if (Math.abs(lag) > MAX_LAG) {
        lag = Math.sign(lag) * MAX_LAG;
      }
    },

    paint(ctx: CanvasRenderingContext2D, view: ChamberView) {
      const media = inputs.media();

      // Not ready is not empty: a chosen source with no pixels yet leaves the
      // ground the body already painted, which is a tube with nothing down it
      // rather than a hole in the figure.
      if (!isMediaReady(media)) {
        return;
      }

      ctx.save();
      // Centred on the cell, like everything else in a chamber. It used to be
      // centred on the mirror triangle's corner, which put the middle of the
      // picture somewhere the bead's axis was not — and a grid photograph
      // through a full bead showed that plainly, as a blown-out patch off to
      // one side of every rosette.
      drawMedia(ctx, media, {
        // In cell units first and pixels second, like everything else in a
        // chamber, so the magnification cannot drift with the mirror size.
        // This is also how far a full drag carries it: a picture has a whole
        // photograph to travel over, and stopping it at the cell wall read as
        // the drag being broken.
        size: COVER * CHAMBER_RADIUS * view.scale,
        zoom: inputs.zoom(),
        // Turned by the bearing, a little behind it.
        rotation: view.rotation - lag,
        pan: view.drag,
        // The one thing the body actually asks for: the whole disc painted.
        // Past the picture's edges it continues as its own mirror image, so
        // there is no zoom and no drag that can leave a gap here.
        reach: view.reach * view.scale,
      });
      ctx.restore();
    },
  };
}
