// Tweak panel, generated from `params`: every value in params.ts gets a control automatically,
// grouped by panel-layout.ts (artist folders, then setup folders; keys not listed there still
// appear). RANGES sets slider limits so the full travel of each slider makes a visible difference;
// typed values may go beyond them. Labels come from panel-layout.ts, tooltips from the doc
// comments in params.ts. Presets (presets.ts): built-in looks, saved looks, a revert button on
// every changed row (to the active preset; Shift-click: the factory default).

import { toggleSheet } from './hotkeys';
import { ButtonApi, FolderApi, ListBladeApi, Pane, TabPageApi } from 'tweakpane';
import { defaults, Params } from './params';
import paramsSource from './params.ts?raw';
import { FOLDER_HINTS, FOLDERS, FolderSpec, LABELS, MACROS, macroPos, macroValue, MOVEMENTS, TIPS } from './panel-layout';
import { installTooltips, tip } from './tooltip';
import { installSelectMenus } from './select-menu';
import { GradientEditor } from './gradient-editor';
import { allThemes } from './themes';
import { setPath } from './presets';
import {
  applyPreset, BUILTINS, diffOf, getPath, isDirty, Kind, KIND_TITLES, kindOf, KINDS, loadStore, PATHS, presetValue, Preset,
  PresetStore, same, saveStore, slug, STORE_KEY, Values,
} from './presets';

const STORAGE_KEY = 'sprout.viewer.params.v2';

type Spec = { min?: number; max?: number; step?: number; options?: Record<string, string | number>; gradient?: boolean };

/** Hard limits for typed values: a typed number may go past a slider's range (the slider stretches
 *  to fit it), except past these, where the viewer would break (counts that size arrays, the port,
 *  shapes that flip over). */
const HARD: Record<string, [number, number]> = {
  'source.port': [1, 65535],
  'scene.layers': [1, 17],
  'scene.scopeLayer': [0, 16],
  'layout.tierFrom': [1, 99],
  'layout.spinFrom': [1, 99],
  'halo.origins': [1, 32],
  'halo.sproutLength': [3, 400],
  'halo.squish': [0, 0.95],
  'plants.maxNodes': [50, 20000],
  'plants.step': [0.005, 1],
  'commit.burst': [0, 500],
  'commit.limbs': [1, 4],
  'fake.liveTracks': [1, 6],
  'growth.branchesKept': [1, 6],
  'plants.strands': [1, 3],
  'plants.strandLay': [1, 100],
  'plants.twistLength': [0.03, 5],
  'perf.fps': [1, 240],
  'perf.idleFps': [1, 240],
  'perf.backgroundFps': [1, 240],
  'perf.maxMegapixels': [0.1, 33],
  'perf.renderScale': [0.1, 2],
};
/** The range a typed value may take: HARD, else never below 0 for sliders that start at 0 or
 *  above (durations, sizes, amounts), and no upper limit. */
export function hardRange(path: string, spec: { min?: number; max?: number; step?: number }): [number, number] {
  if (HARD[path]) return HARD[path];
  const lo = spec.min === undefined || spec.min < 0 ? -Infinity
    : spec.min > 0 ? ((spec.step ?? 0) >= 1 ? Math.max(1, Math.ceil(spec.min * 0.1)) : spec.min * 0.1) : 0;
  return [lo, Infinity];
}
/** Let a slider's typed value go past its range: a capture listener on the text field clamps the
 *  number to hardRange and stretches the slider first (tweakpane clamps to the slider's range). */
export function allowTypedBeyond(api: { element: HTMLElement; min?: number; max?: number }, path: string, spec: { min?: number; max?: number; step?: number }) {
  if (!('min' in api) || spec.min === undefined || spec.max === undefined) return;
  const [lo, hi] = hardRange(path, spec);
  api.element.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (!(input instanceof HTMLInputElement)) return;
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    const c = Math.min(hi, Math.max(lo, v));
    if (c !== v) input.value = String(c);
    stretch(api, spec, c);
  }, true);
}
/** Slider range = the spec's range, widened to hold v. */
export function stretch(api: { min?: number; max?: number }, spec: { min?: number; max?: number }, v: number) {
  if (spec.min === undefined || spec.max === undefined || !Number.isFinite(v)) return;
  const mn = Math.min(spec.min, v), mx = Math.max(spec.max, v);
  if (api.min !== mn) api.min = mn;
  if (api.max !== mx) api.max = mx;
}

