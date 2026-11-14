// Sprout viewer: the halo + take plants, rendered with WebGL2 for an OBS Browser Source.
// Preview mode (default) shows a tweak panel and a placeholder avatar; ?obs hides both and
// leaves only the transparent visual. Settings sync between every open viewer via Sprout.exe.

import { buildUI, deepMerge, loadParams, saveParams, UI, UIStatus } from './ui';
import type { FeatureFrame, LayerFeatures, Theme } from './features';
import { Batch, Instances, LayerUniforms, MAX_LAYERS, Renderer, View } from './render/renderer';
import { Overlay, GuidePlant } from './overlay';
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
import { layoutTakes, Placement } from './layout';
import { angleLerp, clamp, deg, hexToRgb, hsv2rgb, hueShift, lerp, RGB, TAU } from './math';

interface Slot {
  id: string;
  gens: Generations<Plant>;
  place: Placement;
  drive: Drive;
  alpha: number;
  colour: string;
  theme: Theme;
  density: number;
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
  cy: number;
  R: number;
  look: { theme: Theme; density: number; colour: string };
  f?: LayerFeatures;
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

  const renderer = new Renderer(glCanvas);
  const overlay = new Overlay(ovCanvas);
  const fake = new FakeSource(params.fake.seed);
  const live = new LiveSource();
  const status: UIStatus = { feed: '', layers: '', pitch: '', voice: '' };
  const clientId = Math.random().toString(36).slice(2);

  const back = new Instances(), backDeco = new Instances(), front = new Instances(), frontDeco = new Instances();
  const batches: Batch[] = [
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

  function newHalo(id: string): LiveHalo {
    haloSeed += 1000;
    return {
      id, vine: new HaloVine(haloSeed, params), drive: new Drive(), open: 0, spawnT0: t,
      cy: params.halo.restY, R: params.halo.restRadius,
      look: { theme: params.look.theme, density: params.look.density, colour: params.colours.live },
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
    slots = [];
    dying = [];
  }
  restart();

  // ---- Settings sync between viewers ---------------------------------------------------------
  // Last writer wins, by timestamp. A viewer ignores settings older than its own latest change,
  // and ignores everything while you are still dragging a control in it.
  let ui: UI | undefined;
  let lastLocalChange = 0;
  let lastAppliedTs = 0;
  // Shared: everything that changes the look. Per viewer: the audio source, the fake singer and
  // preview-only scene switches (so a test or preview page can never pause or reframe OBS).
  const syncable = () => {
    const { source: _source, fake: _fake, ...rest } = structuredClone(params);
    const scene = rest.scene as Partial<typeof params.scene>;
    delete scene.paused;
    delete scene.timeScale;
    delete scene.layers;
    delete scene.backdrop;
    delete scene.showAvatar;
    delete scene.showGuides;
    return rest;
  };
  const sendParams = () => {
    if (params.source.syncSettings) live.send({ type: 'params', from: clientId, ts: Date.now(), params: syncable() });
  };
  const sendAction = (name: string) => live.send({ type: 'action', from: clientId, name });
  // Settings are only ever sent when someone changes them in a panel; connecting never pushes a
  // viewer's stored settings onto the others. A viewer that connects adopts the latest shared ones.
  live.onMessage = (msg: ViewerMessage) => {
    if (msg.from === clientId) return;
    if (msg.type === 'params' && params.source.syncSettings) {
      const ts = Number(msg.ts) || 0;
      if (ts <= lastAppliedTs || ts <= lastLocalChange || Date.now() - lastLocalChange < 1500) return;
      lastAppliedTs = ts;
      deepMerge(params as unknown as Record<string, unknown>, msg.params);
      saveParams(params);
      ui?.refresh();
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
      deleteTake: () => runAction('delete', true),
      changed: () => {
        lastLocalChange = Date.now();
        sendParams();
      },
    }, status);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') panel.style.display = panel.style.display === 'none' ? '' : 'none';
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
  const themeOf = (f?: LayerFeatures) => ({
    theme: f?.theme ?? params.look.theme,
    density: f?.theme ? f.density ?? params.look.density : params.look.density,
  });

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
      bloom: clamp((d.energy * (0.4 + d.effort) + d.pitch * d.energy - 0.35) * 1.6),
    };
  }

