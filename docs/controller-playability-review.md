# Controller clarity and shorter matches

Review date: 8 November 2026. This follows the phone-led lobby repair and responds
to the reported hidden TV controls, small return button, still-phone paddle
movement, bright table-tennis court and lengthy tennis scoring.

## References and decisions

- [W3C: Target Size (Minimum)](https://github.com/w3c/wcag/blob/main/understanding/22/target-size-minimum.html)
  explains why larger, well-spaced targets reduce accidental activation. Its
  minimum is 24 CSS pixels, while the enhanced criterion uses 44. Primary phone
  actions should be substantially larger than the minimum; returning to play is
  a primary action, not a small text link.
- [W3C: Non-text Contrast](https://github.com/w3c/wcag/blob/main/understanding/21/non-text-contrast.html)
  calls for identifying control cues to contrast at least 3:1 with their
  surroundings. A hover-only TV menu is undiscoverable on a touch screen or
  when watching from across the room. Keep its icon and label visible against
  an opaque background instead of depending on the scene behind it.
- [MDN: getUserMedia](https://github.com/mdn/content/blob/main/files/en-us/web/api/mediadevices/getusermedia/index.md)
  establishes that browser camera access requires a secure context and user
  permission. Use an explicit Scan TV code action, retain manual entry, stop
  camera tracks when dismissed, and do not tie a camera failure to leaving the
  player's current room. A phone's plain HTTP LAN address is not equivalent to
  localhost; use the HTTPS game link produced by `npm run dev`.
- [W3C: Device Orientation and Motion](https://github.com/w3c/deviceorientation/blob/main/index.bs)
  supplies device-relative orientation and angular rates, not absolute hand
  position. Table tennis therefore uses bounded aiming and a deliberate stroke
  request. Automatic receiving movement should not make a still phone appear
  to swing. See the earlier [contact research](table-tennis-research.md) for
  finite paddle collisions, monotonic input age and fixed simulation steps.

These references guide interaction and input design; they do not establish
physical-phone comfort or an end-to-end latency measurement.

## Agreed rules and platform model

Tennis is best of three sets. Each set is first to seven points, winning by two.
There are no games within a set. Table tennis remains first to twelve, winning
by two. These are explicit short-form game rules rather than a claim to model
regulation tennis scoring.

The browser controller and Expo app join the same room on the same game server.
Expo's Metro server supplies the native JavaScript bundle; it does not host a
separate match. QR scanning identifies the game server and room. Browser camera
and motion permissions and iOS native permissions are separate capabilities,
so both clients need understandable recovery and touch alternatives.

## Implementation

- TV display controls have a persistent icon and label, a solid background and
  at least a 44-pixel target. Routine save success messages are silent;
  checkpoint storage and actionable recovery errors remain.
- Phone settings use a large Back to play action. The shared web scanner is
  available on the phone home, join screen and joined controller. Canceling or
  scanning the same room preserves the seat. Changing rooms requires Leave and
  join before releasing it, and camera failure leaves manual entry available.
- Expo shares the web sport artwork and interaction vocabulary, with a focused
  play view, a Tools view, live match information and profile/history access.
  Opening Tools or Profile suppresses play gestures while preserving the
  session and explicit settings commands. Table tennis keeps neutral pose
  updates so opening a menu does not starve the game of input.
- Table-tennis idle movement previously came from automatic ball tracking:
  a neutral feed moved the human paddle about 50 cm. Assisted reach now engages
  only for a queued or forward stroke. Idle aim has a small deadband and a
  stable face. A deliberate shot must still make finite swept contact.
- In Friendly mode, screen-relative lateral wrist motion classifies a forehand
  or backhand using the playing hand. Forehands tend 20 cm toward TV-left,
  backhands toward TV-right; deliberate pointing can override that tendency.
  Forward pitch stays a straight drive. Comparable, opposing yaw/roll rates
  also stay neutral, avoiding direction reversals from small axis noise.
  This is an explicit arcade mapping, not measured anatomical arm tracking.
- The table-tennis court uses muted slate and blue. Decorative paddle windup
  and recovery differ by stroke. During contact-enabled and forward phases,
  the displayed face follows the physical paddle exactly. Reduced motion
  disables decorative poses. There are no table-tennis avatars.
- Lobby sport outlines are decorative, low contrast, noninteractive and behind
  the QR and player content. Reduced motion disables their slow movement.

## Reproducing the checks

Run `npm test -- --maxWorkers=2`,
`node --test --test-concurrency=1 server/src/*.test.js`, and
`npm --prefix apps/controller test`. Build with `npm run build`; run the browser
scripts below against a disposable combined game server with a separate profile
database, setting `WEE_SMOKE_URL` to its origin:

- `scripts/browser-controller-clarity-smoke.cjs`: visible working TV menu,
  responsive decorative lobbies, visible large phone return actions and the
  tennis points-only scoreboard.
- `scripts/browser-remote-home-smoke.cjs`: generated QR image decoding, camera
  denial, pending grants, cleanup, manual entry and connected-seat preservation.
- `scripts/browser-table-tennis-smoke.cjs`: actual phone-controller bridge,
  transport, real paddle contacts and legal returns from repeated generated
  motion, plus idle, background and sensor-silence behavior.
- `scripts/browser-platform-smoke.cjs`: real durable save state, restored
  checkpoints and profiles, independent of success notifications.

Run timing-sensitive transport tests and software-rendered browser tests
separately from bundle builds. Generated inputs establish software behavior,
not iPhone sensor feel, Safari permission behavior or physical motion latency.

## Recorded validation

- 612 root tests across 69 files passed, including scoring, set breaks, pose
  relay, repeated contacts, idle stability, ambiguous diagonal motion, scanner
  cancellation and controller settings. After the final nested-scroll fix,
  100 affected tests passed, including two new regressions proving that an
  embedded controller leaves child scrolling to its parent and a standalone
  controller scrolls locally.
- 160 standalone server cases are covered by the full run and an isolated
  passing rerun of all nine transport cases. The first run had one polling
  timeout while a bundle build was running; the isolated sustained WebSocket
  and polling runs both delivered all 104 actions exactly once. Those local
  timings are not phone-to-TV latency measurements.
- All 62 native controller tests passed. Android and iOS exports succeeded
  (699 and 701 modules respectively), including the four sport images. No
  native dependencies or app configuration changed; an installed compatible
  iPhone development client only needs a Metro reload.
- TypeScript and the six-page production build passed. Production camera,
  table-tennis motion and platform persistence checks reported no uncaught
  browser errors. Continuous generated Y and Z swings each made three real
  contacts and legal opponent-table returns in about six seconds.

Browser reports are retained in
[`docs/validation/controller-clarity`](validation/controller-clarity/).
The visual check uses simulated phone viewports and software WebGL; actual
iPhone camera permission, motion comfort and haptics still require device play.
