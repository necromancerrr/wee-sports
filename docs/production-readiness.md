# Production readiness — November 8, 2026

**Decision: conditionally ready for a single-replica Railway staging deployment**,
subject to the operator and device checks below. This local pass does
not constitute a Railway deployment or physical-device acceptance. The initial
readiness pass left changes local and uncommitted. The owner subsequently
authorized responsive-island repairs and publication of the reviewed work to
`main`. No Railway service, domain or volume was provisioned by this work.

## Source and scope

- Repository: `https://github.com/necromancerrr/wee-sports.git`.
- Starting branch: `feat/sports-platform`; starting commit
  `4966df9f835af0a77b0a62fe316549d4c746ae04`; initially clean working tree.
- Host: Linux x86_64, Node `24.22.1`, npm `11.9.0`, Chromium software WebGL;
  container uses Node `24.22.2` Bookworm Slim. The execution quota is four CPUs and
  32 GiB RAM. This is a local shared development environment.
- Baseline: 671 Vitest tests and 174 standalone Node server tests passed. The
  latter were independently rerun from a pristine archive of the starting SHA.
  Native baseline: 74 tests passed. Build and TypeScript passed. Old GTS
  check/lint commands exited successfully but printed only `version: 24`;
  those exits were **not** evidence of lint coverage.

The current sport registry and actual rules remain authoritative: Tennis has
one/two players and best-of-three sets, seven points per set, win by two; Table
Tennis has one/two players, twelve points, win by two; Bowling has one to eight
players and ten frames. Solo/practice/opponent settings, guest play, optional
profiles/Expo, touch fallback, QR/manual joining, confirmed starts, rematches,
same-room switching and supported recovery remain. Golf and Pool/Billiards did
not become playable. During the readiness pass, no artwork, layout, scoring
or motion/physics tuning was redesigned or reduced in quality. The separately
requested responsive-island follow-up is described in the island documentation.

## Inventory and boundaries

| Area | Entry and responsibility |
| --- | --- |
| Browser shell | `index.html` → `client/src/main.jsx`/`App.jsx`: landing/island, phone/display routing, join, host and profile routes. |
| Sports | `game.html`, `bowling.html`, `table-tennis.html` → `src` game modules: display-authoritative rendering, physics, scoring and stable checkpoints. |
| Browser controllers | `controller.html`, `table-tennis-controller.html`: motion permissions, native-unit adapters, automatic setup, touch alternatives and fresh input. |
| Native controller | `apps/controller/index.js`/`App.jsx`, sensor/session/secure-storage modules; independent npm lock and Metro export boundary. |
| Shared | `shared`: sport registry, protocol, capabilities, units, start and diagnostics contracts. |
| Production service | `server/main.js`: one HTTP/Socket.IO/standalone relay listener; `RoomStore` owns live membership, turns, input generations and lifecycle. |
| Persistence | `server/profiles`: optional accounts, sessions, preferences, results, stable checkpoints and continuation leases in SQLite. |
| Assets/tooling | Six Vite HTML entries; 34 public files including two GLBs, four scenery WebPs, local font/license and 25 sounds/attribution. Build verifier, replay, browser/container/soak checks and CI preserve these consumers. |

Input flows from the phone adapter through membership/epoch validation to the
TV runtime; actual game acknowledgements return through the server. Embedded
games use authenticated Socket.IO and a source/origin-checked iframe bridge.
The standalone `/swings` relay remains separate room-key pairing; knowledge of
its room identifier permits native participation. It does not grant platform
membership or profile access and is not ranked-game security.

Live rooms and Tennis recovery are process-local. Device storage retains
reconnect credentials/settings. SQLite retains accounts/history and supported
solo Bowling/Table Tennis continuation. A server restart expires room codes;
saved continuation creates a new authenticated room from the last acknowledged
stable boundary. Party archive continuation, mid-flight persistence and durable
Tennis restart recovery are not implemented or newly promised.

## Findings and fixes