  function motionOf(d: Drive, scale = 1): [number, number, number, number] {
    const m = params.motion;
    // Angles are per unit of branch length; ~1.6 units from root to tip.
    return [
      ((m.swayDeg * deg * (1 + m.swayFromLevel * d.slow)) / 1.6) * scale,
      m.swayHz * TAU,
      m.tremble ? ((m.trembleDeg * deg * d.vibrato) / 1.6) * scale : 0,
      d.vibratoRate || 5.5,
    ];
  }

  /** Push a skeleton's visible segments. */
  function pushTree(out: Instances, sk: Skeleton, vis: Float32Array, layer: number, base: RGB,
                    look: Look, alpha: number, unit: number, frontGlow = params.glow.front, nodeAlpha?: ArrayLike<number>) {
    const u = Math.max(1e-3, unit);
    if (alpha <= 0.005) return;
    for (let i = 0; i < sk.n; i++) {
      const pa = sk.parent[i];
      if (pa < 0) continue;
      const f = vis[i];
      if (f <= 0) continue;
      const na = nodeAlpha ? nodeAlpha[i] : 1;
      if (na <= 0.005) continue;
      const ax = sk.x[pa], ay = sk.y[pa];
      const c = colourAt(base, layer, sk.flex[i]);
      const k = brighten(look);
      out.stroke(
        ax, ay, lerp(ax, sk.x[i], f), lerp(ay, sk.y[i], f),
        (sk.w[pa] * look.width) / u, (sk.w[i] * look.width * (0.4 + 0.6 * f)) / u, sk.flex[pa], sk.flex[i],
        lerp(c[0], 1, look.shine) * k, lerp(c[1], 1, look.shine) * k, lerp(c[2], 1, look.shine) * k, alpha * na * fadeOf(look),
        look.glow + (f < 1 ? frontGlow * (1 - f) : 0), layer,
      );
    }
  }

