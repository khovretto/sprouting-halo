# Consult 4: performance (frame rate, GPU, memory, OBS)

Scope: `viewer/` as of commit e3fc198. No source file was changed; everything below is a proposal.
What is measured and what is estimated is marked. Line numbers refer to that commit.

## 0. Findings in one page

1. **There is no frame-rate limit and no resolution limit.** `frame()` (main.ts:812) simulates and
   draws on every `requestAnimationFrame`, and `draw()` sizes the canvas to
   `clientWidth x devicePixelRatio` (main.ts:784). A preview window on a 1440p 144 Hz monitor
   therefore costs about 4.3x the GPU work of the OBS source at 1080p60, and on a 4K 144 Hz monitor
   about 9.6x. All Chrome tabs share one GPU process, so this is the most likely reason YouTube
   stutters next to the preview. Fix: steps 1 and 2 of the plan.
2. **A real memory leak in the halo vine (measured).** `HaloVine` drops old nodes from
   `this.nodes`, but every surviving node keeps its `parent` reference, so the whole runner chain
   back to the origin stays reachable forever. A Node run of `HaloVine.update` (60 steps/s, singing
   half the time) retained 74,501 nodes behind one tip after 30 simulated minutes while only 917
   were live, and the heap after forced GC grew from 5.5 MB to 38 MB: about **1.1 MB per minute
   per halo, 65 MB per hour**. It does not explain YouTube breaking within minutes, but it does
   matter for a four-hour stream in OBS. Fix: step 4 (five lines).
3. **Below 20 fps the overlay runs in slow motion.** `realDt = Math.min(0.05, ...)` (main.ts:815)
   clamps instead of catching up. If the OBS source renders slowly for any reason (software
   rendering, a low custom frame rate, a busy GPU), the plants move slower than real time, which
   reads as "very slow" rather than "choppy". The new loop sub-steps instead.
4. **The quads are much larger than the ink.** Chain links have a hard `discard` at their flat
   ends but still pay for a padded cap there; a typical branch segment shades about 3x the
   fragments it needs, the halo vine about 4x, a pine needle about 8x. Fix: step 3, vertex
   shaders only, identical picture.
5. **Not a problem, leave alone:** the vertex shader noise (12,000 vertices per frame is nothing),
   the uniform uploads, the five `bufferData` calls, `preserveDrawingBuffer` (it is already off),
   and the CPU cost as such (3 ms per frame is fine at 60 fps; it was only expensive at 144).

## 1. Frame-rate policy

### 1.1 Rates

| Situation | Rate | Why |
| --- | --- | --- |
| OBS, something sings / grows / transitions | `perf.fps` = 60 | Matches a 60 fps stream. OBS already drives the page at its own rate, so this is a safety net (120 fps canvases, custom frame rates). |
| Preview, window focused | `perf.fps` = 60 | What OBS will show. On 144 Hz this becomes 72 (every 2nd refresh), see 1.2. |
| Nobody sings, no transition, for 2 s | `perf.idleFps` = 30 | Only wind sway, the creeping vine and slow fades remain; they read fine at 30. Set it to 60 to switch the idle mode off. |
| Preview, another window has focus | `perf.backgroundFps` = 30 | The YouTube case. Not lower by default, because "DAW focused, preview on the second monitor" is also this case and must stay watchable. |
| `document.hidden`, or OBS says the source is not visible | 0 (no simulation, no draw) | Nobody sees it. State resumes where it stopped; live features drive it again at once. |

Wake-up from idle takes at most one idle frame (33 ms): the activity check runs after every
simulated frame, and note starts are latched in `LiveSource.onsets`, so none is lost.

### 1.2 How to cap correctly on rAF

`requestAnimationFrame` is already vsync-aligned, so the right structure is "work on every n-th
callback", not a timer. A plain time accumulator has two defects here: with a 60 cap on a 144 Hz
display it yields an uneven 2-3-2-2-3 cadence, and with a cap almost equal to the display rate
(60 against 59.94 or 60.06 Hz, or OBS at 60) it beats: one skipped frame every few seconds.

So: measure the rAF period, pick `n = round(wantedInterval / period)`, and run when at least
`(n - 0.5)` periods have passed since the last drawn frame. The half period of tolerance absorbs
jitter and makes "cap = display rate" exactly "every refresh". The cap snaps to a whole division
of the display rate: 144 Hz gives 72 and 28.8, 165 Hz gives 55, 120 and 240 Hz give 60.

Simulation time stays correct because `dt` is the real time since the last *simulated* frame, in
sub-steps of at most 50 ms (the step size the simulation already accepts today), up to 0.25 s per
drawn frame. `sprout.advance(3, 1/8)` in the README already checks frame-rate independence.

Code is in step 1 of the plan (section 4).

### 1.3 OBS specifics

Checked against the obs-browser source (`obs-browser-source.cpp`) and README:

