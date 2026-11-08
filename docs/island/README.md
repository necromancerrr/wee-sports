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
ocean-only plate extends behind it to both screen edges, including ultrawide
displays. Soft masks blend only the sky and water margins. Venue labels, targets
and water highlights share the island's coordinates; enlarging text can move a
label inward without moving its venue target. Narrow computer windows retain
a compact Games list. This layout is not used as the phone homepage.

Labels are smaller, with thinner borders and a shared rounded typeface. Nunito
is served locally for the island, menu and remote hub. It is licensed under the
bundled SIL Open Font License. The [artwork record](artwork.md) contains sources,
prompts, compression settings and coordinates.

Small SVG water highlights and waterfall streaks animate through CSS. Fine
pointer movement adds up to four pixels of depth while moving art and venue
markers together. Motion off, system reduced motion and page hiding stop these
effects. Unmounting releases observers and listeners. Dark mode changes control
surfaces while keeping the sunlit artwork.

## Validation

Verified on 8 November 2026 with build output, compiler caches and disposable
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
WEE_SMOKE_URL=http://127.0.0.1:5173 node scripts/browser-remote-home-smoke.cjs
WEE_SMOKE_URL=http://127.0.0.1:5173 node scripts/browser-platform-smoke.cjs
```

Use `WEE_SMOKE_REPORT` for a new JSON report path and
`WEE_SMOKE_SCREENSHOTS` for screenshots. Reports are not overwritten by a run.
