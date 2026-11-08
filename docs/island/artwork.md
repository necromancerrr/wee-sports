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

Small SVG highlights are restricted to authored open-water masks; a few dashed
streaks follow the waterfall. CSS provides the animation. Buildings and shore
geometry do not warp. Image and connectors share the same small pointer offset.

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
