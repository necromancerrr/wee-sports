# Developer motion diagnostics

Diagnostics are off during normal play. The measurement collector adds no HUD
or raw sensor logging. Table Tennis also uses the explicit diagnostic flag to
restore its testing controls and instructional labels.

Open the live TV room with `/host/CODE?diagnostics=1`, and the web controller with `/join?code=CODE&diagnostics=1`. The game bridge carries the flag into its iframe. Standalone game/controller pages also accept `diagnostics=1`. In browser developer tools, inspect:

```js
window.__weeDiagnostics.snapshot()
window.__weeDiagnostics.clear()
```

For Expo, set `globalThis.__WEE_DIAGNOSTICS__ = true` in the development debugger **before opening the controller**, then inspect `globalThis.__weeDiagnostics.snapshot()`. Reload without that flag to turn native diagnostics off. This does not enable a production settings panel.

Each scope retains bounded samples and reports p50, p95, p99, and maximum durations. Counters distinguish samples sent/coalesced, accepted/rejected strokes, render quality changes, and transport observations. Action IDs or player/pose sequence IDs correlate stages without recording raw motion vectors, player names, room codes, or session tokens. Histories stay in memory; exporting a snapshot is an explicit developer action.

The available stages include sensor cadence, recognition/send, server processing, TV receipt/preparation/contact, and frame work/gaps. Coverage depends on the sport and controller path. Browser bridges request an authenticated server summary every two seconds while enabled. Probes require room membership, are rate limited, and server collection expires after ten seconds without a probe. Native motion diagnostics remain local.

Interpret measurements by clock scope:

- `serverRoundTripMs` is the phone/TV round trip to the server probe. It is not one-way input latency.
- `swingDeliveryRoundTripMs` covers send through TV bridge acknowledgement. An acknowledgement does not prove that a frame reached the display.
- `sendToResultRoundTripMs` covers send through the returning stroke result on the same phone clock.
- TV receipt-to-preparation/contact and render frame gaps use the TV's own clock.
- Server relay summaries and iframe collectors retain their own clock scope. Match IDs to follow an action, but never subtract timestamps from different scopes or devices.

Use physical iPhone playtests and high-frame-rate video for actual motion-to-visible-response measurements. Browser/native stage timings locate delays but do not substitute for that measurement. Compare the same device, room, and network conditions; clear histories between cases.
