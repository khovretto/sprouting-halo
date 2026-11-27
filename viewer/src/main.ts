// Sprout viewer: the halo + take plants, rendered with WebGL2 for an OBS Browser Source.
// Preview mode (default) shows a tweak panel and a placeholder avatar; ?obs hides both and
// leaves only the transparent visual. Settings sync between every open viewer via Sprout.exe.

import { buildUI, deepMerge, loadParams, saveParams, setSaveOverrides, UI, UIStatus } from './ui';
import { defaults, Params } from './params';
import { getPath, kindOf, migrateGrowth, PATHS, setPath } from './presets';
import type { FeatureFrame, LayerFeatures, Theme } from './features';
import { Batch, Instances, LayerUniforms, MAX_LAYERS, Renderer, STILL, View } from './render/renderer';
import { Overlay, GuidePlant } from './overlay';
import { Scope } from './scope';
import { branchNatural, loadThemes, onThemesChanged, themeDef } from './themes';
import { buildThemeEditor } from './theme-editor';
import { Ink, inkAt, newInk, ringS, setInk } from './colour';
import { LABELS } from './panel-layout';
import { clearAvatarImage, loadAvatarImage, pickAvatarImage } from './avatar-image';
import { LayerMotion, Wind } from './motion';
import { CommitAnimation, CommitHooks, CommitTarget, HaloSnapshot } from './growth/commit';
import { FakeSource } from './sources/fake';
import { bakeGradient, parseGradient } from './gradient';
import { addHotkeys, installHotkeys, toggleSheet } from './hotkeys';
import { LiveSource, ViewerMessage } from './sources/live';
import { HaloVine } from './growth/halo';
import type { ShedPool } from './shed';
import { endActionOf, Plant, Wilt } from './growth/plant';
import { plantMetrics } from './debug';
import { inkMetrics, pixelMetrics } from './debug-ink';
import { Generations } from './growth/generations';
import { NodeKind, Skeleton } from './growth/skeleton';
import { Drive } from './drive';
import { HarmonyTracker } from './harmony';
import { decorateRing, decorateTree, DecoStyle, drawShed, RingLetGo } from './deco';
import { layoutTakes, outlineOf, Placement, plantArc, toWorld } from './layout';
import { angleLerp, clamp, deg, hash1, hexToRgb, hsv2rgb, hueShift, lerp, RGB, TAU } from './math';

/** The settings sections a tree keeps while a look change takes it away (main.ts withLook). */
const LOOK_SECTIONS = ['look', 'plants', 'colBranch', 'colLeaf', 'colAccent', 'colHalo', 'palette', 'colours', 'leaves3d', 'falling', 'halo'] as const;
type LookParams = Pick<Params, (typeof LOOK_SECTIONS)[number]>;
/** The look a retiring tree keeps: its settings and its take's theme, amount and colours. */
interface TreeLook { params: LookParams; theme: Theme; density: number; colour: string; ink?: string }

interface Slot {
  id: string;
  gens: Generations<Plant>;
  place: Placement;
  drive: Drive;
  alpha: number;
  colour: string;
  /** The track's own gradient (Sprout Tap "My gradient"), for its branches. */
  ink?: string;
  theme: Theme;
  density: number;
  /** Being planted by a commit animation (not drawn as a tree until the impact). */
  commit?: CommitAnimation;
  /** Sim time of the commit impact (flash, quiver, growth burst). */
  stampT?: number;
  motion: LayerMotion;
  /** Harmony (harmony.cross): radians this tree leans toward the voice it harmonises with. */
  lean?: number;
  /** growth.fillSpace: 1 = here; falls to 0 once the take has had no tree and been silent for a
   *  while (its neighbours' new trees then take over its space). Seconds it has been away. */
  presence?: number;
  awayFor?: number;
  /** The territory the take's living boughs were built for (growth.fillSpace). */
  growFrozen?: [number, number];
  /** Seconds its trees have been built for other shape settings than now (a look change waits for
   *  the settings to rest). */
  staleFor?: number;
  staleSig?: string;
  /** The look its trees had when a shape change began (kept by the trees it retires). */
  staleLook?: TreeLook;
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
  look: { theme: Theme; density: number; colour: string; ink?: string };
  f?: LayerFeatures;
  motion: LayerMotion;
  /** A Look preset sweeping round it: ahead of the wave the older look (its settings, appearance
   *  and, if the new look grows from other origins, its older vine), behind it the new one. */
  wave?: {
    t0: number; prev: LookParams; prevLook: { theme: Theme; density: number; colour: string; ink?: string }; oldVine?: HaloVine;
    /** The ring's let-go state as the older look had it (its ring spacing). */
    ring: RingLetGo;
    /** Where the front sweeps from (radians; it keeps it if the start point changes meanwhile). */
    start: number;
    /** The older vine's tail fade in the older look's settings, taken when it was set aside. */
    oldAlpha?: Float32Array;
  };
  /** Seconds it takes to fade out once ending (default transitions.liveEndSeconds). */
  endSeconds?: number;
  /** An ending halo that only finishes part of one: a look's part of it still showing when it was
   *  planted or replaced (in that look, masked as the wave left it, fading), and/or its falling
   *  leaves (drawsPool; otherwise the live halo sharing the pool draws them). */
  ghost?: {
    part?: {
      kept: LookParams; look: LiveHalo['look']; vine: HaloVine; alpha: Float32Array; ring: RingLetGo;
      start: number; reach: number; ahead: boolean;
    };
    drawsPool: boolean;
  };
}

/** Width (radians) of a look change's front as it sweeps round a halo. */
const WAVE_W = 0.6;

