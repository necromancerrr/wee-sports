# Build system

Use Node 24 and install dependencies with:

```sh
npm ci
```

Build the three games, lobby/profile shell and both browser controllers with:

```sh
npm run build
```

The build verifies all six built page entries and the required GLB models.
The optional [Expo project](../apps/controller/README.md) has its own lockfile
and build instructions; it is not required for either browser controller.

Some legacy output files under `build/` and `dist/` are tracked. To validate
without altering them, use an external cache/output directory:

```sh
mkdir -p /tmp/wee-sports-checks
npm run compile -- --tsBuildInfoFile /tmp/wee-sports-checks/tsconfig.tsbuildinfo
WEE_BUILD_DIR=/tmp/wee-sports-checks/dist npm run build
PORT=5174 WEE_BUILD_DIR=/tmp/wee-sports-checks/dist node server/main.js --production
```

Profiles default to `.wee-data/profiles.sqlite`. For deployed persistence, set
`WEE_PROFILE_DB` to a writable persistent volume path. Optional profile storage
failure leaves guest play available and must not be described as a saved game.

For phone play, install `cloudflared` once (`brew install cloudflared` on macOS),
then run:

```sh
npm run dev
```

The launcher builds into `.phone-build/`, starts the combined server and a
temporary HTTPS tunnel, and configures the lobby QR automatically. Open
`http://localhost:5173` on the TV/laptop and keep the terminal running.
`npm run dev:phone` is an alias. Restart after source changes to rebuild.

Use `npm run dev:local` for local Vite editing without a phone tunnel. See the
[root README](../README.md#running-the-system) for setup on other systems and
existing HTTPS tunnels.
