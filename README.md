# wee-sports

A browser sports platform for a TV/laptop and a phone. Play Bowling, Table
Tennis, or the existing Tennis game as a guest. Scan the room QR with your
normal camera, choose motion or touch controls, and play; no account or app
installation is required.

On a TV or computer, the opening **Play** button leads to the island. Choose Tennis, Bowling or
Table Tennis to open a room, then scan its QR with your phone. **Menu** keeps
manual joining, profiles, help, appearance and motion preferences nearby.
Phones and tablets open a **Controller** screen with **Scan TV code**, manual
code entry and **Profile & history**. Scanning starts the camera only after a
tap. Sky and ocean fill wide and tall displays while the whole resort keeps
its proportions. `/home` follows the same device roles; QR join links still go straight
to the controller. Resizing a computer window does not turn it into a phone.

Each person scans, enters their playing name, and taps **Play** to join. The first phone gets **Start game**
and confirms **Start now**; the TV shows the code and people who have joined.
Start solo or with friends. Even full rooms wait for confirmation: up to eight
for Bowling, two for Tennis or Table Tennis. Change sports in **Tools → Change
sport**. Tutorials skip automatically on web and Expo.

The lobby stays windowed. Fullscreen is requested when the confirmed countdown
starts, with a large 5–1 over faint sport icons, then the game fills the same view.
If the browser blocks fullscreen, play still fills its window and the TV offers
a **Full screen** button. A phone cannot grant the TV's browser permission.

Leaving the TV page or choosing **Return to lobby** keeps an unfinished game's
last completed point or roll while the room is running. Open **Return to room**
on the homepage: the TV offers **Continue game** or **New game** with the same
players. Phones return to the lobby together. **Close lobby** ends the room;
changing the roster starts a new match.

Table tennis plays in an open-air pavilion inspired by its spot on the homepage
island, with water and greenery around the court in solo and split-screen play.

See the [island implementation and checks](docs/island/README.md) for the
reference artwork, responsive behavior and validation evidence.

## Games and controls

- **Bowling:** one to eight players, ten-frame scoring and solo practice. Aim on
  the phone and watch the live TV indicator; beginning a forward delivery freezes
  aim automatically. Button controls provide aim, power, curve and a deliberate roll.
- **Table Tennis:** one or two players. Solo starts a scored bot game; two phones
  play head to head with a separate camera view from each end of the table. Games finish at 12 with a two-point lead; practice feeds are optional. Use compact motion or the touch paddle. The
  standalone diagnostic view (`/table-tennis.html?diagnostics=1`) also supports pointer/arrow movement, click/Space
  to stroke, and P to pause. In Friendly mode, aim selects a landing area and
  power changes pace. Direction locks at stroke onset; the ball follows its
  physical flight after contact. Standard mode uses unassisted player contact physics.
  A still phone holds a steady ready paddle. In Friendly mode, a forehand tends
  left and a backhand right in each player’s view; deliberate aim can override that tendency. Winners and final scores stay on the TV, even after controller input stops.
  Tilt gently for short/deep placement. The TV keeps scores and brief match
  announcements; instructions and diagnostic labels require the diagnostic URL.
- **Tennis:** best of three sets, each first to **7 points, win by 2**, against a
  bot or a second phone controller. There are no games within sets. Each set
  gets an announcement and a short break before the next serve. Solo uses one camera; two humans use split screen.
  Forehand/backhand motion and button controls remain available.
  Motion captures aim and depth before the swing, so follow-through cannot
  redirect a shot. Both racket sports offer Rally/Challenge opponents in phone
  settings and optional practice targets after three legal returns.

Developer measurements are opt-in: see [diagnostics](docs/developer-diagnostics.md)
and the [motion research and implementation notes](docs/sports-motion-research.md).

Golf is a coming-soon catalog entry. Pool/Billiards is a future game; neither is
playable in the current sport registry.

Tennis keyboard controls:

- **J/K** or **Phone Swing**: backhand/forehand swing 
- **B / Shift+B**: feed a practice ball
- **N / Shift+N**: feed the bot
- **H**: toggle debug displays (hitboxes and location circle)
- **W/A/S/D**: move manually (disabled)

## Features

- Browser guest pairing, readiness, shared pause and private reconnect tokens.
- Scan, enter a name, tap Play to join, and allow motion if asked. Setup and readiness are automatic;
  no grip checklist or per-roll Arm button. Touch controls remain one tap away.
- Same-room sport switching preserves player identities and the selected control
  mode; fresh sensor samples establish the next sport’s neutral position.
- Shared SI-unit motion adapters and capability negotiation; continuous
  table-tennis pose and bowling aim are distinct from deliberate actions.
- Optional [Expo controller](apps/controller/README.md) with scanner, native
  sensors and haptics. Hardware acceptance is separate from browser delivery.
- Camera scanning on the browser controller home, join screen and controller
  options, with manual entry if camera access is unavailable. Switching TVs asks
  before releasing the current seat. Camera access needs the HTTPS phone link.
- Optional profiles, preferences and casual match history backed by local
  SQLite. Bowling and Table Tennis save settled roll/point boundaries; they
  never promise exact mid-flight recovery.

