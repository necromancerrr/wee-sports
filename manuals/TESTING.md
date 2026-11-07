# Testing

```sh
npm run compile       # TypeScript check
npm test              # Vitest: simulation, controller and service tests
npm --prefix server test  # Node: room state and real Socket.IO transport tests
npm run test:watch    # watch mode
npm run test:physics  # physics and bot tests
npm run lint          # style checks
node scripts/replay-motion.mjs  # recorded detector + canonical-unit compatibility
```

Root `npm ci` installs the local `@wee/shared` npm workspace used by the
standalone server suite; separate server/client installs are unnecessary.

The replay runner checks five original recordings with 19 expected strokes in
each detector mode, records fixture/source hashes, and verifies that canonical
SI conversion preserves labels and timing. Use `--json new-report.json` to retain
evidence; an existing report is never overwritten. These are detector-only
same-recording-clock timings, not physical motion-to-display measurements.

Use the [build manual's external output paths](BUILD.md) when checks should leave
tracked generated files alone. Native validation lives in
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
