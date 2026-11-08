# Build system

Use Node 24 and npm 11 (`.nvmrc` and the package engines describe the supported
runtime). The server uses Node's native SQLite and direct TypeScript imports;
older Node versions are not supported. Install dependencies with:

```sh
npm ci
```

The root install owns the browser, server, and `shared` workspace dependencies.
Do not install separately under `client` or `server`: those manifests expose
development/test commands against the root installation. The optional Expo app
has its own pinned `apps/controller/package-lock.json` and uses
`npm --prefix apps/controller ci`. npm is the supported package manager for both
boundaries; the obsolete Bun lockfile has been removed.

Root `npm ci` runs `prepare` → `compile`, so build tooling is required during
installation. Build with development dependencies, then prune them only after
the build. Production startup is `npm start` (`node server/main.js --production`)
and performs no install or build.

Build the three games, lobby/profile shell and both browser controllers with:

```sh
npm run build
```

The build verifies all six built page entries, the required GLB models and the
island artwork. The landing screen is `/`; `/home` opens the sport selector.
The optional [Expo project](../apps/controller/README.md) has its own lockfile
and build instructions; it is not required for either browser controller.

Generated `build/` and `dist/` files are no longer tracked. Canonical models stay
in `public/assets/`; Vite copies them into the production output. TypeScript
checks emit no JavaScript and cache under `node_modules/.cache/wee-sports/`.
For a separate validation build, use an external cache/output directory:

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
