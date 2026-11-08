# TV island and phone controller entry

At `/` and `/home`, computers and TVs show the island; phones and tablets show
a simple Controller screen. Device identity determines the role, independently
of viewport width. A narrow Windows window remains a host, a rotated phone
remains a remote, and desktop-mode iPads are recognized by their touch support.
Known Android TV, Fire TV, webOS and Tizen browsers take precedence over mobile
detection. Explicit `/join?code=…`, `/host/:code` and `/profile` routes retain
their existing session behavior.

## Phone

**Scan TV code** opens a camera dialog only after a tap. A native QR detector is
used when available; jsQR loads on demand as the portable fallback. Decoding
accepts four-character room codes or HTTP(S) `/join?code=…` links and strips
unrelated parameters. It preserves the TV's origin for secure tunnel links.
A phone's normal camera can still open the TV QR directly into the controller.

Closing the dialog, navigating away, hiding the page, or completing a scan stops
the camera tracks and decoding loop. A stream granted after closing is also
stopped. Camera denial/unavailability opens manual code entry. There are no
camera or motion requests, room creation or island-art downloads on entry.

**Profile & history** provides optional preferences and saved-game information.
Its return link opens the controller hub. Starting a saved solo game is offered
on the TV/computer profile only. Guest play and the existing one-tap Play/motion
permission flow are unchanged. Camera scanning and phone motion need HTTPS;
`npm run dev` supplies the existing secure phone tunnel.

## TV and computer

Landing Play opens the selector without creating a room. Tennis, Bowling and
Table Tennis reuse authenticated room creation and host-token storage. Golf
remains informational, Table Tennis supports one or two players, and the reserved future
billiards area is not advertised as playable. Menu contains manual joining,
profiles, help, appearance and Motion.

The updated artwork leaves more ocean around the resort. The whole island keeps
its aspect ratio and fits inside the available scene rectangle. A matching
sky/ocean plate extends behind it to all four screen edges, including tall and
ultrawide displays. Its horizon stays aligned with the island. Narrow windows
crop the backdrop horizontally to keep clouds in proportion; the island itself
remains uncropped. Compact home extends that backdrop behind the header and
Games list too. Soft masks blend only the sky and water margins. Venue labels, targets
and water highlights share the island's coordinates; enlarging text can move a
label inward without moving its venue target. Narrow computer windows retain
a compact Games list. This layout is not used as the phone homepage.

Labels are smaller, with thinner borders and a shared rounded typeface. Nunito
is served locally for the island, menu and remote hub. It is licensed under the
bundled SIL Open Font License. The [artwork record](artwork.md) contains sources,
prompts, compression settings and coordinates.

The original scenery now supplies localized WebGL water highlights, flowing falls,
gently bobbing/rocking boats, and slow cloud drift. No replacement images or
video assets are required. The island, buildings, coast, and UI retain their
existing design; authored masks confine movement to environmental details.
The renderer targets 30 fps at display resolution and preserves the still image
for unsupported or lost WebGL contexts. The camera and venue markers remain fixed;
there is no cursor-driven scene drift or whole-ocean texture wobble. Motion off, system
reduced motion, and page hiding stop rendering. Unmounting releases renderers,
observers, and listeners. Dark mode changes controls while keeping sunlit art.

Canvas resizing repaints synchronously before exposing its new buffer; transparent
clears reveal the original still instead of black. Zero-sized or unsupported
buffers also retain the still, and returning to a supported size resumes motion.
Returning to the tab no longer fades the whole island. The water, clouds, boats
and waterfall retain their environmental animation.

The motion preference uses a shared cached snapshot. Native media events,
visibility, storage and local toggles publish changes to every subscriber. This
avoids a reproduced quick-toggle race where live media-query reads during render
consumed a pending browser transition, leaving the menu and scenery out of sync.

## Validation