- OBS creates the browser with external begin-frames, and
  `windowless_frame_rate = fps_custom ? fps : canvas_fps`. With "Use custom frame rate" off, rAF
  fires once per OBS frame, in step with OBS's own render loop. **The page does not need to read
  the OBS fps, and there is no API for it** (`window.obsstudio` has `getStatus`, scenes and
  transitions, nothing about frame rate). The measured rAF period is the OBS rate.
- When the source stops showing, obs-browser calls `WasHidden(true)` (so `document.hidden` becomes
  true and rAF stops) and dispatches `obsSourceVisibleChanged` with `detail.visible`. The loop
  below checks both. `obsSourceActiveChanged` (`detail.active` = on the program output) exists too;
  it is not needed for a first version.

What the artist should set on the Browser Source:

| Setting | Value | Why |
| --- | --- | --- |
| Width / Height | the canvas size, 1920 x 1080 | The page caps its own render size (`perf.maxMegapixels`), so a 4K canvas does not cost 4x by accident. |
| Use custom frame rate | off | Follows OBS exactly. Turn it on with 30 only as a deliberate "half cost" switch. |
| Shutdown source when not visible | off | On, every scene switch reloads the page: trees are lost, shaders recompile (a visible hitch), the socket reconnects. The page already idles at zero cost when hidden. |
| Refresh browser when scene becomes active | off | Same reason. |
| Settings, Advanced, Sources: Browser Source Hardware Acceleration | on (restart OBS) | Off means the frame is read back through the CPU every frame, and WebGL may fall back to software. This is the first thing to check for "very slow in OBS". |

On a laptop with two GPUs, OBS and its browser helper (`obs-browser-page.exe`) must be on the same
GPU (Windows, Settings, Display, Graphics: set OBS to High performance).

## 2. GPU cost

### 2.1 What a frame costs now (estimate, 1920 x 1080, about 3000 instances)

| Pass | Work | Notes |
| --- | --- | --- |
| Clear scene | 2 x RGBA16F x 2.07 MP = 33 MB written | |
| Strokes + sprites | about 1.5 to 3 M shaded fragments (0.7 to 1.5 screens) | Each blends into two RGBA16F targets: 32 bytes read + 32 written. A branch segment 8.5 px long, 2.5 px radius is drawn as a 17.5 x 9 px quad (157 px for about 45 px of ink). A leaf 28 px long is a 32 x 32 px quad (about 300 px of ink). |
| Bloom | 0.68 MP x (1 + 5 + 5 taps) = 7.5 M half-float samples | 1/2, 1/4, 1/8 levels; the 1/2 level is 76 % of it. |
| Composite | 2.07 MP x 4 samples = 8.3 M samples | Plus a redundant `gl.clear` before it. |
| Browser compositor | one more full-size blend of the transparent canvas | In OBS: the shared texture. |

Total: about 16 M filtered half-float samples, 2 to 3 M MRT-blended fragments, roughly 100 MB of
memory traffic per frame. GPU memory: scene 33 MB + bloom 11 MB + back buffer 8 MB + an unused
depth buffer 8 MB (the context is created with the default `depth: true`) + in the preview two
full-size 2D canvases (16 MB): about 75 MB at 1080p, about 300 MB at 4K.

Expected GPU time per frame. These are engineering estimates, good to a factor of two; step 0 of
the plan adds a timer query so you get real numbers on the real machine.

| GPU | 1080p | 1440p | 4K |
| --- | --- | --- | --- |
| Mid or high discrete (GTX 1660, RTX 3060 and up) | 0.4 to 1 ms | 0.7 to 1.8 ms | 1.5 to 4 ms |
| Old or low discrete (GTX 1050, MX series) | 1 to 2.5 ms | 2 to 4.5 ms | 4 to 10 ms |
| Integrated (UHD 630, Vega 8, Iris Xe) | 3 to 8 ms | 6 to 14 ms | 12 to 30 ms |

What matters to other programs is duty cycle, time x rate:

| Case | Relative load |
| --- | --- |
| OBS source 1080p at 60 | 1x |
| Preview, 1440p monitor, 144 Hz (now) | 4.3x |
| Preview, 4K monitor, 60 Hz (now) | 4x |
| Preview, 4K monitor, 144 Hz (now) | 9.6x |
| Preview after steps 1 and 2, focused / unfocused | 1.2x (72 fps on 144 Hz) / 0.5x |

`devicePixelRatio` never raises the pixel count above the monitor's native resolution, but it does
mean the page always renders at native resolution, which nobody asked for.

### 2.2 Reductions, most effective first

