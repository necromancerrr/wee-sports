# Island artwork

The runtime scenery is a pair of clean illustrated plates, with application
text and controls rendered separately as HTML/SVG. Both plates are 1672 × 941
pixels. They are not 3D models or native 4K renders.

## Source and provenance

The owner supplied `wee-sports-island-handoff.zip` and
`WEESPORTS-ISLAND-HANDOFF.md` for this implementation. The untouched approved
concepts are retained as comparison targets:

- [Approved selector](reference/approved-modern-homepage.png)
- [Approved landing](reference/approved-modern-landing.png)

The handoff identifies these concepts as images previously created with the
built-in image-generation tool. They are visual concepts, not screenshots of
an earlier implemented application. The unapproved expansion draft in the
package was inspected but was not used as the source image for these edits.

On 7 November 2026, the built-in image-generation tool edited the approved
selector directly. It removed baked text, controls, connectors and cyan
selection outlines, repaired the exposed scenery, and replaced the small
center-right cabin with an open white-and-timber Table Tennis pavilion. The
approved landing was then edited using its original camera composition, with
the cleaned selector as a secondary reference for the matching pavilion.

The resulting original PNGs are retained under `source/`:

- [Clean selector](source/homepage.png)
- [Clean landing](source/landing.png)

`public/island/homepage.webp` and `public/island/landing.webp` are high-quality
WebP encodings of those PNGs, at their original dimensions. No crop, stretching,
sharpening, recoloring, or resolution upscale is applied during encoding. The
browser preserves the image aspect ratio and uses the same image rectangle for
venue anchors. There are no animation masks or extracted moving objects in
this asset version; the scenery remains static.

## Re-encode

With ImageMagick and WebP support available, run from the repository root:

```sh
convert docs/island/source/homepage.png -strip -define webp:method=6 -quality 92 public/island/homepage.webp
convert docs/island/source/landing.png -strip -define webp:method=6 -quality 92 public/island/landing.webp
```

Inspect the result at native size before accepting future art or compression
changes. Generation prompts are preserved in [generation-prompts.json](generation-prompts.json).

## Selector anchors

Coordinates are normalized against the full clean selector image. They locate
visible venues, independent of a particular viewport:

| Venue | Suggested connector target |
| --- | --- |
| Golf | `(0.240, 0.315)` |
| Tennis | `(0.268, 0.673)` |
| Bowling | `(0.790, 0.413)` |
| Table Tennis | `(0.640, 0.375)` |

Table Tennis is a small garden pavilion behind the bridge, left of Bowling.
Its two illustrated tables do not imply multiplayer support. The current
platform's Table Tennis mode remains one player. Golf and the reserved future
billiards area are not made playable by the artwork.
