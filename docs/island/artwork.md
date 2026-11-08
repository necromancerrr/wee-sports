# Island artwork

The TV scenery uses separate island and ocean plates, with live HTML/SVG labels.
All source images are 1672 × 941 pixels. These are illustrations, not 3D models
or native 4K renders. Phones do not download or display the island artwork.

## Source and provenance

The owner supplied `wee-sports-island-handoff.zip` and
`WEESPORTS-ISLAND-HANDOFF.md`. The untouched approved concepts are retained:

- [Approved selector](reference/approved-modern-homepage.png)
- [Approved landing](reference/approved-modern-landing.png)

The handoff identifies these as concepts previously made with the built-in image
generation tool. On 7 November 2026 the tool removed their baked interface and
added a matching Table Tennis pavilion. Those first clean versions remain at
[source/homepage.png](source/homepage.png) and
[source/landing.png](source/landing.png).

Following the owner's request for more ocean and an uncropped TV view, the tool
extended both compositions on 7–8 November 2026. The actual generated images
use a wider view; they did not retain an exact pixel-aligned central rectangle
as requested in the prompt. All venue targets were therefore re-authored and
visually checked against the outputs:

- [Wider selector](source/homepage-wide.png)
- [Wider landing](source/landing-wide.png)
- [Selector ocean extension](source/homepage-ocean.png)
- [Landing ocean extension](source/landing-ocean.png)

The last two edits remove all land and boats, leaving matching sky and ocean.
They sit behind the contained island view and fill horizontal space on wide
displays. Only these decorative ocean extensions can stretch horizontally.
The island, coastline, venues and boats preserve their aspect ratio. CSS masks
blend the image margins; no bitmap crop or recoloring is applied at runtime.
The main image URLs include version 2 to avoid pairing new venue targets with
the previous image in a browser's cache.

The supplied unapproved expansion draft was not used as the art direction.
No portrait island ships: phones use the controller hub. Exact prompts and
references are recorded in [generation-prompts.json](generation-prompts.json).

## Runtime assets and encoding

The four WebP files total 1,085,144 bytes (about 1.09 MB); each TV view loads
its own island and ocean pair. Encoding preserves the source dimensions.

```sh
convert docs/island/source/homepage-wide.png -strip -define webp:method=6 -quality 92 public/island/homepage.webp
convert docs/island/source/landing-wide.png -strip -define webp:method=6 -quality 92 public/island/landing.webp
convert docs/island/source/homepage-ocean.png -strip -define webp:method=6 -quality 88 public/island/homepage-ocean.webp
convert docs/island/source/landing-ocean.png -strip -define webp:method=6 -quality 88 public/island/landing-ocean.webp
```

The original WebP files also supply the optional WebGL motion layers. No artwork
is regenerated, resized on disk, or recompressed for animation. `IslandMotion`
paints at display resolution (up to 2× device scale); the underlying image stays
available if WebGL is absent, initialization fails, or its context is lost.
The image and canvas share one edge mask, avoiding double-opacity seams.

`client/src/lib/islandMotion.js` keeps effect coordinates in source-image space:

- The water texture stays fixed; broken reflected-light crests travel over it.
  Broad texture wobble has been removed.
- Clearly moving light streaks descend inside the waterfall, with localized
  foam at its base. Its original pixels and silhouette are never warped.
- Each boat has a rigid inner mask over the entire mast, sail, and hull, with
  feathering confined to surrounding water. Boats bob by up to 0.75 source pixels,
  drift horizontally by up to 8 pixels (2.5 for the distant boat), and rock by
  about 0.2 degrees at independent phases. The rigid mask includes the full
  travel range so neither the original nor the moving boat can duplicate.
- Clouds drift horizontally by up to 32 source pixels over a slow cycle,
  fading out before hills and the lighthouse. There is no vertical sky motion.
- Water masks exclude the coastline, venues, and both landing foreground islets.

The ocean extension has its own motion layer so ultrawide edges remain alive.
Rendering targets 30 frames per second without reducing artwork resolution.
Motion off, system reduced motion, hidden pages, and leaving the island stop
rendering and release animation resources. Device frame rate is not guaranteed;
the original full-quality image remains the fallback. The camera, island, and venue
anchors stay completely still when the pointer moves. Text and buttons remain
live UI. Motion off restores the untouched artwork.

## Selector targets

Coordinates are normalized against the entire wider selector image:

| Venue | Connector target |
| --- | --- |
| Golf | `(0.350, 0.398)` |
| Tennis | `(0.340, 0.640)` |
| Bowling | `(0.690, 0.486)` |
| Table Tennis | `(0.594, 0.424)` |

The Table Tennis pavilion is behind the bridge and left of Bowling. The game supports one or two players. Golf and the
reserved billiards area remain unavailable.

## Typography

The entry screens use the locally served Nunito variable Latin font,
`public/fonts/nunito-latin-variable.woff2` (39,128 bytes), from
`@fontsource-variable/nunito@5.3.0/files/nunito-latin-wght-normal.woff2`.
The source was downloaded from jsDelivr's npm mirror. The SIL Open Font License
is bundled as `public/fonts/OFL-nunito.txt`, obtained from
`google/fonts/main/ofl/nunito/OFL.txt`. Existing game typography is unchanged.
