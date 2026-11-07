# Optional Wee Sports controller

The normal phone-camera QR link still opens the complete browser controller.
This Expo app is an additional client for the same rooms, rules and shared
motion core. Installing it is never required to play.

## Try it from your PC

Use Node 24 and keep your phone and PC on the same Wi-Fi. This app uses **Expo
SDK 58**. On Android, install the matching **SDK 58 Expo Go** from
[Expo's download page](https://expo.dev/go), rather than assuming the store
version matches. The camera, sensors, haptics and secure storage used here are
included in Expo Go; no custom native module is required for this path.

From the repository root, install the controller dependencies once:

```sh
npm run expo:install
```

Keep the game running in one terminal:

```sh
npm run dev
```

Open `http://localhost:5173` on your TV/PC and create a room. In a second
terminal, also at the repository root:

```sh
npm run expo
```

1. Scan the **terminal's Expo QR** with Expo Go to open Wee Sports Controller.
2. Inside the controller, tap **Scan to play** and scan the **TV's room QR**.
3. Allow camera/motion if asked, then play. Keep both terminals running.

The first QR opens the app; the second joins your game. The TV QR still opens
the browser controller when scanned with your phone's normal camera.

If Expo cannot reach your PC over Wi-Fi, restart only the Expo terminal with
`npm run expo -- --tunnel`. Expo's tunnel loads the native app; the game server
has its own HTTPS tunnel from `npm run dev`. Local Wi-Fi is preferable for
loading the app. A tunnel does not establish low gameplay latency.

### Using an iPhone from Windows, Linux or Mac

The App Store version of Expo Go stops at SDK 54, so it **cannot open this SDK
58 project**. Use a development build of this controller instead. The included
[`eas.json`](eas.json) has a `development` profile for installation on your own
devices, with `expo-dev-client` already installed.

On any PC, Expo's hosted build service can compile the iPhone app. This route
needs an Expo account and **paid Apple Developer Program membership**. Before
your first signed build, set `ios.bundleIdentifier` in `app.json` to an app ID
you control. From the repository root, install dependencies, then work in the
controller folder:

```sh
npm run expo:install
cd apps/controller
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest device:create
npx eas-cli@latest build --profile development --platform ios
```

Follow Expo's prompts to connect your project and Apple signing account, choose
an app identifier you own, and register your iPhone. Open the resulting install
link on that registered iPhone. Signing credentials belong in Expo's CLI/account
flow, never in the repository. This uploads source and creates an internal
development build; it does not submit an App Store release. Hosted build quotas
or fees depend on your Expo plan. These commands are for you to run; no remote
build, upload or signing was performed in this workspace.

After installation, return to the repository root. Keep `npm run dev` running
for the TV, and run `npm run expo:dev` in a second terminal. Open the installed
controller and connect to that Metro QR/link. Then tap **Scan to play** inside
the controller and scan the TV's room QR. Later JavaScript changes need only
Metro; rebuild after native dependency or native configuration changes.

On a Mac with Xcode and a connected iPhone, you can build locally instead:

```sh
npm run expo:install
npm --prefix apps/controller run ios -- --device
```

Xcode/device provisioning must be set up for your Apple account. Start the
installed app on later runs with `npm run expo:dev`. The browser controller
remains available without an Expo or Apple developer account.

An SDK 58 Expo Go build distributed through your own TestFlight internal team
is another option; that needs Apple Developer Program membership. Physical iOS
Expo Go also requires Expo CLI and the app to use the same Expo account. Those
distribution/account steps are separate from this repository.

For an Android development build instead of Expo Go, install Android Studio's
SDK/JDK and connect a phone with USB debugging, then run
`npm --prefix apps/controller run android -- --device`. On later runs use
`npm run expo:dev`.

### Connection and validation

For a physical phone, the game server must have a reachable **HTTPS** origin.
The standard `npm run dev` command supplies it in the TV's room QR. Your name
and manual entry are optional. The scanner
accepts only HTTPS `/join?code=XXXX` links, unmounts its camera after scanning,
and never accepts a private account or room token in a QR. Manual room entry
and **Continue in browser** are always available. In development builds only,
the origin field also allows HTTP localhost, 127.0.0.1 and Android's 10.0.2.2
emulator bridge. It does not permit arbitrary plaintext LAN servers.

The native project has its own lockfile. It imports `../../shared` and the pure
bowling recognizer from the repository; keep it in this checkout. Expo SDK
58.0.23, React 19.3.0, React Native 0.88.1 and the camera, sensor, secure-storage
and feedback modules are pinned to the versions listed by this SDK. From the
repository root:

```sh
npm --prefix apps/controller test
npm --prefix apps/controller run export
```

`export` produces JavaScript/Hermes bundles, not an installable APK/IPA. The
checked-in application IDs (`dev.weesports.controller`) are development defaults.
Choose owned IDs and distribution/signing configuration before publishing.

Compatibility instructions checked against Expo's official
[SDK 58 camera](https://docs.expo.dev/versions/v58.0.0/sdk/camera/),
[sensors](https://docs.expo.dev/versions/v58.0.0/sdk/sensors/),
[SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/),
[version mismatch](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/),
[iOS sign-in](https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/),
[development builds](https://docs.expo.dev/develop/development-builds/introduction/)
and [internal distribution](https://docs.expo.dev/build/internal-distribution/)
documentation on 7 November 2026.

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
are callback cadence, **not** end-to-end latency. Table-tennis gyro poses go
directly to the socket on each fresh sample, with a 12 ms minimum spacing to
admit normal 60 Hz scheduling jitter. Congested/disconnected samples are dropped
instead of queued; bowling aim retains its separate 50 ms minimum. Pure math, filtering,
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

- 26 native transport/scanner/automatic-setup/sensor-lifecycle, gravity fixture and guest-claim tests, including cancellation
  while a permission prompt or sensor availability request is unresolved.
- The 60 Hz pose stream, burst bounds, congestion drops and unchanged bowling
  aim rate through the real native session class.
- Metro/Hermes export for Android and iOS, using the pinned SDK dependencies.
- Installed versions checked against the SDK's bundled native-module manifest.
- The root `npm run expo` command starts Metro in Expo Go mode; local Android
  and iOS SDK 58 manifests and development bundles returned HTTP 200. This
  validates the loading path, not installation or execution on a phone.

Not yet verified: an installed Android/iOS build, physical sensor axes and
permissions, haptic behavior, a full ten-frame native bowling game, a native
table-tennis bot match, background/foreground behavior on hardware, and the
same-phone browser/native latency comparison. Those gates require a connected
phone and the platform development toolchain. No native speed or battery
advantage is claimed. Production universal/app links are intentionally omitted
until the project has a controlled HTTPS domain and association files; temporary
tunnels can still be scanned inside the app.
