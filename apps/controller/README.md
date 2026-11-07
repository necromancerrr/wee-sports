# Optional Wee Sports controller

The normal phone-camera QR link still opens the complete browser controller.
This Expo app is an additional client for the same rooms, rules and shared
motion core. Installing it is never required to play.

## Run and validate

Use Node 24. From this directory:

```sh
npm ci
npm test
npm run export
```

The native project has its own lockfile. It imports `../../shared` and the pure
bowling recognizer from the repository; keep it in this checkout. Expo SDK
58.0.23, React 19.3.0, React Native 0.88.1 and the camera, sensor, secure-storage
and feedback modules are pinned to the versions listed by this SDK.

To install a development build with an appropriate local toolchain:

```sh
npm run android  # Android SDK, JDK, emulator or connected Android phone
npm run ios      # macOS with Xcode; device installation may require signing
npm start        # Metro for the installed development client
```

The checked-in application IDs (`dev.weesports.controller`) are development
defaults. Choose your owned IDs and distribution/signing configuration before
publishing a native app. No store account, hosted build, deployment or signing
credential is configured by this project. `npm run export` produces JavaScript
and Hermes bundles, not an installable APK/IPA.

Start the repository's game server separately. For a physical phone, use its
reachable **HTTPS** origin and open the TV on that origin. Scan the room QR in
this app to join and play as a guest. Your name and manual entry are optional. The scanner
accepts only HTTPS `/join?code=XXXX` links, unmounts its camera after scanning,
and never accepts a private account or room token in a QR. Manual room entry
and **Continue in browser** are always available. In development builds only,
the origin field also allows HTTP localhost, 127.0.0.1 and Android's 10.0.2.2
emulator bridge. It does not permit arbitrary plaintext LAN servers.

## Try the controller

1. Create a Bowling or Table Tennis lobby on the TV and scan from the app.
2. Allow motion if the operating system asks. The controller checks fresh
   samples and automatically readies after the server accepts its setup.
   Denied or unavailable sensors select touch controls automatically.
3. Bowl with a gentle forward swing, or make compact table-tennis strokes.
   Bowling waits for a quiet start, locks aim at forward onset, and releases
   at most once until the TV reports the next delivery. No Arm button is needed.
   Table-tennis serves are automatic. Existing tennis uses touch controls.
4. **Options** contains touch/motion choice, centering, profile preferences,
   practice mode and P1's pause/lobby/sport choices. Switching sports checks
   fresh samples automatically, without another QR or setup confirmation.
   Returning to the lobby waits for **Play** before another match; **Wait for
   friends** can stop a countdown without restarting it automatically.
5. Background the app and reopen it. Motion stops immediately, the seat
   reconnects with its private token, and fresh samples restore play automatically.
   Buffered motion is discarded. An unresolved roll is queried by its original
   action ID; the app never generates a replacement roll automatically.

Optional profiles use the same server's `/api/profile` API. Sign-in tokens and
room recovery tokens and guest-history ownership proofs are kept in SecureStore and scoped to the confirmed
server origin. Account identity is provided only through the Socket.IO
authentication handshake. Preferences and history are available without making
accounts a prerequisite for play. Signing in claims saved guest results only on
their original server. Raw sensor recordings and device calibration
are not uploaded to profiles.

## Measurement and remaining device checks

The sensor adapter requests 60 Hz gyro and 30 Hz gravity/acceleration data and
records achieved sampling frequency and largest observed gap. These numbers
are callback cadence, **not** end-to-end latency. Pure math, filtering,
calibration and bowling recognition are shared with web. Native Gyroscope
measurements are already radians/second; DeviceMotion rotation-rate fields are
deliberately unused because their native iOS and Android implementations name
the axes differently. Expo's gravity-down vector is explicitly converted to a
support/up vector for bowling tilt aim; canonical native gravity remains down.
Real-device grip/axis validation remains necessary, especially for the
legacy bowling recognizer. Gyro-relative paddle orientation can drift; use
recenter and do not treat it as tracked hand position.

Local recognition and host-confirmed contact use different text and haptic
cues. Haptics may be disabled or unavailable without blocking play. The camera
is closed before motion play. Pause, suspension and newer input generations
cannot replay old poses or feedback.

Verified in this cloud workspace:

- Native transport/scanner/automatic-setup/sensor-lifecycle, gravity fixture and guest-claim tests, including cancellation
  while a permission prompt or sensor availability request is unresolved.
- Metro/Hermes export for Android and iOS, using the pinned SDK dependencies.
- Installed versions checked against the SDK's bundled native-module manifest.

Not yet verified: an installed Android/iOS build, physical sensor axes and
permissions, haptic behavior, a full ten-frame native bowling game, a native
table-tennis bot match, background/foreground behavior on hardware, and the
same-phone browser/native latency comparison. Those gates require a connected
phone and the platform development toolchain. No native speed or battery
advantage is claimed. Production universal/app links are intentionally omitted
until the project has a controlled HTTPS domain and association files; temporary
tunnels can still be scanned inside the app.