| # | Change | Saves | Risk to the look |
| --- | --- | --- | --- |
| 1 | FPS policy (section 1) | 58 % on a 144 Hz preview; 50 % more when idle or unfocused | none |
| 2 | Pixel cap: render at most `perf.maxMegapixels` (2.1 = 1080p), CSS scales up | 44 % at 1440p, 75 % at 4K, nothing at 1080p | slightly soft above 1080p; the glow hides it |
| 3 | Tight quads: no cap padding on flat chain ends, 1 px instead of 2 px, sprite quads as wide as their shape | about 60 to 70 % of stroke fragments, 35 % of leaf fragments, 85 % of needle fragments; 15 to 25 % of the frame | none (the removed area is already discarded) |
| 4 | Context without depth/stencil; drop the `gl.clear` before the composite | 8 MB at 1080p, one full-screen clear | none |
| 5 | Preview: redraw the 2D overlay only when it changes | one full-window 2D canvas upload and blend per frame | none |
| 6 | Colour target RGBA8, glow target stays RGBA16F (mixed-format MRT is legal in WebGL2) | 25 % of scene-pass bandwidth, 17 MB at 1080p; 5 to 10 % of the frame | colours above 1.0 clip before blending instead of after; check loud passages |
| 7 | Optional, only if still over budget: draw the glow emission in its own half-resolution pass | about 80 % of scene-pass bandwidth, removes the copy pass; costs a second set of draw calls | glow source is rasterised at half size; equal on average |
| 8 | Optional: "light" bloom (keep the 1/2 copy as a stepping stone, blur at 1/4, 1/8, 1/16) | about a third of all post-process samples | glow gets wider and loses its tight inner rim; a look change, so only as a setting |

Answers to the specific questions:

- **RGBA8 or R11G11B10 for the bloom:** no. The glow chain needs alpha (it carries ink coverage
  for the crowd control in composite.frag), which R11F_G11F_B10F does not have, and RGBA8 clips
  the emission and bands in the wide, dark tails, which is exactly what a video encoder
  amplifies. The bloom levels are small (0.68 MP in total); the full-size targets are the cost.
  Change the colour target instead (row 6).
- **Skipping the bloom when the glow is tiny:** only `glow.strength <= 0` can skip it safely, and
  the default look always glows (`glow.base` 0.3), so this almost never triggers. Add the
  one-line early-out if you like; expect nothing from it.
- **Discard early:** not worth touching. There is no depth test to benefit, and the shaders are
  cheap next to the two half-float blends. Shading fewer fragments (row 3) is the real version of
  this idea.
- **Caching static trees in a texture:** not possible as designed. Every vertex moves every frame
  (wind, springs, flutter in motion.glsl), so there is no static picture to keep. Caching the
  CPU-built instance data of a silent plant is possible but its look values (glow, intensity,
  width) follow the drive, and the 1.8 ms it would save no longer matters at 60 / 30 fps. Skip.
- **Row 7 in one paragraph:** attach the half-size glow texture at `COLOR_ATTACHMENT1` of its own
  framebuffer with `gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1])`, and give the full-size
  framebuffer only attachment 0. The same two programs then serve both passes unchanged (an
  output without a draw buffer is dropped); the half-size pass gets `u_px * 2` and a `u_view`
  for its size, and becomes bloom level 1 directly.

## 3. CPU and memory

### 3.1 The leak: `HaloVine` parent chains

halo.ts:133 filters `this.nodes`, but `VNode.parent` still points at the dropped node, which
points at its parent, back to the origin. `rebuild()` already treats a dropped parent as "no
parent" (`index.get(...) ?? -1`), so cutting the link changes nothing visible. Measured with the
real `halo.ts` in Node (see 0.2): 1.1 MB per minute per halo. Fix in step 4. The same edit removes
the `new Map` of about 900 entries that `rebuild()` allocates every frame.

### 3.2 Per-frame garbage (not a leak; ranked by size)

| Where | What | Fix |
| --- | --- | --- |
| halo.ts:133, 180 | new node array + `Map<number, number>` with about 900 entries per halo per frame | in-place compaction, index stored on the node (step 4) |
| deco.ts `tint()` | a new 3-array per leaf, 1500 to 2500 per frame; `c.map((v) => v * 0.6)` adds an array and a closure per under-leaf | write into two module-level scratch arrays; `Placer.put` copies the numbers at once, so reuse is safe |
| main.ts `colourAt` in rainbow mode | `hsv2rgb` array per segment (3000 per frame) | scratch array; only matters in rainbow mode |
| motion.ts:98-100, renderer.ts `LayerUniforms.set` | array literals passed to `.set()` per layer per frame | assign the four elements directly |
| main.ts:584-588 | four status strings with `toFixed` every frame, also in OBS where no panel exists | build them only when `ui` exists, every 10th frame |
| main.ts `draw()` | `{ ...look }` copies, `styleOf` objects, `slotLayer` Map, two `Placer`s and a `{ ...st }` per tree | leave; a few dozen small objects |
| gl.ts `Program.set` | `Object.entries` (about 60 small arrays per frame) | `for (const k in values)`; cosmetic |
| main.ts:688 | `document.body.className = ...` every frame | assign only when it differs |
| main.ts:529-532, layout.ts | `filter` / `map` / `layoutTakes` objects per frame | leave |

