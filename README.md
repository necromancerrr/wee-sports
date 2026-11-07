# wee-sports

A browser sports platform for a TV/laptop and a phone. Play Bowling, Table
Tennis, or the existing Tennis game as a guest. Scan the room QR with your
normal camera, choose motion or touch controls, and play; no account or app
installation is required.

## Games and controls

- **Bowling:** one to four players, ten-frame scoring and solo practice. Aim on
  the phone and watch the live TV indicator; beginning a forward delivery freezes
  aim automatically. Button controls provide aim, power, curve and a deliberate roll.
- **Table Tennis:** one player, repeatable practice feeds or a scored bot game
  to 12 with a two-point lead. Use compact motion or the touch paddle. The
  standalone diagnostic view also supports pointer/arrow movement, click/Space
  to stroke, and P to pause. In Friendly mode, aim selects a landing area and
  power changes pace. Direction locks at stroke onset; the ball follows its
  physical flight after contact. Standard mode uses unassisted contact physics.
- **Tennis:** best of three sets, against a bot or a second phone controller.
  Forehand/backhand motion and button controls remain available.

Tennis keyboard controls:

- **J/K** or **Phone Swing**: backhand/forehand swing 
- **B / Shift+B**: feed a practice ball
- **N / Shift+N**: feed the bot
- **H**: toggle debug displays (hitboxes and location circle)
- **W/A/S/D**: move manually (disabled)

## Features

- Browser guest pairing, readiness, shared pause and private reconnect tokens.
- Scan, tap Play, and allow motion if asked. Setup and readiness are automatic;
  no grip checklist or per-roll Arm button. Touch controls remain one tap away.
- Same-room sport switching preserves player identities and the selected control
  mode; fresh sensor samples establish the next sport’s neutral position.
- Shared SI-unit motion adapters and capability negotiation; continuous
  table-tennis pose and bowling aim are distinct from deliberate actions.
- Optional [Expo controller](apps/controller/README.md) with scanner, native
  sensors and haptics. Hardware acceptance is separate from browser delivery.
- Optional profiles, preferences and casual match history backed by local
  SQLite. Bowling and Table Tennis save settled roll/point boundaries; they
  never promise exact mid-flight recovery.

See [consistent shots and TV feedback](docs/game-quality.md),
[the table-tennis motion and physics repair](docs/table-tennis-research.md),
[the simple-controller design and research](docs/system-plan/controller-simplicity.md),
the [trial runbook](docs/system-plan/README.md) and
[acceptance evidence](docs/system-plan/acceptance.md) for what was checked and
which physical-device trials remain open.

## Try Expo on your phone

