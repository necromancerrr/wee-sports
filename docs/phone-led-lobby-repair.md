# Phone-led lobbies and continuous-motion repair

The TV now shows the room QR/code and the people who have actually joined.
There is no player-count selector, empty-seat grid or sport switcher on the TV.
The first/current leader's phone controls **Start game** and **Next sport**.
Bowling accepts up to eight players; Tennis and Table Tennis accept up to two.
Solo and partly filled rooms wait for Start; a fresh full ready room starts
automatically. A room returned from a match waits for an explicit Start again.

## Leaving and returning

The old phone retained a local no-start flag after playing. Table-tennis also
retained a completed-game phase, and the bowling controller could retain a
pending roll. Returning now clears those match states, keeps valid controller
setup and becomes ready for the next explicit Start.
Native bowling also ties unresolved roll/status replies to their original
session, match and turn. Leaving clears the local roll lock immediately; late
replies cannot restore it or block Start in the next game. A pause alone keeps
an unresolved roll protected against duplicate delivery.

**Return to lobby** ends the match for everyone while retaining the room.
**Leave lobby** releases this phone's seat. When someone leaves, the remaining
players receive their updated seats and leader identity; the old input generation
is invalidated so an old delivery cannot enter the new match. Closing the TV
room releases all phones.

## Motion fixes

The iPhone startup watchdog previously counted time spent reading the system
permission prompt. That could switch a functioning phone to buttons before its
first sensor reading. It now starts after permission completes, tolerates the
temporary inactive state and gives a useful retry if motion really is unavailable.
An automatic fallback no longer overwrites the user's preference for motion.
Raw accelerometer support covers devices without a complete fused-motion sensor.

Bowling's remaining aim lag came from rejecting fast sideways tilts, a four-degree
deadzone, mixing hand acceleration into gravity and reusing old native gravity
readings. Aim now has a one-degree center band, uses gravity separately where
available and uses bounded gyro prediction between timestamped gravity updates.
Delivery still locks the line. The host also avoids recalculating every player's
scorecard for every incoming aim sample.

Table-tennis previously required at least 60 ms with almost no rotation before
another stroke. Continuous wrist movement therefore stopped registering. It now
recognizes a distinct slowdown and new acceleration, with minimum separation
to reject follow-through. Legitimate early actions survive short setup/recovery
periods, and a stroke that has visibly begun can finish its bounded motion.
Hits still require paddle/ball collision; idle phones do not generate returns.
Games remain first to 12, winning by two, with independent two-player inputs.

## Verification

Passed: 589 root tests, 159 standalone server tests, 54 native tests, TypeScript
checking, the production web build and Android/iOS Metro/Hermes exports.
The [return-flow browser report](validation/phone-led-lobby/return-browser.json)
records ten successful checks across all three games. The
[continuous-motion browser report](validation/phone-led-lobby/continuous-motion-browser.json)
records three legal returns for each generated swing axis without a still-hand
reset, plus idle, visibility and sensor-recovery checks.
The [party report](validation/phone-led-lobby/party-browser.json) verifies automatic
full-roster startup and player-eight reconnect. The
[bowling motion report](validation/phone-led-lobby/bowling-motion-browser.json)
verifies rapid aiming through the real TV guide, deliberate releases, motion
permission fallback and switching sports from the phone.
The [platform report](validation/phone-led-lobby/platform-browser.json) covers
pause/resume, sport switching, saved boundaries and profile-based continuation.

Targeted regressions cover an iPhone permission dialog left open for 12 seconds,
delayed sensor startup, actual native delivery routing, quick sideways aim with
30 Hz gravity and 60 Hz gyro, and controller lifecycle transitions. The continuous
two-phone table-tennis test uses independent rhythms through both web and native
normalization, a simulated 40 ms relay delay and a 30 Hz TV update. The previous
code produced no returns; the repaired path sustains physical paddle contacts.

The browser checks use real rooms and production assets:

```sh
WEE_SMOKE_URL=http://localhost:5173 node scripts/browser-lobby-return-smoke.cjs
WEE_SMOKE_URL=http://localhost:5173 node scripts/browser-party-smoke.cjs
WEE_SMOKE_URL=http://localhost:5173 node scripts/browser-table-tennis-smoke.cjs
```

The first script covers solo Start, return/restart, leader departure, seat
promotion, phone sport switching and room closure in all three sports. The
motion script requires repeated legal returns during continuous generated swings.
These tests do not establish physical iPhone comfort or phone-to-TV latency.

## Loading the update on iPhone

After pulling the branch, restart the TV's `npm run dev`. Reload the matching
Expo development client from `npm run expo:dev -- --clear` so it receives the
updated JavaScript. This round adds no native dependency: Accelerometer is part
of the existing `expo-sensors` installation. See the
[native guide](../apps/controller/README.md) for installation and older-client
requirements.
