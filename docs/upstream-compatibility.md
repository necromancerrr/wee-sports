# Fork integration, 2026-11-11

`compat/reduce-upstream-conflicts` merges team main `78d04a0` into fork main
`639a3bf`. It is a fork integration baseline, not an all-features submission to
the team. Neither main branch is replaced, and no pull request is opened.

## Decisions

- Adopt upstream's `server/tests` layout, Vitest aliases and `test:node` subset.
  Move all 71 fork root suites and upstream's 10 room/socket suites without
  dropping the fork's assertions. Keep the remaining Node suites and Expo CI.
- Integrate the team's TV swing diagnostics through `GameFrame`, the fork's
  replacement for `PrototypeFrame`. Accepted direct and relayed swings share
  one notification; duplicates, stale games and inactive inputs cannot trigger
  it. Clear the overlay timer on pause, game replacement and unmount.
- Retain the active gyro classifier and `swingStream` used by browser and Expo.
  Preserve upstream's acceleration-threshold detector separately in
  `src/controller/accelerationSwing.js`, with its six tests. Its fixed power
  and one-second cooldown are not silently substituted into existing gameplay.
- Keep upstream's orientation calibration module available, but do not wire
  mandatory calibration into this fork's lobby. The fork's automatic setup,
  touch fallback and phone-leader start remain coherent across client/server.
  `RoomStore`, the socket handlers, protocol and phone pages retain that flow.
  This is an explicit behavioral disagreement for team review, not an assertion
  that all of upstream's behavior has been adopted.
- Keep generated `dist` output ignored. Retain the fork's gameplay, profile,
  recovery, production checks, phone UI and Expo implementation.

## Conflict measurements

Local `git merge-tree --write-tree --name-only` simulations against the exact
heads below give these counts of unmerged paths:

| Target | Original fork | Integrated branch |
| --- | ---: | ---: |
| Team main `78d04a0` | 36 | 0 |
| Pending PR #14 `04fc805` | 39 | 8 |

PR #14 is still open and is not included. Remaining conflicts are
`client/src/components/PrototypeFrame.jsx`, `client/src/components/TvGame.jsx`,
`server/relay.js`, `server/src/RoomStore.js`,
`server/tests/controller-motion.test.js`, `src/controller/main.js`,
`src/network/lobbyConnection.js` and `src/network/swingConnection.js`.
They require review of orientation, input payloads and controller lifecycle.
Do not resolve them by dropping authentication, deduplication or freshness
checks. Zero conflicts with current main means the current integration is
resolved; it does not establish product agreement or guarantee future merges.

## Subsequent submissions

Preserve the proposed numbering and prepare four feature branches from the
then-current team main, stacking only where dependencies require it:

1. Shared platform, lobby, browser phone UI/controller, and input transport.
2. Tennis and bowling gameplay, scoring, responsiveness and TV presentation.
4. Expo native controller, sharing the platform/protocol from PR 1.
5. Profiles, supported saved games/history, recovery and production hardening.

The island homepage/map/artwork and Table Tennis remain excluded from those
submissions. They are not deleted from the existing fork in this integration.
Do not submit this entire branch as PR 1. The fork has shared imports and
protocol/profile handling for Table Tennis; extracting the four branches must
remove those dependencies coherently and rerun their tests. Those feature
branches have not yet been extracted, so the table above is not a per-PR
mergeability guarantee.

## Validation

Validated with Node 24.22.2 and npm 11.9.0:

- TypeScript and semantic ESLint checks pass.
- Vitest: 1,007 tests pass across 101 files, including the migrated suites and
  the new input-diagnostics regression. Remaining Node suites: 95 tests pass.
- Expo: 85 tests pass; Android and iOS bundle exports pass.
- Production build and all page/model/artwork verification pass. The existing
  large shared rendering chunk still produces Vite's size warning.
- Motion replay: all 19 expected strokes in five recordings pass in both
  modes, with identical canonical-unit conversion. Fast confirmation remains
  median 51 ms and p95 100 ms on the recording clock.
- Headless Chrome 156: platform smoke passes all 14 checks, including actual
  tennis input reaching the debug overlay, label expiry, shared pause/resume,
  room closure, profile authorization and exact saved-bowling recovery. The
  old smoke expected a join-page Play button after closure; it now verifies
  the existing `/home` redirect and removal of the controller iframe.
- Synthetic-motion browser smoke passes all 12 checks, including motion
  routing, denied/silent sensor fallback, background interruption and sport
  switching, with no uncaught page errors in either browser run.

These checks do not establish physical-phone sensor behavior, permissions,
haptics, live motion latency or installed native performance. Hardware trials
remain necessary before describing the controller as fully device-verified.