See [consistent shots and TV feedback](docs/game-quality.md),
[controller clarity and short matches](docs/controller-playability-review.md),
[phone-led lobbies and continuous-motion repair](docs/phone-led-lobby-repair.md),
[the party and controller repair](docs/party-controller-repair.md),
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

Scan the terminal's Expo QR to open the controller, then tap **Scan TV code**
and scan the TV's room QR. The phone and PC should share Wi-Fi.

Web and Expo connect to the same game server. Expo's development server loads
the native app; it does not create a separate lobby or game.

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
- [Production readiness and verification](docs/production-readiness.md)
- [Railway deployment runbook](docs/railway.md)

Use `npm run check` for TypeScript and semantic ESLint checks across browser,
native, server and test code. The optional `.prettierrc.cjs` formatter retains
the GTS style settings without requiring a repository-wide formatting rewrite.

## Running the system
### 1. Install Node.js 24 and npm 11

Install Node.js 24 for your operating system from the
[official Node.js website](https://nodejs.org/en/download).
The supported versions are recorded in `.nvmrc` and the package engines.
Node 24 is required for the server's native SQLite and direct TypeScript imports.

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

This root install covers the browser, server and local `shared` workspace;
separate installs under `client` or `server` are unnecessary. Its `prepare`
hook runs the TypeScript check, so development dependencies are required while
installing and building. The optional native controller has a separate npm
lockfile and uses `npm run expo:install`.

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

Reloading a live TV offers **Continue game / New game** for Bowling, Table Tennis
and Tennis when the same players remain. Continue restores the last completed
roll or point. Bowling and Table Tennis also save these boundaries to SQLite. After a
server restart, in-memory room codes expire; a signed-in solo participant can
use **Continue a solo game** in Profile & history on a new TV to open an owned
saved boundary, then join from a phone signed into the same profile. Interrupted
rolls or points restart from the last saved state. The original boundary remains
read-only and allows one continuation under a new game identity. Party-room archive recovery,
exact mid-flight continuation and ranked result integrity are not supported.
Tennis recovery is stored in the running room; it does not survive a server restart.

## Play with built assets

Run `npm run play` to build once and serve the production assets on port 5173.
Stop an existing server on that port first. This avoids Vite development serving
overhead, but does not alter motion detection thresholds or network latency.
For phone sensors, keep using a trusted HTTPS tunnel or deployment and provide
its origin through `PUBLIC_GAME_URL` when needed. The bottom tennis swing-status
pill is hidden; scores and the serving marker remain in the top scoreboard.

Browser tennis and table-tennis controllers try a direct connection to the TV
to reduce input delay on reachable local networks. They fall back to Railway
when that connection is unavailable; bowling keeps its existing route.
See [input, first-shot placement and fullscreen](docs/direct-input-and-first-shot.md)
for the behavior and browser restrictions.

For an already built deployment, `npm start` serves the existing assets without
building again. Follow the [Railway runbook](docs/railway.md) for origins,
persistent storage, health checks and shutdown settings; the
[readiness report](docs/production-readiness.md) records verified behavior and
remaining release checks.

## Use Case: Join and play a motion-controlled game

1. On the TV or laptop, choose a playable sport to create a room. The lobby shows
   its QR code and manual room code.
2. Each player scans the QR or enters the code, enters a playing name, and taps
   **Play**. Motion permission is requested on that tap when needed; denied or
   unavailable sensors select touch controls. Setup and readiness are automatic.
3. The TV shows the joined players. When everyone is ready, the first phone
   chooses **Start game** and confirms **Start now**. Full rooms wait for the
   same confirmation. Tutorials skip automatically.
4. The countdown starts and the TV requests fullscreen. The game still fills
   the available window if fullscreen permission is denied.
5. Players use motion or touch controls. The TV simulates the sport, displays
   actions and scores, and applies its scoring rules through the result screen.
6. After a match, choose a rematch, return to the lobby, change sports when the
   roster fits the next sport, or leave. The room and player identities can stay
   together between sports.

An invalid, expired or full room shows an error and lets the player retry with a
valid available room. Motion can be enabled later from controller options;
interrupted sensor input requires fresh samples before another action is sent.

A temporary player disconnect reserves the seat for up to 60 seconds and
pauses play. Reconnecting resumes that identity while it remains valid and
discards old motion. An expired or explicitly released player seat ends the
current match and returns the remaining players to lobby readiness. A missing
TV can return while its room remains alive; connected phones retain that room.
This differs from **Close lobby**, which ends the room for everyone, and from a
server restart, which expires all live room codes. Saved-game continuation has
the separate boundaries described above.

Both phone controllers offer **Go home**, including while reconnecting. This
stops input immediately and remembers a private shortcut to **Return to room**
while the seat is still available. Returning is always a choice. **Leave room**
forgets that shortcut and works offline; **Close lobby** on the TV sends phones
home automatically. A temporary TV disconnect shows **Waiting for the TV**.
Room shortcuts do not extend the server's reservation or survive its restart.
See [controller recovery and input delivery](docs/controller-recovery-input.md)
for the behavior, latency changes and verification boundaries.
