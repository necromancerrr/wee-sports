# Acceptance evidence and remaining device gates

Baseline source: `necromancerrr/wee-sports`,
`1410caf713e7e6c27c16ab18339246d805b22e60`. Implementation work is a local change set
on that baseline; an unchanged HEAD alone does not identify uncommitted source.
No deployment, native signing, or store distribution is part of this evidence.

## Baseline verified during cloud onboarding

| Check | Observed result |
| --- | --- |
| Runtime | Node 24.22.1; npm 11.9.0 |
| Root dependency install | Successful frozen-lockfile installation |
| TypeScript | Passed |
| Root Vitest suite | 363 tests passed in 43 files |
| Standalone Node server suite | 129 tests passed after linking the local `@wee/shared` package |
| Production build | Passed; four page entries and both GLB model files verified |
| Chromium browser smoke | Tennis and Bowling lobby creation, separate-context player join, live roster update, and room closure passed in development and production serving |
| Hardware motion, sensor permission, haptics | Not run on a physical phone |

These are baseline results. New feature checks are recorded separately after
integration; baseline counts must not be reused as evidence for new features.

## Detector replay reproduced

`node scripts/replay-motion.mjs` replays five checked-in teammate recordings and
checks all expected labels in both detector modes. [The retained JSON](detector-baseline.json)
contains fixture byte hashes, detector source hashes, runtime version, online
emission timestamps, and per-stroke results.

| Mode | Strokes | Minimum | Median | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fast | 19 | 67 ms | 84 ms | 150 ms | 150 ms |
| Completed | 19 | 150 ms | 217 ms | 317 ms | 317 ms |

The duration is recorded peak to the first online detector emission on the same
fixture clock. Final flushing must not create or duplicate strokes. This is a
small selected dataset, not a general recognition-accuracy benchmark. It excludes
live sensor delivery, network transport, contact scheduling, rendering and
haptics. The evidence audit's mention of protocol version 3 is stale: the
implementation baseline already used version 4.

The [canonical roundtrip report](motion-roundtrip.json) additionally passes each
sample through browser degrees → shared SI radians → legacy degrees and compares
both detector modes with their direct-recording baseline. All labels, peak times
and online confirmation times match (floating-point tolerance: 0.000001 ms). This
verifies extraction compatibility; it does not establish real-device axis signs.

## Implementation validation

The following integrated checks have run against the local implementation:

| Command | Observed result |
| --- | --- |
| TypeScript compile | Passed with the incremental build cache outside the checkout |
| `npm test -- --reporter=default` | 433/433 passed in 50 files (8.56 s); includes canonical motion, bowling, table-tennis physics/rules, profiles, SQLite restart recovery and recovery leases |
| `npm --prefix server test` | 161/161 passed; the current platform/recovery/profile-socket subset was also rerun after recovery-lease integration (32/32) |
| Production build | Passed: six page entries and required GLB assets verified using an external output directory |
| Optional native controller | 12/12 transport/scanner/sensor-lifecycle/guest-claim tests passed; Metro/Hermes exports completed for Android and iOS; this is bundle validation, not installed-device acceptance |
| `node --test server/src/platform.test.js` | 20/20 passed: capability opt-in, authenticated routing, payload/sequence rejection, pause generations, host epochs, reconnect, current-turn aim, same-room switching, private action status, required modern input envelopes, checkpoint authorization/revisions/saved status, lost acknowledgements and replaced-host late replies; includes real Socket.IO clients |
| Production Chromium touch smoke | Separate host/phone contexts: guest Bowling join/setup/Ready, authenticated live aim, one settled roll, saved boundary, pause/resume, TV reload restoring the same frame/ball, same-room switch to Table Tennis practice, phone feed/stroke and scored bot mode, switch to existing Tennis, room close; passed with no uncaught page errors |
| Production profile browser/API smoke | Registration, save preferences, reload/sign-out/sign-in, retained playing hand, recent history UI, stale profile revision rejected with 409 and guest history rejected with 401; passed |
| Profile Continue browser flow | Same account on host and a separate phone context; save a solo bowling roll, close the original room, continue from Profile, receive a new room code, preserve the original player name, Ready, restore frame/rack, receive a saved acknowledgement, compare complete persisted checkpoint state and verify the source is unchanged; passed |