Estimated total today: 150 to 300 KB per frame, so 20 to 40 MB/s at 144 fps and a minor GC several
times a second. After the cap and the first two rows: around 1 to 3 MB/s. A minor GC costs about
1 ms, so this was never the main problem; it is cheap to fix and makes heap graphs readable.

Also check once: how often Sprout.exe sends feature frames ("one per app frame"). Each is a
`JSON.parse` in every viewer; more than about 60 per second is wasted work.

### 3.3 Not leaks (checked)

`Instances` only doubles. `Generations` keeps at most 5 trees per take, each about 20 typed arrays
of up to 2600 entries (about 200 KB), released when its alpha reaches 0. `commits`, `dying`,
`endingHalos` and `LiveSource.seen` are pruned. `Scope` uses fixed ring buffers. Render targets
are disposed on resize.

### 3.4 How to check for a leak quickly

1. Open `http://localhost:5173/?offline`, DevTools, Memory. Click the bin icon (collect garbage),
   note `performance.memory.usedJSHeapSize / 1e6`.
2. `sprout.advance(1800, 1/30)` (30 simulated minutes, takes about a minute), collect garbage,
   read the number again. Before step 4 it rises by roughly 30 MB; after, it should stay within
   about 5 MB.
3. To see what grew: take a heap snapshot before and after, choose "Comparison", sort by
   "Size Delta". The leaked nodes show up as plain `Object` with keys `arcAt`, `growStart`,
   `runner`.
4. For a long real run: DevTools, three dots, More tools, Performance monitor, and watch "JS heap
   size" for 20 minutes. A sawtooth with a flat floor is healthy; a rising floor is a leak.

### 3.5 Why another tab (YouTube) can break

Each tab has its own renderer process, so this page's JavaScript, heap and GC cannot slow
YouTube's. What all tabs share:

- **The GPU process and the GPU itself.** Every tab's WebGL commands, video decoding and the
  final compositing of every window run through one process and one GPU queue. Full pipeline at
  native resolution and 144 Hz (section 2.1) can take a large share of the GPU, more so when
  VTube Studio and OBS are running on it. Video frames then arrive late: stutter, dropped frames,
  audio drifting ahead.
- **GPU memory.** About 300 MB for a 4K window. When video memory runs out Chrome may reset the
  GPU process; every tab then loses its GPU state at once (black video, a flash, "Aw, Snap").
  This page currently has no `webglcontextlost` handler, so after such a reset it stays blank
  until reloaded, in OBS too. Step 2 adds one.
- **The window's compositor rate.** A canvas that presents on every refresh forces the whole
  window to composite at 144 Hz, with three stacked full-window layers in the preview (WebGL
  canvas, 2D overlay redrawn every frame, backdrop).

`preserveDrawingBuffer` is not involved (it is off), and the uniform uploads are a few kilobytes
per frame. A hidden or fully covered tab is already paused by Chrome, so the problem exists only
while the preview is visible, which matches the report.

To tell which of these it is: Windows Task Manager, Performance, GPU ("3D" graph and dedicated
memory) with the preview open and closed; Chrome's own task manager (Shift+Esc, add the columns
"GPU memory" and "JavaScript memory"); and `chrome://gpu`, where "WebGL2" must say "Hardware
accelerated" and the renderer must name the real GPU, not SwiftShader or "Microsoft Basic Render
Driver".

## 4. Implementation plan (one sitting, in this order)

### Step 0. Numbers first (15 min)

A GPU timer and a fuller `sprout.perf()`, so every later step can be judged. `gl.finish()` in
Chrome does not wait for the GPU, which is why `glFinishMs` reads 0.05.

renderer.ts, in `Renderer`:

```ts
  /** GPU time of the last measured frame (ms), smoothed; -1 = no timer available. */
  gpuMs = -1;
  private tq: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private query: WebGLQuery | null = null;   // running or waiting for its result
  private timing = false;

  // constructor, after the context is created:
  //   this.tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  private beginTimer() {
    const gl = this.gl;
    if (!this.tq) return;
    if (this.query) {
      // One query at a time: read the previous result when it is ready.
      if (!gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
      const ms = (gl.getQueryParameter(this.query, gl.QUERY_RESULT) as number) / 1e6;
      if (!gl.getParameter(this.tq.GPU_DISJOINT_EXT)) this.gpuMs = this.gpuMs < 0 ? ms : this.gpuMs + (ms - this.gpuMs) * 0.1;
      gl.deleteQuery(this.query);
    }
    this.query = gl.createQuery();
    gl.beginQuery(this.tq.TIME_ELAPSED_EXT, this.query!);
    this.timing = true;
  }

  private endTimer() {
    if (!this.timing) return;
    this.gl.endQuery(this.tq!.TIME_ELAPSED_EXT);
    this.timing = false;
  }

  /** Which GPU draws this (SwiftShader / Basic Render Driver = software: far too slow). */
  gpuName(): string {
    const gl = this.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }
```

