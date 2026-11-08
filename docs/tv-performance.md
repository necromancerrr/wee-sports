# TV rendering and fullscreen

Large-screen rendering is now bounded independently of the physical screen size.
Tennis, table tennis and bowling start with at most 1920 × 1080 drawing pixels,
while HTML scores, controls, camera framing and the browser viewport retain their
normal dimensions. A 3840 × 2160 viewport therefore starts with 75% fewer scene
pixels. This is a rendering-work reduction, not a measured FPS improvement.

The shared quality controller lowers resolution under sustained pressure. A
short resolution trial distinguishes a GPU-limited 30 FPS cadence from a native
30 Hz display: it keeps the reduction when cadence improves and rolls it back
when it does not. Resize updates logical size and pixel ratio together, avoiding
an intermediate oversized buffer. Physics steps, input cadence, rules and scene
content are unchanged.

Bowling caches stationary shadows and refreshes them during deliveries, after
settlement, rack changes and checkpoint restoration. Table-tennis quality
decisions now include physics and HUD work, with separate opt-in timing metrics;
unchanged HUD values no longer produce repeated DOM writes.

Each decorative island shader is limited to its source image's pixel count
(and a maximum of 1080p). The existing full-size still remains underneath.
Sustained very slow visible frames stop decorative rendering and reveal the
original artwork. Hidden tabs and isolated load/resume stalls do not trigger
that fallback. The motion toggle can retry the effect. Existing sky/ocean
extension and island proportions are preserved. Viewport-unit fallbacks keep
the island and game stage usable in older browsers without `svh`/`dvh`.

The lobby stays windowed. Countdown still attempts browser fullscreen. When
that is denied, the viewport-filling layout remains and a focused **Full screen**
action works with one click or the TV remote's Enter button. Display controls
now use actual browser fullscreen state, rather than confusing the CSS layout
with permission to hide browser chrome. Entering/exiting fullscreen preserves
the mounted game and its score. Browsers without the API keep the full-window
layout without an unusable fullscreen action.

A start command from the phone cannot grant transient user activation to the
TV browser. Some browsers require that one local click/Enter; this restriction
cannot be removed by changing hosting providers.

Regression coverage includes the adaptive policy, source image budget, slow
decoration fallback, bowling shadow lifecycle, fullscreen rejection/retry and
game-frame preservation. `scripts/browser-tv-performance-smoke.cjs` checks
4K and DPR 1/2 canvas budgets, resize framing, score visibility, and usable
navigation after decorative motion stops. The existing island animation/resize
and play-flow browser checks cover the visual and session paths.

Browser evidence uses local Chromium with software WebGL. It does not establish
physical Toshiba TV FPS, wireless input latency, or support for an unspecified
TV browser version. Games require WebGL2. Earlier diagnosed aim/stroke-recognition
issues are separate from these presentation fixes.
