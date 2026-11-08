# Party and controller repair

Implemented on `feat/sports-platform`, November 7, 2026 (America/Los_Angeles).

The player-count selector described below has since been replaced by
[phone-led startup](phone-led-lobby-repair.md). That follow-up also fixes
continuous table-tennis motion and the iPhone sensor startup timeout.

## What players see

- Table Tennis has a quiet court with no avatars. Tennis keeps its avatars and
  park backdrop; the earlier visual change had targeted the wrong sport.
- Table Tennis starts a scored game automatically: one phone plays the bot,
  two phones play each other, first to 12 with a two-point lead. Practice is an
  optional solo mode. Each human has an independent paddle, motion stream,
  landing target, score and contact feedback.
- Bowling supports eight players. A compact standings panel leaves the lane
  clear; **Full scorecard** opens the detailed frame table separately.
- Choose **Players in this game** on the TV before friends scan. The room waits
  for the chosen number, and joining no longer clears other phones' readiness.
- Browser and native controllers retain the scan, tap Play, then play flow.
  Touch remains available when motion cannot be used.

## Causes and changes

Table Tennis previously defaulted to endless practice, and its input path had
one human sequence counter and one stroke detector. The match now routes each
authenticated player's samples separately and disables the bot in two-player
games. Friendly assistance follows the incoming ball, including low returns,
while phone direction chooses the outgoing landing target. Small deliberate
swings register sooner. Stroke intent locks before contact, and a hit still
requires swept paddle/ball contact; idle motion does not award hits.

Bowling aim was capped near 20 Hz in both controller and relay, and ordinary
repositioning could exceed its tilt-speed guard. Aim now sends at approximately
60 Hz, with a short adaptive filter to damp jitter while following intentional
movement. A delivery still locks its line at the beginning of the forward swing.

Web setup acknowledgements now correlate with requests and retry safely. A
brief visible sensor scheduling gap suppresses stale input immediately but
does not immediately revoke room readiness. Backgrounding still suppresses
input and revokes setup; returning obtains fresh samples. Duplicate page-show
events no longer reclaim seats. Controller surfaces contain overscroll, and
table-tennis requests a screen wake lock where supported.

Expo Tennis had been explicitly forced into touch mode. It now uses the shared
motion detector. Bowling requests the DeviceMotion permission needed for its
gravity-based aim. Temporary iOS permission overlays no longer discard a live
seat. Native table-tennis touch sends fresh neutral poses even before dragging
and after finger release, with gesture velocity expiring promptly; the stream
stops on pause, disconnect or backgrounding. Keep-awake, hand and sensitivity
settings are available without a calibration checklist.

## Validation

Passed: 564 root tests, 159 standalone server tests and 39 native tests;
TypeScript checking; production build; Android and iOS Metro/Hermes exports.
The [party browser report](validation/party-controller-repair/party-browser.json)
records seven successful checks with no uncaught errors. The
[table-tennis motion report](validation/party-controller-repair/table-tennis-motion-browser.json)
records eight successful checks using generated sensors through the real relay.
The [platform browser report](validation/party-controller-repair/platform-browser.json)
records twelve successful checks including sport switching, pause/resume, host
reload and profile-based saved-game continuation.

Regression coverage includes real table-tennis paddle contacts and legal
returns, a 24-hit two-human rally, complete 12–0 games won by either human,
independent sequence counters, deuce, controller lifecycle recovery, all eight
bowling seats, ninth-seat rejection, complete eight-player scoring and saved
boundaries. Browser smoke scripts exercise production assets and real rooms:

```sh
npm test -- --maxWorkers=2
node --test --test-concurrency=1 server/src/*.test.js
npm --prefix apps/controller test
npm run build
WEE_SMOKE_URL=http://localhost:5173 node scripts/browser-party-smoke.cjs
WEE_SMOKE_URL=http://localhost:5173 node scripts/browser-table-tennis-smoke.cjs
WEE_SMOKE_URL=http://localhost:5173 node scripts/browser-platform-smoke.cjs
```

Browser scripts require Playwright and Chromium and a disposable running game
server. They create test rooms; the platform script also creates test profiles.
Native Android and iOS JavaScript bundles are checked through Expo export.

These checks use generated inputs and software WebGL, not physical phones.
They do not establish zero latency, native sensor quality, or how comfortable
the swing feels in someone's hand. Wi-Fi and device rendering still contribute
delay. Physical Android/iPhone play remains the final comfort and latency check.

## Try the update

Pull `feat/sports-platform`, then restart `npm run dev`. For Expo, run
`npm run expo:install` once after pulling because the native dependency set
changed, then `npm run expo` (Expo Go) or `npm run expo:dev` (development build).
See the [native controller guide](../apps/controller/README.md) for the SDK and
iPhone development-build requirements.