Call `this.beginTimer()` as the first line of `render()` and `this.endTimer()` as the last.

main.ts, replace `perf:` in the `sprout` object:

```ts
    perf: () => ({
      fps: shownFps, displayHz: +(1000 / vsync).toFixed(1),
      simMs: +perf.sim.toFixed(2), buildMs: +perf.build.toFixed(2), glSubmitMs: +perf.gpu.toFixed(2),
      gpuMs: +renderer.gpuMs.toFixed(2),
      canvas: `${glCanvas.width}x${glCanvas.height}`, dpr: window.devicePixelRatio,
      gpu: renderer.gpuName(),
      heapMB: +(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6).toFixed(1),
      instances: batches.reduce((a, b) => a + b.inst.count, 0),
    }),
```

and, so OBS can be measured without a debugger (`?obs&perflog` writes one line every 10 s to the
OBS log; if your OBS version does not log page console output, start OBS with
`--remote-debugging-port=9222` and open `http://localhost:9222` in Chrome):

```ts
  if (query.has('perflog'))
    setInterval(() => console.info('sprout perf ' + JSON.stringify((window as unknown as { sprout: { perf(): unknown } }).sprout.perf())), 10000);
```

### Step 1. Frame-rate policy (30 min)

params.ts, a new section (doc comments become the tooltips):

```ts
  /** Performance: how often and how large the picture is drawn. Shared with OBS, never part of a preset. */
  perf: {
    /** Most frames per second (OBS, and the preview while its window has focus). Snaps to a whole
     *  division of the display rate: on a 144 Hz monitor 60 becomes 72. */
    fps: 60,
    /** Frames per second while nobody sings and nothing is growing or being planted (only wind
     *  and slow fades). Same as "max fps" = always full rate. */
    idleFps: 30,
    /** Preview only: frames per second while another window has focus (DAW, a video). */
    backgroundFps: 30,
    /** Largest picture drawn, in megapixels (2.1 = 1920 x 1080, 8.3 = 4K). A larger window or
     *  source is drawn at this size and scaled up. */
    maxMegapixels: 2.1,
    /** Draw smaller and scale up (1 = full size, 0.7 = half the pixels). For weak GPUs. */
    renderScale: 1,
  },
```

ui.ts `RANGES`:

```ts
  'perf.fps': { min: 15, max: 144, step: 1 },
  'perf.idleFps': { min: 5, max: 144, step: 1 },
  'perf.backgroundFps': { min: 5, max: 144, step: 1 },
  'perf.maxMegapixels': { min: 0.5, max: 8.5, step: 0.1 },
  'perf.renderScale': { min: 0.4, max: 1, step: 0.05 },
```

panel-layout.ts: a setup folder after `connection`, labels, and the scope (rig = synced, so the
OBS page receives it; never touched by a preset):

```ts
  {
    id: 'perf', title: 'Setup: performance', setup: true,
    keys: ['perf.fps', 'perf.idleFps', 'perf.backgroundFps'],
    advanced: ['perf.maxMegapixels', 'perf.renderScale'],
    catchSections: ['perf'],
  },
  // FOLDER_HINTS:
  perf: 'How often and how large the picture is drawn. Lower values leave more of the graphics card to OBS, VTube Studio and your browser. Shared with the OBS page.',
  // LABELS:
  'perf.fps': 'max fps', 'perf.idleFps': 'fps when silent', 'perf.backgroundFps': 'preview fps in background',
  'perf.maxMegapixels': 'max picture size (MP)', 'perf.renderScale': 'render scale',
  // scopeOf():
  if (RIG_KEYS.has(path) || path.startsWith('avatar.') || path.startsWith('perf.')) return 'rig';
```

main.ts, replace the block from `// ---- Loop` down to the end of `frame()` (lines 806-827):