| Severity | Reproduced evidence | Fix and regression coverage |
| --- | --- | --- |
| High | Browser WebSocket handshakes bypassed CORS-only origin restrictions. | Validate actual origins on polling, WebSocket and standalone relay. Preserve native no-Origin access and room/account authorization. Test foreign-origin rejection and same-origin/native isolation. |
| High | A built Docker image inherited checkout `0700` directories as root-owned; its non-root user could not import server modules. | Make packaged source readable/traversable while retaining root ownership; keep the private database directory owned by UID 1000. Verify the actual image as its runtime user. |
| Medium | Delayed legacy bowling input could substitute the current game ID; late command/swing acknowledgements survived epoch changes. | Reject explicitly stale game IDs/generations; recheck epoch on game acknowledgement. Retain supported older payload compatibility. |
| Medium | Admission/input bursts and relay output buffers lacked bounds; shutdown admitted new work. | Separate per-connection budgets for membership, control, streams and actions; drop blocked stale relay delivery; gate new work during idempotent, bounded shutdown. |
| Medium | Registration could insert an account without issuing a session; revision races could report false success. | Atomic account/session creation and checked compare-and-swap writes. Regressions inject failed inserts and competing SQLite writers. |
| Medium | Database startup had no version/compatibility guard or tested WAL-aware operational backup. | Validate known schema/integrity before DDL, preserve compatible legacy data, close failed initialization, and add validated private online backup/restore to a new filename. |
| Medium | Shared ingress address limits could block unrelated accounts; concurrent password work was unbounded. | Separate account/address attempt limits and cap concurrent password operations; do not trust arbitrary forwarded IPs. Limits remain process-local. |
| Medium | Saved-room owner mismatch retried forever; profile requests and guest-claim batches could spin indefinitely. | Show sign-in/Back to room while retaining valid seat tokens. Bound browser/native requests including body reads to ten seconds, cancel departed pages, stop failed claim batches without dropping remaining proofs. |
| Medium | Existing lint scripts did not actually lint on Node 24; CI omitted native export integration. | Direct semantic ESLint plus TypeScript; align Node/npm/types, root/server/replay/build CI and separate native install/tests/iOS+Android export. |
| Low | Table Tennis validated but discarded the applied opponent style; some error paths exposed internal codes. | Synchronize Rally/Challenge settings and return stable redacted storage/shutdown/rate-limit errors. |
| Low | Unversioned assets were cached as immutable; static containment and deployment configuration needed stricter checks. | ETag revalidation for unversioned files, immutable hashed JS/CSS, complete MIME mapping, symlink containment and strict public-origin/port configuration. |

The combined test run exposed an old recovery test waiting forever for a
foreign-origin connection after origin enforcement was fixed. Its helper now
handles connection errors and its expectation asserts rejection, then verifies
trusted recovery. No gameplay assertion was weakened to obtain a pass.

One integrated server run also timed out on an existing game-command test while
a Docker build ran concurrently. The unchanged timeouts/assertions passed three
isolated repeats and the full 186-test rerun without a concurrent build. The
failure evidence is retained; scheduling contention is plausible, not proven.
Browser/render and final soak checks run separately from heavy builds/tests.

Browser harnesses also contained older no-name joins, return-confirmation labels
and automatic-reload expectations. They now follow the existing required-name,
Save and return, and Continue game flows. The restored player identity is checked
on the actual game scoreboard and phone, rather than the parent after the game
opens. All persistence/contact assertions remain. One initial combined
play-flow run observed a transient Table Tennis connection overlay; unchanged
1280×800 isolated and complete three-sport reruns both passed. Its cause was
not established, and the original evidence is retained. No motion thresholds,
freshness deadlines or physics settings were changed to obtain those results.
Scanner tests now target the Tools disclosure directly instead of matching its
nested sport disclosure too. Phone-return tests wait for the TV's lobby
broadcast before inspecting its recovery choices; a phone acknowledgement alone
does not establish that the TV has rendered that state.