const RANGES: Record<string, Spec> = {
  'source.mode': { options: { 'Auto (live when connected)': 'auto', 'Live taps only': 'live', 'Fake singer': 'fake' } },
  'source.port': { min: 1, max: 65535, step: 1 },
  'source.holdSeconds': { min: 0, max: 10 },
  'scene.layers': { min: 1, max: 17, step: 1 },
  'scene.timeScale': { min: 0, max: 4 },
  'scene.viewRadius': { min: 1, max: 3.5 },
  'scene.centerX': { min: -1.5, max: 1.5 },
  'scene.centerY': { min: -1.5, max: 1.5 },
  'scene.scopeLayer': { min: 0, max: 16, step: 1 },
  'scene.scopeSeconds': { min: 3, max: 40, step: 1 },
  'scene.backdrop': { options: { 'Checker (dark)': 'checker', 'Checker (light)': 'checker-light', 'Checker (half dark, half light)': 'checker-split', Black: 'black', White: 'white', 'None (transparent)': 'none' } },
  'growth.secondsToFull': { min: 0.5, max: 15 },
  'growth.branching': { min: 0, max: 1 },
  'growth.reach': { min: 0.4, max: 1.6 },
  'growth.restBrightness': { min: 0, max: 1 },
  'growth.spread': { min: 0.4, max: 2 },
  'growth.flatten': { min: 0, max: 1 },
  'plants.clearance': { min: 0.02, max: 0.12 },
  'look.variety': { min: 0, max: 1 },
  'look.depthShade': { min: 0, max: 1 },
  'layout.shrinkPerTake': { min: 0, max: 0.15 },
  'plants.lift': { min: -1, max: 1 },
  'plants.wildness': { min: 0, max: 1 },
  'plants.overlap': { min: 0, max: 1 },
  'plants.taper': { min: 0, max: 1 },
  'plants.softDroop': { min: 0, max: 2 },
  'layout.downGap': { min: 0, max: 200 },
  'growth.witherDipSemitones': { min: 1, max: 12, step: 1 },
  'growth.witherDepth': { min: 0.05, max: 1.5 },
  'growth.witherSeconds': { min: 0.1, max: 5 },
  'growth.twigFadeSeconds': { min: 0.05, max: 3 },
  'growth.regrowSpeed': { min: 0.2, max: 5 },
  'growth.fadeAfter': { min: 0, max: 15 },
  'growth.dieAfter': { min: 0, max: 15 },
  'look.leafFall': { min: 0, max: 1 },
  'look.leafSheen': { min: 0, max: 1 },
  'look.leafRegrow': { min: 0.5, max: 10 },
  'motion.leafShake': { min: 0, max: 2 },
  'plants.twist': { min: 0, max: 1 },
  'plants.gnarl': { min: 0, max: 1 },
  'plants.curl': { min: 0, max: 1 },
  'plants.strands': { min: 1, max: 3, step: 1 },
  'plants.twistLength': { min: 0.15, max: 0.8 },
  'plants.twistTighten': { min: 0, max: 1 },
  'plants.twistTwigs': { min: 0, max: 2 },
  'plants.knots': { min: 0, max: 1 },
  'plants.twistDepth': { min: 0, max: 1 },
  'plants.strandLay': { min: 4, max: 20 },
  'plants.twistVoice': { min: 0, max: 2 },
  'motion.writhe': { min: 0, max: 1 },
  'motion.writheVoice': { options: { Always: 'none', Vibrato: 'vibrato', Effort: 'effort', Loudness: 'loudness' } },
  'halo.braid': { min: 0, max: 1 },
  'halo.twist': { min: 0, max: 1 },
  'glow.shadow': { min: 0, max: 1 },
  'glow.tintFlat': { min: 0, max: 1 },
  'growth.ending': { options: { 'Wither away': 'wither', 'Fade away': 'fade', 'Both': 'both' } },
  'growth.fadeSeconds': { min: 0.2, max: 10 },
  'response.release': { min: 0.1, max: 8 },
  'response.phraseGap': { min: 0.1, max: 2 },
  'response.variety': { min: 0, max: 1 },
  'response.pitchSteer': { min: 0, max: 1 },
  'response.effortWidth': { min: 0, max: 2 },
  'response.brightness': { min: 0, max: 1 },
  'look.themeFrom': { options: { 'Used (Sprout Tap overrides)': 'tracks', 'Ignored (this look for every track)': 'preset' } },
  'look.theme': { options: { Branches: 'branches', Leaves: 'leaves', Thorns: 'thorns', 'Christmas wreath': 'wreath' } },
  'look.density': { min: 0, max: 1 },
  'look.tintAmount': { min: 0, max: 1 },
  'look.blossomHold': { min: 0, max: 5 },
  'look.decoSize': { min: 0.2, max: 4 },
  'look.decoGlow': { min: 0, max: 1.5 },
  'look.blossoms': { min: 0, max: 1 },
  'look.thornEffort': { min: 0, max: 3 },
  'halo.restRadius': { min: 0.05, max: 1 },
  'halo.restY': { min: -1, max: 1.5 },
  'halo.openRadius': { min: 0.3, max: 2 },
  'halo.openY': { min: -1, max: 1.5 },
  'halo.ringWidth': { min: 0, max: 0.04 },
  'halo.vineWidth': { min: 0, max: 0.03 },
  'halo.sproutWidth': { min: 0, max: 0.03 },
  'halo.wander': { min: 0, max: 0.4 },
  'halo.sproutLength': { min: 2, max: 40, step: 1 },
  'halo.sproutCurl': { min: 0, max: 3 },
  'halo.sproutGrow': { min: 0.05, max: 3 },
  'halo.startAngle': { min: -180, max: 180 },
  'halo.origins': { min: 1, max: 8, step: 1 },
  'halo.idleSpeed': { min: 0, max: 60 },
  'halo.singSpeed': { min: 0, max: 240 },
  'halo.tailDeg': { min: 30, max: 720 },
  'halo.tailFade': { min: 0.05, max: 1 },
  'halo.sproutRate': { min: 0, max: 15 },
  'halo.alwaysLeaves': { min: 0, max: 1 },
  'halo.spawnSeconds': { min: 0.1, max: 4 },
  'plants.step': { min: 0.01, max: 0.1 },
  'plants.tipWidth': { min: 0.001, max: 0.03 },
  'plants.maxWidth': { min: 0.005, max: 0.12 },
  'plants.maxNodes': { min: 100, max: 5000, step: 1 },
  'layout.lowOriginY': { min: -1.5, max: 1 },
  'layout.midOriginY': { min: -1.5, max: 1 },
  'layout.tierFrom': { min: 3, max: 17, step: 1 },
  'layout.innerScale': { min: 0.3, max: 1 },
  'layout.spinFrom': { min: 1, max: 17, step: 1 },
  'layout.spinSpeed': { min: -180, max: 180 },
  'layout.ease': { min: 0.2, max: 10 },
  'transitions.liveEndSeconds': { min: 0.1, max: 5 },
  'halo.ringSpacing': { min: 0.03, max: 0.4 },
  'fake.liveTracks': { min: 1, max: 4, step: 1 },
  'commit.duration': { min: 0.6, max: 1.6 },
  'commit.impact': { min: 0, max: 2 },
  'commit.stampReveal': { min: 0.2, max: 1 },
  'commit.burst': { min: 0, max: 80, step: 1 },
  'commit.syncWindow': { min: 0, max: 0.5 },
  'commit.plunge': { min: 0.1, max: 0.5 },
  'commit.spinTurns': { min: 0, max: 2 },
  'transitions.pruneSeconds': { min: 0.3, max: 5 },
  'avatar.opacity': { min: 0, max: 1 },
  'avatar.headX': { min: -1, max: 1 },
  'avatar.headY': { min: -1, max: 1 },
  'avatar.headR': { min: 0, max: 1 },
  'avatar.bodyTopY': { min: -2, max: 1 },
  'avatar.bodyBottomY': { min: -4, max: 0 },
  'avatar.bodyR': { min: 0, max: 1.5 },
  'motion.swayDeg': { min: 0, max: 25 },
  'motion.idle': { min: 0, max: 1 },
  'motion.speed': { min: 0.25, max: 3 },
  'motion.kickDeg': { min: 0, max: 20 },
  'motion.springiness': { min: 0, max: 1 },
  'motion.twigs': { min: 0, max: 2.5 },
  'motion.flutterDeg': { min: 0, max: 40 },
  'motion.shiverDeg': { min: 0, max: 12 },
  'motion.shiverSensitivity': { min: 0, max: 4 },
  'halo.squish': { min: 0, max: 0.85 },
  'halo.restX': { min: -1, max: 1 },
  'halo.tilt': { min: -45, max: 45 },
  'avatar.imageX': { min: -2, max: 2 },
  'avatar.imageY': { min: -3, max: 2 },
  'avatar.imageHeight': { min: 0.5, max: 8 },
  'colBranch.source': { options: { 'Track colour': 'take', 'Theme colour': 'theme', Gradient: 'gradient' } },
  'colBranch.gradient': { gradient: true },
  'palette.list': { gradient: true },
  'colBranch.takeMix': { min: 0, max: 1 },
  'colBranch.along': { min: -2, max: 2 },
  'colBranch.speed': { min: -1, max: 1 },
  'colBranch.voice': { options: { Nothing: 'none', Pitch: 'pitch', Loudness: 'loudness', Effort: 'effort', Airiness: 'breath', Vibrato: 'vibrato', 'Note starts': 'flash' } },
  'colBranch.voiceAmount': { min: -1, max: 1 },
  'colBranch.perTake': { min: 0, max: 1 },
  'colBranch.scatter': { min: 0, max: 1 },
  'colLeaf.source': { options: { 'Track colour': 'take', 'Theme colour': 'theme', Gradient: 'gradient' } },
  'colLeaf.gradient': { gradient: true },
  'colLeaf.takeMix': { min: 0, max: 1 },
  'colLeaf.along': { min: -2, max: 2 },
  'colLeaf.speed': { min: -1, max: 1 },
  'colLeaf.voice': { options: { Nothing: 'none', Pitch: 'pitch', Loudness: 'loudness', Effort: 'effort', Airiness: 'breath', Vibrato: 'vibrato', 'Note starts': 'flash' } },
  'colLeaf.voiceAmount': { min: -1, max: 1 },
  'colLeaf.perTake': { min: 0, max: 1 },
  'colLeaf.scatter': { min: 0, max: 1 },
  'colAccent.source': { options: { 'Track colour': 'take', 'Theme colour': 'theme', Gradient: 'gradient' } },
  'colAccent.gradient': { gradient: true },
  'colAccent.takeMix': { min: 0, max: 1 },
  'colAccent.along': { min: -2, max: 2 },
  'colAccent.speed': { min: -1, max: 1 },
  'colAccent.voice': { options: { Nothing: 'none', Pitch: 'pitch', Loudness: 'loudness', Effort: 'effort', Airiness: 'breath', Vibrato: 'vibrato', 'Note starts': 'flash' } },
  'colAccent.voiceAmount': { min: -1, max: 1 },
  'colAccent.perTake': { min: 0, max: 1 },
  'colAccent.scatter': { min: 0, max: 1 },
  'colHalo.source': { options: { 'Same as branches': 'branches', 'Track colour': 'take', Gradient: 'gradient' } },
  'colHalo.gradient': { gradient: true },
  'colHalo.takeMix': { min: 0, max: 1 },
  'colHalo.along': { min: -2, max: 2 },
  'colHalo.speed': { min: -1, max: 1 },
  'colHalo.voice': { options: { Nothing: 'none', Pitch: 'pitch', Loudness: 'loudness', Effort: 'effort', Airiness: 'breath', Vibrato: 'vibrato', 'Note starts': 'flash' } },
  'colHalo.voiceAmount': { min: -1, max: 1 },
  'colHalo.perTake': { min: 0, max: 1 },
  'colHalo.scatter': { min: 0, max: 1 },
  'glow.tintAmount': { min: 0, max: 1 },
  'glow.strength': { min: 0, max: 6 },
  'glow.radius': { min: 0.2, max: 5 },
  'glow.wide': { min: 0, max: 3 },
  'glow.base': { min: 0, max: 2 },
  'glow.levelGain': { min: 0, max: 4 },
  'glow.onsetGain': { min: 0, max: 4 },
  'glow.pitchShine': { min: 0, max: 3 },
  'glow.front': { min: 0, max: 5 },
  'glow.softGlow': { min: 0, max: 2 },
  'glow.crowd': { min: 0, max: 1.5 },
  'glow.inkMask': { min: 0, max: 1 },
  'glow.knee': { min: 0, max: 3 },
  'perf.fps': { min: 15, max: 144, step: 1 },
  'perf.idleFps': { min: 5, max: 144, step: 1 },
  'perf.backgroundFps': { min: 5, max: 144, step: 1 },
  'perf.maxMegapixels': { min: 0.5, max: 8.5, step: 0.1 },
  'perf.renderScale': { min: 0.4, max: 1, step: 0.05 },
  'detect.vibratoMinNote': { min: 0.15, max: 1.5 },
  'detect.vibratoMinSemitones': { min: 0, max: 0.5 },
  'detect.vibratoFullSemitones': { min: 0.1, max: 1.5 },
  'detect.vibratoMinHz': { min: 1, max: 8 },
  'detect.vibratoMaxHz': { min: 5, max: 15 },
  'fake.seed': { min: 1, max: 999, step: 1 },
  'fake.phraseMin': { min: 0.5, max: 10 },
  'fake.phraseMax': { min: 0.5, max: 15 },
  'fake.gapMin': { min: 0, max: 5 },
  'fake.gapMax': { min: 0, max: 8 },
  'fake.noteMax': { min: 0.3, max: 6 },
  'fake.longNotes': { min: 0, max: 1 },
  'fake.autoCommit': { min: 0, max: 30, step: 1 },
  'growth.branchesKept': { min: 1, max: 6, step: 1 },
  'growth.branchWitherSeconds': { min: 0.3, max: 8 },
  'growth.branchDroopDeg': { min: 0, max: 70 },
  'growth.branchFallSeconds': { min: 0.3, max: 4 },
  'commit.limbs': { min: 1, max: 4, step: 1 },
  'look.buds': { min: 0, max: 0.6 },
  'palette.from': { options: { 'My take colours (Setup)': 'mine', "This look's colours": 'list' } },
  'palette.pick': { options: { 'In order': 'order', 'Random (per take)': 'random', 'Spread along the gradient': 'spread' } },
  'palette.seed': { min: 1, max: 99, step: 1 },
  'fake.fullStopEvery': { min: 0, max: 10, step: 1 },
  'fake.fullStopSeconds': { min: 1.5, max: 20 },
  'fake.highNotes': { min: 0, max: 1 },
};