  function pushRing(out: Instances, layer: number, base: RGB, look: Look, alpha: number, unit: number, level: number) {
    const h = params.halo;
    const N = 160;
    const w = (h.ringWidth * look.width * (1 + 0.6 * level)) / Math.max(1e-3, unit);
    const wob = 0.006 * (0.3 + level);
    const rAt = (a: number) => 1 + wob * (Math.sin(a * 5 + t * 0.9) + 0.5 * Math.sin(a * 9 - t * 1.3));
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU;
      const r0 = rAt(a0), r1 = rAt(a1);
      const c = colourAt(base, layer, a0);
      const s = look.shine, i = brighten(look);
      out.stroke(r0 * Math.cos(a0), r0 * Math.sin(a0), r1 * Math.cos(a1), r1 * Math.sin(a1), w, w, 0, 0,
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

  // ---- Simulation ------------------------------------------------------------------------------
  function simulate(dt: number, realDt: number): FeatureFrame {
    t += dt;
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
    for (const h of halos) if (!nextHalos.includes(h)) {
      h.endT0 = t;
      endingHalos.push(h);
    }
    halos = nextHalos;

    const hp = params.halo;
    halos.forEach((h, k) => {
      const f = lives.length ? lives[k] : undefined;
      h.f = f;
      h.drive.update(f, dt, params);
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
        place: { ...targets[k] }, drive: new Drive(), alpha: 0, colour: takeColour(k, takes[k]), ...themeOf(takes[k]),
      };
      // Each tree: plumage from its own seed, gesture (spine) from the take's seed, character from
      // the phrase that grows it.
      slot.gens = new Generations<Plant>((seed) => {
        const plant = new Plant(seed, seed0);
        const d = slot.drive;
        plant.mood = { effort: d.effort, pitch: d.pitch, soft: d.softness, vibrato: d.vibrato };
        return plant;
      }, seed0);
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
      Object.assign(pl, { tierDir: tg.tierDir, kind: tg.kind, rMin: tg.rMin, length: tg.length, halfAngle: tg.halfAngle, bend: tg.bend, taper: tg.taper });
      const f = takes[k];
      s.drive.update(f, dt, params);
      s.gens.update(s.drive, dt, params);
      for (const g of s.gens.gens) {
        g.tree.ensureBuilt(tg, params, blocked, n);
        g.tree.computeReveal(g.reveal, s.drive.pitch, params, g.retired ? 0 : g.wither, dt);
      }
      s.alpha = Math.min(1, s.alpha + realDt * 2);
      s.colour = takeColour(k, f);
      Object.assign(s, themeOf(f));
    });
    if (n >= params.layout.spinFrom) spin += params.layout.spinSpeed * deg * dt;

    dying = dying.filter((d) => t - d.t0 < params.transitions.pruneSeconds);
    return ff;
  }

  // ---- Drawing -----------------------------------------------------------------------------------
  let plantLayerCount = 0;
  let lastView: View | null = null;
  function draw() {
    document.body.className = obs ? '' : `backdrop-${params.scene.backdrop}`;
    back.reset();
    backDeco.reset();
    front.reset();
    frontDeco.reset();
    let layer = 0;

    const drawPlant = (s: Slot, alpha: number, look: Look, fall: number) => {
      const pl = s.place;
      const angle = pl.angle + spin * pl.tierDir;
      const base = hexToRgb(s.colour);
      // Every take colour glows about equally: yellow-green would otherwise clip long before blue.
      const luma = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
      look = { ...look, glow: look.glow * clamp(0.5 / Math.max(0.05, luma), 0.65, 1.4) };
      const [dx, dy] = localDown(angle, pl.scale);
      for (const g of s.gens.gens) {
        const a = alpha * g.alpha;
        pushTree(back, g.tree.sk, g.tree.vis, layer, base, look, a, 1, params.glow.front, g.tree.life);
        decorateTree(g.tree.sk, g.tree.vis, params,
          styleOf(layer, base, look, a, 1, g.seed, s.drive, fall, dx, dy, s.theme, s.density), backDeco,
          { alpha: g.tree.leafLife });
      }
    };

    // Take plants.
    slots.forEach((s) => {
      if (layer >= MAX_LAYERS) return;
      const pl = s.place;
      layerU.set(layer, pl.ox, pl.oy, pl.angle + spin * pl.tierDir, pl.scale, motionOf(s.drive));
      drawPlant(s, s.alpha, lookOf(s.drive), 0);
      layer++;
    });
    plantLayerCount = layer;

    // Deleted takes: a brief flash, then the plant fades away while its leaves fall.
    dying.forEach((d) => {
      if (layer >= MAX_LAYERS) return;
      const u = clamp((t - d.t0) / Math.max(0.05, params.transitions.pruneSeconds));
      const pl = d.slot.place;
      layerU.set(layer, pl.ox, pl.oy, pl.angle + spin * pl.tierDir, pl.scale, motionOf(d.slot.drive, 0.3));
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
      layerU.set(layer, 0, h.cy, Math.PI / 2, R, motionOf(h.drive, 0.4));
      const base = hexToRgb(h.look.colour);
      const look = lookOf(h.drive);
      pushRing(front, layer, base, look, fade, R, h.drive.energy);
      // More origins = more vine, so fewer leaves on each part of it.
      const origins = Math.max(1, Math.round(hp.origins));
      const style = styleOf(layer, base, look, fade, R, h.vine.seed, h.drive, 0, 0, -1 / R, h.look.theme, h.look.density / origins);
      style.sizeMul = Math.pow(clamp(R / Math.max(0.05, hp.openRadius), 0.25, 1), 0.7);
      pushTree(front, h.vine.sk, h.vine.vis, layer, base, look, fade, R, params.glow.front, h.vine.alpha);
      decorateTree(h.vine.sk, h.vine.vis, params, style, frontDeco, { ids: h.vine.ids, alpha: h.vine.alpha });
      decorateRing(params, { ...style, density: h.look.density }, (a) => h.vine.coverage(a, params), frontDeco, hp.alwaysLeaves);
      layer++;
    };
    halos.forEach((h) => drawHalo(h, 1));
    endingHalos.forEach((h) => drawHalo(h, 1 - smooth(clamp((t - (h.endT0 ?? t)) / Math.max(0.05, params.transitions.liveEndSeconds)))));

    // Render.
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(glCanvas.clientWidth * dpr));
    const H = Math.max(1, Math.round(glCanvas.clientHeight * dpr));
    if (glCanvas.width !== W || glCanvas.height !== H) {
      glCanvas.width = W;
      glCanvas.height = H;
    }
    const view: View = { s: Math.min(W, H) / 2 / params.scene.viewRadius, cx: params.scene.centerX, cy: params.scene.centerY, W, H };
    renderer.render(batches, layerU, view, t, params.glow);
    lastView = view;

    if (!obs) {
      const guides: GuidePlant[] = slots.map((s) => ({ pl: s.place, extraAngle: spin * s.place.tierDir, colour: s.colour }));
      overlay.draw(view, params, guides);
    }
  }

  // ---- Loop ----------------------------------------------------------------------------------------
  let last = performance.now();
  function frame(now: number) {
    requestAnimationFrame(frame);
    try {
      const realDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // The OBS page always runs in real time, whatever a preview page saved.
      const dt = obs ? realDt : params.scene.paused ? 0 : realDt * params.scene.timeScale;
      simulate(dt, realDt);
      draw();
    } catch (e) {
      showError(e);
    }
  }

  /** Fast-forward the simulation (debugging / screenshots): sprout.advance(30). */
  function advance(seconds: number) {
    const dt = 1 / 60;
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
      const m = g ? plantMetrics(g.tree, layoutTakes(slots.length, params)[k], blocked) : null;
      return m && Object.fromEntries(Object.entries(m).map(([key, v]) => [key, +v.toFixed(3)]));
    }),
    /** Bunching / blobbing of the plants as drawn (docs/fable-consult-2.md 5.1). */
    ink: () => {
      const g = params.growth as unknown as Record<string, number>;
      const flatten = g.flatten ?? 0.55;
      const a = 2.15 * params.growth.reach, b = a * (1 - 0.6 * flatten);
      const gap = params.layout.spinSpeed === 0 ? params.layout.downGap : 0;
      return inkMetrics({
        strokes: batches.filter((x) => x.kind === 'stroke').map((x) => x.inst),
        sprites: batches.filter((x) => x.kind === 'sprite').map((x) => x.inst),
        layers: layerU, isPlantLayer: (L) => L < plantLayerCount, blocked,
        hubX: params.avatar.headX, hubY: params.layout.midOriginY, a, b, bDown: 0.85 * b,
        arcLo: (-90 + gap / 2) * deg, arcHi: (270 - gap / 2) * deg,
      });
    },
    /** Clipped pixels and local contrast in the rendered frame (draws once, then reads back). */
    pixels: () => {
      draw();
      const v = lastView!;
      return pixelMetrics(renderer.gl, v.W, v.H, (px, py) => [(px - v.W / 2) / v.s + v.cx, (v.H / 2 - py) / v.s + v.cy], blocked);
    },
    stats: () => ({
      t,
      feed: status.feed,
      liveStatus: live.status,
      halos: halos.map((h) => ({ id: h.id, open: +h.open.toFixed(2), R: +h.R.toFixed(2), nodes: h.vine.sk.n })),
      endingHalos: endingHalos.length,
      plants: slots.map((s) => ({ id: s.id, theme: s.theme, gens: s.gens.gens.map((g) => ({ seed: g.seed, reveal: +g.reveal.toFixed(2), alpha: +g.alpha.toFixed(2), retired: g.retired, idle: +g.idle.toFixed(1), wither: +g.wither.toFixed(2), nodes: g.tree.sk.n })) })),
      dying: dying.length,
      instances: { back: back.count, backDeco: backDeco.count, front: front.count, frontDeco: frontDeco.count },
    }),
  };

  requestAnimationFrame(frame);
}