For Android, install **Expo Go for SDK 58** from [expo.dev/go](https://expo.dev/go).
Keep `npm run dev` running for the TV, then use a second terminal in this repo:

```sh
npm run expo:install
npm run expo
```

Scan the terminal's Expo QR to open the controller, then tap **Scan to play**
and scan the TV's room QR. The phone and PC should share Wi-Fi.

For iPhone, SDK 58 needs a development build; the App Store Expo Go is
incompatible. The [controller guide](apps/controller/README.md#using-an-iphone-from-windows-linux-or-mac)
includes a Windows/Linux/Mac cloud-build route and a local Xcode route. Once
installed, use `npm run expo:dev`. Browser play remains available immediately.

## Development

- [Version control](manuals/VERSION_CONTROL.md)
- [Bug tracking](manuals/BUG_TRACKING.md)
- [Build system](manuals/BUILD.md)
- [Testing](manuals/TESTING.md)
- [Continuous integration](manuals/CI.md)

The project follows the Google TypeScript Style Guide and uses GTS for
formatting and linting.

## Running the system
### 1. Installing Node.js 24

Install Node.js 24 for your operating system from the
[official Node.js website](https://nodejs.org/en/download).

Verify the installation:

```bash
node --version
npm --version
```

### 2. Install the phone tunnel client once

Phone motion needs HTTPS, including when the phone and laptop share Wi-Fi.
The development launcher creates a temporary HTTPS connection automatically
using Cloudflare Quick Tunnels. No account or domain is required.

On macOS:

```bash
brew install cloudflared
```

For Windows or Linux, use the
[official cloudflared downloads](https://developers.cloudflare.com/tunnel/downloads/).

### 3. Install dependencies

From the project folder:

```bash
npm ci
```

### 4. Run the game and phone connection

```bash
npm run dev
```

This builds the app, starts the server and secure tunnel, and checks that the
phone link is reachable. Open `http://localhost:5173` on the TV/laptop, choose a
sport, and scan the lobby QR with your phone. The QR uses the HTTPS address
automatically. There is no separate ngrok command or URL to configure.
`npm run dev:phone` is an alias for the same launcher.

Keep the terminal open while playing. Press Ctrl+C to stop the server and
tunnel together. The temporary public link changes on restart, so scan the new
QR each session. Anyone with the link can reach the app while it is running.
Re-run `npm run dev` after source changes to rebuild the phone-play session.

### Local editing or an existing tunnel

For local editing with Vite or keyboard-only testing:

```bash
npm run dev:local
```

This starts the local server without a tunnel. Plain HTTP on a LAN cannot
provide phone motion access. To use an existing HTTPS tunnel such as ngrok,
start that tunnel for port 5173 and pass its origin when starting the server:

```bash
PUBLIC_GAME_URL="https://your-tunnel-domain" npm run dev:local
```

The TV can stay on `http://localhost:5173`; its QR will use that secure origin.

## Operational Use Case

The TV owns the simulation and renders the Three.js scene. Existing Tennis uses
a 120 Hz step; Bowling retains cannon-es at 240 Hz; Table Tennis uses its own
fixed-step ball/paddle simulation with swept contacts. The room service
authenticates players and routes inputs; the phone cannot award itself a score.

The normal phone-camera QR opens the browser controller. The Play tap requests motion permission when needed. Sensor setup runs in the
background, with automatic touch fallback when sensors are unavailable.
Players can return to the lobby and choose another sport without recreating
their identities. Profiles and the optional native client remain independent
of this guest journey.

## Optional profiles and saved games

Open **Profile & history** to create a username/password profile or sign in.
Preferences include hand, sensitivity, assistance, sound, haptics and accessible
controls. Device calibration stays local. Password recovery is not implemented;
guest play remains available without an account.

The server uses Node 24's SQLite support and stores data in
`.wee-data/profiles.sqlite` by default. Set `WEE_PROFILE_DB` to an appropriate
persistent path for deployment. Protect and back up that data; an ephemeral
container filesystem is not durable storage. No external identity provider or
hosting service is provisioned by this repository. Use HTTPS for account access
outside local development.

The TV reports whether the latest stable boundary was saved. Reloading a live
Bowling or Table Tennis host restores its available settled boundary. After a
server restart, in-memory room codes expire; a signed-in solo participant can
use **Continue a solo game** in Profile & history on a new TV to open an owned
saved boundary, then join from a phone signed into the same profile. Interrupted
rolls or points restart from the last saved state. The original boundary remains
read-only and allows one continuation under a new game identity. Party-room archive recovery,
exact mid-flight continuation and ranked result integrity are not supported.
Existing Tennis does not yet have durable score recovery.

## Play with built assets

Run `npm run play` to build once and serve the production assets on port 5173.
Stop an existing server on that port first. This avoids Vite development serving
overhead, but does not alter motion detection thresholds or network latency.
For phone sensors, keep using a trusted HTTPS tunnel or deployment and provide
its origin through `PUBLIC_GAME_URL` when needed. The bottom tennis swing-status
pill is hidden; scores and the serving marker remain in the top scoreboard.

## Use Case: Join and play a motion-controlled game

### Primary actors: Host and player

### Goal: Players join a shared game using their phones as controllers, complete the game, and view the results.

### System: Wee Sports

### Trigger: The host selects "create room"

### Preconditions: The host has opened the application, and players have network access to the shared session

### Basic Scenario

Host first chooses to create the room

1. The host creates a room, and the system/website displays a QR code
2. Players scan the QR code, enter their names, and join the room.
3. The system displays the connected players on the host's lobby screen, host selects a game.
4. Players tap Play and grant motion permission if asked. Real sensor readings complete setup automatically; denied or unavailable motion uses touch controls. No separate Ready tap is required.
5. Once all players are ready, host starts the game.
6. Players move their phones to perform actions in selected game.
7. The system responds to player input, displays corresponding game actions, and updates scores. Steps 6 - 7 repeated until the game is finished.
8. The system identifies a winner based on game point counts, and displays this information.
9. Results are displayed, participants may replay, return to lobby, or leave the game.

### Variation flows

2.1. Join using a room code
2.1a. Player enters room manually instead of entering a room code
2.1b. System validates code, player enters their name, and joins
2.1c. Continue at step 3

4.1. Use button controllers where supposed
4.1a. Player makes decision on using button controller instead of motion controller
4.1b. System displays supported controls, player marks themselves ready
4.1c. Continue at step 5

7.1. Tied scores
7.1a. System applies the tied game rules
7.1b. If ties are allowed, displays tied players. Else, return to step 6, repeat until game outcome is determined.

### Exception flows

2.1. Expired or invalid room code
2.1a. The system displays an error and asks player to enter a valid code
2.1b. Return to step 2, or player chooses to leave and their participation ends

4.1. Motion permission denied or sensors unavailable
4.1a. The system selects touch controls and explains that motion is off.
4.1b. The player can play immediately or choose Use motion later.

4.2 Motion samples are interrupted
4.2a. The system discards the unfinished gesture and waits for fresh readings.
4.2b. Setup resumes automatically, or the player can use touch controls.

5.1. A required player is not ready
5.1a. The system keeps the game in the lobby and identifies players who are not ready.
5.1b. Return to step 4 for players that are not ready. Continue at step 5 once required players are ready.

6.1. Player disconnects
6.1a. System pauses the game.
6.1b. The player reconnects and the controller resumes after fresh samples; old gestures are discarded.
6.1c. Resume step 6 only after connection and controller readiness are reachieved.
6.1d. If connection period expires, system applies the 60-second session-expiration policy where their seat is removed,, and the room closes.  

Any step- User ends session
a. The system notifies the players and closes the room.
b. Game ends without completion, active players returned to lobby.