```ts
  // ---- Loop ----------------------------------------------------------------------------------------
  // requestAnimationFrame fires on every display refresh (in OBS: every OBS frame). A frame is
  // simulated and drawn on every n-th of them, n being the whole division of the display rate
  // nearest to the wanted fps (docs/fable-consult-4-performance.md, 1.2).
  const MAX_STEP = 0.05;    // s: longest single simulation step
  const MAX_CATCHUP = 0.25; // s: most time simulated for one drawn frame (after a stall)
  const IDLE_HOLD = 2000;   // ms at the full rate after the last activity
  let last = performance.now(); // time of the last simulated and drawn frame
  let lastRaf = last;
  let vsync = 1000 / 60;        // measured rAF period (ms), smoothed
  let activeUntil = last + IDLE_HOLD;
  let obsVisible = true;
  let contextLost = false;
  let shownFps = 0, fpsCount = 0, fpsSince = last;
  // Timing (sprout.perf()): average ms per frame of each phase over the last ~2 s.
  const perf = { sim: 0, build: 0, gpu: 0, frames: 0 };
  const perfAdd = (k: 'sim' | 'build' | 'gpu', ms: number) => (perf[k] += (ms - perf[k]) * 0.02);

  // OBS tells the page when the source is not shown anywhere (it also hides the document).
  if (obs) window.addEventListener('obsSourceVisibleChanged', (e) => {
    obsVisible = (e as CustomEvent<{ visible?: boolean }>).detail?.visible !== false;
  });

  /** Someone sings, or something is being planted, pruned or faded out: draw at the full rate. */
  function sceneActive() {
    if (commits.length || dying.length || endingHalos.length) return true;
    for (const h of halos) if (h.drive.voice || h.drive.energy > 0.03 || h.drive.flash > 0.03) return true;
    for (const s of slots) if (s.drive.voice || s.drive.energy > 0.03 || s.drive.flash > 0.03) return true;
    return false;
  }

  function wantedFps(now: number) {
    const pf = params.perf;
    let fps = pf.fps;
    if (now > activeUntil) fps = Math.min(fps, pf.idleFps);
    if (!obs && !document.hasFocus()) fps = Math.min(fps, pf.backgroundFps);
    return clamp(fps, 1, 240);
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    const rafDt = now - lastRaf;
    lastRaf = now;
    if (rafDt > 2 && rafDt < 50) vsync += (rafDt - vsync) * 0.1;
    // Nothing can be seen: no simulation, no drawing. `last` follows, so nothing jumps afterwards.
    if (document.hidden || !obsVisible || contextLost) {
      last = now;
      return;
    }
    // Every n-th refresh, with half a refresh of tolerance: jitter never skips or doubles a
    // frame, and a cap equal to the display rate is exactly "every refresh".
    const n = Math.max(1, Math.round(1000 / wantedFps(now) / vsync));
    if (now - last < (n - 0.5) * vsync) return;
    try {
      const elapsed = clamp((now - last) / 1000, 0, MAX_CATCHUP);
      last = now;
      // Longer frames are simulated in steps, so a low frame rate never slows the plants down.
      const steps = Math.max(1, Math.ceil(elapsed / MAX_STEP - 1e-6));
      const realDt = elapsed / steps;
      // The OBS page always runs in real time, whatever a preview page saved.
      const dt = obs ? realDt : params.scene.paused ? 0 : realDt * params.scene.timeScale;
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) simulate(dt, realDt);
      perfAdd('sim', performance.now() - t0);
      if (sceneActive()) activeUntil = now + IDLE_HOLD;
      draw();
      perf.frames++;
      if (++fpsCount && now - fpsSince >= 1000) {
        shownFps = Math.round((fpsCount * 1000) / (now - fpsSince));
        fpsCount = 0;
        fpsSince = now;
      }
    } catch (e) {
      showError(e);
    }
  }
```

Notes:

- `clamp(x, lo, hi)` from math.ts is used with three arguments elsewhere, so it fits as is.
- `document.hasFocus()` is false while DevTools has the focus. When profiling the preview, set
  "preview fps in background" equal to "max fps" first, or the numbers are those of the 30 fps mode.
- `sprout.bench()` and `sprout.advance()` call `simulate` / `draw` directly and are unaffected.

### Step 2. Pixel cap, lean context, context loss (15 min)

main.ts `draw()`, replace the three lines that compute `dpr`, `W`, `H` (784-786):

```ts
    // Render size: the window in device pixels, but never more than perf.maxMegapixels; CSS
    // scales the canvas up. (OBS: devicePixelRatio is 1 and a 1080p source is exactly 2.07 MP.)
    const dpr = window.devicePixelRatio || 1;
    const fullW = glCanvas.clientWidth * dpr, fullH = glCanvas.clientHeight * dpr;
    const fit = Math.min(1, Math.sqrt((params.perf.maxMegapixels * 1e6) / Math.max(1, fullW * fullH)));
    const k = fit * clamp(params.perf.renderScale, 0.25, 1);
    const W = Math.max(1, Math.round(fullW * k));
    const H = Math.max(1, Math.round(fullH * k));
```

Everything downstream (`view.s`, `u_px`, the overlay canvas, `sprout.pixels()`) already works from
`W` and `H`, so line widths and antialiasing stay right at any scale.

renderer.ts, context creation:

```ts
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, // nothing uses them; saves a full-size buffer
    });
```

and delete the two lines `gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);` before the
composite (the composite writes every pixel with blending off).

main.ts, next to the `obsSourceVisibleChanged` listener:

```ts
  // The GPU process was reset (driver update, out of video memory, another program crashed it):
  // stop drawing, and start clean once the context is back. Without this OBS shows nothing until
  // the source is refreshed by hand.
  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
  });
  glCanvas.addEventListener('webglcontextrestored', () => location.reload());
```

### Step 3. Tight quads (20 min, shaders only, same picture)

