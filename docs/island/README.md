# Island landing and sport selector

The opening screen at `/` has the approved distant island composition, the
Wee Sports wordmark and a small Play control. Play opens `/home`; it does not
create a room, request phone motion or enter browser fullscreen. The selector
uses the closer resort view with four venue labels. Tennis, Bowling and Table
Tennis reuse authenticated room creation, host-token storage and room routes.
Golf is informational. Table Tennis remains one player. The future billiards
area is a presentation reservation, not an advertised playable game.

The small Menu contains manual code joining, Profile & history, How to play,
Appearance and Motion. Direct `/join?code=…`, `/host/:code` and `/profile` links
continue to work and refresh in production. Returning from a closed lobby or
profile opens `/home`. Returning to a live lobby remains a separate action.
The gameplay, physics, rules, controller setup, same-room switching, transport
and save/recovery implementations were retained from the latest branch.

## Artwork and layout

The [artwork record](artwork.md) preserves the approved concepts, clean edited
PNGs, exact generation prompts and WebP encoding settings. Runtime art totals
about 804 KB across both views. It has no baked text or controls. Matching
Table Tennis pavilions were added to the two approved views without moving the
existing major venues. The supplied unapproved expansion draft was not used as
the replacement visual direction.

`client/src/lib/island.js` contains region identity, image dimensions, normalized
labels/anchors, neighboring-region slots and the reserved future billiards
area. Display names, player counts and support come from the existing sport
catalog and shared registry. Every playable catalog entry appears in Games,
even if its future venue has not yet been illustrated.

The image, SVG connectors and labels use one contained rectangle. Full scenery
remains visible on ultrawide screens; matching coastal color fills the side
space. Portrait screens keep the island and show readable game controls below
it. Games also provides a linear keyboard/screen-reader route on desktop.
There is no required dragging or hidden clickable scenery. Modal utilities
use native dialog focus behavior and restore focus on close.

Motion is limited to the brief scenery arrival and small control hover/focus
transitions. There is no image warping, animated video, continuous render loop
or invented 3D camera. The stored Motion preference, reduced-motion setting
and page visibility govern decoration. Leaving the island releases its
observers/listeners. Dark mode changes control surfaces while preserving the
sunlit artwork.

The source images are 1672 × 941, not native 4K renders. Large-TV layout checks
do not establish additional image detail or physical-device performance.

## Validation

The repair was built and reviewed on November 7, 2026. Build output, compiler
caches and disposable browser databases were kept outside tracked `build/`
and `dist/` directories. Build verification includes both island WebP assets,
all six HTML entry points and the required player/racket models.

- 534 root tests in 60 files passed, including new catalog/coordinate and
  production route/MIME coverage.
- TypeScript and the six-page production build passed.
- [13 focused island browser checks](browser-island.json) cover real room creation, duplicate activation,
  rejected requests/retry, offline/no replay, direct routes, manual joining,
  optional profile access, keyboard focus, themes, motion and viewport sizing.
  Real 32px browser font preferences were checked on desktop and portrait,
  including pointer access to Menu and the enlarged Games dialog.
- [12 existing platform browser flow checks](browser-platform.json) exercise guest play, bowling
  delivery/save, pause/reconnect, same-room sport switching, profiles and saved
  solo-game continuation through the new entry route.

Reviewed screenshots: [landing](screenshots/island-landing-1672.webp),
[island](screenshots/island-home-1672.webp),
[ultrawide](screenshots/island-home-2560.webp),
[portrait](screenshots/island-home-390.webp),
[larger text](screenshots/island-text-enlarged-390.webp) and
[larger-text menu](screenshots/island-menu-enlarged-390.webp).

These checks use generated inputs and software WebGL;
they do not measure physical-phone feel or end-to-end motion latency.
There were no React warnings or uncaught page errors. The environment blocked
the existing Google Fonts request; island typography uses local system fonts
and the other screens used their existing fallback fonts during verification.

To repeat with Playwright and Chromium available, start a disposable production
server and point `WEE_SMOKE_URL` at it:

```sh
WEE_SMOKE_URL=http://127.0.0.1:5173 node scripts/browser-island-smoke.cjs
WEE_SMOKE_URL=http://127.0.0.1:5173 node scripts/browser-platform-smoke.cjs
```

Use `WEE_SMOKE_REPORT` for a new JSON report path and
`WEE_SMOKE_SCREENSHOTS` for an island screenshot directory. Existing report
paths are not overwritten by the harness.