/** Older settings files: the sine sway/tremble became wind and shiver; the rainbow mode and
 *  natural tint became the colour roles. */
export function migrate(v: unknown) {
  const o = v as Record<string, Record<string, unknown>> | null;
  const col = o?.colours;
  if (o && col && col.mode === 'rainbow') {
    o.colBranch = { ...(o.colBranch ?? {}), source: 'gradient', ...(typeof col.rainbowSpeed === 'number' ? { speed: col.rainbowSpeed } : {}) };
    o.colHalo = { ...(o.colHalo ?? {}), source: 'branches' };
  }
  const nt = o?.look?.naturalTint;
  if (o && typeof nt === 'number' && o.colLeaf?.takeMix === undefined) o.colLeaf = { ...(o.colLeaf ?? {}), takeMix: 1 - nt };
  const m = (v as { motion?: Record<string, unknown> } | null)?.motion;
  if (m) {
    if (typeof m.tremble === 'boolean' && m.shiver === undefined) m.shiver = m.tremble;
    if (typeof m.trembleDeg === 'number' && m.shiverDeg === undefined) m.shiverDeg = m.trembleDeg;
  }
  return v;
}

/** Copy values from src into dst where the key exists in dst with the same type. */
export function deepMerge(dst: Record<string, unknown>, src: unknown) {
  if (!src || typeof src !== 'object') return;
  const s = src as Record<string, unknown>;
  for (const k of Object.keys(dst)) {
    if (!(k in s)) continue;
    const d = dst[k];
    if (d && typeof d === 'object') deepMerge(d as Record<string, unknown>, s[k]);
    else if (typeof s[k] === typeof d) dst[k] = s[k];
  }
}

export function loadParams(): Params {
  const p = structuredClone(defaults);
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) deepMerge(p, migrate(JSON.parse(saved)));
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return p;
}

/** Only the values that differ from the defaults, so improved defaults still reach untouched settings. */
function changedOnly(p: Record<string, unknown>, d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(p)) {
    const v = p[k], dv = d?.[k];
    if (v && typeof v === 'object') {
      const sub = changedOnly(v as Record<string, unknown>, (dv ?? {}) as Record<string, unknown>);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (v !== dv) out[k] = v;
  }
  return out;
}

/** Values saved instead of the live ones (the /themes page's test values must not stick). */
let saveOverrides: Record<string, unknown> = {};
export function setSaveOverrides(o: Record<string, unknown>) {
  saveOverrides = o;
}

export function saveParams(p: Params) {
  if (Object.keys(saveOverrides).length) {
    const copy = structuredClone(p);
    for (const [k, v] of Object.entries(saveOverrides)) setPath(copy, k, v);
    p = copy;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changedOnly(
      p as unknown as Record<string, unknown>, defaults as unknown as Record<string, unknown>)));
  } catch {
    /* ignore */
  }
}

export interface UIActions {
  restart(): void;
  commitLive(): void;
  deleteTake(): void;
  /** Fake singer <-> the mode before it. */
  toggleFake(): void;
  /** Fake singer: end the phrase now with a long pause. */
  endPhrase(): void;
  loadAvatar(): void;
  /** Set every Sprout Tap's theme, amount and colour back to Auto (they follow the look). */
  tapsToAuto(): void;
  clearAvatar(): void;
  /** Called after the user changed something in the panel (not for remote updates). */
  changed(): void;
}

/** Read-only values shown at the top of the panel (updated by the app). */
export interface UIStatus {
  feed: string;
  layers: string;
  pitch: string;
  voice: string;
}