Browser evidence uses headless Chromium with software rendering over local HTTP.
It does not exercise a physical phone, a complete ten-frame game, or a complete
scored bot game. The reusable runner is
[`scripts/browser-platform-smoke.cjs`](../../scripts/browser-platform-smoke.cjs).
The [retained browser report](browser-smoke.json) records all 12 successful
checks, runtime/browser versions and zero uncaught page errors. Its Continue
flow closes a live room; the separate SQLite/socket restart regression covers
closing and reopening the persistence service before restoration.

Browser validation found and resolved production `/profile` routing, malformed
Table Tennis options, the saved-status layout and the missing durable save after
successful restore. The final run includes those fixes. The full root and Node
suites, native checks and browser smoke are independent evidence; their test
counts are not combined into a single coverage claim.

| Area | Required evidence |
| --- | --- |
| Canonical motion | Unit/axis conversion, elapsed-time filters, capability absence, interrupted samples and legacy tennis regression tests |
| Session/transport | Spoofed identities, stale epochs/generations, out-of-order sequences, pause/recenter cancellation, lost acknowledgements and duplicate action rejection |
| Bowling | Forward-only release, rate-independent aim, frozen aim, authoritative live preview, score oracles and surviving-pin regression cases |
| Table tennis | Flight/bounce, finite swept paddle contact, spin direction, net/edge cases, serve sequence, lets, deuce, duplicate point suppression and bot/practice smoke |
| Profiles | Unauthorized access denied, isolated preferences/history, idempotent results, ownership of guest claims, stale-host/revision rejection and process-restart persistence |
| Browser shell | Browser-default QR join, touch fallback, one-player readiness, same-room switching, pause/reconnect, actionable failure messages |
| Expo | SDK compatibility, type/bundle checks, camera unmount, native/background lifecycle and shared contract tests |

## Milestone gates

| Plan gate | Cloud deliverable | Evidence still required |
| --- | --- | --- |
| M0: baseline | Baseline tests and auditable detector replay | Physical reference-phone sensor/network/render measurements |
| M1: contracts | Shared units, lifecycle, registry and transport regression checks | Real-device axis/cadence confirmation |
| M2: browser bowling | Automated aiming/release/scoring/transport checks and browser controls | One physical browser phone completing ten frames; false/missed release observations |
| M3: table-tennis simulation | Deterministic physics/rules tests and host controls | Review of intended playable behavior with repeatable trial settings |
| M4: browser table tennis | Browser pairing, continuous control and practice/bot paths | Real compact-motion practice and complete bot game, misses and latency evidence |
| N1/N2: optional Expo | Reviewable native project and automated checks | Native development build installed on a real device; permission, axes, haptics and same-device comparison |
| P1: profiles/recovery | Authorized persistence and checkpoint consistency checks | Validation against the intended deployed storage/auth setup and supported restart workflow |
| Q1: release evidence | Runbook and automated fault coverage | Declared supported-device matrix and owner acceptance; no release-readiness claim yet |

## Hardware matrix — not executed

At least one real phone and the owner's display are needed for initial motion
acceptance. Broader support requires separate iOS/Safari and Android/Chrome
evidence. Native iOS and Android are separate gates. For each platform record:

- Both playing hands, grip changes and screen rotation.
- Motion allowed, denied, absent, and interrupted; haptics present and absent.
- Background/foreground, Wi-Fi interruption, reconnect, and stale input.
- Bowling backswing preparations, forward releases, aim lock, and a full game.
- Table-tennis recenter, stationary blocks, compact strokes, brush direction,
  a complete bot game, and switching back to bowling.
- Host overload, host replacement, and interrupted saved/unsaved boundaries.

## Measurement rules and report template

Use monotonic times on one device for sensor intervals, recognition delay, local
queue time, acknowledgement RTT and host receipt-to-contact. Never subtract
unsynchronized phone/TV clocks. RTT includes processing and is not one-way
network delay. Do not add overlapping durations.

For physical motion-to-visible response, record video frame rate and the chosen
motion/visual landmark. A haptic API call resolving is not proof of actuator
onset. Keep median, p95, maximum, sample count, and dropped/rejected counts. The
plan's sub-100-ms p95 and 60-fps goals remain targets until measured on named
hardware; a cloud browser test does not prove them.

```text
Build / source hashes:
Date:
Phone / OS / browser or app version:
Display / OS / browser / resolution:
Connection route (LAN, HTTPS tunnel, deployment):
Sport / mode / assistance / sensitivity:
Procedure and expected behavior:
Observed behavior:
Samples / misses / false inputs / rejected inputs:
Median / p95 / max with clock and metric definition:
Automated checks and report paths:
Video / trace:
Known limitations / next experiment:
```