Cleanup removed 13 proven obsolete files totaling **1,892,475 tracked bytes**:
seven generated `build` files, four stale partial `dist` files, `bun.lock` and
the unreferenced GTS demo `src/index.ts`. Consumer checks included imports,
dynamic/static URLs, HTML/Vite entries, manifests, scripts and tests. Deleted
GLB copies were byte-identical to retained `public/assets` originals; the clean
six-page build regenerates their outputs. The native npm lock, source artwork,
licenses and attribution remain. The optional formatter config was renamed
`.cjs` for its CommonJS contents; no mass formatting occurred.

## Verification

Detailed local evidence is retained at
`/workspace/.cloud-setup/wee-sports/readiness/`, with baseline, clean-install and
`final` logs/JSON/screenshots. These are disposable test artifacts, not shipped
assets or production records. Counts below refer to this pass, not older
acceptance notes. The scripts are retained for repetition. `final/verification-summary.json` maps
all twelve passing browser suites to their final reports, including reruns.
The final platform suite includes thirteen checks with real profile persistence;
the camera and profile-error suites clearly label their synthetic fixtures.

| Area | Expected | Actual and evidence | Status |
| --- | --- | --- | --- |
| Fresh install/build | Lockfile installs, real type/lint checks, all runtime entries/assets. | Fresh root/native installs passed; `npm run check` passed; production build 2.06 s and all six pages/models/scenery/font verified. `final/{main-install,check-final,lint-final,build,clean-install-root,clean-install-native}.log`. | Pass locally |
| Automated gameplay/contracts | All current rules, modes, authority and controller contracts. | 713 Vitest tests (84 files), 186 standalone Node server tests, 75 native tests passed. `final/{root-tests,server-tests-repeat,native-tests}.log`. | Pass |
| Motion/native integration | Replay preserves stroke labels/units; both native platforms bundle. | Five recordings, 19 strokes in each detector mode; canonical adapter round-trip passed. iOS/Android exports passed with final executable sources. `final/motion-replay.json`, `clean-native-export.log`. | Pass; devices pending |
| Production container | Actual non-root image serves built app, HTTP/realtime and closes cleanly. | Eleven checks passed on image `sha256:9f8cac45c9b783783ec1ca737d5a751e9a464bb3c131090a6426da9b03d91ae0`: five SPA routes, all 68 built files/six HTML entries, 28 immutable assets/40 revalidating files, no misleading missing-file HTML. SIGTERM exited 0 in 300 ms. `final/container.json`. Forced ten-second deadline is separately covered by `runtime.test.js`. | Pass locally |
| Guest joining/party | QR/manual paths, no required account, correct limits and independent controls. | Real QR image decoding/manual entry, denied camera fallback, eight Bowling seats/ninth rejection and two independent Table Tennis rally contacts passed. `final/browser-remote-home-smoke-repeat2.json`, `browser-party-smoke.json`. | Pass locally |
| Session lifecycle | No stuck controller, duplicate start or stale input after navigation/recovery/switch. | All three sports passed leave/Continue/New game/closure; Tennis solo/two-player split view, leader promotion and phone controls passed. Full play-flow rerun verified confirmation/countdown and persistent Table Tennis TV winner; granted/denied/silent motion recovery passed. `final/browser-room-recovery-smoke.json`, `browser-tennis-lobby-return-repeat.json`, `browser-play-flow-smoke-repeat.json`, `browser-motion-smoke-repeat.json`; unit suites cover invalid epochs, duplicate actions and acknowledgement boundaries. | Pass locally |
| Profiles/persistence | Isolation, acknowledged writes, owned continuation, restart/restore and failure behavior. | Atomic/CAS/schema/timeout tests passed; container retained account/history/checkpoint after restart and restored the earlier backup revision. The fixture had a 173,072-byte WAL; a raw main-file copy omitted both seeded matches. Unwritable DB produced profile503 while guest health/join remained available. Profile browser timeout/navigation/recovery smoke passed. `final/container.json`, `browser-profile-readiness-smoke.json`, root/server logs. | Pass locally |
| Security/abuse | Reject malformed, oversized, unauthorized and cross-origin requests without exposing private fields. | Real polling/WS rejection, role/account isolation, payload limits, stale input, traversal/symlink and burst checks passed. Root audit0; native26moderate tooling findings remain. `final/session-focused.log`, root/server logs and both npm-audit JSON reports. | Pass; dependency follow-up |
| Presentation | Preserve art, responsive roles, keyboard/touch, reduced motion and readable errors. | Island responsive/keyboard/enlarged-text/reduced-motion and fixed-camera animation checks passed; phone/tablet routes avoid island downloads. Normal Table Tennis keeps the score without diagnostic text. Screenshots reviewed for island, court, eight-player scoreboard and profile error. `final/browser-{island-smoke,island-animation-smoke,clean-table-tennis}.json` and `screens-*`. | Pass locally |
| Resource stability | Bounded switching/reconnect load, no retained rooms/connections or growing listener counts. | Six-room mixed-sport soak passed; measurements and limitations below. `final/soak.json`. | Pass for stated workload |
| CI | Documented clean commands represented without deployment credentials. | Workflow covers type/lint/root/server/replay/build and separate native install/test/export; commands reproduced locally. Hosted GitHub Actions results were not part of this initial local pass. | Local proof; hosted CI pending |

