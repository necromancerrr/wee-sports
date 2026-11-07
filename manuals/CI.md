# Continuous integration

GitHub Actions runs on every push and pull request. It uses Node 24 and runs:

```sh
npm ci
npm run compile
npm test
npm --prefix server test
npm run build
```

The root npm workspace installs `@wee/shared` automatically. The Node server
suite exercises actual Socket.IO authorization, input generations, host epochs
and lost acknowledgements in addition to in-memory state transitions.

A separate `native-controller` job installs the pinned dependencies in
`apps/controller` and runs its scanner, session and sensor-lifecycle tests. Native
Android/iOS bundle export is a separate documented validation command; CI does
not sign apps or claim real-device acceptance.

Check the workflow result before merging.