stroke.vert, replace the `pad` line and the `P` line:

```glsl
  // The quad covers only what the fragment shader keeps: a flat (joined) end is cut exactly at
  // the end point, so it needs no cap there; elsewhere the radius plus one pixel for the edge.
  float pad = max(rA, rB) + u_px;
  float padA = a_misc.z > 0.5 ? 0.5 * u_px : pad; // join 1 or 2: flat start
  float padB = a_misc.z > 1.5 ? 0.5 * u_px : pad; // join 2: flat end too

  float sx = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  float sy = (gl_VertexID & 2) == 0 ? -1.0 : 1.0;
  vec2 P = (sx < 0.0 ? A - t * padA : B + t * padB) + n * sy * pad;
```

stroke.frag discards `s0 < 0` for `v_join > 0` and `s0 > 1` for `v_join > 1.5`, which is the same
boundary, so the output is unchanged. Typical branch link (8.5 px long, 2.5 px radius):
17.5 x 9 = 157 px before, 9.5 x 7 = 67 px after. Halo vine link: 98 px to 31 px.

sprite.vert, replace the `pad` and `uv` lines:

```glsl
  // Quad as wide as the shape (sprite.frag: leaf 0.34, thorn 0.24, berry 0.42, needle 0.05,
  // holly 0.40, blossom 0.42 half-width) plus one pixel.
  float pad = u_px / size;
  float hw = sid < 0.5 ? 0.34 : sid < 1.5 ? 0.24 : sid < 2.5 ? 0.42 : sid < 3.5 ? 0.05 : sid < 4.5 ? 0.40 : 0.42;
  float sx = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  float sy = (gl_VertexID & 2) == 0 ? 0.0 : 1.0;
  vec2 uv = vec2(sx * (hw + pad), mix(-pad, 1.0 + pad, sy));
```

If a shape in sprite.frag is ever widened, widen its `hw` too; a clipped leaf edge is the symptom.
Check with `sprout.pixels()` before and after on a paused frame (`scene.paused`): the numbers
should match to rounding.

### Step 4. Halo vine: leak and per-frame Map (15 min)

halo.ts, `VNode` gets two fields (set them in `add()` so every node has the same shape):

```ts
  /** Index in the skeleton this frame (rebuild). */
  index: number;
  /** Dropped off the end of the tail: nothing may keep pointing at it. */
  dead: boolean;
```

```ts
    const n: VNode = { id: this.nextId++, x, y, parent, flex, w, kind, runner, arcAt, growStart, pos, index: -1, dead: false };
```

`update()`, replace the `this.nodes = this.nodes.filter(...)` line:

```ts
    // Drop vine that has fallen off the end of every tail (in place, no new array).
    const tail = Math.max(0.1, h.tailDeg * deg);
    let kept = 0;
    for (const node of this.nodes) {
      const tip = this.tips[node.runner];
      if (tip && tip.arc - node.arcAt <= tail) this.nodes[kept++] = node;
      else node.dead = true;
    }
    this.nodes.length = kept;
```

`rebuild()`, delete `const index = new Map<number, number>();` and replace the three lines that
use it:

```ts
      // Cut the link to a dropped parent: otherwise the whole vine ever grown stays in memory.
      if (v.parent && v.parent.dead) v.parent = null;
      const pi = v.parent ? v.parent.index : -1;
      const j = sk.add(v.x, v.y, pi, v.flex, v.w, v.kind);
      v.index = j;
```

Parents always come before their children in `this.nodes`, so `parent.index` is already this
frame's value. `tip.node` is always the newest node of its runner and is never dropped.

Same sitting, deco.ts: let `tint()` fill a scratch array instead of returning a new one.

```ts
const tintA: [number, number, number] = [0, 0, 0], tintB: [number, number, number] = [0, 0, 0];
function tint(base: RGB, natural: RGB, amount: number, intensity: number, out = tintA): [number, number, number] {
  out[0] = lerp(base[0], natural[0], amount) * intensity;
  out[1] = lerp(base[1], natural[1], amount) * intensity;
  out[2] = lerp(base[2], natural[2], amount) * intensity;
  return out;
}
```

and the under-leaf line becomes

```ts
          if (toUnder) {
            tintB[0] = c[0] * 0.6; tintB[1] = c[1] * 0.6; tintB[2] = c[2] * 0.6;
            underPlace!.put(x, y, ang, sz * 1.15, Shape.Leaf, tintB, flex, h0);
          } else place.put(x, y, ang, sz, Shape.Leaf, c, flex, h0);
```

`Placer.put` reads the three numbers straight into the instance buffer, and every call site uses
the result before the next `tint()` call, so sharing one array is safe.

### Step 5. Preview-only waste (15 min)

main.ts `draw()`, the block under `if (!obs)`: redraw the 2D overlay only when something it shows
changed (with guides on it follows the plants, so it redraws every frame as before).