Commands from the repository root:

```sh
npm ci
npm run check
npm test -- --maxWorkers=2
npm --prefix server test
npm --prefix apps/controller ci
npm --prefix apps/controller test
node scripts/replay-motion.mjs --json /tmp/wee-readiness-motion.json
WEE_BUILD_DIR=/tmp/wee-readiness-dist npm run build
npm --prefix apps/controller run export -- --output-dir /tmp/wee-controller-export --max-workers 2
docker build -t wee-sports-readiness:local .
node scripts/verify-production-container.mjs --image wee-sports-readiness:local --report /tmp/wee-container-report.json
node server/scripts/readiness-soak.js --rooms 6 --cycles 3 --seconds 15 --output /tmp/wee-soak.json
```

Browser checks use an already running disposable production service:

```sh
PORT=5221 WEE_BUILD_DIR=/tmp/wee-readiness-dist WEE_PROFILE_DB=/tmp/wee-readiness-profiles/profiles.sqlite node server/main.js --production
```

In another terminal, with Chromium and Playwright available, use fresh report
paths on each run (several scripts deliberately refuse to overwrite evidence):

```sh
for scenario in profile-readiness-smoke platform-smoke motion-smoke party-smoke room-recovery-smoke remote-home-smoke island-smoke island-animation-smoke table-tennis-smoke clean-table-tennis play-flow-smoke; do
  WEE_SMOKE_URL=http://127.0.0.1:5221 WEE_SMOKE_WIDTH=960 WEE_SMOKE_HEIGHT=640 WEE_SMOKE_REPORT=/tmp/wee-browser-$scenario.json node scripts/browser-$scenario.cjs
done
WEE_SMOKE_URL=http://127.0.0.1:5221 WEE_SMOKE_SPORT=Tennis WEE_SMOKE_REPORT=/tmp/wee-browser-tennis-lobby.json node scripts/browser-lobby-return-smoke.cjs
```

The party and motion-contact checks use a 960×640 functional software-rendered
viewport; other scripts retain their own recorded sizes. Island checks include
narrow desktop windows, phone/tablet role emulation and ultrawide displays.
No screenshot, emulated phone or synthetic sensor establishes hardware speed.

The local proxy required an optional BuildKit CA secret for npm installation;
normal builds use standard certificate trust. TLS verification stayed enabled.
The Docker verifier only uses an existing local image, loopback ports and
uniquely named disposable containers/volume; it never deploys or pulls images.
It validates persisted results with synthetic stable checkpoint fixtures;
separate rules and browser tests exercise actual gameplay. Test credentials are
not printed or added to source.

