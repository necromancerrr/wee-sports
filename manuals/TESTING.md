# Testing

```sh
npm run check         # TypeScript and semantic lint across first-party code
npm run compile       # TypeScript check only
npm test              # Vitest: simulation, controller and service tests
npm --prefix server test  # Node: room state and real Socket.IO transport tests
npm run test:watch    # watch mode
npm run test:physics  # physics and bot tests
npm run lint          # JavaScript/JSX/TypeScript correctness checks
node scripts/replay-motion.mjs  # recorded detector + canonical-unit compatibility
```

Root `npm ci` installs the local `@wee/shared` npm workspace used by the
standalone server suite; separate server/client installs are unnecessary.

The replay runner checks five original recordings with 19 expected strokes in
each detector mode, records fixture/source hashes, and verifies that canonical
SI conversion preserves labels and timing. Use `--json new-report.json` to retain
evidence; an existing report is never overwritten. These are detector-only
same-recording-clock timings, not physical motion-to-display measurements.

Lint includes browser/native code, server code, scripts and tests, with the
appropriate platform globals and TypeScript promise checks. It does not impose
a formatting rewrite on the existing source; `.prettierrc.cjs` remains the
optional formatter configuration. `npm run fix` applies ESLint's available fixes.

Use the [build manual's external output paths](BUILD.md) to keep validation
builds separate. Native validation lives in
[apps/controller](../apps/controller/README.md). A native bundle export is not an
installed-device test.

Automated tests and headless browser checks cannot establish real-phone sensor
axes, permission behavior, haptic output, grip feel or live physical latency.
Follow the [owner trial runbook](../docs/system-plan/README.md) and record the
[device matrix and acceptance evidence](../docs/system-plan/acceptance.md).
Distinguish passing automated checks, unrun hardware gates, and measured results.

Against a disposable built server, `scripts/browser-platform-smoke.cjs` checks
one-tap Play with automatic touch fallback, same-room switching, profiles and
recovery. `scripts/browser-motion-smoke.cjs` generates deterministic DeviceMotion
events to check real controller/socket behavior, permission-call timing, curve
direction and lifecycle cancellation. Both require an environment-provided
Playwright and Chromium; commands are in the owner trial runbook. Neither
runner exercises a physical sensor or a real permission dialog.

`scripts/browser-island-smoke.cjs` checks landing/map navigation, actual room
creation, offline/retry handling, utility access and responsive controls.
`scripts/browser-island-resize-smoke.cjs` adds continuous same-page size changes,
Retina resolution, backdrop coverage/texture, buffer repaint timing and
reduced-motion/hidden-page recovery on both island routes. The animation runner
checks moving environmental details and unchanged venues. These use software
WebGL; native macOS window dragging still needs a physical-browser check.
See the [island implementation](../docs/island/README.md) for its reference art
and browser evidence. The existing platform and motion runners enter `/home`.

The [game-quality follow-up](../docs/game-quality.md) explains the repeatable
shot matrix, 12-point/deuce rules, three-set tennis, aim feedback, 60 Hz input
scheduling and current Expo checks. Root tests cap worker concurrency at four
to keep CPU-heavy rigid-body tests reliable on shared runners. Browser roll
waits allow software rendering to reach the actual settled boundary; they
must not be read as a real-device performance benchmark.