export interface UI {
  /** Re-read all values from params (after a remote update), without reporting it as a change. */
  refresh(): void;
  /** Open a setting's folder(s), scroll it into view and flash it. */
  reveal(path: string): void;
  /** The user themes changed (rebuild the theme list). */
  themesChanged(): void;
}

// ---- Tooltips from the doc comments in params.ts ------------------------------------------------

function parseHints(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  let section = '', pending = '', inDoc = false, doc: string[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    const sec = /^ {2}(\w+): \{/.exec(raw);
    if (sec) {
      section = sec[1];
      pending = '';
      continue;
    }
    if (line.startsWith('/**')) {
      inDoc = !line.endsWith('*/');
      doc = [line.replace(/^\/\*\*\s?/, '').replace(/\s?\*\/$/, '')];
      if (!inDoc) pending = doc.join(' ');
      continue;
    }
    if (inDoc) {
      doc.push(line.replace(/^\*\s?/, '').replace(/\s?\*\/$/, ''));
      if (line.endsWith('*/')) {
        inDoc = false;
        pending = doc.join(' ').trim();
      }
      continue;
    }
    const key = /^ {4}(\w+):/.exec(raw);
    if (key && section) {
      if (pending) out[`${section}.${key[1]}`] = pending.replace(/\s+/g, ' ').trim();
      pending = '';
    } else if (line && !line.startsWith('//')) pending = '';
  }
  return out;
}
const HINTS = parseHints(paramsSource);

// ---- Panel -------------------------------------------------------------------------------------

const PANEL_KEY = 'sprout.viewer.panel.v1';
const CSS = `
.sprout-rv { float: right; border: 0; background: none; color: #8fd0ff; cursor: pointer; padding: 0 2px;
  font: 12px/1 sans-serif; visibility: hidden; }
.sprout-mod .sprout-rv { visibility: visible; }
.sprout-mod .tp-lblv_l { color: #cfe8ff; }
@keyframes sprout-flash { 0%, 40% { background: rgba(143,208,255,0.35); } 100% { background: transparent; } }
.sprout-flash { animation: sprout-flash 1.6s ease-out; border-radius: 3px; }
.sprout-moves { display: flex; gap: 3px; padding: 4px 6px 2px; flex-wrap: wrap; }
.sprout-moves button { font: 11px system-ui, sans-serif; color: #ddd; background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 3px; padding: 2px 6px; cursor: pointer; }
.sprout-moves button:hover { background: rgba(143,208,255,0.25); }
.sprout-desc { color: #9aa0a8; font: 11px/1.35 sans-serif; padding: 2px 8px 6px; white-space: normal; }
`;

type Binding = { element: HTMLElement; hidden: boolean; refresh(): void; min?: number; max?: number };
type Folder = FolderApi;

export function buildUI(container: HTMLElement, p: Params, actions: UIActions, status: UIStatus): UI {
  if (!document.getElementById('sprout-ui-css')) {
    const st = document.createElement('style');
    st.id = 'sprout-ui-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const store = loadStore();
  const all = (k: Kind) => [...BUILTINS[k], ...store[k].user];
  const byId = (k: Kind, id: string | null) => (id ? all(k).find((x) => x.id === id) : undefined);
  /** Active preset of a kind: keep the stored one, else the one the values match, else none (custom). */
  const derive = (k: Kind, current: string | null): string | null => {
    const cur = byId(k, current);
    if (cur && !isDirty(p, cur, k)) return cur.id;
    const m = all(k).find((x) => !isDirty(p, x, k));
    if (m) return m.id;
    return cur ? cur.id : null;
  };
  const active = {} as Record<Kind, string | null>;
  for (const k of KINDS) active[k] = derive(k, store[k].active);
  const activePreset = (k: Kind) => byId(k, active[k]);
  /** What a row reverts to: its kind's active preset, or the factory default for rig keys. */
  const baseline = (path: string) => {
    const k = kindOf(path);
    return k ? presetValue(activePreset(k), path) : getPath(defaults, path);
  };

  const pane = new Pane({ container, title: 'Sprouting Halo  (H hides, G scope)' });
  installTooltips(container);
  installSelectMenus(container);
  const folderTip = (f: Folder, text?: string) => tip(f.element.querySelector('.tp-fldv_b'), text);
  const btnTip = (b: { element: HTMLElement }, text: string) => tip(b.element.querySelector('button'), text);
  tip(pane.addBinding(status, 'feed', { readonly: true, label: 'feed' }).element,
    'Where the voice data comes from right now: live taps from Sprout.exe, or the fake singer.');
  tip(pane.addBinding(status, 'layers', { readonly: true, label: 'layers' }).element,
    'Live tracks (a halo each) and recorded takes (a tree each).');
  tip(pane.addBinding(status, 'pitch', { readonly: true, label: 'live pitch' }).element,
    'The note the first live track is singing, in cents off the note, and the vibrato rate when there is vibrato.');
  let fakeSync = () => {};
  const voiceRow = pane.addBinding(status, 'voice', { readonly: true, label: 'live voice' });
  // Test toolbar: the preview tools used most, with their keys ("/" lists every key).
  {
    const bar = document.createElement('div');
    bar.className = 'sprout-toolbar';
    const add = (text: string, key: string, tipText: string, run: () => void) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', () => {
        run();
        pane.refresh();
      });
      tip(b, `${tipText}
Key: ${key}`);
      bar.appendChild(b);
      return b;
    };
    const fakeBtn = add('', 'F', 'Switch between the fake singer and live taps from Sprout.exe (the mode you had before), to test without a DAW and come back.', () => actions.toggleFake());
    const syncFake = () => (fakeBtn.textContent = p.source.mode === 'fake' ? '◉ Fake singer' : '○ Fake singer');
    syncFake();
    fakeSync = syncFake;
    add('↻ Restart', 'R', 'Restart growth: the fake singer and every tree start from the beginning.', () => actions.restart());
    add('Halo → tree', 'T', 'Play the planting animation: the live take finishes recording and its halo becomes a tree (fake singer).', () => actions.commitLive());
    add('End phrase', 'E', 'Fake singer: end the phrase now with a full stop (a long pause), to see the phrase-end effects.', () => actions.endPhrase());
    add('Keys /', '/', 'Show every keyboard shortcut.', () => toggleSheet());
    voiceRow.element.after(bar);
  }
  tip(voiceRow.element,
    'Effort: soft (0) to full voice (1), from the overtones, so 0.5 = how you usually sing and mic distance does not matter. Breath: how airy the singing is (only while a note is sung; inhales do not count). Soft: what the visuals use, high for soft, airy singing. G opens the voice scope to see them over time');

  // Changes applied from another viewer must never be sent back: that echo, arriving late, is
  // what overwrote newer values while dragging. Ignore panel events for a moment after a refresh.
  let quietUntil = 0;
  const isQuiet = () => performance.now() < quietUntil;
  const userChange = () => {
    saveParams(p);
    for (const k of KINDS) store[k].active = active[k];
    saveStore(store);
    actions.changed();
  };

  let panelState: Record<string, boolean> = {};
  try {
    panelState = JSON.parse(localStorage.getItem(PANEL_KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  const remember = (id: string, f: Folder) =>
    f.on('fold', (ev) => {
      panelState[id] = ev.expanded;
      try {
        localStorage.setItem(PANEL_KEY, JSON.stringify(panelState));
      } catch {
        /* ignore */
      }
    });

  /** A button that asks for a second click within 3 s. */
  const confirmButton = (folder: Folder, title: string, ask: string, run: () => void) => {
    const b = folder.addButton({ title });
    let armed = 0;
    b.on('click', () => {
      if (performance.now() < armed) {
        armed = 0;
        b.title = title;
        run();
        return;
      }
      armed = performance.now() + 3000;
      b.title = ask;
      setTimeout(() => {
        if (armed && performance.now() >= armed) b.title = title;
      }, 3100);
    });
    return b;
  };

  const download = (name: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- Presets: Visual, Reactivity and Testing, each on its own tab ----
  // ---- Top tabs: Look (visual preset), Reaction (reactivity preset), Setup (rig and this viewer;
  // testing preset) - docs/fable-consult-5-colour-themes-panel.md, D.1 ----
  const TAB_IDS = ['look', 'reaction', 'setup'] as const;
  type TabId = (typeof TAB_IDS)[number];
  const TAB_TITLES: Record<TabId, string> = { look: 'Look', reaction: 'Reaction', setup: 'Setup' };
  const TAB_TIPS: Record<TabId, string> = {
    look: 'How it looks: colours, theme and leaves, tree shape, halo, glow. The Visual preset at the top sets all of it.',
    reaction: 'How it answers your voice, grouped by what the voice does. The Reactivity preset at the top sets all of it.',
    setup: 'Fit to your avatar, voice detection, performance, connection, and preview tools (Testing preset). No look preset touches these.',
  };
  const KIND_TAB: Record<Kind, TabId> = { visual: 'look', reactivity: 'reaction', testing: 'setup' };
  const showAdv = { showAdvanced: !!panelState.showAdvanced };
  const advRow = pane.addBinding(showAdv, 'showAdvanced', { label: 'show advanced' });
  tip(advRow.element, 'Show the Advanced folds with the rarely needed settings.');
  const advFolders: Folder[] = [];
  advRow.on('change', () => {
    for (const f of advFolders) f.hidden = !showAdv.showAdvanced;
    panelState.showAdvanced = showAdv.showAdvanced;
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(panelState));
    } catch {
      /* ignore */
    }
  });
  const mainTab = pane.addTab({ pages: TAB_IDS.map((id) => ({ title: TAB_TITLES[id] })) });
  const pageOf = (id: TabId) => mainTab.pages[TAB_IDS.indexOf(id)];
  mainTab.element.querySelectorAll('.tp-tbiv_b').forEach((b, i) => tip(b, TAB_TIPS[TAB_IDS[i]]));
  try {
    const last = Number(localStorage.getItem('sprout.viewer.tab.v1') ?? 0);
    if (mainTab.pages[last]) mainTab.pages[last].selected = true;
  } catch {
    /* ignore */
  }
  mainTab.on('select', (ev) => {
    try {
      localStorage.setItem('sprout.viewer.tab.v1', String(ev.index));
    } catch {
      /* ignore */
    }
  });
  /** Each preset kind's rows go at the top of its tab. */
  const tab = { pages: KINDS.map((k) => pageOf(KIND_TAB[k])) };
  const STASH = '__stash', CUSTOM = '__custom';
  const LIST_TIPS: Record<Kind, string> = {
    visual: 'Pick a look: tree shape, leaves, colour tint and glow. Built-in looks first, then your own (·). It also sets the theme in every Sprout Tap window.',
    reactivity: 'Pick how it answers your voice: growth speed, withering, brightness, glow flashes, motion and the planting animation. Built-in first, then your own (·).',
    testing: 'Pick a test scene for this browser only: what the fake singer sings, how many takes, preview speed. Never sent to OBS.',
  };
  interface Section {
    k: Kind;
    page: TabPageApi;
    list: ListBladeApi<string>;
    descEl: HTMLDivElement;
    saveBtn: ButtonApi;
    revertBtn: ButtonApi;
    delBtn: ButtonApi;
    nameObj: { name: string };
    nameRow: { refresh(): void };
    namedFor: string | null | undefined;
    suppress: boolean;
  }
  const sections = {} as Record<Kind, Section>;
  const listOptions = (k: Kind) => [
    ...(active[k] ? [] : [{ text: '(custom)', value: CUSTOM }]),
    ...BUILTINS[k].map((x) => ({ text: x.name, value: x.id })),
    ...[...store[k].user].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ text: '· ' + x.name, value: x.id })),
    ...(store[k].stash ? [{ text: 'Unsaved tweaks', value: STASH }] : []),
  ];
  /** (Re)create a kind's preset list (its options change after save / delete / import). */
  const makeList = (sec: Section, index?: number) => {
    const list = sec.page.addBlade({ view: 'list', label: 'preset', options: listOptions(sec.k), value: active[sec.k] ?? CUSTOM, index }) as ListBladeApi<string>;
    list.on('change', (ev) => {
      if (!sec.suppress) choose(sec.k, ev.value);
    });
    tip(list.element, LIST_TIPS[sec.k]);
    list.element.after(sec.descEl);
    return list;
  };
  const rebuildList = (k: Kind) => {
    const sec = sections[k];
    const idx = sec.page.children.indexOf(sec.list);
    sec.list.dispose();
    sec.list = makeList(sec, idx);
  };

  function choose(k: Kind, id: string) {
    if (id === CUSTOM) return;
    const dirtyNow = active[k] === null || isDirty(p, activePreset(k), k);
    const stashFrom = dirtyNow ? diffOf(p, k) : undefined;
    if (id === STASH) {
      const st = store[k].stash;
      applyPreset(p, undefined, k);
      if (st) deepMerge(p as unknown as Record<string, unknown>, st);
      store[k].stash = stashFrom;
      active[k] = derive(k, null);
    } else {
      if (stashFrom) store[k].stash = stashFrom;
      applyPreset(p, byId(k, id), k);
      active[k] = id;
    }
    afterPresetChange(k, true);
  }

  /** After a preset change in one kind: new list options, panel values, marks, save and sync. */
  function afterPresetChange(k: Kind | null, valuesChanged: boolean) {
    for (const kk of k ? [k] : KINDS) rebuildList(kk);
    if (valuesChanged) {
      quietUntil = performance.now() + 200;
      pane.refresh();
    }
    updateMarks();
    userChange();
  }

  /** Values from a preset file: v2 files carry one kind; older ones are split by key. */
  const addImportedPreset = (json: Record<string, unknown>, into: Kind | null) => {
    const raw = (json.values ?? {}) as Values;
    const kinds: Kind[] = json.kind && KINDS.includes(json.kind as Kind) ? [json.kind as Kind] : into ? [into] : KINDS;
    let applied: Kind | null = null;
    for (const k of kinds) {
      const values = diffOf(raw, k);
      if (!Object.keys(values).length && kinds.length > 1) continue;
      let name = String(json.name ?? 'Imported').slice(0, 32);
      if (all(k).some((x) => x.name.toLowerCase() === name.toLowerCase())) name += ' (imported)';
      const pr = { id: 'user:' + slug(name), name, description: json.description as string | undefined, values };
      store[k].user = [...store[k].user.filter((x) => x.id !== pr.id), pr];
      applyPreset(p, pr, k);
      active[k] = pr.id;
      applied = k;
    }
    return applied;
  };

  const importFile = (into: Kind | null, btn?: ButtonApi, idle?: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(await file.text());
      } catch {
        if (btn && idle) {
          btn.title = 'Not a valid .json file';
          setTimeout(() => (btn.title = idle), 3000);
        }
        return;
      }
      if (json.sprout === 'preset') addImportedPreset(json, into);
      else {
        // A full settings file (or an export from before presets existed).
        deepMerge(p as unknown as Record<string, unknown>, migrate(json.sprout === 'settings' ? json.params : json));
        const ps = json.presets as unknown;
        if (Array.isArray(ps)) {
          // v1 settings file: one list of presets, split by kind.
          for (const pr of ps as Preset[])
            for (const k of ['visual', 'reactivity'] as Kind[]) {
              const values = diffOf(pr.values, k);
              if (Object.keys(values).length) store[k].user = [...store[k].user.filter((x) => x.id !== pr.id), { ...pr, values }];
            }
        } else if (ps && typeof ps === 'object') {
          const byKind = ps as Partial<PresetStore>;
          for (const k of KINDS)
            for (const pr of byKind[k]?.user ?? []) store[k].user = [...store[k].user.filter((x) => x.id !== pr.id), pr];
        }
        for (const k of KINDS) active[k] = derive(k, active[k]);
      }
      afterPresetChange(null, true);
    };
    input.click();
  };

  KINDS.forEach((k, i) => {
    const page = tab.pages[i];
    const descEl = document.createElement('div');
    descEl.className = 'sprout-desc';
    const sec = { k, page, descEl, namedFor: undefined, suppress: false } as unknown as Section;
    sections[k] = sec;
    sec.list = makeList(sec);
    const what = KIND_TITLES[k].toLowerCase();
    sec.saveBtn = page.addButton({ title: 'Save' });
    btnTip(sec.saveBtn, `Overwrite this saved ${what} preset with the current values.`);
    sec.nameObj = { name: 'Mine' };
    const nameRow = page.addBinding(sec.nameObj, 'name', { label: 'new name' });
    sec.nameRow = nameRow;
    tip(nameRow.element, 'Name for "Save as new preset".');
    const saveAsBtn = page.addButton({ title: 'Save as new preset' });
    btnTip(saveAsBtn, `Save the current ${what} settings under the name above. Kept in this browser; use Export to move it.`);
    sec.revertBtn = page.addButton({ title: 'Revert all changes' });
    btnTip(sec.revertBtn, `Put every ${what} value back to the active preset. Your changes are kept as "Unsaved tweaks" in the list.`);
    sec.delBtn = confirmButton(page as unknown as Folder, 'Delete preset', 'Click again to delete', () => {
      store[k].user = store[k].user.filter((x) => x.id !== active[k]);
      active[k] = null;
      afterPresetChange(k, false);
    });
    btnTip(sec.delBtn, 'Delete this saved preset (asks for a second click). The values stay on screen.');
    const exportBtn = page.addButton({ title: 'Export preset (.json)' });
    btnTip(exportBtn, `Save the current ${what} settings as a preset file to share or move to another browser.`);
    exportBtn.on('click', () => {
      const pr = activePreset(k);
      const name = pr?.name ?? 'custom';
      download(`sprout-${k}-${slug(name)}.json`, { sprout: 'preset', version: 2, kind: k, name, description: pr?.description, values: diffOf(p, k) });
    });
    const importIdle = 'Import preset…';
    const importBtn = page.addButton({ title: importIdle });
    btnTip(importBtn, `Load a ${what} preset file (it is added to this list). Older preset files are split into their visual and reactivity parts.`);
    importBtn.on('click', () => importFile(k, importBtn, importIdle));

    sec.saveBtn.on('click', () => {
      const pr = activePreset(k);
      if (!pr || pr.builtin) return;
      pr.values = diffOf(p, k);
      afterPresetChange(k, false);
    });
    let overwriteArmed = 0;
    saveAsBtn.on('click', () => {
      let name = sec.nameObj.name.trim().slice(0, 32);
      if (!name) return;
      if (BUILTINS[k].some((x) => x.name.toLowerCase() === name.toLowerCase())) name += ' (mine)';
      const id = 'user:' + slug(name);
      if (store[k].user.some((x) => x.id === id) && performance.now() > overwriteArmed) {
        overwriteArmed = performance.now() + 3000;
        saveAsBtn.title = `Overwrite "${name}"?`;
        setTimeout(() => (saveAsBtn.title = 'Save as new preset'), 3000);
        return;
      }
      overwriteArmed = 0;
      saveAsBtn.title = 'Save as new preset';
      store[k].user = [...store[k].user.filter((x) => x.id !== id), { id, name, values: diffOf(p, k) }];
      active[k] = id;
      afterPresetChange(k, false);
    });
    sec.revertBtn.on('click', () => {
      if (active[k] === null) return;
      if (isDirty(p, activePreset(k), k)) store[k].stash = diffOf(p, k);
      applyPreset(p, activePreset(k), k);
      afterPresetChange(k, true);
    });
  });

  // ---- Combined sliders (not settings: each moves several real settings) ----
  type MacroRow = { spec: (typeof MACROS)[number]; obj: Record<string, number>; binding: { label: string | undefined; refresh(): void; element: HTMLElement } };
  const macroRows: MacroRow[] = [];
  for (const spec of MACROS) {
    const obj: Record<string, number> = { [spec.id]: 0.5 };
    const b = pageOf(spec.tab).addBinding(obj, spec.id, { min: 0, max: 1, label: spec.label });
    tip(b.element, spec.tip + '\n“~” after the name: the settings it moves were changed one by one; moving it puts them back in line.');
    b.on('change', (ev) => {
      if (marking || isQuiet()) return;
      for (const tg of spec.targets) setPath(p, tg.path, +macroValue(Number(ev.value), tg.at).toFixed(3));
      quietUntil = performance.now() + 60;
      pane.refresh();
      updateMarks();
      clearTimeout(timer);
      timer = window.setTimeout(userChange, 80);
    });
    macroRows.push({ spec, obj, binding: b as unknown as MacroRow['binding'] });
  }

  // ---- Parameter folders ----
  type Row = { path: string; binding: Binding; button: HTMLButtonElement; spec?: Spec };
  const rows: Row[] = [];
  /** Before a refresh, every slider stretches to hold its value (tweakpane would clamp it). */
  const fitRanges = (only?: Row) => {
    for (const r of only ? [only] : rows) {
      if (!r.spec) continue;
      const v = getPath(p, r.path);
      if (typeof v === 'number') stretch(r.binding, r.spec, v);
    }
  };
  const paneRefresh = pane.refresh.bind(pane);
  pane.refresh = () => {
    fitRanges();
    paneRefresh();
  };
  const folderRows: { folder: Folder; title: string; rows: Row[] }[] = [];

  const placed = new Set(FOLDERS.flatMap((f) => [...f.keys, ...(f.advanced ?? []), ...(f.sub ?? []).flatMap((x) => x.keys)]));
  const extra = new Map<string, string[]>();
  const unsorted: string[] = [];
  for (const path of PATHS) {
    if (placed.has(path)) continue;
    const section = path.split('.')[0];
    const f = FOLDERS.find((x) => x.catchSections?.includes(section));
    if (f) extra.set(f.id, [...(extra.get(f.id) ?? []), path]);
    else unsorted.push(path);
  }
  if (unsorted.length) console.warn('Panel: keys missing from FOLDERS (shown under Unsorted):', unsorted);

  const pathFolders = new Map<string, Folder[]>();
  let themeRowAt: number | undefined;
  const editors: { obj: Record<string, unknown>; key: string; ed: GradientEditor; binding: Binding }[] = [];
  let gradTimer = 0;
  const addRow = (folder: Folder, path: string, groups: Row[][]) => {
    const [section, key] = path.split('.');
    const obj = (p as unknown as Record<string, Record<string, unknown>>)[section];
    if (!obj || !(key in obj)) return;
    const v = obj[key];
    const opts: Record<string, unknown> = { label: LABELS[path] ?? key, ...(RANGES[path] ?? {}) };
    const isGradient = !!opts.gradient;
    delete opts.gradient;
    // The theme list: built-ins plus the user themes Sprout.exe has (rebuilt when they change).
    if (path === 'look.theme') opts.options = Object.fromEntries(allThemes().map((d) => [d.name, d.id]));
    if (themeRowAt !== undefined && path === 'look.theme') opts.index = themeRowAt;
    if (typeof v === 'string' && v.startsWith('#')) opts.view = 'color';
    else if (typeof v === 'number' && opts.min === undefined) {
      opts.min = Math.min(0, v * 4);
      opts.max = Math.max(1, v * 4);
    }
    const spec: Spec | undefined = typeof v === 'number' && opts.min !== undefined && !opts.options
      ? { min: opts.min as number, max: opts.max as number, step: opts.step as number | undefined } : undefined;
    if (spec) {
      // A saved value beyond the slider: the slider starts stretched to hold it.
      opts.min = Math.min(spec.min!, v as number);
      opts.max = Math.max(spec.max!, v as number);
    }
    const binding = folder.addBinding(obj, key, opts) as unknown as Binding;
    if (spec) allowTypedBeyond(binding, path, spec);
    tip(binding.element, TIPS[path] ?? HINTS[path]);
    const button = document.createElement('button');
    button.className = 'sprout-rv';
    button.textContent = '↺';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const to = e.shiftKey ? getPath(defaults, path) : baseline(path);
      obj[key] = structuredClone(to);
      if (spec && typeof to === 'number') stretch(binding, spec, to);
      binding.refresh();
      updateMarks();
      userChange();
    });
    binding.element.querySelector('.tp-lblv_l')?.appendChild(button);
    if (isGradient) {
      // A gradient: the text field is replaced by the gradient bar and editor (full row width).
      const input = binding.element.querySelector<HTMLElement>('.tp-lblv_v');
      if (input) input.style.display = 'none';
      const ed = new GradientEditor(String(obj[key]), (v) => {
        obj[key] = v;
        updateMarks();
        // Sync at most ~15 times a second while a stop is dragged.
        if (!gradTimer) gradTimer = window.setTimeout(() => {
          gradTimer = 0;
          userChange();
        }, 70);
      }, p.colours.take1);
      ed.el.style.padding = '2px 4px 4px 8px';
      ed.el.style.flexBasis = '100%';
      binding.element.style.flexWrap = 'wrap';
      binding.element.appendChild(ed.el);
      editors.push({ obj, key, ed, binding });
    }
    const row = { path, binding, button, spec };
    rows.push(row);
    for (const g of groups) g.push(row);
  };

  const pathTab = new Map<string, TabId>();
  const specs: FolderSpec[] = [...FOLDERS, ...(unsorted.length ? [{ id: 'unsorted', tab: 'setup' as const, title: 'Unsorted', keys: unsorted }] : [])];
  for (const spec of specs) {
    const folder = pageOf(spec.tab).addFolder({ title: spec.title, expanded: panelState[spec.id] ?? !!spec.open });
    remember(spec.id, folder);
    folderTip(folder, FOLDER_HINTS[spec.id]);
    const fRows: Row[] = [];
    folderRows.push({ folder, title: spec.title, rows: fRows });
    for (const path of [...spec.keys, ...(extra.get(spec.id) ?? [])]) {
      addRow(folder, path, [fRows]);
      pathFolders.set(path, [folder]);
      pathTab.set(path, spec.tab);
    }
    for (const sub of spec.sub ?? []) {
      const sf = folder.addFolder({ title: sub.title, expanded: panelState[spec.id + '.' + sub.id] ?? false });
      remember(spec.id + '.' + sub.id, sf);
      folderTip(sf, FOLDER_HINTS[sub.id]);
      const sRows: Row[] = [];
      folderRows.push({ folder: sf, title: sub.title, rows: sRows });
      if (sub.id.startsWith('col')) {
        // Quick "movement" buttons: they set the role to a gradient and its movers.
        const bar = document.createElement('div');
        bar.className = 'sprout-moves';
        for (const mv of MOVEMENTS) {
          const btn = document.createElement('button');
          btn.textContent = mv.label;
          tip(btn, mv.tip);
          btn.addEventListener('click', () => {
            const role = (p as unknown as Record<string, Record<string, unknown>>)[sub.id];
            role.source = 'gradient';
            Object.assign(role, mv.values);
            quietUntil = performance.now() + 60;
            pane.refresh();
            updateMarks();
            userChange();
          });
          bar.appendChild(btn);
        }
        sf.element.querySelector('.tp-fldv_c')?.appendChild(bar);
      }
      for (const path of sub.keys) {
        addRow(sf, path, [fRows, sRows]);
        pathFolders.set(path, [folder, sf]);
        pathTab.set(path, spec.tab);
      }
    }
    if (spec.advanced?.length) {
      const adv = folder.addFolder({ title: 'Advanced', expanded: panelState[spec.id + '.adv'] ?? false });
      remember(spec.id + '.adv', adv);
      folderTip(adv, 'Values you rarely need to change.');
      adv.hidden = !showAdv.showAdvanced;
      advFolders.push(adv);
      const aRows: Row[] = [];
      folderRows.push({ folder: adv, title: 'Advanced', rows: aRows });
      for (const path of spec.advanced) {
        addRow(adv, path, [fRows, aRows]);
        pathFolders.set(path, [folder, adv]);
        pathTab.set(path, spec.tab);
      }
    }
    if (spec.id === 'theme') {
      const et = folder.addButton({ title: 'Edit themes…' });
      btnTip(et, 'Make your own themes with your own pictures (opens the theme editor of Sprout.exe in a new tab).');
      et.on('click', () => window.open(`http://localhost:${p.source.port}/themes`, '_blank'));
      const ta = confirmButton(folder, 'Set every tap to Auto', 'Click again: every tap follows this look', () => actions.tapsToAuto());
      btnTip(ta, 'Every Sprout Tap window: Theme, Leaves and Colour back to Auto, so every track follows the look picked here. A tap set to its own theme or colour keeps it until then (asks for a second click).');
    }
    if (spec.id === 'commit') {
      const tc = folder.addButton({ title: 'Test: commit the live take' });
      btnTip(tc, 'Fake singer: pretend the live take finished recording, to watch the planting animation.');
      tc.on('click', () => {
        actions.commitLive();
        pane.refresh();
      });
      const td = folder.addButton({ title: 'Test: delete the last take' });
      btnTip(td, 'Fake singer: remove the newest take, to watch it fade with falling leaves.');
      td.on('click', () => {
        actions.deleteTake();
        pane.refresh();
      });
    }
    if (spec.id === 'test') {
      btnTip(folder.addButton({ title: 'Load avatar PNG…' }).on('click', () => actions.loadAvatar()),
        'Show your own avatar picture (PNG with transparency) instead of the grey shape, to judge the look. Stays in this browser; never shown in OBS.');
      btnTip(folder.addButton({ title: 'Remove avatar PNG' }).on('click', () => actions.clearAvatar()), 'Back to the grey placeholder shape.');
      btnTip(folder.addButton({ title: 'Restart growth' }).on('click', () => actions.restart()),
        'Start the fake singer and all trees from the beginning.');
      btnTip(folder.addButton({ title: 'Export everything (.json)' }).on('click', () =>
        download('sprout-settings.json', { sprout: 'settings', version: 2, params: p, presets: store })),
        'Save every setting and your own presets to one file (a backup, or to move to another browser).');
      btnTip(folder.addButton({ title: 'Import…' }).on('click', () => importFile(null)), 'Load a settings file or a preset file.');
      const resetAll = confirmButton(folder, 'Reset everything', 'Click again to reset everything', () => {
        deepMerge(p as unknown as Record<string, unknown>, structuredClone(defaults));
        for (const k of KINDS) active[k] = 'default';
        afterPresetChange(null, true);
      });
      btnTip(resetAll, 'Every setting back to factory defaults, including the fit to your avatar and colours (asks for a second click).');
    }
  }

  /** Revert buttons, folder dots, dependent rows, preset title and buttons. */
  let marking = false;
  function updateMarks() {
    if (marking) return;
    marking = true;
    try {
      markRows();
    } finally {
      marking = false;
    }
  }
  function markRows() {
    for (const e of editors) {
      e.ed.set(String(e.obj[e.key]));
      e.ed.setTake(p.colours.take1);
    }
    for (const r of rows) {
      const mod = !same(getPath(p, r.path), baseline(r.path));
      r.binding.element.classList.toggle('sprout-mod', mod);
      if (mod) {
        const b = baseline(r.path), d = getPath(defaults, r.path);
        const fmt = (x: unknown) => (typeof x === 'number' ? +x.toFixed(3) : String(x));
        const rk = kindOf(r.path);
        const pr = rk ? activePreset(rk)?.name : undefined;
        tip(r.button, `Revert to ${fmt(b)}${pr ? ` (${pr})` : ''}` + (same(b, d) ? '' : `.
Shift-click: factory default ${fmt(d)}`));
      }
    }
    for (const f of folderRows) {
      const any = f.rows.some((r) => r.binding.element.classList.contains('sprout-mod'));
      f.folder.title = f.title + (any ? ' •' : '');
    }
    const hide = (path: string, h: boolean) => rows.filter((r) => r.path === path).forEach((r) => (r.binding.hidden = h));
    // Colour roles: the gradient and its movers only when the source is a gradient.
    for (const r of ['colBranch', 'colLeaf', 'colAccent', 'colHalo'] as const) {
      const role = p[r] as { source: string; voice: string };
      const grad = role.source === 'gradient';
      for (const k of ['gradient', 'along', 'speed', 'voice', 'voiceAmount', 'perTake', 'scatter']) hide(`${r}.${k}`, !grad);
      hide(`${r}.voiceAmount`, !grad || role.voice === 'none');
      hide(`${r}.takeMix`, role.source === 'take' || role.source === 'branches');
    }
    hide('glow.tint', false);
    // Look palette: its list and pick only when the look brings its own colours.
    const pal = p.palette.from === 'list';
    hide('palette.list', !pal);
    hide('palette.pick', !pal);
    hide('palette.seed', !pal || p.palette.pick !== 'random');
    // Branch per phrase replaces "new tree each phrase"; its own settings only while on.
    hide('growth.newTreeEachPhrase', p.growth.branchEachPhrase);
    for (const k of ['branchesKept', 'branchWitherSeconds', 'branchDroopDeg', 'branchFallSeconds']) hide(`growth.${k}`, !p.growth.branchEachPhrase);
    for (const e of editors) e.ed.el.style.display = e.binding.hidden ? 'none' : '';
    hide('growth.witherDipSemitones', !p.growth.witherOnPitchDip);
    hide('scene.scopeLayer', !p.scene.showScope);
    hide('scene.scopeSeconds', !p.scene.showScope);
    hide('commit.syncWindow', !p.commit.syncToOnset);
    const motion = p.motion as unknown as Record<string, unknown>;
    if ('shiver' in motion) hide('motion.shiverDeg', !motion.shiver);

    const names: string[] = [];
    let anyDirty = false;
    KINDS.forEach((k, i) => {
      const sec = sections[k];
      const pr = activePreset(k);
      const dirty = active[k] === null ? false : isDirty(p, pr, k);
      anyDirty ||= dirty;
      if (k !== 'testing') names.push((pr ? pr.name : 'Custom') + (dirty ? ' *' : ''));
      tab.pages[i].title = TAB_TITLES[KIND_TAB[k]] + (dirty ? ' *' : '');
      const text = pr?.description ?? (pr ? '' : 'Values match no preset.');
      sec.descEl.textContent = text;
      sec.descEl.style.display = text ? '' : 'none';
      sec.saveBtn.hidden = !pr || !!pr.builtin;
      sec.saveBtn.disabled = !dirty;
      sec.revertBtn.disabled = !dirty;
      sec.delBtn.hidden = !pr || !!pr.builtin;
      // Suggest a name only when the active preset changes (never over what is being typed).
      if (active[k] !== sec.namedFor) {
        sec.namedFor = active[k];
        sec.nameObj.name = pr ? (pr.builtin ? pr.name + ' 2' : pr.name) : 'Mine';
        sec.nameRow.refresh();
      }
      if (sec.list.value !== (active[k] ?? CUSTOM)) {
        sec.suppress = true;
        sec.list.value = active[k] ?? CUSTOM;
        sec.suppress = false;
      }
    });
    void anyDirty;
    void names;
    // Combined sliders: position from the first target; "~" when the others are off its line.
    for (const m of macroRows) {
      const first = m.spec.targets[0];
      const pos = macroPos(Number(getPath(p, first.path)), first.at);
      const off = m.spec.targets.some((tg) => Math.abs(Number(getPath(p, tg.path)) - macroValue(pos, tg.at)) > 1e-3 * Math.max(1, Math.abs(tg.at[2])));
      m.obj[m.spec.id] = +pos.toFixed(3);
      m.binding.label = m.spec.label + (off ? ' ~' : '');
      m.binding.refresh();
    }
  }

  let timer = 0;
  pane.on('change', () => {
    fakeSync();
    if (isQuiet() || marking) return;
    updateMarks();
    clearTimeout(timer);
    timer = window.setTimeout(userChange, 80);
  });
  updateMarks();

  // Another tab on the same origin saved a preset: pick up its library.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY) return;
    const st = loadStore();
    for (const k of KINDS) {
      store[k].user = st[k].user;
      store[k].stash = st[k].stash;
      rebuildList(k);
    }
    updateMarks();
  });

  function refresh() {
    quietUntil = performance.now() + 400;
    clearTimeout(timer);
    pane.refresh();
    fakeSync();
    for (const k of KINDS) {
      const before = active[k];
      active[k] = derive(k, before);
      if (before !== active[k]) rebuildList(k);
    }
    updateMarks();
  }
  function reveal(path: string) {
    const row = rows.find((r) => r.path === path);
    if (!row) return;
    container.style.display = '';
    pane.expanded = true;
    const tb = pathTab.get(path);
    if (tb) pageOf(tb).selected = true;
    for (const f of pathFolders.get(path) ?? []) {
      f.expanded = true;
      if (f.title === 'Advanced' && f.hidden) f.hidden = false;
    }
    row.binding.hidden = false;
    setTimeout(() => {
      row.binding.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.binding.element.classList.remove('sprout-flash');
      void row.binding.element.offsetWidth;
      row.binding.element.classList.add('sprout-flash');
    }, 60);
  }
  /** The user themes changed: rebuild the theme dropdown with the new list. */
  function themesChanged() {
    const r = rows.find((x) => x.path === 'look.theme');
    const folders = pathFolders.get('look.theme');
    if (!r || !folders) return;
    const folder = folders[folders.length - 1];
    themeRowAt = folder.children.indexOf(r.binding as unknown as (typeof folder.children)[number]);
    (r.binding as unknown as { dispose(): void }).dispose();
    rows.splice(rows.indexOf(r), 1);
    for (const f of folderRows) {
      const k = f.rows.indexOf(r);
      if (k >= 0) f.rows.splice(k, 1);
    }
    addRow(folder, 'look.theme', folderRows.filter((f) => f.folder === folder || folders.includes(f.folder)).map((f) => f.rows));
    themeRowAt = undefined;
    updateMarks();
  }
  return { refresh, reveal, themesChanged };
}
