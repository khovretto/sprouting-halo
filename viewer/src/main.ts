// Sprout viewer: the halo + take plants, rendered with WebGL2 for an OBS Browser Source.
// Preview mode (default) shows a tweak panel and a placeholder avatar; ?obs hides both and
// leaves only the transparent visual. Settings sync between every open viewer via Sprout.exe.

import { buildUI, deepMerge, loadParams, saveParams, UI, UIStatus } from './ui';
import { defaults, Params } from './params';
import { getPath, PATHS, setPath } from './presets';
import type { FeatureFrame, LayerFeatures, Theme } from './features';
import { Batch, Instances, LayerUniforms, MAX_LAYERS, Renderer, STILL, View } from './render/renderer';
import { Overlay, GuidePlant } from './overlay';
import { Scope } from './scope';
import { LABELS } from './panel-layout';
import { clearAvatarImage, loadAvatarImage, pickAvatarImage } from './avatar-image';
import { LayerMotion, Wind } from './motion';
import { CommitAnimation, CommitHooks, CommitTarget, HaloSnapshot, StrandLook } from './growth/commit';
import { FakeSource } from './sources/fake';
import { LiveSource, ViewerMessage } from './sources/live';
import { HaloVine } from './growth/halo';
import { Plant } from './growth/plant';
import { plantMetrics } from './debug';
import { inkMetrics, pixelMetrics } from './debug-ink';
import { Generations } from './growth/generations';
import { Skeleton } from './growth/skeleton';
import { Drive } from './drive';
import { decorateRing, decorateTree, DecoStyle } from './deco';
import { layoutTakes, outlineOf, Placement, plantArc } from './layout';
import { angleLerp, clamp, deg, hash1, hexToRgb, hsv2rgb, hueShift, lerp, RGB, TAU } from './math';

interface Slot {
  id: string;
  gens: Generations<Plant>;
  place: Placement;
  drive: Drive;
  alpha: number;
  colour: string;
  theme: Theme;
  density: number;
  /** Being planted by a commit animation (not drawn as a tree until the impact). */
  commit?: CommitAnimation;
  /** Sim time of the commit impact (flash, quiver, growth burst). */
  stampT?: number;
  motion: LayerMotion;
}

/** A deleted take: fades away while its leaves fall (no ungrowing). */
interface Dying {
  slot: Slot;
  t0: number;
}

/** One live track's halo. Several live tracks nest concentrically (first = outermost). */
interface LiveHalo {
  id: string;
  vine: HaloVine;
  drive: Drive;
  /** 0..1 open: opens with the first phrase of a recording, stays open until it stops. */
  open: number;
  spawnT0: number;
  /** Set when this track stopped being live: the halo fades out. */
  endT0?: number;
  cx: number;
  cy: number;
  R: number;
  look: { theme: Theme; density: number; colour: string };
  f?: LayerFeatures;
  motion: LayerMotion;
}

