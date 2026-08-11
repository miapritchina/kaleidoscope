# Object sets

Drop a picture in here and it becomes a preset in the **Pieces** control. Remove
it and the preset goes away. Nothing else to edit — the list is built from the
files by `src/lib/objectSets.ts`.

## What a picture has to be

- **PNG or WebP with an alpha channel.** The transparent parts are what tell the
  app where one object ends and the next begins; a photo on a white background
  works far less well, and a JPEG cannot carry the alpha at all.
- **A handful of separate objects**, not touching. Anything covering more than
  55% of the frame is read as "this picture has no background" and the set is
  refused; under 0.2% is read as a speck and skipped. Fewer than three objects
  and the picture is not used as a set at all.
- **Roughly compact shapes.** Each object is traced by casting rays out from its
  own middle, so gems, pebbles and beads come out exactly; a spiral or a
  horseshoe comes out filled in.
- Up to 24 objects are kept, largest first.

## Naming

The filename is the preset's name: `rough-quartz.png` shows up as "Rough
quartz". Keep it lowercase with hyphens.

## Licensing

Only put files in here that this repository is allowed to redistribute. Stock
site previews are not — several of them are watermarked, and the watermark ends
up on the pieces.