```ts
    if (!obs) {
      const a = params.avatar, sc = params.scene;
      const key = sc.showGuides ? '' : [W, H, view.s, view.cx, view.cy, sc.showAvatar, a.useImage, a.opacity, a.imageX, a.imageY,
        a.imageHeight, a.headX, a.headY, a.headR, a.bodyTopY, a.bodyBottomY, a.bodyR].join();
      if (key === '' || key !== overlayKey || overlay.image !== overlayImage) {
        overlayKey = key;
        overlayImage = overlay.image;
        const guides: GuidePlant[] = sc.showGuides
          ? slots.map((s) => ({ pl: s.place, extraAngle: spin * s.place.tierDir, colour: s.colour })) : [];
        overlay.draw(view, params, guides);
      }
      ...scope lines as before
    }
```

with `let overlayKey = '', overlayImage: HTMLImageElement | null = null;` next to `lastDrawT`.
Also at the top of `draw()`:

```ts
    const bodyClass = obs ? '' : `backdrop-${params.scene.backdrop}`;
    if (document.body.className !== bodyClass) document.body.className = bodyClass;
```

and in `simulate()` wrap the four `status.* =` assignments (and the `status.feed` ones in
`pickFrame`) in `if (ui)`.

### Step 6. Colour target in 8 bits (20 min, optional)

gl.ts: let `Target` take one format per attachment (`fmt: Format | Format[]`, use
`Array.isArray(fmt) ? fmt[c] : fmt` in the loop). renderer.ts:

```ts
    const rgba8: Format = { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    this.scene = new Target(gl, W, H, 2, [rgba8, this.fmt]); // colour, glow emission
```

`clearBufferfv` on a normalised target is fine. Check a loud, bright passage by eye and with
`sprout.pixels()`: colours above 1.0 now clip before overlapping strokes blend over them. If the
highlights look flatter, revert this step; it is the smallest win on the list.

### Later, only if the numbers ask for it

Half-resolution glow pass (2.2 row 7), "light" bloom as a `perf.bloom` option (row 8), caching
`layoutTakes`, a uniform buffer for the six layer arrays. None is needed to fix the two reported
problems.

## 5. Measurement plan

### In Chrome (preview)

1. `chrome://gpu`: "WebGL2: Hardware accelerated"; note the renderer string. `sprout.perf().gpu`
   shows the same for the page itself.
2. Before any change, with the fake singer and 3 takes, window as you normally keep it:
   `sprout.perf()` after 20 s. Write down `fps`, `displayHz`, `canvas`, `gpuMs`, `heapMB`.
3. After steps 1 and 2: `fps` 60 (72 on a 144 Hz monitor) while singing, 30 a couple of seconds
   after the fake singer's phrase ends, 30 when you click into another window; `canvas` at most
   about 1931 x 1086 on a 1440p monitor.
4. DevTools, Performance, record 10 s: scripting per frame under 4 ms, no long tasks, minor GCs
   at most about once a second after step 4.
5. The YouTube test: a 1080p60 video with "Stats for nerds" open next to the preview for five
   minutes. Dropped frames should stay under 1 % and not climb while the fake singer sings.
6. Leak test from 3.4: heap after `sprout.advance(1800, 1/30)` and a forced GC within 5 MB of the
   start.
7. Only if something is still wrong: `chrome://tracing` (or ui.perfetto.dev), categories `gpu`
   and `viz`, 5 s. Look at the GPU process main thread: how full it is, and which tab's commands
   fill it.

### In OBS

1. View, Docks, Stats. Read three numbers for one minute each with the source's eye icon off,
   then on, then on while singing with several takes:
   - "Average time to render frame": the difference between off and on should be under 1 ms, and
     the total should stay well under a third of the frame time (under 5 ms at 60 fps).
   - "Frames missed due to rendering lag": must not increase at all.
   - "Skipped frames due to encoding lag": must not increase.
2. Windows Task Manager, Details, add the "GPU" column: the `obs-browser-page.exe` GPU process
   should sit under about 10 % on a discrete card at 1080p60 (under 25 % on integrated graphics),
   and near 0 % when the source is hidden.
3. `http://localhost:7777/?obs&perflog` as the source URL for a test session: the log line every
   10 s should show `fps` 60 / 30, `gpuMs` under 2 (discrete) or under 6 (integrated),
   `simMs + buildMs + glSubmitMs` under 4, a `gpu` string naming the real card, and `heapMB` not
   climbing over an hour.
4. Slow motion check: sing a note of known length. If the tree grows visibly slower than in the
   preview, the source was running under 20 fps before the new loop; after it, growth speed must
   match the preview at any frame rate.

### Good enough

1080p60 in OBS with zero lagged frames over a 30-minute session with 6 takes; the overlay's GPU
share under 10 % on the streaming machine; preview next to a 1080p60 video with under 1 % dropped
frames; JS heap flat over an hour. If the first two hold after steps 1 to 4, stop there.