const errorBox = document.getElementById('error')!;
function showError(e: unknown) {
  errorBox.style.display = 'block';
  errorBox.textContent = e instanceof Error ? e.message : String(e);
  console.error(e);
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

try {
  start();
} catch (e) {
  showError(e);
}

function start() {
  const params = loadParams();
  const query = new URLSearchParams(location.search);
  const obs = query.has('obs');
  /** ?offline: never connect to Sprout.exe (fake singer only, no settings sync). For testing. */
  const offline = query.has('offline');
  const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
  const ovCanvas = document.getElementById('overlay') as HTMLCanvasElement;
  const panel = document.getElementById('panel')!;

  // /controls (or ?controls): the panel and the voice scope only. Nothing is drawn, so it costs
  // nothing on the graphics card: control the OBS page from here without opening OBS's Interact.
  const controls = /\/controls\/?$/.test(location.pathname) || query.has('controls');
  if (controls) {
    document.documentElement.classList.add('controls');
    document.title = 'Sprout controls';
  }
  const renderer = controls ? (null as unknown as Renderer) : new Renderer(glCanvas);
  const overlay = new Overlay(ovCanvas);
  if (!obs && !controls) void loadAvatarImage().then((img) => (overlay.image = img));
  const scopeCanvas = document.getElementById('scope') as HTMLCanvasElement;
  const scope = new Scope(scopeCanvas);
  const scopeSet = (fn: () => void) => {
    fn();
    saveParams(params);
    ui?.refresh();
  };
  scope.onSelect = (k) => scopeSet(() => (params.scene.scopeLayer = k));
  scope.onSeconds = (d) => scopeSet(() => (params.scene.scopeSeconds = clamp(params.scene.scopeSeconds + d, 4, 40)));
  scope.onClose = () => scopeSet(() => (params.scene.showScope = false));
  scope.onReveal = (path) => ui?.reveal(path);
  scope.labelOf = (path) => LABELS[path] ?? path.split('.')[1];
  let scopeTarget = '';
  const fake = new FakeSource(params.fake.seed);
  const live = new LiveSource();
  const status: UIStatus = { feed: '', layers: '', pitch: '', voice: '' };
  const clientId = Math.random().toString(36).slice(2);

  const backUnder = new Instances(), back = new Instances(), backDeco = new Instances();
  const front = new Instances(), frontDeco = new Instances();
  const batches: Batch[] = [
    // Dim, larger under-leaves beneath the take plants' branches (depth without glow).
    { kind: 'sprite', inst: backUnder },
    { kind: 'stroke', inst: back },
    { kind: 'sprite', inst: backDeco },
    { kind: 'stroke', inst: front },
    { kind: 'sprite', inst: frontDeco },
  ];
  const layerU = new LayerUniforms();

  let slots: Slot[] = [];
  let dying: Dying[] = [];
  let t = 0;
  let spin = 0;
  let plantSeed = 1;
  let haloSeed = 1;
  let halos: LiveHalo[] = [];
  let endingHalos: LiveHalo[] = [];
  let commits: CommitAnimation[] = [];
  const wind = new Wind();
  const commitDrive = new Drive();

  function newHalo(id: string): LiveHalo {
    haloSeed += 1000;
    return {
      id, vine: new HaloVine(haloSeed, params), drive: new Drive(), open: 0, spawnT0: t,
      cx: params.halo.restX, cy: params.halo.restY, R: params.halo.restRadius,
      look: { theme: params.look.theme, density: params.look.density, colour: params.colours.live },
      motion: new LayerMotion(haloSeed),
    };
  }

  function restart() {
    t = 0;
    spin = 0;
    plantSeed = 1;
    haloSeed = params.fake.seed * 31;
    fake.reset(params.fake.seed);
    halos = [];
    endingHalos = [];
    commits = [];
    slots = [];
    dying = [];
  }
  restart();

  // ---- Settings sync between viewers ---------------------------------------------------------
  // Last writer wins, by timestamp. A viewer ignores settings older than its own latest change,
  // and ignores everything while you are still dragging a control in it.
  let ui: UI | undefined;
  let lastLocalChange = 0;
  // ---- Settings sync, key by key -------------------------------------------------------------------
  // Only the keys someone actually changed travel ({"growth.reach": 1.2, ...}), so a page with old
  // values can never overwrite newer ones it did not touch. Sprout.exe merges every patch and gives
  // a page that connects the latest value of every key. Per viewer (never synced): the audio
  // source, the fake singer, preview switches, voice detection (its own message), the preview
  // avatar picture.
  const LOCAL_ONLY = new Set([
    'source.mode', 'source.port', 'source.syncSettings', 'scene.paused', 'scene.timeScale', 'scene.layers',
    'scene.backdrop', 'scene.showAvatar', 'scene.showGuides', 'scene.showScope', 'scene.scopeLayer', 'scene.scopeSeconds',
    'avatar.opacity', 'avatar.useImage', 'avatar.imageX', 'avatar.imageY', 'avatar.imageHeight',
  ]);
  const SYNC_KEYS = PATHS.filter((k) => !LOCAL_ONLY.has(k) && !k.startsWith('fake.') && !k.startsWith('detect.'));
  const SYNC_SET = new Set(SYNC_KEYS);
  /** What every shared key was when last sent or received: a different value now = changed here. */
  const synced = new Map<string, string>(SYNC_KEYS.map((k) => [k, JSON.stringify(getPath(params, k))]));
  const editedAt = new Map<string, number>();
  const sendParams = () => {
    if (!params.source.syncSettings || live.status !== 'connected') return; // unsent edits go out on connect
    const patch: Record<string, unknown> = {};
    const now = Date.now();
    for (const k of SYNC_KEYS) {
      const v = JSON.stringify(getPath(params, k));
      if (v === synced.get(k)) continue;
      patch[k] = getPath(params, k);
      synced.set(k, v);
      editedAt.set(k, now);
    }
    if (Object.keys(patch).length) live.send({ type: 'params', from: clientId, ts: now, patch });
  };
  /** Apply another viewer's changes (or Sprout.exe's merged settings on connect). */
  const applyPatch = (patch: Record<string, unknown>) => {
    const now = Date.now();
    let any = false;
    for (const [k, v] of Object.entries(patch)) {
      if (!SYNC_SET.has(k)) continue;
      const def = getPath(defaults, k);
      if (typeof v !== typeof def) continue;
      // Keep what is being changed here right now (a drag in progress, or not sent yet).
      if (now - (editedAt.get(k) ?? 0) < 1000) continue;
      if (JSON.stringify(getPath(params, k)) !== synced.get(k)) continue;
      setPath(params, k, v);
      synced.set(k, JSON.stringify(v));
      any = true;
    }
    if (any) {
      saveParams(params);
      ui?.refresh();
    }
  };
  live.onOpen = () => sendParams();
  // Voice detection settings: sent to Sprout.exe when changed here; Sprout.exe keeps them and tells
  // every viewer (also on connect), so all panels show what is really used.
  let detectSent = JSON.stringify(params.detect);
  const sendDetect = () => {
    const now = JSON.stringify(params.detect);
    if (now === detectSent || live.status !== 'connected') return; // not connected: Sprout.exe's values arrive on connect
    detectSent = now;
    live.send({ type: 'detect', ...params.detect, from: clientId });
  };
  const sendAction = (name: string) => live.send({ type: 'action', from: clientId, name });
  // Settings are only ever sent when someone changes them in a panel; connecting never pushes a
  // viewer's stored settings onto the others. A viewer that connects adopts the latest shared ones.
  live.onMessage = (msg: ViewerMessage) => {
    if (msg.type === 'detect') {
      // Sprout.exe's current voice detection (on connect, or after any viewer changed it).
      const d = params.detect as unknown as Record<string, number>;
      for (const k of Object.keys(d)) if (typeof msg[k] === 'number') d[k] = +(msg[k] as number).toFixed(3);
      detectSent = JSON.stringify(params.detect);
      saveParams(params);
      ui?.refresh();
      return;
    }
    if (msg.from === clientId) return;
    if (msg.type === 'params' && params.source.syncSettings) {
      if (msg.patch && typeof msg.patch === 'object') applyPatch(msg.patch as Record<string, unknown>);
      else if (msg.params && typeof msg.params === 'object') {
        // An older viewer sending all its settings: take them key by key.
        const flat: Record<string, unknown> = {};
        for (const k of SYNC_KEYS) {
          const v = getPath(msg.params as Params, k);
          if (v !== undefined) flat[k] = v;
        }
        applyPatch(flat);
      }
    } else if (msg.type === 'action') runAction(String(msg.name), false);
  };
  function runAction(name: string, broadcast: boolean) {
    if (name === 'restart') restart();
    else if (name === 'commit') fake.commit(params);
    else if (name === 'delete') fake.deleteLast(params);
    if (broadcast) sendAction(name);
  }

  if (obs) {
    panel.remove();
    ovCanvas.remove();
  } else {
    ui = buildUI(panel, params, {
      restart: () => runAction('restart', true),
      commitLive: () => runAction('commit', true),
      presetApplied: (theme, density) => live.send({ type: 'tapLook', theme, density, from: clientId }),
      loadAvatar: async () => {
        const img = await pickAvatarImage();
        if (img) {
          overlay.image = img;
          params.avatar.useImage = true;
          params.scene.showAvatar = true;
          if (params.avatar.opacity < 0.5) params.avatar.opacity = 1;
          saveParams(params);
          ui?.refresh();
        }
      },
      clearAvatar: () => {
        overlay.image = null;
        void clearAvatarImage();
      },
      deleteTake: () => runAction('delete', true),
      changed: () => {
        lastLocalChange = Date.now();
        sendParams();
        sendDetect();
      },
    }, status);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') panel.style.display = panel.style.display === 'none' ? '' : 'none';
    if ((e.key === 'g' || e.key === 'G') && !obs) {
      params.scene.showScope = !params.scene.showScope;
      saveParams(params);
      ui?.refresh();
    }
  });

  // ---- Helpers ---------------------------------------------------------------------------------
  const blocked = (wx: number, wy: number) => {
    const a = params.avatar;
    if (!a.avoid) return false;
    if (Math.hypot(wx - a.headX, wy - a.headY) < a.headR) return true;
    const y = clamp(wy, a.bodyBottomY, a.bodyTopY);
    return Math.hypot(wx, wy - y) < a.bodyR;
  };

  /** Colour for take k: the track colour when the tap asks for it, otherwise the viewer palette. */
  const takeColour = (k: number, f?: LayerFeatures) => {
    const useTrack = f?.trackColour ?? params.source.useTrackColours;
    if (useTrack && f?.colour) return f.colour;
    const c = params.colours as unknown as Record<string, string>;
    return c[`take${(k % 7) + 1}`] ?? '#ffffff';
  };
  // A track's theme: its own (Sprout Tap window), unless the preset's theme applies to all tracks.
  const themeOf = (f?: LayerFeatures) => {
    const own = params.look.themeFrom === 'tracks' && f?.theme;
    return { theme: own ? f.theme! : params.look.theme, density: own ? f.density ?? params.look.density : params.look.density };
  };

  const liveUrl = () =>
    !import.meta.env.DEV && location.protocol.startsWith('http')
      ? `ws://${location.host}`
      : `ws://localhost:${params.source.port}`;
  // Connect right away (not only from the frame loop), so settings arrive even before rendering.
  if (!offline && (params.source.mode !== 'fake' || params.source.syncSettings)) live.setUrl(liveUrl());

  const describePitch = (f?: LayerFeatures) => {
    if (!f || f.pitch <= 0) return '–';
    const n = Math.round(f.pitch);
    const cents = Math.round((f.pitch - n) * 100);
    const note = `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1} ${cents >= 0 ? '+' : ''}${cents}¢`;
    return f.vibrato > 0.1 ? `${note}  vib ${f.vibratoRate.toFixed(1)} Hz` : note;
  };

  /** This frame's features: live taps or the fake singer, per source.mode. */
  function pickFrame(dt: number): FeatureFrame {
    const mode = params.source.mode;
    live.setUrl(offline || (mode === 'fake' && !params.source.syncSettings) ? '' : liveUrl());
    const useLive = mode === 'live' || (mode === 'auto' && live.status === 'connected' && live.hasFrames);
    if (useLive) {
      status.feed = live.status === 'connected'
        ? `live: ${live.tapCount} tap${live.tapCount === 1 ? '' : 's'}`
        : `waiting for Sprout.exe (:${params.source.port})`;
      return live.frame(performance.now() / 1000, params.source.holdSeconds);
    }
    status.feed = mode === 'fake' ? 'fake singer' : `fake singer (no Sprout.exe on :${params.source.port})`;
    return fake.update(dt, params);
  }

  function colourAt(base: RGB, layer: number, flex: number): RGB {
    if (params.colours.mode === 'rainbow')
      return hsv2rgb((((t * params.colours.rainbowSpeed + flex * 0.15 + layer * 0.13) % 1) + 1) % 1, 0.7, 1);
    return base;
  }

  /**
   * intensity: < 1 = quieter (applied as opacity, so a resting halo turns see-through instead of
   * dark over what is behind it), > 1 = brighter (applied to colour).
   */
  type Look = { intensity: number; glow: number; shine: number; width: number; bloom: number };
  const brighten = (look: Look) => Math.max(1, look.intensity);
  const fadeOf = (look: Look) => Math.min(1, look.intensity);

  /** Look values derived from a drive. */
  function lookOf(d: Drive): Look {
    const g = params.glow, r = params.response;
    const intensity = lerp(1, 0.45 + 0.75 * clamp(d.energy * 1.3) + 0.3 * d.flash, r.brightness);
    return {
      intensity,
      glow: g.base + g.levelGain * d.energy + g.onsetGain * d.flash + g.pitchShine * d.pitch * d.energy + g.softGlow * d.softness * d.energy,
      shine: clamp(0.2 * d.flash + 0.25 * d.pitch * d.energy),
      width: Math.max(0.25, 1 + r.effortWidth * (d.effort - 0.5) * 1.6),
      bloom: d.bloom,
    };
  }



  let shown = new Uint8Array(0);
  /** Push a skeleton's visible segments. */
  function pushTree(out: Instances, sk: Skeleton, vis: Float32Array, layer: number, base: RGB,
                    look: Look, alpha: number, unit: number, frontGlow = params.glow.front, nodeAlpha?: ArrayLike<number>,
                    tone?: ArrayLike<number>, order?: ArrayLike<number>, bend?: ArrayLike<number>) {
    const u = Math.max(1e-3, unit);
    if (alpha <= 0.005) return;
    const rainbow = params.colours.mode === 'rainbow', bright = brighten(look), fade = fadeOf(look);
    // shown[i]: a child segment of node i is drawn (so the segment ending at i can end flat).
    if (shown.length < sk.n) shown = new Uint8Array(sk.n * 2);
    shown.fill(0, 0, sk.n);
    for (let i = 0; i < sk.n; i++) {
      const pa = sk.parent[i];
      if (pa >= 0 && vis[i] > 0 && vis[pa] >= 1 && (!nodeAlpha || nodeAlpha[i] > 0.005)) shown[pa] = 1;
    }
    for (let i = 0; i < sk.n; i++) {
      const pa = sk.parent[i];
      if (pa < 0) continue;
      const f = vis[i];
      if (f <= 0) continue;
      const na = nodeAlpha ? nodeAlpha[i] : 1;
      if (na <= 0.005) continue;
      const ax = sk.x[pa], ay = sk.y[pa];
      const c = rainbow ? colourAt(base, layer, sk.flex[i]) : base;
      const tn = tone ? tone[i] : 1;
      const k = bright * tn;
      out.stroke(
        ax, ay, lerp(ax, sk.x[i], f), lerp(ay, sk.y[i], f),
        (sk.w[pa] * look.width) / u, (sk.w[i] * look.width * (0.4 + 0.6 * f)) / u, sk.flex[pa], sk.flex[i],
        lerp(c[0], 1, look.shine) * k, lerp(c[1], 1, look.shine) * k, lerp(c[2], 1, look.shine) * k, alpha * na * fade,
        (look.glow + (f < 1 ? frontGlow * (1 - f) : 0)) * tn * tn, layer,
        // Chain links tile: a flat start where the parent segment meets this one, and a flat end
        // where a drawn child continues it (tips and growing ends stay round).
        sk.parent[pa] >= 0 ? (shown[i] ? 2 : 1) : 0,
        order ? order[i] : 1,
        bend ? bend[i * 4] : ax, bend ? bend[i * 4 + 1] : ay, bend ? bend[i * 4 + 2] : sk.flex[pa], bend ? bend[i * 4 + 3] : 0,
      );
    }
  }

  function pushRing(out: Instances, layer: number, base: RGB, look: Look, alpha: number, unit: number, level: number) {
    const h = params.halo;
    const N = 160;
    const w = (h.ringWidth * look.width * (1 + 0.6 * level)) / Math.max(1e-3, unit);
    // A clean circle: its oval / trefoil motion comes from the layer's ring mode (shaders/motion.glsl).
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU;
      const c = colourAt(base, layer, a0);
      const s = look.shine, i = brighten(look);
      out.stroke(Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1), w, w, 0, 0,
        lerp(c[0], 1, s) * i, lerp(c[1], 1, s) * i, lerp(c[2], 1, s) * i, alpha * fadeOf(look), look.glow, layer);
    }
  }


  /** World "down" in a layer's local frame (for falling leaves). */
  function localDown(angle: number, scale: number): [number, number] {
    // local = R(-th) * world / scale, with world down = (0, -1).
    const th = angle - Math.PI / 2;
    const s = Math.max(1e-3, scale);
    return [-Math.sin(th) / s, -Math.cos(th) / s];
  }

  function styleOf(layer: number, colour: RGB, look: Look, alpha: number, unit: number, seed: number, d: Drive,
                   fall: number, downX: number, downY: number, theme: Theme, density: number): DecoStyle {
    return {
      theme, density, layer, colour, alpha: alpha * fadeOf(look), glow: look.glow * params.look.decoGlow, unit, seed, effort: d.effort,
      bloom: look.bloom * params.look.blossoms, fall, downX, downY, intensity: brighten(look),
    };
  }

  /** One scope sample for the followed layer: raw tap values next to what the drive makes of them. */
  function sampleScope(takes: LayerFeatures[]) {
    const k = Math.round(params.scene.scopeLayer);
    const slot = k > 0 ? slots[k - 1] : undefined;
    const halo = k === 0 ? halos[0] : undefined;
    const d = slot?.drive ?? halo?.drive;
    const f = slot ? takes[k - 1] : halo?.f;
    const key = slot ? slot.id : halo ? 'halo:' + halo.id : 'none';
    if (key !== scopeTarget) {
      scopeTarget = key;
      scope.clear();
    }
    scope.layers = ['live halo', ...slots.map((x, i) => `take ${i + 1}`)];
    scope.selected = Math.min(k, scope.layers.length - 1);
    scope.title = slot ? `take ${k}  (${f?.name || slot.id})` : halo ? `live halo  (${f?.name || halo.id})` : `layer ${k}: none`;
    if (!d) return;
    const g = slot?.gens.current ?? slot?.gens.gens[slot.gens.gens.length - 1];
    scope.push(t, {
      level: f?.level ?? 0, energy: d.energy, slow: d.slow,
      midi: f?.pitch ?? 0, pitchHeld: d.pitch > 0 ? 48 + d.pitch * 41 : 0,
      effortRaw: f?.effort ?? 0.5, effort: d.effort, breath: d.breath, softness: d.softness,
      vibRaw: f?.vibrato ?? 0, vib: d.vibrato, vibRate: (f?.vibratoRate ?? 0) / 10,
      flash: d.flash, voice: d.voice ? 1 : 0,
      held: Math.min(1, d.held / Math.max(0.1, 2 * params.look.blossomHold)), bloom: d.bloom, phraseOn: d.phraseOver(params) ? 0 : 0.9,
      open: halo ? halo.open : g?.reveal ?? 0, wither: g?.wither ?? 0, alpha: halo ? 1 : g?.alpha ?? 0,
    }, { phrase: d.newPhrase, onset: !!f?.onset, dip: d.pitchDip });
  }

  // ---- Commit (Part B) ---------------------------------------------------------------------------
  function snapshotOf(h: LiveHalo): HaloSnapshot {
    const sk = h.vine.sk.clone();
    const n = sk.n;
    return {
      sk, vis: h.vine.vis.slice(0, n), alpha: h.vine.alpha.slice(0, n), ids: h.vine.ids.slice(0, n),
      cx: h.cx, cy: h.cy, R: h.R, theme: h.look.theme, density: h.look.density, colour: tinted(hexToRgb(h.look.colour)),
      seed: h.vine.seed, lead: h.vine.leadTip(),
      sizeMul: Math.pow(clamp(h.R / Math.max(0.05, params.halo.openRadius), 0.25, 1), 0.7),
      idle: 1 - smooth(clamp(h.open)),
      mood: { effort: h.drive.effort, pitch: h.drive.pitch, soft: h.drive.softness, vibrato: h.drive.vibrato },
    };
  }

  function targetOf(s: Slot, layer: number): CommitTarget | undefined {
    const g = s.gens.current ?? s.gens.gens[s.gens.gens.length - 1];
    if (!g) return undefined;
    return { place: s.place, spinAngle: spin * s.place.tierDir, plant: g.tree, layer, colour: tinted(hexToRgb(s.colour)) };
  }

  /** A strand look as a regular Look (multipliers on a moderately loud voice). */
  const strandLook = (sl: StrandLook): Look => ({
    intensity: 1, glow: (params.glow.base + 0.5 * params.glow.levelGain) * sl.glow, shine: sl.shine, width: sl.width, bloom: 0,
  });

  function commitHooks(fxLayer: number, nextLayer: () => number): CommitHooks {
    return {
      ring(snap, cx, cy, R, rot, look, ringAlpha, nodeAlpha, windE) {
        const L = nextLayer();
        if (L < 0) return;
        // It starts with the halo's squish and tilt and turns round as it winds up and spins.
        const k = (snap.idle ?? 1) * (1 - windE);
        const sq = 1 - clamp(params.halo.squish, 0, 0.95) * k;
        layerU.set(L, cx, cy, Math.PI / 2 + rot + params.halo.tilt * deg * k, R, STILL, sq);
        const lk = strandLook(look);
        pushRing(front, L, look.colour, lk, ringAlpha * look.alpha, R, 0);
        pushTree(front, snap.sk, snap.vis, L, look.colour, lk, look.alpha, R, params.glow.front, nodeAlpha);
        const st = styleOf(L, look.colour, lk, look.alpha, R, snap.seed, commitDrive, 0, 0, -1 / R, snap.theme, snap.density);
        st.sizeMul = snap.sizeMul;
        decorateTree(snap.sk, snap.vis, params, st, frontDeco, { ids: snap.ids, alpha: nodeAlpha });
      },
      strand(sk, vis, nodeAlpha, ids, L, look, snap, unit) {
        const lk = strandLook(look);
        pushTree(back, sk, vis, L, look.colour, lk, look.alpha, 1, params.glow.front, nodeAlpha);
        const s = slots.find((x) => x.commit && x.commit.snap === snap);
        const [dx, dy] = s ? localDown(s.place.angle + spin * s.place.tierDir, s.place.scale) : [0, -1];
        const st = styleOf(L, look.colour, lk, look.alpha, unit, snap.seed, commitDrive, 0, dx, dy, snap.theme, snap.density);
        st.sizeMul = snap.sizeMul;
        decorateTree(sk, vis, params, st, backDeco, { ids, alpha: nodeAlpha });
      },
      stroke(L, ax, ay, bx, by, ra, rb, fa, fb, look) {
        const c = look.colour, sh = look.shine;
        back.stroke(ax, ay, bx, by, ra * look.width, rb * look.width, fa, fb,
          lerp(c[0], 1, sh), lerp(c[1], 1, sh), lerp(c[2], 1, sh), look.alpha, strandLook(look).glow, L);
      },
      fxStroke(ax, ay, bx, by, w, rgb, a, glow) {
        if (fxLayer >= 0) front.stroke(ax, ay, bx, by, w, w, 0, 0, rgb[0], rgb[1], rgb[2], a, glow, fxLayer);
      },
      fxSprite(x, y, angle, size, shape, rgb, a, seed) {
        if (fxLayer >= 0) frontDeco.sprite(x, y, angle, size, shape, 0, seed, rgb[0], rgb[1], rgb[2], a, 0.6, fxLayer);
      },
    };
  }

  // ---- Simulation ------------------------------------------------------------------------------
  function simulate(dt: number, realDt: number): FeatureFrame {
    t += dt;
    wind.update(dt, params);
    const ff = pickFrame(dt);
    const lives = ff.layers.filter((l) => l.role === 'live' && l.id !== 'live-none');
    const takes = ff.layers.filter((l) => l.role === 'take').slice(0, 16);
    const n = takes.length;
    const targets = layoutTakes(n, params);
    const ids = takes.map((l) => l.id);

    // Halos: one per live track, matched by id. With no live track a resting halo stays on the head
    // (the next live track takes it over). A track that stops being live fades its halo out.
    const want = lives.length ? lives : [undefined];
    const nextHalos: LiveHalo[] = want.map((f) => {
      const id = f?.id ?? 'idle';
      const existing = halos.find((h) => h.id === id) ?? (f ? halos.find((h) => h.id === 'idle') : undefined);
      if (existing) {
        existing.id = id;
        return existing;
      }
      return newHalo(id);
    });
    // A live track that became a take: its halo is planted as the tree (Part B); otherwise it fades.
    let started = 0;
    for (const h of halos) if (!nextHalos.includes(h)) {
      if (params.commit.enabled && ids.includes(h.id) && !slots.some((s) => s.id === h.id) && commits.length < 4) {
        commits.push(new CommitAnimation(h.id, snapshotOf(h), t + 0.09 * started++, params));
      } else {
        h.endT0 = t;
        endingHalos.push(h);
      }
    }
    // A new resting halo would sit exactly where the departing ring winds up: let it wait.
    if (started) for (const h of nextHalos) if (!halos.includes(h)) h.spawnT0 = t + 0.5;
    halos = nextHalos;

    const hp = params.halo;
    halos.forEach((h, k) => {
      const f = lives.length ? lives[k] : undefined;
      h.f = f;
      h.drive.update(f, dt, params);
      h.motion.update(h.drive, wind, dt, params, 0.6, true);
      h.vine.update(dt, h.drive, !!f?.onset, params);
      // Track colour if the tap asks for it; otherwise the live colour, hue-shifted for each extra
      // live track so nested halos stay distinguishable.
      h.look = { ...themeOf(f), colour: f?.trackColour && f.colour ? f.colour : hueShift(params.colours.live, k * 55) };
      // Small unless this track is being recorded; while recording it opens with the first phrase
      // and stays open until the recording stops.
      const recording = !!f && (f.recording ?? true);
      if (!recording) h.open *= Math.exp(-dt / Math.max(0.05, params.response.release));
      else if (h.drive.voice) h.open = Math.min(1, h.open + (dt / Math.max(0.05, params.growth.secondsToFull * 0.5)) * (0.4 + h.drive.level));
      const o = smooth(clamp(h.open));
      const nest = Math.max(0.2, 1 - k * hp.ringSpacing); // later live tracks nest inside
      h.cy = lerp(hp.restY, hp.openY, o);
      h.cx = lerp(hp.restX, 0, o);
      h.R = lerp(hp.restRadius, hp.openRadius, o) * nest;
    });
    endingHalos = endingHalos.filter((h) => t - (h.endT0 ?? t) < params.transitions.liveEndSeconds);

    const first = halos[0];
    status.layers = lives.length + ' live + ' + n + (n === 1 ? ' take' : ' takes');
    status.pitch = describePitch(first?.f);
    status.voice = first
      ? 'effort ' + first.drive.effort.toFixed(2) + ' · breath ' + first.drive.breath.toFixed(2) + ' · soft ' + first.drive.softness.toFixed(2)
      : '–';

    // Plants matched to takes by id: a take keeps its plant when others come and go.
    const next: Slot[] = ids.map((id, k) => {
      const existing = slots.find((s) => s.id === id);
      if (existing) return existing;
      const seed0 = params.fake.seed * 1000 + plantSeed++ * 97;
      const slot: Slot = {
        id, gens: undefined as unknown as Generations<Plant>,
        place: { ...targets[k] }, drive: new Drive(), motion: new LayerMotion(seed0), alpha: 0, colour: takeColour(k, takes[k]), ...themeOf(takes[k]),
      };
      // Each tree: plumage from its own seed, gesture (spine) from the take's seed, character from
      // the phrase that grows it.
      slot.gens = new Generations<Plant>((seed) => {
        const plant = new Plant(seed, seed0);
        const d = slot.drive;
        plant.mood = { effort: d.effort, pitch: d.pitch, soft: d.softness, vibrato: d.vibrato };
        return plant;
      }, seed0);
      const c = commits.find((x) => x.slotId === id);
      if (c) {
        slot.commit = c;
        slot.gens.regrow();
        slot.gens.gens[0].tree.mood = c.snap.mood;
      }
      return slot;
    });
    for (const s of slots) if (!ids.includes(s.id)) dying.push({ slot: s, t0: t });
    slots = next;

    // Ease placements toward the layout (re-layout morphs instead of rebuilding).
    const ease = 1 - Math.exp(-params.layout.ease * realDt);
    slots.forEach((s, k) => {
      const tg = targets[k], pl = s.place;
      pl.ox = lerp(pl.ox, tg.ox, ease);
      pl.oy = lerp(pl.oy, tg.oy, ease);
      pl.angle = angleLerp(pl.angle, tg.angle, ease);
      pl.scale = lerp(pl.scale, tg.scale, ease);
      Object.assign(pl, { tierDir: tg.tierDir, kind: tg.kind, lengthMul: tg.lengthMul, sectorLo: tg.sectorLo, sectorHi: tg.sectorHi });
      const f = takes[k];
      s.drive.update(f, dt, params);
      s.motion.update(s.drive, wind, dt, params, 1, false);
      const pending = !!s.commit && s.commit.stampedAt < 0;
      if (!pending) s.gens.update(s.drive, dt, params);
      for (const g of s.gens.gens) {
        g.tree.boost = s.stampT !== undefined ? 1 + 5 * Math.exp(-(t - s.stampT) / 0.2) : 1;
        g.tree.ensureBuilt(tg, params, blocked, n);
        g.tree.computeReveal(g.reveal, s.drive.pitch, params, g.retired ? 0 : g.wither, dt);
      }
      s.alpha = pending ? 0 : Math.min(1, s.alpha + realDt * 2);
      s.colour = takeColour(k, f);
      Object.assign(s, themeOf(f));
    });
    if (n >= params.layout.spinFrom) spin += params.layout.spinSpeed * deg * dt;

    // Commit animations: plunge timing, impact.
    const onsetAny = ff.layers.some((l) => l.onset && l.level > 0.1);
    for (const c of commits) {
      const s = slots.find((x) => x.id === c.slotId);
      if (c.step(t, s ? targetOf(s, 0) : undefined, onsetAny) && s) {
        s.alpha = 1;
        s.stampT = t;
        // The impact jolts the new tree: a push up and to one side, then it springs back.
        const j = 12 * deg * params.commit.impact;
        s.motion.push((hash1(t * 7.3) < 0.5 ? -0.5 : 0.5) * j, j);
        const g = s.gens.current ?? s.gens.gens[s.gens.gens.length - 1];
        if (g) {
          g.stamped = true;
          g.reveal = Math.max(g.reveal, params.commit.stampReveal);
          g.tree.revealSpine();
        }
      }
    }
    commits = commits.filter((c) => {
      if (!c.done) return true;
      for (const s of slots) if (s.commit === c) s.commit = undefined;
      return false;
    });

    dying = dying.filter((d) => t - d.t0 < params.transitions.pruneSeconds);
    if (params.scene.showScope && !obs && dt > 0) sampleScope(takes);
    return ff;
  }

  // ---- Drawing -----------------------------------------------------------------------------------
  let plantLayerCount = 0;
  let lastView: View | null = null;
  /** The look's tint over a palette colour. */
  const tinted = (c: RGB): RGB => {
    const k = clamp(params.look.tintAmount);
    if (k <= 0) return c;
    const tc = hexToRgb(params.look.tint);
    return [lerp(c[0], tc[0], k), lerp(c[1], tc[1], k), lerp(c[2], tc[2], k)];
  };
  let lastDrawT = 0;
  let overlayKey = '', overlayImage: HTMLImageElement | null = null;
  function draw() {
    if (controls) {
      // Controls page: only the voice scope.
      scopeCanvas.style.display = params.scene.showScope ? 'block' : 'none';
      if (params.scene.showScope) scope.draw(params.scene.scopeSeconds);
      return;
    }
    const tDraw0 = performance.now();
    // Sim seconds since the last drawn frame (leaf fades); a jump (restart, fast-forward) snaps.
    const drawDt = t - lastDrawT > 0 && t - lastDrawT < 0.5 ? t - lastDrawT : 0;
    lastDrawT = t;
    const bodyClass = obs ? '' : `backdrop-${params.scene.backdrop}`;
    if (document.body.className !== bodyClass) document.body.className = bodyClass;
    backUnder.reset();
    back.reset();
    backDeco.reset();
    front.reset();
    frontDeco.reset();
    let layer = 0;

    const drawPlant = (s: Slot, alpha: number, look: Look, fall: number) => {
      const pl = s.place;
      const angle = pl.angle + spin * pl.tierDir;
      const base = tinted(hexToRgb(s.colour));
      // Every take colour glows about equally: yellow-green would otherwise clip long before blue.
      const luma = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
      look = { ...look, glow: look.glow * clamp(0.5 / Math.max(0.05, luma), 0.65, 1.4) };
      const [dx, dy] = localDown(angle, pl.scale);
      for (const g of s.gens.gens) {
        const a = alpha * g.alpha;
        pushTree(back, g.tree.sk, g.tree.vis, layer, base, look, a, 1, params.glow.front, g.tree.life, g.tree.tone, g.tree.order, g.tree.bend);
        decorateTree(g.tree.sk, g.tree.vis, params,
          styleOf(layer, base, look, a, 1, g.seed, s.drive, fall, dx, dy, s.theme, s.density), backDeco,
          { alpha: g.tree.leafLife, rank: g.tree.leafRank, tone: g.tree.tone, under: backUnder, order: g.tree.order, bend: g.tree.bend,
            leafState: g.tree.leafState, dt: drawDt, branchId: g.tree.branchId, branchDone: g.tree.branchDone });
      }
    };

    // Take plants. A plant being planted by a commit is not drawn until the impact; just after it,
    // it flashes and quivers.
    const slotLayer = new Map<string, number>();
    slots.forEach((s) => {
      if (layer >= MAX_LAYERS) return;
      const pl = s.place;
      const since = s.stampT !== undefined ? t - s.stampT : Infinity;
      const imp = params.commit.impact;
      layerU.set(layer, pl.ox, pl.oy, pl.angle + spin * pl.tierDir, pl.scale, s.motion);
      slotLayer.set(s.id, layer);
      if (!(s.commit && s.commit.stampedAt < 0)) {
        let look = lookOf(s.drive);
        if (since < 1) {
          const e = Math.exp(-since / 0.12) * imp;
          look = { ...look, shine: Math.max(look.shine, Math.min(1, 0.8 * e)), glow: look.glow * (1 + 2 * e), width: look.width * (1 + 0.8 * e) };
        }
        drawPlant(s, s.alpha, look, 0);
      }
      layer++;
    });
    plantLayerCount = layer;

    // Deleted takes: a brief flash, then the plant fades away while its leaves fall.
    dying.forEach((d) => {
      if (layer >= MAX_LAYERS) return;
      const u = clamp((t - d.t0) / Math.max(0.05, params.transitions.pruneSeconds));
      const pl = d.slot.place;
      layerU.set(layer, pl.ox, pl.oy, pl.angle + spin * pl.tierDir, pl.scale, d.slot.motion);
      const look = { ...lookOf(d.slot.drive), glow: params.glow.base + 1.2 * Math.max(0, 1 - u * 4) };
      drawPlant(d.slot, 1 - smooth(u), look, Math.min(1, u * 1.2));
      layer++;
    });

    // Live halos (in front of the plants): small on the head unless recording; several live tracks
    // nest concentrically. A new one pops in; one whose track stopped being live fades out.
    const hp = params.halo;
    const drawHalo = (h: LiveHalo, fade: number) => {
      if (layer >= MAX_LAYERS) return;
      const spawn = Math.max(0.001, easeOutBack(clamp((t - h.spawnT0) / Math.max(0.05, hp.spawnSeconds))));
      const R = h.R * spawn;
      // Squish and tilt are for the small resting halo only; the recording halo opens round.
      const idle = 1 - smooth(clamp(h.open));
      layerU.set(layer, h.cx, h.cy, Math.PI / 2 + hp.tilt * deg * idle, R, h.motion, 1 - clamp(hp.squish, 0, 0.95) * idle);
      const base = tinted(hexToRgb(h.look.colour));
      const look = lookOf(h.drive);
      pushRing(front, layer, base, look, fade, R, h.drive.energy);
      // More origins = more vine, so fewer leaves on each part of it.
      const origins = Math.max(1, Math.round(hp.origins));
      const style = styleOf(layer, base, look, fade, R, h.vine.seed, h.drive, 0, 0, -1 / R, h.look.theme, h.look.density / origins);
      style.sizeMul = Math.pow(clamp(R / Math.max(0.05, hp.openRadius), 0.25, 1), 0.7);
      pushTree(front, h.vine.sk, h.vine.vis, layer, base, look, fade, R, params.glow.front, h.vine.alpha, undefined, h.vine.order, h.vine.bend);
      decorateTree(h.vine.sk, h.vine.vis, params, style, frontDeco, { ids: h.vine.ids, alpha: h.vine.alpha, order: h.vine.order, bend: h.vine.bend, leafGrow: h.vine.leaf });
      decorateRing(params, { ...style, density: h.look.density }, (a) => h.vine.coverage(a, params), frontDeco, hp.alwaysLeaves);
      layer++;
    };
    halos.forEach((h) => drawHalo(h, 1));
    // Commit animations: their own layers for the flying ring, one identity layer for effects.
    if (commits.length) {
      const fxLayer = layer < MAX_LAYERS ? layer++ : -1;
      if (fxLayer >= 0) layerU.set(fxLayer, 0, 0, Math.PI / 2, 1, STILL);
      const hooks = commitHooks(fxLayer, () => (layer < MAX_LAYERS ? layer++ : -1));
      for (const c of commits) {
        const s = slots.find((x) => x.id === c.slotId);
        const L = s ? slotLayer.get(s.id) : undefined;
        c.draw(t, s && L !== undefined ? targetOf(s, L) : undefined, hooks);
      }
    }
    endingHalos.forEach((h) => drawHalo(h, 1 - smooth(clamp((t - (h.endT0 ?? t)) / Math.max(0.05, params.transitions.liveEndSeconds)))));

    // Render.
    // Render size: the window in device pixels, but never more than perf.maxMegapixels; CSS
    // scales the canvas up. (OBS: devicePixelRatio is 1 and a 1080p source is exactly 2.07 MP.)
    const dpr = window.devicePixelRatio || 1;
    const fullW = glCanvas.clientWidth * dpr, fullH = glCanvas.clientHeight * dpr;
    const fit = Math.min(1, Math.sqrt((params.perf.maxMegapixels * 1e6) / Math.max(1, fullW * fullH)));
    const kScale = fit * clamp(params.perf.renderScale, 0.25, 1);
    const W = Math.max(1, Math.round(fullW * kScale));
    const H = Math.max(1, Math.round(fullH * kScale));
    if (glCanvas.width !== W || glCanvas.height !== H) {
      glCanvas.width = W;
      glCanvas.height = H;
    }
    const view: View = { s: Math.min(W, H) / 2 / params.scene.viewRadius, cx: params.scene.centerX, cy: params.scene.centerY, W, H };
    const tGpu0 = performance.now();
    perfAdd('build', tGpu0 - tDraw0);
    renderer.render(batches, layerU, view, wind.t, params.glow);
    perfAdd('gpu', performance.now() - tGpu0);
    lastView = view;

    if (!obs) {
      // The 2D preview overlay is redrawn only when something it shows changed (with guides on it
      // follows the plants, so then every frame).
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
      scopeCanvas.style.display = params.scene.showScope ? 'block' : 'none';
      if (params.scene.showScope) scope.draw(params.scene.scopeSeconds);
    }
  }

  // ---- Loop ----------------------------------------------------------------------------------------
  // requestAnimationFrame fires on every display refresh (in OBS: every OBS frame). A frame is
  // simulated and drawn on every n-th of them, n being the whole division of the display rate
  // nearest to the wanted fps (docs/fable-consult-4-performance.md, 1.2).
  const MAX_STEP = 0.05; // s: longest single simulation step
  const MAX_CATCHUP = 0.25; // s: most time simulated for one drawn frame (after a stall)
  const IDLE_HOLD = 2000; // ms at the full rate after the last activity
  let last = performance.now(); // time of the last simulated and drawn frame
  let lastRaf = last;
  let vsync = 1000 / 60; // measured rAF period (ms), smoothed
  let activeUntil = last + IDLE_HOLD;
  let obsVisible = true;
  let contextLost = false;
  let shownFps = 0, fpsCount = 0, fpsSince = last;
  // Timing (sprout.perf()): average ms per frame of each phase over the last ~2 s.
  const perf = { sim: 0, build: 0, gpu: 0, frames: 0 };
  const perfAdd = (k: 'sim' | 'build' | 'gpu', ms: number) => (perf[k] += (ms - perf[k]) * 0.02);

  // OBS tells the page when the source is not shown anywhere.
  if (obs) window.addEventListener('obsSourceVisibleChanged', (e) => {
    obsVisible = (e as CustomEvent<{ visible?: boolean }>).detail?.visible !== false;
  });
  // The GPU process was reset (driver update, out of video memory, another program crashed it):
  // stop drawing, and start clean once the context is back. Without this OBS stays blank.
  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
  });
  glCanvas.addEventListener('webglcontextrestored', () => location.reload());

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
    if (controls) fps = Math.min(fps, params.scene.showScope ? 30 : 10); // simulation for the scope only
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

  /** Fast-forward the simulation (debugging / screenshots): sprout.advance(30). */
  function advance(seconds: number, step = 1 / 60) {
    const dt = Math.max(1e-3, step);
    for (let s = 0; s < seconds; s += dt) simulate(dt, dt);
    draw();
  }
  (window as unknown as { sprout: unknown }).sprout = {
    params,
    restart,
    advance,
    action: (name: string) => runAction(name, true),
    slots: () => slots,
    /** Shape checks for each take's newest tree (docs/fable-consult.md, A7). */
    metrics: () => slots.map((s, k) => {
      const g = s.gens.current ?? s.gens.gens[s.gens.gens.length - 1];
      const m = g ? plantMetrics(g.tree, layoutTakes(slots.length, params)[k], params, blocked) : null;
      return m && Object.fromEntries(Object.entries(m).map(([key, v]) => [key, +v.toFixed(3)]));
    }),
    /** Bunching / blobbing of the plants as drawn (docs/fable-consult-2.md 5.1). */
    ink: () => {
      const { a, b, bDown } = outlineOf(params);
      const [arcLo, arcHi] = plantArc(params);
      return inkMetrics({
        strokes: batches.filter((x) => x.kind === 'stroke').map((x) => x.inst),
        sprites: batches.filter((x) => x.kind === 'sprite').map((x) => x.inst),
        layers: layerU, isPlantLayer: (L) => L < plantLayerCount, blocked,
        hubX: params.avatar.headX, hubY: params.layout.midOriginY, a, b, bDown, arcLo, arcHi,
      });
    },
    /** Clipped pixels and local contrast in the rendered frame (draws once, then reads back). */
    pixels: () => {
      draw();
      const v = lastView!;
      return pixelMetrics(renderer.gl, v.W, v.H, (px, py) => [(px - v.W / 2) / v.s + v.cx, (v.H / 2 - py) / v.s + v.cy], blocked);
    },
    /** Preview picture from code (tests): sprout.avatarImage(imgElement) or null. */
    avatarImage: (img: HTMLImageElement | null) => (overlay.image = img),
    /** Average ms per frame: simulation, instance building, GL submission (CPU side). */
    perf: () => ({
      fps: shownFps, displayHz: +(1000 / vsync).toFixed(1),
      simMs: +perf.sim.toFixed(2), buildMs: +perf.build.toFixed(2), glSubmitMs: +perf.gpu.toFixed(2),
      gpuMs: renderer ? +renderer.gpuMs.toFixed(2) : -1,
      canvas: `${glCanvas.width}x${glCanvas.height}`, dpr: window.devicePixelRatio,
      gpu: renderer ? renderer.gpuName() : 'none (controls page)',
      heapMB: +(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6).toFixed(1),
      instances: batches.reduce((a, b) => a + b.inst.count, 0),
    }),
    /** Time n frames of each phase synchronously (works while the pane is hidden). */
    bench: (n = 120) => {
      const r = { sim: 0, build: 0, gl: 0, glFinish: 0 };
      for (let i = 0; i < n; i++) {
        let a = performance.now();
        simulate(1 / 60, 1 / 60);
        r.sim += performance.now() - a;
        a = performance.now();
        draw();
        r.build += perf.build;
        r.gl += perf.gpu;
        const b = performance.now();
        renderer.gl.finish();
        r.glFinish += performance.now() - b;
      }
      const f = (x: number) => +(x / n).toFixed(2);
      return { simMs: f(r.sim), buildMs: f(r.build), glSubmitMs: f(r.gl), glFinishMs: f(r.glFinish), instances: batches.reduce((a, b) => a + b.inst.count, 0) };
    },
    stats: () => ({
      t,
      feed: status.feed,
      liveStatus: live.status,
      halos: halos.map((h) => ({ id: h.id, open: +h.open.toFixed(2), R: +h.R.toFixed(2), nodes: h.vine.sk.n,
        held: +h.drive.held.toFixed(2), bloom: +h.drive.bloom.toFixed(2) })),
      endingHalos: endingHalos.length,
      plants: slots.map((s) => ({ id: s.id, theme: s.theme, gens: s.gens.gens.map((g) => ({ seed: g.seed, reveal: +g.reveal.toFixed(2), alpha: +g.alpha.toFixed(2), retired: g.retired, idle: +g.idle.toFixed(1), wither: +g.wither.toFixed(2), nodes: g.tree.sk.n })) })),
      dying: dying.length,
      commits: commits.map((c) => ({ slot: c.slotId, plungeAt: +c.plungeAt.toFixed(2), stampedAt: +c.stampedAt.toFixed(2), aborted: c.abortedAt >= 0 })),
      instances: { backUnder: backUnder.count, back: back.count, backDeco: backDeco.count, front: front.count, frontDeco: frontDeco.count },
    }),
  };

  // ?perflog: one line every 10 s in the console (OBS: its log, or remote debugging), for measuring.
  if (query.has('perflog'))
    setInterval(() => console.info('sprout perf ' + JSON.stringify((window as unknown as { sprout: { perf(): unknown } }).sprout.perf())), 10000);
  requestAnimationFrame(frame);
}