The responsive follow-up passed TypeScript/ESLint and **733 root tests in 86
files**, including ten renderer/lifecycle cases, seven motion-preference cases
and backdrop/horizon geometry.
The new resize browser check passed **36 same-page size combinations** across
landing and selector, at DPR 1 and 2. It checks resized-buffer visibility,
advancing animation, whole-island proportions, all-edge backdrop coverage,
textured water below the original artwork, keyboard controls and hidden-page /
reduced-motion recovery. Screenshots were reviewed at tall, half-size and wide
windows. The final island, animation, phone-entry and resize suites passed all
36 check groups with no browser errors. `verification-summary.json` maps their
final results. Evidence is in `/workspace/.cloud-setup/wee-sports/resize/`; these are
disposable local artifacts, not production assets. Native macOS window dragging
and physical-TV performance remain device checks.

The existing menu smoke exposed the motion-preference race twice before the
cache fix; its original assertions now pass. The animation smoke now waits for
the actual stopped canvas state before asserting zero subsequent draws, instead
of assuming a media event arrives within 150 ms during software rendering.
The original failures and focused reproductions remain in the evidence folder.

Earlier island integration was verified on 8 November 2026 with build output, compiler caches and disposable
databases outside tracked `build/` and `dist/`:

- 538 root tests in 61 files passed, including device roles, QR link parsing,
  catalog coordinates and production routes.
- TypeScript and the six-page production build passed. Build verification
  checks all four scenery assets, the local font and the required game models.
- [13 island browser checks](browser-island.json) cover desktop/TV/32:9 sizing,
  enlarged text, real room creation, duplicate activation, failures/retry,
  offline behavior, menus, profiles, themes and motion preferences.
- [10 phone browser checks](browser-remote-home.json) cover iPhone/Android/iPad
  routing, rotation, profile return, direct/manual joining, real QR-image
  decoding, denied/pending permission and camera cleanup.
- [Platform browser checks](browser-platform.json) cover guest play, bowling
  delivery/save, pause/reconnect, sport switching, profiles and TV recovery.

Reviewed previews: [TV landing](screenshots/island-landing-1672.webp),
[selector](screenshots/island-home-1672.webp),
[wide ocean](screenshots/island-home-2560.webp),
[phone controller](screenshots/phone-controller-home.webp),
[phone dark mode](screenshots/phone-controller-dark.webp), and
[narrow computer with larger text](screenshots/island-text-enlarged-390.webp).

Camera inputs and device identities are simulated in Chromium. Physical Safari
and Android camera focus/permission behavior still need device checks. Existing
gameplay checks use software WebGL and do not measure phone-to-TV motion latency.
The illustrations remain 1672 × 941 sources, not native 4K artwork.

To repeat against a disposable production server with Playwright and Chromium:

```sh
WEE_SMOKE_URL=http://127.0.0.1:5173 node scripts/browser-island-smoke.cjs
WEE_SMOKE_URL=http://127.0.0.1:5173 node scripts/browser-island-animation-smoke.cjs
WEE_SMOKE_URL=http://127.0.0.1:5173 node scripts/browser-island-resize-smoke.cjs
WEE_SMOKE_URL=http://127.0.0.1:5173 node scripts/browser-remote-home-smoke.cjs
WEE_SMOKE_URL=http://127.0.0.1:5173 node scripts/browser-platform-smoke.cjs
```

Use `WEE_SMOKE_REPORT` for a new JSON report path and
`WEE_SMOKE_SCREENSHOTS` for screenshots. Reports are not overwritten by a run.

The focused animation check samples actual WebGL output immediately after a
draw on both pages. It checks moving water, clouds, both boats, and waterfall
pixels against unchanged venue/foreground-plant samples. It also verifies
a fixed camera under pointer movement, reduced motion, page visibility, route cleanup, context loss, and unavailable
WebGL. These software-rendered checks do not establish physical TV frame rate.
Set `WEE_SMOKE_CHROMIUM` when Chromium is not installed at `/usr/bin/chromium`.


## Repository-local preview

The implementation lives in this checkout on `feat/sports-platform`. Run the
normal source preview with `npm run dev:local`, or use an isolated build and
disposable profile data inside the ignored `.local-preview/` directory:

```sh
WEE_BUILD_DIR=.local-preview/dist npm run build
PORT=5198 WEE_PROFILE_DB=.local-preview/profiles.sqlite WEE_BUILD_DIR=.local-preview/dist node server/main.js --production
```

This preview does not depend on `/tmp`. Generated preview files are ignored;
source code, tests and documentation remain normal repository files.