const errorBox = document.getElementById('error')!;
function showError(e: unknown) {
  errorBox.style.display = 'block';
  errorBox.textContent = e instanceof Error ? e.message : String(e);
  console.error(e);
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
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
  /** Running inside an OBS browser source (OBS adds window.obsstudio), with or without ?obs. It
   *  never has keyboard focus, so it must not count as "in the background"; its panel starts hidden
   *  (H or Interact shows it). */
  const inObs = obs || 'obsstudio' in window;
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
    document.title = 'Sprouting Halo controls';
  }
  // /themes (or ?themes): make your own themes, with a live preview.
  const themesPage = /\/themes\/?$/.test(location.pathname) || query.has('themes');
  let editorTheme = 'leaves';
  if (themesPage) document.title = 'Sprouting Halo themes';
  const renderer = controls ? (null as unknown as Renderer) : new Renderer(glCanvas);
  const overlay = new Overlay(ovCanvas);
  if (!obs && !controls) void loadAvatarImage().then((img) => (overlay.image = img));
  /** Where Sprout.exe serves the theme files ('' = offline: built-in themes only). */
  const themeBase = () =>
    offline ? '' : !import.meta.env.DEV && location.protocol.startsWith('http') ? location.origin : `http://localhost:${params.source.port}`;
  onThemesChanged(() => ui?.themesChanged());
  if (themeBase()) void loadThemes(themeBase());
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
  const harmony = new HarmonyTracker();

  function newHalo(id: string): LiveHalo {
    haloSeed += 1000;
    return {
      id, vine: new HaloVine(haloSeed, params), drive: new Drive(), open: 0, spawnT0: t,
      cx: params.halo.restX, cy: params.halo.restY, R: params.halo.restRadius,
      look: { theme: themesPage ? editorTheme : params.look.theme, density: params.look.density, colour: params.colours.live },
      motion: new LayerMotion(haloSeed),
    };
  }

  /** Switch between the fake singer and the mode used before it (auto by default). */
  let modeBeforeFake: Params['source']['mode'] = params.source.mode === 'fake' ? 'auto' : params.source.mode;
  function toggleFake() {
    if (params.source.mode === 'fake') params.source.mode = modeBeforeFake;
    else {
      modeBeforeFake = params.source.mode;
      params.source.mode = 'fake';
    }
    saveParams(params);
    ui?.refresh();
  }

  let lastAutoCommit = 0;
  /** Mixed into every tree's seed: a restart from the panel picks a new one, so it shows new trees
   *  (the fake song stays the same). Sent with the restart, so every open viewer agrees. */
  let treeSalt = 0;
  function restart(salt = treeSalt) {
    treeSalt = salt;
    lastAutoCommit = 0;
    t = 0;
    spin = 0;
    plantSeed = 1;
    haloSeed = params.fake.seed * 31 + salt * 7;
    fake.reset(params.fake.seed + salt); // a new restart: new trees and a new song
    harmony.clear();
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
    // Settings from an older viewer (or kept by Sprout.exe from before) in the older words: in the
    // current ones, so they are not dropped as the wrong type.
    if (Object.keys(patch).some((k) => k.startsWith('growth.') && typeof patch[k] === 'string' && /^growth\.(onPause|onPhraseEnd|onStop|ending)$/.test(k))) {
      const gr: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) if (k.startsWith('growth.')) gr[k.slice(7)] = patch[k];
      migrateGrowth(gr);
      patch = { ...patch };
      for (const k of Object.keys(patch)) if (k.startsWith('growth.')) delete patch[k];
      for (const [k, v] of Object.entries(gr)) patch['growth.' + k] = v;
    }
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
    if (msg.type === 'themes') {
      // A theme was saved or deleted (any page): read the list again.
      void loadThemes(themeBase());
      return;
    }
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
    if (name === 'restart' || name.startsWith('restart:')) {
      // restart:<salt> from another viewer; a restart here picks a new salt (new trees).
      const salt = name.startsWith('restart:') ? Number(name.slice(8)) || 0 : 1 + Math.floor(Math.random() * 99999);
      restart(salt);
      if (broadcast) sendAction('restart:' + salt);
      return;
    }
    if (name === 'commit') fake.commit(params);
    else if (name === 'delete') fake.deleteLast(params);
    else if (name === 'phraseEnd') fake.endPhrase();
    if (broadcast) sendAction(name);
  }

  if (obs) {
    panel.remove();
    ovCanvas.remove();
  } else {
    if (inObs) panel.style.display = 'none';
    buildPanel();
  }
  function buildPanel() {
    if (themesPage) {
      // /themes: the theme editor on the left, the normal panel on the right (presets can be worked
      // on here too). The preview sings with the fake singer; these test values are not saved.
      setSaveOverrides({ 'source.mode': params.source.mode, 'scene.layers': params.scene.layers, 'fake.recording': params.fake.recording });
      params.source.mode = 'fake';
      params.scene.layers = 3;
      params.fake.recording = true;
      const editorBox = document.createElement('div');
      editorBox.id = 'theme-panel';
      document.body.appendChild(editorBox);
      const editor = buildThemeEditor(editorBox, {
        send: (msg) => {
          if (live.status !== 'connected') return false;
          live.send(msg as ViewerMessage);
          return true;
        },
        connected: () => live.status === 'connected',
        useInViewer: (id) => {
          params.look.theme = id;
          params.look.themeFrom = 'preset';
          saveParams(params);
          sendParams();
          ui?.refresh();
        },
        preview: (id) => (editorTheme = id),
      });
      onThemesChanged(() => editor.refresh());
    }
    {
      ui = buildUI(panel, params, {
        restart: () => runAction('restart', true),
        commitLive: () => runAction('commit', true),
        tapsToAuto: () => live.send({ type: 'tapLook', theme: 'default', density: -1, colour: 'auto', from: clientId }),
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
        toggleFake: () => toggleFake(),
        endPhrase: () => runAction('phraseEnd', true),
        changed: () => {
          lastLocalChange = Date.now();
          sendParams();
          sendDetect();
        },
      }, status);
    }
  }
  // ---- Keyboard shortcuts ("/" shows them all) ------------------------------------------------------
  const setLocal = (fn: () => void) => {
    fn();
    saveParams(params);
    ui?.refresh();
  };
  addHotkeys([
    { key: 'H', label: 'Hide / show the settings panels', run: () => {
      const hide = panel.style.display !== 'none';
      for (const el of [panel, document.getElementById('theme-panel')]) if (el) el.style.display = hide ? 'none' : '';
    } },
  ]);
  if (!obs) addHotkeys([
    { key: 'G', label: 'Voice scope', run: () => setLocal(() => (params.scene.showScope = !params.scene.showScope)) },
    { key: 'F', label: 'Fake singer ⇄ live taps', run: () => toggleFake() },
    { key: 'R', label: 'Restart growth', run: () => runAction('restart', true) },
    { key: 'T', label: 'Halo → tree (commit the live take)', run: () => runAction('commit', true) },
    { key: 'D', label: 'Delete the last take', run: () => runAction('delete', true) },
    { key: 'E', label: 'End the phrase (fake singer full stop)', run: () => runAction('phraseEnd', true) },
    { key: 'P', label: 'Pause / play', run: () => setLocal(() => (params.scene.paused = !params.scene.paused)) },
  ]);
  addHotkeys([{ key: '/', label: 'This list', run: () => toggleSheet() }]);
  installHotkeys();

  // ---- Helpers ---------------------------------------------------------------------------------
  const blocked = (wx: number, wy: number) => {
    const a = params.avatar;
    if (!a.avoid) return false;
    if (Math.hypot(wx - a.headX, wy - a.headY) < a.headR) return true;
    const y = clamp(wy, a.bodyBottomY, a.bodyTopY);
    return Math.hypot(wx, wy - y) < a.bodyR;
  };

  /** Colour for take k: the track colour when the tap asks for it, otherwise the viewer palette. */
  // ---- Take colours (consult 6, 7): one per take id, kept while it is on screen ------------------
  const assigned = new Map<string, number>();
  let ordinal = 0, paletteKey = '';
  const strHash = (str: string) => {
    let h = 0;
    for (let q = 0; q < str.length; q++) h = (h * 31 + str.charCodeAt(q)) | 0;
    return Math.abs(h);
  };
  const usesMine = () => params.palette.from === 'mine' || params.colours.lock;
  const mineList = () => {
    const c = params.colours as unknown as Record<string, string>;
    return [1, 2, 3, 4, 5, 6, 7].map((n) => c[`take${n}`] ?? '#ffffff');
  };
  const rgbHex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');
  /** The palette colour of take (or halo) `id`: the first free one, a random free one, or spread. */
  function paletteColour(id: string): string {
    const P = params.palette, mine = usesMine();
    const key = [mine, P.pick, P.seed, P.list].join('|');
    if (key !== paletteKey) {
      paletteKey = key;
      assigned.clear();
      ordinal = 0;
    }
    const spread = !mine && P.pick === 'spread';
    const list = mine ? mineList() : parseGradient(P.list).stops.map((st) => (st.col === 't' ? params.colours.live : '#' + st.col));
    let n = assigned.get(id);
    if (n === undefined) {
      if (spread) n = ordinal++;
      else {
        const used = new Set(assigned.values());
        const free = list.map((_, q) => q).filter((q) => !used.has(q));
        const pool = free.length ? free : list.map((_, q) => q);
        n = P.pick === 'random' && !mine ? pool[Math.floor(hash1(strHash(id) * 0.731 + P.seed * 17.3) * pool.length)] : pool[0];
      }
      assigned.set(id, n);
    }
    if (spread) {
      const lut = bakeGradient(P.list, [1, 1, 1]).lut, x = Math.round(((n * 0.618034) % 1) * 255) * 3;
      return rgbHex(lut[x], lut[x + 1], lut[x + 2]);
    }
    return list[n % list.length];
  }
  /** Forget ids no longer on screen (their colour is free again). */
  function prunePalette() {
    for (const id of assigned.keys())
      if (!slots.some((x) => x.id === id) && !halos.some((h) => h.id === id) && !dying.some((d) => d.slot.id === id) &&
          !commits.some((c) => c.slotId === id)) assigned.delete(id);
  }
  /** The middle colour of a gradient string, as #rrggbb. */
  const midHex = (g: string) => {
    const lut = bakeGradient(g, hexToRgb(params.colours.live)).lut, x = 128 * 3;
    return rgbHex(lut[x], lut[x + 1], lut[x + 2]);
  };
  /** Colour for take `id`: the tap's own colour or gradient, the track colour when asked for (or
   *  on Auto with "use DAW track colours"), otherwise the palette (consult 6, 6.5). */
  const takeColour = (id: string, f?: LayerFeatures) => {
    if (f?.ink?.startsWith('#')) return f.ink;
    if (f?.ink) return midHex(f.ink);
    const track = f?.colourMode === 'track' || ((f?.colourMode ?? 'auto') === 'auto' && params.source.useTrackColours);
    if (track && f?.colour) return f.colour;
    return paletteColour(id);
  };
  /** The tap's own gradient, if any. */
  const inkOf = (f?: LayerFeatures) => (f?.ink && !f.ink.startsWith('#') ? f.ink : undefined);
  // A track's theme: its own (Sprout Tap window), unless the preset's theme applies to all tracks.
  const themeOf = (f?: LayerFeatures) => {
    // A user theme this viewer doesn't have (not loaded yet, or deleted) falls back to the preset's.
    if (themesPage) return { theme: editorTheme, density: params.look.density }; // the theme being edited, on every layer
    // Each value falls back on its own: a tap on Auto (or a theme this viewer lacks) takes the look's.
    const tracks = params.look.themeFrom === 'tracks';
    const own = tracks && f?.theme && themeDef(f.theme) ? f.theme : undefined;
    return { theme: own ?? params.look.theme, density: tracks && f?.density !== undefined ? f.density : params.look.density };
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
    const intensity = lerp(1, 0.45 + 0.75 * clamp(d.energy * 1.3) + 0.12 * d.flash, r.brightness);
    return {
      intensity,
      glow: g.base + g.levelGain * d.energy + g.onsetGain * d.flash + g.pitchShine * d.pitch * d.energy + g.softGlow * d.softness * d.energy
        + params.harmony.glow * d.harmony,
      shine: clamp(0.08 * d.flash + 0.25 * d.pitch * d.energy),
      width: Math.max(0.25, 1 + r.effortWidth * (d.effort - 0.5) * 1.6),
      // Blossoms open on a held note, and (harmony.blossoms) in harmony.
      bloom: Math.max(d.bloom, clamp(params.harmony.blossoms) * d.harmony),
    };
  }



  let shown = new Uint8Array(0);
  /** Glow settings plus the leaf sheen, one object reused every frame. */
  const glowArgs = { ...params.glow, sheen: 0, sheenColour: '#ffffff', leaf3d: 0, leaves3d: params.leaves3d };
  /** Rope limbs of a take tree (plants.strands). */
  type Rope = { phase: ArrayLike<number>; strands: number; depth: number; k: number };
  const smoothstep01 = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  /** A theme's natural branch colour (its middle, for a gradient); undefined = the take colour. */
  const branchCache = new Map<string, RGB>();
  const branchRgb = (theme: string): RGB | undefined => {
    const nat = branchNatural(theme);
    if (!nat) return undefined;
    let c = branchCache.get(nat);
    if (!c) {
      if (nat.includes(';')) {
        const lut = bakeGradient(nat, [1, 1, 1]).lut;
        c = [lut[384], lut[385], lut[386]];
      } else c = hexToRgb(nat);
      branchCache.set(nat, c);
    }
    return c;
  };
  /** Push a skeleton's visible segments. */
  // Colour inks: one per layer and role (branch or halo, leaf, accent), refilled every frame.
  const inkPool: Ink[][] = Array.from({ length: MAX_LAYERS + 8 }, () => [newInk(), newInk(), newInk()]);
  const C = [0, 0, 0];
  /** Inks for a layer: stroke (branches, or the halo), leaf and accent. */
  function inksFor(layer: number, take: RGB, k: number, d: Drive | undefined, halo: boolean, ink?: string, id?: string) {
    const pool = inkPool[Math.max(0, Math.min(inkPool.length - 1, layer))];
    setInk(pool[0], params, halo ? 'colHalo' : 'colBranch', take, k, t, d, ink);
    setInk(pool[1], params, 'colLeaf', take, k, t, d);
    setInk(pool[2], params, 'colAccent', take, k, t, d);
    // Harmony: the colours move toward the one shared with the other voice (harmony.colour).
    const hm = params.harmony, amount = (d?.harmony ?? 0) * clamp(hm.colour);
    const other = amount > 0.003 && id ? colourOfId(harmony.partner(id)) : undefined;
    if (other || (amount > 0.003 && hm.colourMode === 'colour')) {
      const own = pool[0].mid;
      const mix: RGB = hm.colourMode === 'colour' ? tinted(hexToRgb(hm.colourValue))
        : hm.colourMode === 'mix' ? [0.5 * (own[0] + other![0]), 0.5 * (own[1] + other![1]), 0.5 * (own[2] + other![2])]
          : other!;
      const along = hm.colourMode === 'gradient' ? (halo ? 2 : 1) : 0;
      pool.forEach((x, q) => {
        x.mix = mix;
        x.mixAlong = along;
        x.mixK = amount * (q === 0 ? 1 : 0.5); // leaves and blossoms follow half way
      });
    }
    return { stroke: pool[0], leaf: pool[1], accent: pool[2] };
  }
  /** The colour a track's branches (or halo) have, for the voice in harmony with it. */
  function colourOfId(id: string | null): RGB | undefined {
    if (!id) return undefined;
    const s = slots.find((x) => x.id === id);
    if (s) return (params.colBranch.source === 'theme' ? branchRgb(s.theme) : undefined) ?? tinted(hexToRgb(s.colour));
    const h = halos.find((x) => x.id === id);
    return h ? tinted(hexToRgb(h.look.colour)) : undefined;
  }

  function pushTree(out: Instances, sk: Skeleton, vis: Float32Array, layer: number, ink: Ink,
                    look: Look, alpha: number, unit: number, frontGlow = params.glow.front, nodeAlpha?: ArrayLike<number>,
                    tone?: ArrayLike<number>, order?: ArrayLike<number>, bend?: ArrayLike<number>, sScale = 1, ring = false, natural?: RGB,
                    rope?: Rope) {
    const u = Math.max(1e-3, unit);
    const W0 = Math.max(1.6 * params.plants.tipWidth, 0.008);
    const S = rope ? Math.max(1, Math.min(3, Math.round(rope.strands))) : 1;
    if (alpha <= 0.005) return;
    const bright = brighten(look), fade = fadeOf(look);
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
      const c = inkAt(ink, ring ? ringS(sk.x[i], sk.y[i], ink.loop) : sk.flex[i] * sScale, 0.5, C, natural);
      const tn = tone ? tone[i] : 1;
      const k = bright * tn;
      const wa = (sk.w[pa] * look.width) / u, wb = (sk.w[i] * look.width * (0.4 + 0.6 * f)) / u;
      const cr = lerp(c[0], 1, look.shine) * k, cg = lerp(c[1], 1, look.shine) * k, cb = lerp(c[2], 1, look.shine) * k;
      const a = alpha * na * fade, gl = (look.glow + (f < 1 ? frontGlow * (1 - f) : 0)) * tn * tn;
      // Chain links tile: a start on the parent segment's end plane, and a flat end where a drawn
      // child continues it (tips and growing ends stay round).
      const gp = sk.parent[pa];
      const join = gp >= 0 ? (shown[i] ? 2 : 1) : 0;
      const ord = order ? order[i] : 1;
      // The link knows the point before it when that point moves with it: both on limbs, or both
      // in one shoot group. (The first link of a shoot starts square, inside its limb.) Its start
      // then follows any bend without a notch (Instances.stroke, shaders/stroke.vert).
      const chained = join > 0 && (!order || (order[pa] < 2) === (ord < 2));
      const px = bend ? bend[i * 4] : ax, py = bend ? bend[i * 4 + 1] : ay, pf = bend ? bend[i * 4 + 2] : sk.flex[pa], hd = bend ? bend[i * 4 + 3] : 0;
      if (S > 1 && rope && ord <= 1 && sk.w[pa] > W0) {
        // Rope (consult 7, 1.5): S thinner strands on a phase-shifted helix, back strand first and
        // dimmer. The outer edge stays at the branch width; strands grow out of the main one.
        const ph = rope.phase, rho = S === 2 ? 0.62 : 0.52;
        let bx = sk.x[i] - ax, by = sk.y[i] - ay;
        const bl = Math.hypot(bx, by) || 1;
        bx /= bl;
        by /= bl;
        let qx = gp >= 0 ? ax - sk.x[gp] : bx, qy = gp >= 0 ? ay - sk.y[gp] : by;
        const ql = Math.hypot(qx, qy) || 1;
        qx /= ql;
        qy /= ql;
        const Ka = rope.k * smoothstep01(W0, 1.6 * W0, sk.w[pa]), Kb = rope.k * smoothstep01(W0, 1.6 * W0, sk.w[i]);
        // Where each strand of the parent segment starts (the point before this strand's A): the
        // parent's own offset, across the direction of the segment before it.
        let hx = qx, hy = qy, og = 0;
        if (chained) {
          const gg = sk.parent[gp];
          if (gg >= 0) {
            hx = sk.x[gp] - sk.x[gg];
            hy = sk.y[gp] - sk.y[gg];
            const hl = Math.hypot(hx, hy) || 1;
            hx /= hl;
            hy /= hl;
          }
          // (0 if the parent segment was drawn as one stroke: its strands start at the node.)
          const roped = (order ? order[pa] : 1) <= 1 && sk.w[gp] > W0;
          og = roped ? ((sk.w[gp] * look.width) / u) * (1 - rho) * rope.k * smoothstep01(W0, 1.6 * W0, sk.w[gp]) : 0;
        }
        const mid = 0.5 * (ph[pa] + ph[i]);
        strandOrder.length = 0;
        for (let j = 0; j < S; j++) strandOrder.push(j);
        strandOrder.sort((p1, p2) => Math.cos(mid + (TAU * p1) / S) - Math.cos(mid + (TAU * p2) / S));
        for (const j of strandOrder) {
          const o = (TAU * j) / S, z = Math.cos(mid + o);
          const oa = wa * (1 - rho) * Ka * Math.sin(ph[pa] + o), ob = wb * (1 - rho) * Kb * Math.sin(ph[i] + o);
          const ra = wa * (j === 0 ? lerp(1, rho, Ka) : rho * Ka), rb = wb * (j === 0 ? lerp(1, rho, Kb) : rho * Kb);
          if (ra <= 0 && rb <= 0) continue;
          const sh = 1 - 0.4 * rope.depth * (0.5 - 0.5 * z) * Math.min(1, Ka + Kb);
          const Ax = ax - qy * oa, Ay = ay + qx * oa, Bx = sk.x[i] - by * ob, By = sk.y[i] + bx * ob;
          const os = chained ? og * Math.sin(ph[gp] + o) : 0;
          out.stroke(Ax, Ay, lerp(Ax, Bx, f), lerp(Ay, By, f), ra, rb, sk.flex[pa], sk.flex[i],
            cr * sh, cg * sh, cb * sh, a, gl, layer, join, ord, px, py, pf, hd,
            chained, chained ? sk.x[gp] - hy * os : 0, chained ? sk.y[gp] + hx * os : 0, chained ? sk.flex[gp] : 0);
        }
        continue;
      }
      out.stroke(ax, ay, lerp(ax, sk.x[i], f), lerp(ay, sk.y[i], f), wa, wb, sk.flex[pa], sk.flex[i],
        cr, cg, cb, a, gl, layer, join, ord, px, py, pf, hd,
        chained, chained ? sk.x[gp] : 0, chained ? sk.y[gp] : 0, chained ? sk.flex[gp] : 0);
    }
  }
  const strandOrder: number[] = [];

  // ---- The trunk (plants.trunk): one for the scene, from behind the body up into the point every
  // take's limbs fan out from. Upright in the world (plants.trunkLean tilts it), so it does not turn
  // with a take's layer; coloured like the first take's branches at their base; there while any take
  // has a tree. ------------------------------------------------------------------------------------
  const trunkSk = new Skeleton(32);
  let trunkVis = new Float32Array(32);
  /** Draws into layer L; false = nothing drawn (L stays free). */
  function drawTrunk(L: number): boolean {
    const len = Math.max(0, params.plants.trunk ?? 0);
    if (len < 0.02 || !slots.length || L >= MAX_LAYERS) return false;
    let a = 0;
    for (const s of slots) for (const g of s.gens.gens) a = Math.max(a, s.alpha * g.alpha * (g.dim ?? 1) * clamp(g.reveal * 4));
    if (a <= 0.005) return false;
    const s0 = slots[0];
    layerU.set(L, s0.place.ox, s0.place.oy, Math.PI / 2, 1, STILL);
    const lean = (params.plants.trunkLean ?? 0) * deg, ux = Math.sin(lean), uy = Math.cos(lean);
    const N = 16, w0 = params.plants.maxWidth, w1 = params.plants.maxWidth * 0.5;
    trunkSk.reset();
    if (trunkVis.length < N + 1) trunkVis = new Float32Array(N + 1);
    for (let j = 0; j <= N; j++) {
      const u = j / N;
      // flex 0 all along: the colour of the branches' base.
      trunkSk.add(-ux * len * (1 - u), -uy * len * (1 - u), j - 1, 0, lerp(w0, w1, u), NodeKind.Branch);
      trunkVis[j] = 1;
    }
    trunkSk.computeChildren();
    const inks = inksFor(L, hexToRgb(s0.colour), 0, s0.drive, false, s0.ink, s0.id);
    pushTree(back, trunkSk, trunkVis, L, inks.stroke, lookOf(s0.drive), a, 1, 0, undefined, undefined, undefined, undefined, 1, false, branchRgb(s0.theme));
    return true;
  }

  let dryKey = '', dryRgb: RGB = [0.54, 0.44, 0.27];
  /** look.dryColour as RGB (cached). */
  const dryRgbOf = () => {
    if (params.look.dryColour !== dryKey) dryRgb = hexToRgb((dryKey = params.look.dryColour));
    return dryRgb;
  };
  const pieceOf = new Map<number, number>();
  const continued = new Set<number>();
  /**
   * Take over the segments of a tree that let go since the last frame (Plant.drops) into its twig
   * pool, coloured and sized as pushTree drew them. The segments of one branch that let go
   * together make one piece: it turns about its lowest node.
   */
  function takeDrops(tree: Plant, sk: Skeleton, ink: Ink, look: Look, alpha: number, sScale: number, natural?: RGB) {
    const drops = tree.drops;
    if (!drops.length) return;
    if (alpha > 0.005) {
      const bright = brighten(look);
      // Each piece's pivot: the parent of its lowest node (nodes come parent first).
      pieceOf.clear();
      continued.clear();
      for (let q = 0; q < drops.length; q += 3) {
        const i = drops[q], b = tree.branchId[i] * 4096 + Math.round(drops[q + 2] * 1000) % 4096;
        const low = pieceOf.get(b);
        if (low === undefined || i < low) pieceOf.set(b, i);
        continued.add(sk.parent[i]); // another dropped segment starts where this one ends
      }
      for (let q = 0; q < drops.length; q += 3) {
        const i = drops[q], f = drops[q + 1], t0 = drops[q + 2], pa = sk.parent[i];
        if (pa < 0) continue;
        const na = tree.life[i];
        if (na <= 0.02) continue;
        const b = tree.branchId[i] * 4096 + Math.round(t0 * 1000) % 4096;
        const low = pieceOf.get(b) ?? i, piv = sk.parent[low] >= 0 ? sk.parent[low] : low;
        const c = inkAt(ink, sk.flex[i] * sScale, 0.5, C, natural);
        const tn = tree.tone[i] ?? 1, k = bright * tn;
        const wa = sk.w[pa] * look.width, wb = sk.w[i] * look.width * (0.4 + 0.6 * f);
        const ax = sk.x[pa], ay = sk.y[pa], o = i * 4, bend = tree.bend;
        tree.twigs.add(t0, sk.x[piv], sk.y[piv], hash1(b * 0.37 + 1.7), ax, ay, lerp(ax, sk.x[i], f), lerp(ay, sk.y[i], f), wa, wb,
          sk.flex[pa], sk.flex[i], lerp(c[0], 1, look.shine) * k, lerp(c[1], 1, look.shine) * k, lerp(c[2], 1, look.shine) * k,
          na, look.glow * tn * tn, tree.swing[i], bend[o], bend[o + 1], bend[o + 2], bend[o + 3], continued.has(i) ? 2 : 1);
      }
    }
    drops.length = 0;
  }

  function pushRing(out: Instances, layer: number, ink: Ink, look: Look, alpha: number, unit: number, level: number, braidMore = 0,
                    mask?: (angle: number) => number) {
    const h = params.halo;
    const N = 160;
    const w = (h.ringWidth * look.width * (1 + 0.6 * level)) / Math.max(1e-3, unit);
    // A clean circle: its oval / trefoil motion comes from the layer's ring mode (shaders/motion.glsl).
    const braid = Math.max(clamp(h.braid ?? 0, 0, 1), clamp(braidMore));
    // The links tile (flat ends, each starting on the end plane of the one before): with round
    // caps every joint of a see-through ring is drawn twice and the ring reads as a row of dots.
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU, ap = ((k - 1) / N) * TAU, am = 0.5 * (a0 + a1);
      // A look change sweeping round: this look only where it has reached.
      const mk = mask ? mask(am) : 1;
      if (mk <= 0.003) continue;
      // Colour by the same ring position as the vine on it (ringS), so they agree.
      const c = inkAt(ink, ringS(Math.cos(am), Math.sin(am), ink.loop), 0.5, C);
      const s = look.shine, i = brighten(look);
      if (braid > 0) {
        // halo.braid (consult 7, 1.8): two strands round each other, 12 crossings (whole: it closes),
        // the back one first and dimmer.
        const js = Math.cos(12 * am) < Math.cos(12 * am + Math.PI) ? [0, 1] : [1, 0];
        for (const j of js) {
          const r0 = 1 + 0.028 * braid * Math.sin(12 * a0 + j * Math.PI), r1 = 1 + 0.028 * braid * Math.sin(12 * a1 + j * Math.PI);
          const z = Math.cos(12 * am + j * Math.PI), sh = i * (1 - 0.4 * params.plants.twistDepth * (0.5 - 0.5 * z));
          const ws = w * lerp(1, 0.7, braid), rp = 1 + 0.028 * braid * Math.sin(12 * ap + j * Math.PI);
          const x0 = r0 * Math.cos(a0), y0 = r0 * Math.sin(a0);
          out.stroke(x0, y0, r1 * Math.cos(a1), r1 * Math.sin(a1), ws, ws, 0, 0,
            lerp(c[0], 1, s) * sh, lerp(c[1], 1, s) * sh, lerp(c[2], 1, s) * sh, alpha * mk * fadeOf(look), look.glow, layer,
            2, 1, x0, y0, 0, 0, true, rp * Math.cos(ap), rp * Math.sin(ap), 0);
        }
        continue;
      }
      const x0 = Math.cos(a0), y0 = Math.sin(a0);
      out.stroke(x0, y0, Math.cos(a1), Math.sin(a1), w, w, 0, 0,
        lerp(c[0], 1, s) * i, lerp(c[1], 1, s) * i, lerp(c[2], 1, s) * i, alpha * mk * fadeOf(look), look.glow, layer,
        2, 1, x0, y0, 0, 0, true, Math.cos(ap), Math.sin(ap), 0);
    }
  }


  /** World "down" in a layer's local frame (for falling leaves). */
  function localDown(angle: number, scale: number): [number, number] {
    // local = R(-th) * world / scale, with world down = (0, -1).
    const th = angle - Math.PI / 2;
    const s = Math.max(1e-3, scale);
    return [-Math.sin(th) / s, -Math.cos(th) / s];
  }

  function styleOf(layer: number, inks: { leaf: Ink; accent: Ink }, look: Look, alpha: number, unit: number, seed: number, d: Drive,
                   fall: number, downX: number, downY: number, theme: Theme, density: number, sScale = 1): DecoStyle {
    return {
      theme, density, layer, leaf: inks.leaf, accent: inks.accent, sScale, alpha: alpha * fadeOf(look), glow: look.glow * params.look.decoGlow, unit, seed, effort: d.effort,
      bloom: look.bloom * params.look.blossoms, fall, downX, downY, intensity: brighten(look), time: t, pitch: d.pitch,
      harmony: d.harmony, fallAway: params.growth.fallDirection === 'away', drop: params.falling,
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
      open: halo ? halo.open : g?.reveal ?? 0, wither: g?.wither ?? 0, alpha: halo ? 1 : (g?.alpha ?? 0) * (g?.dim ?? 1),
      ending: Math.min(1, g?.end ?? 0), harmony: d.harmony,
    }, { phrase: d.newPhrase, onset: !!f?.onset, dip: d.pitchDip });
  }

  // ---- Commit (Part B) ---------------------------------------------------------------------------
  /** How far round a look change's front has come (radians from its start point, both ways). */
  function waveReach(w: NonNullable<LiveHalo['wave']>) {
    return clamp((t - w.t0) / Math.max(0.3, params.transitions.lookChangeSeconds)) * (Math.PI + 2 * WAVE_W);
  }
  /** 0..1 at ring angle a: the front has passed (1) or not yet reached (0) it. */
  function frontAt(start: number, reach: number, a: number) {
    return smooth(clamp((reach - Math.abs(wrapAngle(a - start))) / WAVE_W));
  }

  function snapshotOf(h: LiveHalo): HaloSnapshot {
    const sk = h.vine.sk.clone();
    const n = sk.n;
    const ids = h.vine.ids.slice(0, n), alpha = h.vine.alpha.slice(0, n);
    // Leaves that already let go stay gone on the planted strand.
    const decoAlpha = alpha.slice();
    if (h.vine.gone.size) for (let i = 0; i < n; i++) if (h.vine.gone.has(ids[i])) decoAlpha[i] = 0;
    return {
      sk, vis: h.vine.vis.slice(0, n), alpha, decoAlpha, ids,
      cx: h.cx, cy: h.cy, R: h.R, theme: h.look.theme, density: h.look.density, colour: tinted(hexToRgb(h.look.colour)),
      seed: h.vine.seed, lead: h.vine.leadTip(),
      sizeMul: Math.pow(clamp(h.R / Math.max(0.05, params.halo.openRadius), 0.25, 1), 0.7),
      idle: 1 - smooth(clamp(h.open)),
      mood: { effort: h.drive.effort, pitch: h.drive.pitch, soft: h.drive.softness, vibrato: h.drive.vibrato },
      look: lookOf(h.drive),
    };
  }

  function targetOf(s: Slot, layer: number): CommitTarget | undefined {
    const g = s.gens.current ?? s.gens.gens[s.gens.gens.length - 1];
    if (!g) return undefined;
    const v = lastView;
    const view = v
      ? { cx: v.cx, cy: v.cy, hw: v.W / 2 / v.s, hh: v.H / 2 / v.s }
      : { cx: params.scene.centerX, cy: params.scene.centerY, hw: params.scene.viewRadius, hh: params.scene.viewRadius };
    return { place: s.place, spinAngle: spin * s.place.tierDir, plant: g.tree, layer, colour: tinted(hexToRgb(s.colour)), view };
  }

  const mixLook = (a: Look, b: Look, k: number): Look => ({
    intensity: lerp(a.intensity, b.intensity, k), glow: lerp(a.glow, b.glow, k), shine: lerp(a.shine, b.shine, k),
    width: lerp(a.width, b.width, k), bloom: lerp(a.bloom, b.bloom, k),
  });

  /**
   * The planting strand (growth/commit.ts) is drawn with the take tree's own colours and theme, so
   * nothing changes at the hand-over: its take colour comes over from the halo's while it curls and
   * moves (the branch colour leans toward the halo's until then), and its look eases from the
   * halo's to the tree's.
   */
  const commitHooks: CommitHooks = {
    strand(sk, vis, lineAlpha, decoAlpha, ids, L, snap, unit, st) {
      const s = slots.find((x) => x.commit && x.commit.snap === snap);
      if (!s) return;
      const tree = s.gens.current?.tree ?? s.gens.gens[s.gens.gens.length - 1]?.tree;
      const own = hexToRgb(s.colour), from = snap.colour;
      const take: RGB = [lerp(from[0], own[0], st.colour), lerp(from[1], own[1], st.colour), lerp(from[2], own[2], st.colour)];
      const inks = inksFor(L, take, Math.max(0, slots.indexOf(s)), s.drive, false, s.ink, s.id);
      if (st.colour < 1) {
        inks.stroke.mix = from;
        inks.stroke.mixAlong = 0;
        inks.stroke.mixK = Math.max(inks.stroke.mixK, 1 - st.colour);
      }
      const look = mixLook(snap.look ?? lookOf(s.drive), lookOf(s.drive), st.look);
      const sScale = 1 / Math.max(1e-3, tree?.maxFlex ?? 1);
      pushTree(back, sk, vis, L, inks.stroke, look, 1, 1, params.glow.front, lineAlpha, undefined, undefined, undefined, sScale,
        false, branchRgb(s.theme));
      const [dx, dy] = localDown(s.place.angle + spin * s.place.tierDir, s.place.scale);
      // Leaves keep the halo's size while it curls, then take the tree's.
      const style = styleOf(L, inks, look, 1, lerp(unit, 1, st.look), snap.seed, s.drive, 0, dx, dy, s.theme, s.density, sScale);
      style.sizeMul = lerp(snap.sizeMul, 1, st.look);
      decorateTree(sk, vis, params, style, backDeco, { ids, alpha: decoAlpha });
    },
  };

  // ---- The look a tree keeps (Look presets) --------------------------------------------------------
  // A tree that a look change replaces keeps the look it had while it withers away: its settings of
  // these sections and its take's theme, amount and colours, drawn by swapping them in for that tree
  // only (drawPlant). Frame-wide things (glow, 3D-leaf light, leaf sheen) are the new ones.
  let lookJson = '';
  let lookNow: LookParams | null = null;
  /** The look settings as they were before this frame's changes. */
  let lookBefore: LookParams | null = null;
  const treeLookOf = (s: Slot, lp: LookParams | null): TreeLook | undefined =>
    lp ? { params: lp, theme: s.theme, density: s.density, colour: s.colour, ink: s.ink } : undefined;
  /** Look-preset settings (not Reaction ones) that differ between two settings trees: a Look
   *  preset changes many at once. */
  const countDiff = (a: unknown, b: unknown, path = ''): number => {
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      let n = 0;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
        n += countDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? path + '.' + k : k);
      return n;
    }
    return a === b || kindOf(path) !== 'visual' ? 0 : 1;
  };
  /**
   * Once per step: notice a change of the look settings. Several at once (a Look preset, here or
   * from another viewer) replaces every take's trees at once, the old ones keeping their look. One
   * setting alone (a slider) is live, except a shape setting, which replaces the trees once it rests
   * (the slots loop).
   */
  function trackLook() {
    const j = JSON.stringify(LOOK_SECTIONS.map((k) => params[k]));
    lookBefore = lookNow;
    if (j === lookJson) return;
    const now = Object.fromEntries(LOOK_SECTIONS.map((k) => [k, structuredClone(params[k])])) as unknown as LookParams;
    const before = lookNow;
    lookJson = j;
    lookNow = now;
    if (!before || countDiff(before, now) < 3) return;
    for (const s of slots) {
      if (s.commit) continue;
      s.gens.transition(params, treeLookOf(s, before));
      s.staleFor = 0;
      s.staleSig = undefined;
    }
    // The live halos: the new look sweeps round each one as a wave, from its start point both ways
    // at a steady pace (transitions.lookChangeSeconds), so every shoot changes in its turn; ahead of
    // the wave it is drawn in the look it had (drawHalo). Vine the new look does not keep fades as
    // the wave passes; what it lacks grows as usual. If the new look grows from other origins, the
    // old vine stays as it is, ahead of the wave, and a new one starts from the new origins.
    const lay = (h: LookParams['halo']) => [h.origins, h.startAngle, h.bothWays].join('|');
    for (const h of halos) {
      // Another look change while one still sweeps round: a halo shows two looks at most, so the
      // look that has reached less of the ring gives way to the newest one at once. (Less than half
      // way round: the oldest look stays ahead and the new one sweeps on behind the same front.)
      const w0 = h.wave;
      const keepOld = !!w0 && t - w0.t0 < 0.5 * Math.max(0.3, params.transitions.lookChangeSeconds);
      const r = h.vine.ring;
      const wave: NonNullable<LiveHalo['wave']> = keepOld ? w0!
        : { t0: t, prev: before, prevLook: { ...h.look }, ring: { gone: r.gone.slice(), prev: r.prev.slice(), spacing: r.spacing },
            start: params.halo.startAngle * deg };
      if (lay(before.halo) !== lay(params.halo)) {
        const old = h.vine;
        haloSeed += 1000;
        h.vine = new HaloVine(haloSeed, params);
        h.vine.shed = old.shed; // its falling leaves fall on
        if (!wave.oldVine) {
          // It stays as it is from now on: its tail fade as the older look had it.
          wave.oldVine = old;
          wave.oldAlpha = old.tailAlpha(wave.prev.halo.tailDeg, wave.prev.halo.tailFade).slice();
        } else {
          // The wave already keeps an older vine: the one grown since (behind the front, in the
          // look just replaced) fades out where it was.
          const r2 = old.ring;
          endingHalos.push({
            ...h, vine: old, wave: undefined, endT0: t, endSeconds: Math.max(0.3, params.growth.fadeSeconds),
            ghost: {
              part: {
                kept: before, look: { ...h.look }, vine: old, alpha: old.alpha.slice(),
                ring: { gone: r2.gone.slice(), prev: r2.prev.slice(), spacing: r2.spacing }, start: wave.start, reach: waveReach(wave), ahead: false,
              },
              drawsPool: false,
            },
          });
        }
      }
      h.wave = wave;
    }
  }

  // ---- Simulation ------------------------------------------------------------------------------
  const pauseWilt: Wilt = { action: 'keep', amount: 0 }, endWilt: Wilt = { action: 'keep', amount: 0 };
  function simulate(dt: number, realDt: number): FeatureFrame {
    t += dt;
    trackLook();
    wind.update(dt, params);
    const ff = pickFrame(dt);
    harmony.update(ff.layers, dt, params);
    // Fake singer: plant the live take every n seconds (watch the planting hands-free).
    if (params.fake.autoCommit > 0 && status.feed.startsWith('fake') && t - lastAutoCommit > params.fake.autoCommit) {
      lastAutoCommit = t;
      fake.commit(params);
      fake.dropOldest(params, 4);
    }
    const lives = ff.layers.filter((l) => l.role === 'live' && l.id !== 'live-none');
    const takes = ff.layers.filter((l) => l.role === 'take').slice(0, 16);
    const n = takes.length;
    // growth.fillSpace: how present each take is (a take singing now is here at once).
    const presence = takes.map((l) => {
      const s = slots.find((x) => x.id === l.id);
      return !s || l.level > 0.05 ? 1 : s.presence ?? 1;
    });
    const targets = layoutTakes(n, params, presence);
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
        // What the planting does not take along finishes where the halo was: the older look still
        // ahead of a look change (it fades), and the leaves still falling.
        const w = h.wave;
        if (w || h.vine.shed.busy(t, params.falling.time)) {
          const ov = w?.oldVine;
          endingHalos.push({
            ...h, wave: undefined, endT0: t, endSeconds: w ? Math.max(0.3, params.growth.fadeSeconds) : 0.05,
            ghost: {
              part: w && {
                kept: w.prev, look: w.prevLook, vine: ov ?? h.vine, ring: w.ring, start: w.start, reach: waveReach(w), ahead: true,
                alpha: (ov ? w.oldAlpha ?? ov.alpha : h.vine.tailAlpha(w.prev.halo.tailDeg, w.prev.halo.tailFade)).slice(),
              },
              drawsPool: true,
            },
          });
        }
      } else {
        h.endT0 = t;
        endingHalos.push(h);
      }
    }
    // A new resting halo would sit exactly where the departing ring winds up: let it wait.
    if (started) for (const h of nextHalos) if (!halos.includes(h)) h.spawnT0 = t + 1.7 * Math.max(0.3, params.commit.duration);
    halos = nextHalos;

    const hp = params.halo;
    halos.forEach((h, k) => {
      const f = lives.length ? lives[k] : undefined;
      h.f = f;
      h.drive.update(f, dt, params);
      h.drive.harmony = f ? harmony.amount(f.id) : 0;
      h.motion.update(h.drive, wind, dt, params, 0.6, true);
      // A look change sweeping round: done once the wave has gone round.
      if (h.wave && t - h.wave.t0 > Math.max(0.3, params.transitions.lookChangeSeconds)) h.wave = undefined;
      h.vine.update(dt, h.drive, !!f?.onset, params, h.wave && !h.wave.oldVine ? h.wave.prev.halo.tailDeg : 0);
      // Track colour if the tap asks for it; otherwise the live colour, hue-shifted for each extra
      // live track so nested halos stay distinguishable.
      // The look's palette colours the halo too (so it already has its tree's colour); with your own
      // colours it is the live colour, hue-shifted for each extra live track.
      const haloColour = usesMine() ? hueShift(params.colours.live, k * 55) : paletteColour(h.id);
      const own = f && (f.ink || ((f.colourMode === 'track' || (f.colourMode !== 'ink' && params.source.useTrackColours)) && f.colour));
      h.look = { ...themeOf(f), colour: own ? takeColour(h.id, f) : haloColour, ink: inkOf(f) };
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
    // (kept while its last falling leaves are still falling)
    endingHalos = endingHalos.filter((h) => t - (h.endT0 ?? t) < (h.endSeconds ?? params.transitions.liveEndSeconds)
      || ((!h.ghost || h.ghost.drawsPool) && h.vine.shed.busy(t, params.falling.time)));
    for (const h of endingHalos) if (h.wave && t - h.wave.t0 > Math.max(0.3, params.transitions.lookChangeSeconds)) h.wave = undefined;

    const first = halos[0];
    status.layers = lives.length + ' live + ' + n + (n === 1 ? ' take' : ' takes');
    status.pitch = describePitch(first?.f);
    status.voice = first
      ? 'effort ' + first.drive.effort.toFixed(2) + ' · breath ' + first.drive.breath.toFixed(2) + ' · soft ' + first.drive.softness.toFixed(2)
        + (first.drive.harmony > 0.5 ? ' · in harmony' : '')
      : '–';

    // Plants matched to takes by id: a take keeps its plant when others come and go.
    const next: Slot[] = ids.map((id, k) => {
      const existing = slots.find((s) => s.id === id);
      if (existing) return existing;
      const seed0 = params.fake.seed * 1000 + plantSeed++ * 97 + treeSalt * 7919;
      const slot: Slot = {
        id, gens: undefined as unknown as Generations<Plant>,
        place: { ...targets[k] }, drive: new Drive(), motion: new LayerMotion(seed0), alpha: 0, colour: takeColour(id, takes[k]), ...themeOf(takes[k]),
      };
      // Each tree: plumage from its own seed, gesture (spine) from the take's seed, character from
      // the phrase that grows it.
      slot.gens = new Generations<Plant>((seed, slice) => {
        const plant = new Plant(seed, seed0);
        plant.slice = slice;
        const d = slot.drive;
        plant.mood = { effort: d.effort, pitch: d.pitch, soft: d.softness, vibrato: d.vibrato };
        return plant;
      }, seed0);
      const c = commits.find((x) => x.slotId === id);
      if (c) {
        slot.commit = c;
        slot.gens.regrow(params);
        slot.gens.gens[0].tree.mood = c.snap.mood;
      }
      return slot;
    });
    for (const s of slots) if (!ids.includes(s.id)) dying.push({ slot: s, t0: t });
    slots = next;

    let newBuilds = 0;
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
      s.drive.harmony = harmony.amount(s.id);
      // harmony.cross: lean toward the tree it harmonises with (the trees' edges interlace).
      const mate = s.drive.harmony > 0.003 ? slots.find((x) => x.id === harmony.partner(s.id)) : undefined;
      const toMate = mate ? Math.sign(Math.atan2(Math.sin(mate.place.angle - pl.angle), Math.cos(mate.place.angle - pl.angle))) : 0;
      s.lean = lerp(s.lean ?? 0, toMate * 7 * deg * clamp(params.harmony.cross) * s.drive.harmony, 1 - Math.exp(-dt / 0.4));
      s.motion.update(s.drive, wind, dt, params, 1, false);
      const pending = !!s.commit && s.commit.stampedAt < 0;
      // A change to the trees' shape (a Look preset, a slider, the layout): a tree that has shown is
      // not rebuilt in place. Once the settings have rested for a moment the living trees go the way
      // growth.witherEffect says and new ones grow back to where they were (Generations.transition).
      // (Not while a planting is under way, the strand fading included: it is tied to its tree.)
      const shown = s.gens.gens.find((x) => !x.retired && x.tree.built && x.reveal >= 0.03);
      if (shown && !s.commit && shown.tree.isStale(tg, params)) {
        // The settings have to rest: a slider still moving starts the wait again.
        const sig = shown.tree.sigOf(tg, params);
        if (sig !== s.staleSig) {
          // The look before the change began (a slider still moving keeps the first one).
          if (s.staleSig === undefined) s.staleLook = treeLookOf(s, lookBefore);
          s.staleSig = sig;
          s.staleFor = 0;
        }
        s.staleFor = (s.staleFor ?? 0) + realDt;
        if (s.staleFor > 0.35) {
          s.gens.transition(params, s.staleLook);
          s.staleFor = 0;
          s.staleSig = undefined;
        }
      } else {
        s.staleFor = 0;
        s.staleSig = undefined;
      }
      if (!pending) s.gens.update(s.drive, dt, params);
      for (const g of s.gens.gens) {
        // Just planted: the rest of the tree grows out from the limbs quickly, then as usual.
        g.tree.boost = s.stampT !== undefined ? 1 + 2.5 * Math.exp(-(t - s.stampT) / 0.8) : 1;
        // One new tree built per step: when several takes start a phrase together, the others wait
        // a frame (invisible) instead of making one long frame the growth then catches up on.
        if (!g.tree.built && newBuilds >= 1) continue;
        // Only a tree that has not shown yet is (re)built; one that has keeps its shape (a look change
        // replaces it instead, above).
        const frozen = g.tree.built && (g.retired || g.reveal >= 0.03);
        // growth.fillSpace across takes: a tree grows into the territory of its take as handed out
        // now (wider while a neighbour is away), but only where trees are replaced as the song goes
        // on (a tree that stays for good would keep the space when the neighbour comes back). The
        // boughs of a take share one territory until all of them are gone (their slices are
        // fractions of it).
        let tgB = tg;
        const replaced = (params.growth.newTreeEachPhrase || params.growth.branchEachPhrase) && !params.look.woodStays;
        if (!replaced) tgB = { ...tg, growLo: undefined, growHi: undefined };
        else if (g.bough) {
          if (!s.growFrozen || !s.gens.gens.some((x) => x.bough && !x.retired && x.tree.built && x !== g))
            s.growFrozen = [tg.growLo ?? tg.sectorLo, tg.growHi ?? tg.sectorHi];
          tgB = { ...tg, growLo: s.growFrozen[0], growHi: s.growFrozen[1] };
        }
        if (!frozen && g.tree.ensureBuilt(tgB, params, blocked, n, true)) newBuilds++;
        // A replaced tree keeps its withered twigs while it ends (they no longer grow back).
        const stays = params.look.woodStays;
        // The wood stays: pauses and endings touch nothing (pauses shake leaves loose below instead),
        // except on a tree that is being replaced (a look change).
        if (stays && !g.retired) g.tree.computeReveal(g.reveal, s.drive.pitch, params, dt, t);
        else {
          pauseWilt.action = endActionOf(params.growth, params.growth.onPause);
          pauseWilt.amount = g.wither;
          endWilt.action = g.endAction ?? 'keep';
          endWilt.amount = g.end ?? 0;
          g.tree.computeReveal(g.reveal, s.drive.pitch, params, dt, t, pauseWilt, endWilt);
        }
        if (params.look.leafFall > 0) {
          // Leaves fall on their own: a trickle, much more while trembling (vibrato) and in pauses.
          const shake = params.motion.leafShake * clamp(s.drive.vibrato * 1.5, 0, 1.5);
          const pause = stays ? g.wither : 0;
          g.tree.fallLeaves(dt, params.look.leafFall * (0.12 + 0.9 * shake + 0.5 * pause), params.look.leafRegrow);
        }
      }
      s.alpha = pending ? 0 : Math.min(1, s.alpha + realDt * 2);
      // Away: silent, nothing of its tree left, no planting under way. After 2 s away its space
      // starts to go to its neighbours (growth.fillSpace), over 1.5 s; back at once when it sings.
      const here = s.drive.voice || pending || s.gens.gens.some((g) =>
        g.retired ? g.alpha * (g.dim ?? 1) > 0.02 : !((g.end ?? 0) >= 1 && g.endAction !== undefined && g.endAction !== 'keep'));
      s.awayFor = here ? 0 : (s.awayFor ?? 0) + dt;
      s.presence = 1 - smooth(clamp((s.awayFor - 2) / 1.5));
      s.colour = takeColour(s.id, f);
      s.ink = inkOf(f);
      Object.assign(s, themeOf(f));
    });
    if (n >= params.layout.spinFrom) spin += params.layout.spinSpeed * deg * dt;

    // Planting: the hand-over from the unrolled fronds to the tree.
    for (const c of commits) {
      const s = slots.find((x) => x.id === c.slotId);
      if (c.step(t, s ? targetOf(s, 0) : undefined) && s) {
        s.stampT = t;
        const g = s.gens.current ?? s.gens.gens[s.gens.gens.length - 1];
        if (g) {
          // Fully grown: the limbs the fronds lie on are there, the rest grows out from them.
          g.reveal = 1;
          c.revealLimbs(g.tree);
        }
        // From here it is a tree whose phrase has just ended: lit, then resting, then ending the
        // way growth.onPhraseEnd says (its take singing again starts a new tree, as usual).
        s.drive.silentFor = 0;
      }
    }
    commits = commits.filter((c) => {
      if (!c.done) return true;
      for (const s of slots) if (s.commit === c) s.commit = undefined;
      return false;
    });

    dying = dying.filter((d) => t - d.t0 < params.transitions.pruneSeconds);
    prunePalette();
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
      const angle = pl.angle + spin * pl.tierDir + (s.lean ?? 0);
      const weave = clamp(params.harmony.cross) * s.drive.harmony;
      const slotL = layer, look0 = look;
      const drawGen = (g: (typeof s.gens.gens)[number]) => {
        // Inks per tree: a tree that keeps an older look has its own colours (drawn with them swapped in).
        const inks = inksFor(slotL, hexToRgb(s.colour), Math.max(0, slots.indexOf(s)), s.drive, false, s.ink, s.id);
        // Every take colour glows about equally: yellow-green would otherwise clip long before blue.
        const base = inks.stroke.mid;
        const luma = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
        const look = { ...look0, glow: look0.glow * clamp(0.5 / Math.max(0.05, luma), 0.65, 1.4) };
        const take = hexToRgb(s.colour), kTake = Math.max(0, slots.indexOf(s));
        let a = alpha * g.alpha * (g.dim ?? 1), L = slotL, gInks = inks, ang = angle;
        const dry = g.dry ?? 0, gfall = g.fall ?? 0;
        if (g.bough && dry > 0 && layer < MAX_LAYERS - 5) {
          // An old bough (branch per phrase) in its own layer: it dries, droops about the point
          // where it starts (leaves the hub), then drops and fades (consult 6, 3.4).
          L = ++layer;
          const spinA = spin * pl.tierDir;
          const path = g.tree.limbPaths[0];
          let ox = pl.ox, oy = pl.oy;
          if (path) {
            const q0 = g.tree.limbAt(0, path.base), q1 = g.tree.limbAt(0, path.length);
            const [px, py] = toWorld(q0.x, q0.y, pl, spinA);
            const [tx, ty] = toWorld(q1.x, q1.y, pl, spinA);
            // Down: it droops toward the ground while it dries, then lets go and keeps turning that
            // way as it falls. Away (growth.fallDirection): no gravity, no droop; it drifts straight
            // out, away from the point it grew from.
            const away = params.growth.fallDirection === 'away';
            const dirA = Math.atan2(ty - py, tx - px);
            let toT = Math.atan2(Math.sin(-Math.PI / 2 - dirA), Math.cos(-Math.PI / 2 - dirA));
            // Pointing straight up: turn outward, away from the head.
            if (Math.abs(toT) > 2.8) toT = Math.abs(toT) * (tx >= params.avatar.headX ? -1 : 1);
            const droop = away ? 0 : Math.min(Math.abs(toT), params.growth.branchDroopDeg * deg);
            const e = dry * dry; // slow start
            const delta = away ? 0 : Math.sign(toT) * (droop * (0.85 * e + 0.15 * gfall) + (Math.abs(toT) - droop) * 0.6 * smooth(gfall));
            const c = Math.cos(delta), s2 = Math.sin(delta);
            const fs = gfall * params.growth.branchFallSeconds; // seconds falling
            const ux = Math.cos(dirA), uy = Math.sin(dirA); // along the bough: away from where it grew
            const out = 0.25 * fs + 0.25 * fs * fs;
            ox = px + c * (pl.ox - px) - s2 * (pl.oy - py) + (away ? ux * out : 0.06 * Math.sign(tx - px) * gfall);
            oy = py + s2 * (pl.ox - px) + c * (pl.oy - py) + (away ? uy * out : -0.5 * 1.8 * fs * fs); // gravity 1.8 units / s²
            ang = angle + delta;
          }
          layerU.set(L, ox, oy, ang, pl.scale, s.motion);
          a *= 1 - smooth(gfall);
          gInks = inksFor(L, take, kTake, s.drive, false, s.ink, s.id);
          const dryRgb = hexToRgb(params.look.dryColour);
          for (const ink of [gInks.stroke, gInks.leaf, gInks.accent]) {
            ink.tint = [lerp(ink.tint[0], dryRgb[0], dry), lerp(ink.tint[1], dryRgb[1], dry), lerp(ink.tint[2], dryRgb[2], dry)];
            ink.tintK = lerp(ink.tintK, 0.75, dry);
          }
        }
        const [dx, dy] = localDown(ang, pl.scale);
        const sScale = 1 / Math.max(1e-3, g.tree.maxFlex);
        // In harmony the branches weave across each other (harmony.cross).
        const sk = g.tree.woven(weave, t);
        pushTree(back, sk, g.tree.vis, L, gInks.stroke, look, a, 1, params.glow.front, g.tree.life, g.tree.tone, g.tree.swing, g.tree.bend, sScale,
          false, branchRgb(s.theme), {
            phase: g.tree.twistPhase, strands: params.plants.strands, depth: params.plants.twistDepth,
            // Just after a planting the frond (one stroke) splits into strands under the flash.
            k: s.stampT !== undefined ? clamp((t - s.stampT) / 0.3, 0, 1) : 1,
          });
        // Pieces that broke off (fall away): taken over with the colours they had, then drawn falling.
        takeDrops(g.tree, sk, gInks.stroke, look, a, sScale, branchRgb(s.theme));
        const [hx, hy] = g.tree.originLocal();
        g.tree.twigs.draw(back, L, a * fadeOf(look), dx, dy, t, dryRgbOf(), params.growth.fallDirection === 'away', hx, hy);
        decorateTree(sk, g.tree.vis, params,
          { ...styleOf(L, gInks, look, a, 1, g.seed, s.drive, fall, dx, dy, s.theme, s.density, sScale), originX: hx, originY: hy }, backDeco,
          { alpha: g.tree.leafLife, rank: g.tree.leafRank, tone: g.tree.tone, under: backUnder, order: g.tree.swing, bend: g.tree.bend,
            leafState: g.tree.leafState, leafGone: params.look.leafFall > 0 ? g.tree.leafGone : undefined, dt: drawDt, branchId: g.tree.branchId, branchDone: g.tree.branchDone, branchFront: g.tree.branchFront,
            shed: g.tree.shed, now: t, bloomState: g.tree.bloomState, retracting: g.tree.retracting, dry, dropped: g.tree.dropped });
      };
      for (const g of s.gens.gens) {
        const tl = g.look as TreeLook | undefined;
        if (tl) withLook(tl, s, () => drawGen(g));
        else drawGen(g);
      }
    };
    /** Draw with a tree's kept look swapped in (its settings sections and its take's appearance). */
    const withLook = (tl: TreeLook, s: Slot, draw: () => void) => {
      const keep = { theme: s.theme, density: s.density, colour: s.colour, ink: s.ink };
      Object.assign(s, { theme: tl.theme, density: tl.density, colour: tl.colour, ink: tl.ink });
      try {
        withParams(tl.params, draw);
      } finally {
        Object.assign(s, keep);
      }
    };
    /** Draw with older look settings swapped in (a tree or halo a Look preset is replacing). */
    const withParams = (lp: LookParams, draw: () => void) => {
      const p = params as unknown as Record<string, unknown>, saved: Record<string, unknown> = {};
      for (const k of LOOK_SECTIONS) {
        saved[k] = p[k];
        p[k] = lp[k];
      }
      try {
        draw();
      } finally {
        for (const k of LOOK_SECTIONS) p[k] = saved[k];
      }
    };

    // Take plants. A plant being planted is not drawn until the hand-over; then it fades in under
    // the fading strand.
    if (drawTrunk(layer)) layer++;
    const slotLayer = new Map<string, number>();
    slots.forEach((s) => {
      if (layer >= MAX_LAYERS) return;
      const pl = s.place;
      layerU.set(layer, pl.ox, pl.oy, pl.angle + spin * pl.tierDir + (s.lean ?? 0), pl.scale, s.motion);
      slotLayer.set(s.id, layer);
      if (!(s.commit && s.commit.stampedAt < 0)) drawPlant(s, s.alpha, lookOf(s.drive), 0);
      layer++;
    });
    plantLayerCount = layer;

    // Deleted takes: a brief flash, then the plant fades away while its leaves fall.
    dying.forEach((d) => {
      if (layer >= MAX_LAYERS) return;
      const u = clamp((t - d.t0) / Math.max(0.05, params.transitions.pruneSeconds));
      const pl = d.slot.place;
      layerU.set(layer, pl.ox, pl.oy, pl.angle + spin * pl.tierDir, pl.scale, d.slot.motion);
      const look = { ...lookOf(d.slot.drive), glow: params.glow.base + 0.5 * Math.max(0, 1 - u * 4) };
      drawPlant(d.slot, 1 - smooth(u), look, Math.min(1, u * 1.2));
      layer++;
    });

    // Live halos (in front of the plants): small on the head unless recording; several live tracks
    // nest concentrically. A new one pops in; one whose track stopped being live fades out.
    const hp = params.halo;
    const drawHalo = (h: LiveHalo, fade: number) => {
      if (layer >= MAX_LAYERS) return;
      const hp = params.halo; // read here: a halo being replaced draws with its own (withParams)
      const spawn = Math.max(0.001, easeOutBack(clamp((t - h.spawnT0) / Math.max(0.05, hp.spawnSeconds))));
      const R = h.R * spawn;
      // Squish and tilt are for the small resting halo only; the recording halo opens round.
      const idle = 1 - smooth(clamp(h.open));
      layerU.set(layer, h.cx, h.cy, Math.PI / 2 + hp.tilt * deg * idle, R, h.motion, 1 - clamp(hp.squish, 0, 0.95) * idle);
      const wave = h.wave;
      const v = h.vine;
      let style: DecoStyle | undefined;
      /** Draw in another look: its settings and appearance swapped in. */
      const inLook = (kept: LookParams, lk: LiveHalo['look'], draw: () => DecoStyle) => {
        const keep = h.look;
        h.look = lk;
        try {
          withParams(kept, () => (style = draw()));
        } finally {
          h.look = keep;
        }
      };
      const g = h.ghost;
      if (g) {
        // Part of a halo finishing on its own (planted, or its vine replaced): masked as the wave
        // left it, in its look, fading (its leaves let go as it does).
        const pt = g.part;
        if (pt) {
          const mask = pt.ahead ? (a: number) => 1 - frontAt(pt.start, pt.reach - WAVE_W, a) : (a: number) => frontAt(pt.start, pt.reach, a);
          inLook(pt.kept, pt.look, () => drawHaloLook(h, fade, R, pt.vine, pt.alpha, mask, { la: pt.alpha, gone: pt.vine.gone, ring: pt.ring, shed: v.shed }));
        }
        if (g.drawsPool) drawShed(v.shed, frontDeco, style ?? haloStyle(h, fade, R, v).style, t, params, fadeOf(lookOf(h.drive)));
        layer++;
        return;
      }
      if (!wave) style = drawHaloLook(h, fade, R, v, v.alpha, undefined, { la: v.alpha, ring: v.ring, track: true });
      else {
        // A Look preset sweeping round from the start point both ways at a steady pace: behind the
        // front the new look, ahead of it the older one (its settings and appearance swapped in).
        // The new look is drawn over the older one: the older stays whole until the new one is
        // whole above it (no see-through band at the front), then goes.
        const reach = waveReach(wave), start = wave.start;
        const m = (a: number) => frontAt(start, reach, a), mo = (a: number) => 1 - frontAt(start, reach - WAVE_W, a);
        const ov = wave.oldVine;
        const oldAlpha = ov ? (wave.oldAlpha ?? ov.alpha) : v.tailAlpha(wave.prev.halo.tailDeg, wave.prev.halo.tailFade);
        // growth.shed: a node's leaves let go once what shows of it fades half way. Both looks with
        // leaves on one vine: what the two show together, let go by the look showing more of it.
        // Otherwise each look's own (an older vine goes with the wave; the new one is only hidden).
        const leafy = (lk: LiveHalo['look']) => lk.theme !== 'branches' && lk.density > 0;
        const oSk = ov ? ov.sk : v.sk;
        const shared = !ov && leafy(wave.prevLook) && leafy(h.look);
        if (waveLa.length < oSk.n) {
          const n2 = oSk.n * 2;
          waveLa = new Float32Array(n2);
          waveOld = new Uint8Array(n2);
          waveNew = new Uint8Array(n2);
        }
        for (let i = 0; i < oSk.n; i++) {
          const a = Math.atan2(oSk.y[i], oSk.x[i]);
          const so = oldAlpha[i] * mo(a);
          if (!shared) {
            waveLa[i] = so;
            continue;
          }
          const sn = v.alpha[i] * m(a), below = so * (1 - sn);
          waveLa[i] = sn + below;
          waveOld[i] = below >= sn ? 1 : 0;
          waveNew[i] = 1 - waveOld[i];
        }
        inLook(wave.prev, wave.prevLook, () => drawHaloLook(h, fade, R, ov ?? v, oldAlpha, mo,
          { la: waveLa, mine: shared ? waveOld : undefined, gone: ov?.gone, ring: wave.ring, shed: v.shed }));
        style = drawHaloLook(h, fade, R, v, v.alpha, m,
          { la: shared ? waveLa : v.alpha, mine: shared ? waveNew : undefined, ring: v.ring, track: true });
      }
      // growth.shed: the leaves that let go (either look), once; each keeps the opacity it had when
      // it let go, and how it falls.
      drawShed(v.shed, frontDeco, style!, t, params, fadeOf(lookOf(h.drive)));
      layer++;
    };
    /** A halo's decoration style in the current look. */
    const haloStyle = (h: LiveHalo, fade: number, R: number, vine: HaloVine) => {
      const hp = params.halo;
      const inks = inksFor(layer, hexToRgb(h.look.colour), Math.max(0, halos.indexOf(h)), h.drive, true, h.look.ink, h.id);
      const look = lookOf(h.drive);
      // More origins = more vine, so fewer leaves on each part of it.
      const origins = Math.max(1, Math.round(hp.origins));
      const style = styleOf(layer, inks, look, fade, R, vine.seed, h.drive, 0, 0, -1 / R, h.look.theme, h.look.density / origins);
      style.sizeMul = Math.pow(clamp(R / Math.max(0.05, hp.openRadius), 0.25, 1), 0.7);
      return { style, inks, look };
    };
    let haloMask = new Float32Array(0), waveLa = new Float32Array(0), waveOld = new Uint8Array(0), waveNew = new Uint8Array(0);
    /** One look of a halo into the current layer: its ring, vine and leaves, where `mask` (per ring
     *  angle) shows them; returns its decoration style. `lg` (growth.shed): per node how much
     *  shows (la; its leaves let go below one half) and whether this pass lets them go (mine); the
     *  ring's let-go state and whether this pass keeps it (track). The caller draws the pool. */
    const drawHaloLook = (h: LiveHalo, fade: number, R: number, vine: HaloVine, alpha: ArrayLike<number>,
                          mask: ((angle: number) => number) | undefined,
                          lg: { la: ArrayLike<number>; mine?: ArrayLike<number>; gone?: Set<number>; ring: RingLetGo; track?: boolean; shed?: ShedPool }) => {
      const hp = params.halo;
      const { style, inks, look } = haloStyle(h, fade, R, vine);
      // In harmony the ring braids (harmony.cross): its two strands cross and recross.
      pushRing(front, layer, inks.stroke, look, fade, R, h.drive.energy, clamp(params.harmony.cross) * h.drive.harmony, mask);
      let na: ArrayLike<number> = alpha;
      if (mask) {
        const n = vine.sk.n;
        if (haloMask.length < n) haloMask = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) haloMask[i] = alpha[i] * mask(Math.atan2(vine.sk.y[i], vine.sk.x[i]));
        na = haloMask;
      }
      pushTree(front, vine.sk, vine.vis, layer, inks.stroke, look, fade, R, params.glow.front, na, undefined, vine.order, vine.bend, 1, true,
        branchRgb(h.look.theme));
      const shed = lg.shed ?? vine.shed;
      decorateTree(vine.sk, vine.vis, params, style, frontDeco, {
        ids: vine.ids, alpha: na, order: vine.order, bend: vine.bend, leafGrow: vine.leaf,
        // growth.shed: leaves let go as the tail (or the whole halo) fades; the pool keeps them falling.
        letGone: lg.gone ?? vine.gone, letGoAlpha: lg.la, letGoMine: lg.mine, letGoAll: fade, shed, now: t, shedDrawnElsewhere: true,
      });
      decorateRing(params, { ...style, density: h.look.density }, (a) => vine.coverage(a, params), frontDeco, hp.alwaysLeaves,
        { mask, ring: lg.ring, track: lg.track, shed, whole: fade, now: t });
      return style;
    };
    halos.forEach((h) => drawHalo(h, 1));
    // Planting: the strand is drawn in its take's layer.
    for (const c of commits) {
      const s = slots.find((x) => x.id === c.slotId);
      const L = s ? slotLayer.get(s.id) : undefined;
      c.draw(t, s && L !== undefined ? targetOf(s, L) : undefined, commitHooks);
    }
    endingHalos.forEach((h) => {
      const fade = 1 - smooth(clamp((t - (h.endT0 ?? t)) / Math.max(0.05, h.endSeconds ?? params.transitions.liveEndSeconds)));
      drawHalo(h, fade);
    });

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
    Object.assign(glowArgs, params.glow, { sheen: params.look.leafSheen, sheenColour: params.look.sheenColour, leaf3d: params.look.leaf3d, leaves3d: params.leaves3d });
    renderer.render(batches, layerU, view, wind.t, glowArgs);
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
  let typical = 1 / 60; // s between drawn frames, smoothed
  let activeUntil = last + IDLE_HOLD;
  let obsVisible = true;
  let contextLost = false;
  let shownFps = 0, fpsCount = 0, fpsSince = last;
  // Timing (sprout.perf()): average ms per frame of each phase over the last ~2 s.
  const perf = { sim: 0, build: 0, gpu: 0, frames: 0 };
  const perfAdd = (k: 'sim' | 'build' | 'gpu', ms: number) => (perf[k] += (ms - perf[k]) * 0.02);

  // OBS tells the page when the source is not shown anywhere.
  if (inObs) window.addEventListener('obsSourceVisibleChanged', (e) => {
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
    if (!inObs && !document.hasFocus()) fps = Math.min(fps, pf.backgroundFps);
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
      // A stall (a tree being built, garbage collection) is not caught up beyond half a frame
      // more than expected: the growth would visibly jump. Low frame rates still run in real time.
      // (`typical` follows the real frame interval, so a browser that runs slower than the
      // measured refresh rate is still simulated in real time.)
      const raw = Math.min(MAX_CATCHUP, (now - last) / 1000);
      const expected = Math.max((n * vsync) / 1000, typical);
      typical += (raw - typical) * 0.1;
      const elapsed = clamp(raw, 0, Math.max(expected * 1.5, 1 / 40));
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
    halos: () => halos,
    commits: () => commits,
    view: () => lastView,
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
      commits: commits.map((c) => ({ slot: c.slotId, handedOverAt: +c.stampedAt.toFixed(2), aborted: c.abortedAt >= 0 })),
      instances: { backUnder: backUnder.count, back: back.count, backDeco: backDeco.count, front: front.count, frontDeco: frontDeco.count },
    }),
  };

  // ?perflog: one line every 10 s in the console (OBS: its log, or remote debugging), for measuring.
  if (query.has('perflog'))
    setInterval(() => console.info('sprout perf ' + JSON.stringify((window as unknown as { sprout: { perf(): unknown } }).sprout.perf())), 10000);
  requestAnimationFrame(frame);
}