The bounded soak used six rooms, twelve simulated players and eighteen
WebSocket connections across three fifteen-second input stages, normal
five-second countdowns, sport switching and eighteen phone replacements. Aim
and pose were offered every 34 ms; Tennis swings every 350 ms. It recorded
8,304 attempted and 8,266 observed inputs: all 480 swings arrived, with 38
volatile aim/pose samples not observed. No duplicate, wrong-room, stale-epoch
or unexpected-disconnect errors were recorded. Same-clock **local relay**
delivery was p50 0.90 ms, p95 2.86 ms and p99 7.11 ms; these are not Internet RTT
or sensor-to-display measurements.

Rooms, Socket.IO/Engine.IO clients, socket listeners and connection timers
returned to zero after closing. Global listener counts stayed 6/1/1. RSS grew
from 73.09 to 81.59 MiB; collected heap was 1.91 MiB above the initial sample.
The 20 ms-resolution event-loop monitor recorded a maximum of 221.64 ms. These
observations from a short run do not prove absence of long-term leaks or a
production player capacity. The soak excludes rendering, physics, scoring,
profile load and real networks; those have separate functional tests. Full
stage counts, memory samples and limitations are in `final/soak.json`.

## Railway handoff and remaining checks

Use the [Railway runbook](railway.md) for the exact Docker/start path, variables,
HTTPS origins, healthcheck, single-replica assumptions, private runtime volume,
ten-second shutdown deadline, SQLite backup/restore and rollback procedure.
Do not use a production-only npm install before building: the prepare/build
hooks require TypeScript and Vite. Do not use a development tunnel or Vite
server for the hosted path.

| Status / owner | User impact and concrete next action |
| --- | --- |
| Required staging checks — deployment owner | No Railway service was accessed. Verify current dashboard controls, public HTTPS/WebSocket/polling routing, one replica/no sleep, `/health`, at least 15-second termination grace, and a persistent volume writable by UID/GID 1000. Repeat the release smoke checklist on that service before production. |
| Current documentation unverified — deployment owner | Official Railway docs returned policy-blocked HTTP 403; expected official GitHub mirror returned 404. The attachment's legacy-config deprecation claim could not be independently confirmed. No `railway.json`/`railway.toml` was generated. Confirm current official volume/healthcheck/configuration/teardown guidance. |
| Required device acceptance — owner/QA | Browser automation and Expo export cannot establish actual sensor axes, OS permissions, haptics, Wi-Fi transitions or motion-to-display latency. Run the checklist below on physical iPhone and Android. |
| Moderate dependency follow-up — dependency maintainer | Root audit has zero findings. Native audit has 26 moderate findings cascading from two `glob`/`minimatch` advisories in Expo CLI/fingerprint tooling; no high/critical findings. Compatible Expo releases still require affected majors. Do not force incompatible overrides; adopt an upstream compatible fix and repeat native tests/exports. These packages are absent from the Railway root runtime dependency tree. |
| Optional tooling maintenance — maintainer | Installed ESLint 9 is reported unsupported by npm; it was already the GTS lint dependency. Plan a compatible lint-toolchain upgrade separately. Existing bundle chunk-size warning remains; detailed assets were preserved. |

Physical-device checklist, on the intended HTTPS domain:

1. iPhone Safari and Android Chrome: scan and manually join, enter a name, allow
   motion on Play; repeat with motion/camera denied and confirm touch fallback.
2. Expo on each supported OS: scan the same room, enable native motion, check
   axis direction/aim, swing power, haptics, settings and touch controls.
3. Play Tennis solo/two-player, Table Tennis solo/two-player and Bowling with
   eight players. Finish scoring, rematch and switch sports; verify correct
   turns, visible TV results and comfortable frame/motion response.
4. Lock/background the phone, interrupt Wi-Fi and switch networks. Return to
   the same valid seat with fresh input, no queued hit/roll, no duplicate match;
   close the TV room and verify the phone exits gameplay.
5. With disposable accounts, save a supported solo boundary, reload the TV,
   then restart the staging process. Old rooms must expire; owned continuation
   must use a new room, preserve the saved boundary and reject another account.

Local readiness checks are not production SLOs. Monitor actual reconnects,
save failures, resource usage and volume growth during staging before a public
release. Deployment, pushing and merging remain for a separate owner instruction.
