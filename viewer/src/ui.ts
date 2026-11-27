// Settings panel, generated from `params`: every value in params.ts gets a control automatically,
// grouped by panel-layout.ts (three tabs, folders in each; keys not listed there still appear).
// RANGES sets slider limits so the full travel of each slider makes a visible difference; typed
// values may go beyond them. Labels come from panel-layout.ts, tooltips from there and from the doc
// comments in params.ts. Presets (presets.ts): built-in looks, saved looks, a revert button on
// every changed row (to the active preset; Shift-click: the factory default).

import { toggleSheet } from './hotkeys';
import { ButtonApi, FolderApi, Pane } from 'tweakpane';
import { defaults, Params } from './params';
import paramsSource from './params.ts?raw';
import { FOLDER_HINTS, FOLDERS, FolderSpec, LABELS, MACROS, macroPos, macroValue, MOVEMENTS, TIPS } from './panel-layout';
import { installTooltips, tip } from './tooltip';
import { installSelectMenus } from './select-menu';
import { GradientEditor } from './gradient-editor';
import { allThemes } from './themes';
import { migrateGrowth, setPath } from './presets';
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
  'growth.lowBranches': { min: 0, max: 1 },
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
  'look.leaf3d': { min: 0, max: 1 },
  'leaves3d.fold': { min: 0, max: 70 },
  'leaves3d.cup': { min: 0, max: 1 },
  'leaves3d.arch': { min: 0, max: 1 },
  'leaves3d.turn': { min: 0, max: 85 },
  'leaves3d.tilt': { min: 0, max: 75 },
  'leaves3d.wind': { min: 0, max: 2 },
  'leaves3d.shiver': { min: 0, max: 20 },
  'leaves3d.lightAngle': { min: 0, max: 360 },
  'leaves3d.lightHeight': { min: 5, max: 90 },
  'leaves3d.shade': { min: 0, max: 1 },
  'leaves3d.shine': { min: 0, max: 1 },
  'leaves3d.underside': { min: 0, max: 1 },
  'look.leafRegrow': { min: 0.5, max: 10 },
  'motion.leafShake': { min: 0, max: 2 },
  'plants.twist': { min: 0, max: 1 },
  'plants.trunk': { min: 0, max: 1.5 },
  'plants.originLimbs': { min: 0, max: 16, step: 1 },
  'plants.trunkLean': { min: -45, max: 45 },
  'growth.fillSpace': { min: 0, max: 1 },
  'growth.branchOrder': { options: { 'Spread out': 'spread', Random: 'random', 'Top to bottom': 'topDown', 'Bottom to top': 'bottomUp' } },
  'growth.fallDirection': { options: { 'Down (gravity)': 'down', 'Away from the origin (no gravity)': 'away', 'Up (they float up)': 'up' } },
  'look.gravity': { options: { 'As the reaction says': 'reaction', 'Down (gravity)': 'down', 'Away from the origin (no gravity)': 'away', 'Up (they float up)': 'up' } },
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
  'growth.witherEffect': { options: { Ungrow: 'ungrow', Fade: 'fade', 'Fall away': 'fall' } },
  'falling.speed': { min: 0.2, max: 3 },
  'falling.sway': { min: 0, max: 2 },
  'falling.spin': { min: 0, max: 2 },
  'falling.flutter': { min: 0, max: 1.5 },
  'falling.time': { min: 0.3, max: 3 },
  'glow.travel': { min: 0, max: 2 },
  'falling.dropSeconds': { min: 0, max: 1.5 },
  'falling.dropVariety': { min: 0, max: 1 },
  'falling.dropSpeed': { min: 1, max: 3 },
  'falling.variety': { min: 0, max: 1 },
  'harmony.colour': { min: 0, max: 1 },
  'harmony.colourMode': { options: { 'Waves of both colours': 'waves', 'Gradient from one to the other': 'gradient', 'Mix of the two': 'mix', 'The harmony colour': 'colour' } },
  'harmony.colourMix': { options: { 'Even (OKLab)': 'oklab', 'Straight (RGB)': 'rgb', 'As light (brighter)': 'light', 'Round the colour wheel': 'hue', "Painter's wheel (yellow + blue = green)": 'paint', 'Hard cut': 'hard' } },
  'harmony.waveLead': { options: { 'Higher voice leads, then in step': 'higher', 'Lower voice leads, then in step': 'lower', 'Each takes the other colour': 'each' } },
  'harmony.waveFrom': { options: { 'Side facing the other voice': 'partner', "The halo's growing points": 'origins' } },
  'harmony.waveLength': { min: 0.1, max: 3 },
  'harmony.waveSpeed': { min: 0.1, max: 5 },
  'harmony.cross': { min: 0, max: 1 },
  'harmony.blossoms': { min: 0, max: 1 },
  'harmony.glow': { min: 0, max: 2 },
  'harmony.minSeconds': { min: 0, max: 2 },
  'harmony.attack': { min: 0.05, max: 3 },
  'fake.voices': { options: { 'Independent (own phrases)': 'independent', 'Duet (trading phrases)': 'duet', 'Together (same phrases)': 'together' } },
  'fake.harmony': { min: 0, max: 1 },
  'fake.together': { min: 0, max: 1 },
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
  'layout.midOriginY': { min: -1.5, max: 1 },
  'layout.tierFrom': { min: 3, max: 17, step: 1 },
  'layout.innerScale': { min: 0.3, max: 1 },
  'layout.spinFrom': { min: 1, max: 17, step: 1 },
  'layout.spinSpeed': { min: -180, max: 180 },
  'layout.ease': { min: 0.2, max: 10 },
  'transitions.liveEndSeconds': { min: 0.1, max: 5 },
  'halo.ringSpacing': { min: 0.03, max: 0.4 },
  'fake.liveTracks': { min: 1, max: 4, step: 1 },
  'commit.duration': { min: 0.5, max: 2.5 },
  'transitions.lookChangeSeconds': { min: 0.5, max: 10 },
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
  'motion.shiverDeg': { min: 0, max: 6 },
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
  'palette.from': { options: { 'My take colours': 'mine', "This look's colours": 'list' } },
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
  // growth.ending and growth.witherOnPause became one choice per length of silence.
  migrateGrowth(o?.growth);
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

/** Read-only values shown in the head of the panel (updated by the app). */
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
  /** Put the cursor in the panel's search field. */
  search(): void;
  /** The user themes changed (rebuild the theme list). */
  themesChanged(): void;
  /** Switch a kind to the i-th preset of its list (0-based, as numbered there; keys 1..9, 0). */
  pickPreset(k: Kind, i: number): void;
  /** Switch a kind to the next (step 1) or previous (-1) preset of its list, round and round. */
  cyclePreset(k: Kind, step: number): void;
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
//
// The panel is a fixed head (title bar, status, test buttons, search, the three tabs) over a
// scrolling body. The body is one Tweakpane pane: its own tab strip is hidden and driven from the
// tabs in the head. Each tab page starts with its preset card (plain DOM, placed beside
// Tweakpane's own container: Tweakpane inserts rows by child index, so nothing foreign may sit
// among them), then the combined sliders, then the folders of panel-layout.ts.

const PANEL_KEY = 'sprout.viewer.panel.v1';
const TAB_KEY = 'sprout.viewer.tab.v1';
const WIDTH_KEY = 'sprout.viewer.panelWidth.v1';
const MIN_WIDTH = 280, MAX_WIDTH = 640;
/** Share of the panel's width the value column takes (the label gets the rest). */
const VALUE_SHARE = 0.47;
const CSS = `
.sprout-panel { --accent: #8fd0ff; --accent-soft: rgba(143,208,255,0.16); --line: rgba(255,255,255,0.08);
  --text: #e6e9ee; --muted: #8e95a3; color: var(--text); font: 12px/1.3 system-ui, 'Segoe UI', Roboto, sans-serif; }
.sprout-panel [hidden] { display: none !important; }
.sprout-panel .sprout-btn, .sprout-panel .sprout-chip, .sprout-panel .sprout-tab, .sprout-panel .sprout-hit { font: inherit; color: inherit; }
.sprout-panel .sprout-head { flex: none; padding: 0 8px 6px; border-bottom: 1px solid var(--line); }
.sprout-panel .sprout-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; scrollbar-width: thin;
  scrollbar-color: #4a4e58 transparent; padding: 2px 0 6px; }
.sprout-panel.sprout-folded .sprout-head > :not(.sprout-title), .sprout-panel.sprout-folded .sprout-body { display: none; }
.sprout-panel.sprout-folded .sprout-head { padding-bottom: 0; border-bottom: 0; }

/* Title bar */
.sprout-panel .sprout-title { display: flex; align-items: center; gap: 4px; height: 34px; }
.sprout-panel .sprout-name { flex: 1; font-weight: 650; font-size: 13px; letter-spacing: 0.01em; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; cursor: default; }
.sprout-panel .sprout-name::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 7px; border-radius: 8px 0 8px 0;
  background: linear-gradient(135deg, #9be08a, #4fb873); }
.sprout-panel .sprout-chip { height: 22px; padding: 0 8px; border: 1px solid var(--line); border-radius: 11px; background: transparent;
  color: var(--muted); font-size: 11px; cursor: pointer; white-space: nowrap; }
.sprout-panel .sprout-chip:hover { color: var(--text); background: rgba(255,255,255,0.07); }
.sprout-panel .sprout-chip.on { color: var(--accent); border-color: rgba(143,208,255,0.45); background: var(--accent-soft); }
.sprout-panel .sprout-chip.sprout-round { width: 22px; padding: 0; }

/* Status */
.sprout-panel .sprout-status { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 6px 8px; border-radius: 6px;
  background: rgba(0,0,0,0.25); font-size: 11px; font-variant-numeric: tabular-nums; }
.sprout-panel .sprout-stat { display: flex; gap: 6px; min-width: 0; white-space: nowrap; }
.sprout-panel .sprout-stat-pitch, .sprout-panel .sprout-stat-voice { grid-column: 1 / -1; }
.sprout-panel .sprout-stat-l { flex: none; width: 34px; color: var(--muted); }
.sprout-panel .sprout-stat-layers .sprout-stat-l { width: auto; }
.sprout-panel .sprout-stat-v { overflow: hidden; text-overflow: ellipsis; }
.sprout-panel .sprout-stat-feed .sprout-stat-v::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 5px;
  border-radius: 50%; background: #e0b34f; }
.sprout-panel .sprout-status[data-feed=live] .sprout-stat-feed .sprout-stat-v::before { background: #5fd08a; box-shadow: 0 0 6px #5fd08a; }
.sprout-panel .sprout-status[data-feed=waiting] .sprout-stat-feed .sprout-stat-v::before { background: #ff8080; }

/* Buttons of the head and the preset card */
.sprout-panel .sprout-toolbar { display: flex; gap: 4px; padding-top: 6px; }
.sprout-panel .sprout-btn { flex: 1 1 auto; height: 24px; padding: 0 7px; border: 1px solid rgba(255,255,255,0.09); border-radius: 5px;
  background: #343843; cursor: pointer; white-space: nowrap; font-size: 11.5px; }
.sprout-panel .sprout-btn:hover:not(:disabled) { background: #414655; }
.sprout-panel .sprout-btn:active:not(:disabled) { background: #4c5263; }
.sprout-panel .sprout-btn:disabled { opacity: 0.4; cursor: default; }
.sprout-panel .sprout-btn.on { border-color: rgba(143,208,255,0.5); background: var(--accent-soft); color: var(--accent); }
.sprout-panel .sprout-btn.sprout-quiet { background: transparent; color: var(--muted); }
.sprout-panel .sprout-btn.sprout-quiet:hover:not(:disabled) { color: var(--text); background: rgba(255,255,255,0.07); }
.sprout-panel .sprout-btn.sprout-narrow { flex: none; width: 26px; padding: 0; }

/* Search */
.sprout-panel .sprout-search { padding-top: 6px; }
.sprout-panel .sprout-search input, .sprout-panel .sprout-preset input, .sprout-panel .sprout-preset select { box-sizing: border-box; width: 100%; height: 24px; padding: 0 8px;
  border: 1px solid rgba(255,255,255,0.09); border-radius: 5px; background: rgba(0,0,0,0.25); color: var(--text); font: inherit;
  outline: none; color-scheme: dark; }
.sprout-panel .sprout-search input:focus, .sprout-panel .sprout-preset input:focus, .sprout-panel .sprout-preset select:focus { border-color: rgba(143,208,255,0.6); }
.sprout-panel .sprout-search input::placeholder { color: var(--muted); }
.sprout-panel .sprout-results { display: none; margin-top: 4px; max-height: 46vh; overflow-y: auto; scrollbar-width: thin; }
.sprout-panel .sprout-hit { display: block; width: 100%; padding: 4px 8px; border: 0; border-radius: 5px; background: none; text-align: left;
  cursor: pointer; }
.sprout-panel .sprout-hit.sel, .sprout-panel .sprout-hit:hover { background: var(--accent-soft); }
.sprout-panel .sprout-hit small { display: block; color: var(--muted); font-size: 10.5px; }
.sprout-panel .sprout-hit-none { padding: 4px 8px; color: var(--muted); }

/* Tabs */
.sprout-panel .sprout-tabs { display: flex; gap: 2px; margin: 8px 0 -7px; }
.sprout-panel .sprout-tab { flex: 1; height: 28px; border: 0; border-bottom: 2px solid transparent; border-radius: 5px 5px 0 0; background: none;
  color: var(--muted); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.sprout-panel .sprout-tab:hover { color: var(--text); background: rgba(255,255,255,0.05); }
.sprout-panel .sprout-tab.sel { color: var(--text); border-bottom-color: var(--accent); background: rgba(255,255,255,0.06); }
.sprout-panel .sprout-tab.sprout-dirty::after, .sprout-panel .sprout-dot > .tp-fldv_b::after { content: ''; display: inline-block; width: 6px;
  height: 6px; margin-left: 6px; border-radius: 50%; background: var(--accent); vertical-align: 1px; }

/* Preset card */
.sprout-panel .sprout-preset { margin: 6px 8px 4px; padding: 7px 8px 8px; border: 1px solid var(--line); border-radius: 7px;
  background: rgba(255,255,255,0.035); }
.sprout-panel .sprout-preset-cap { display: flex; justify-content: space-between; margin-bottom: 5px; color: var(--muted); font-size: 10.5px;
  font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.sprout-panel .sprout-preset-cap b { color: var(--accent); font-weight: 600; letter-spacing: 0; text-transform: none; }
.sprout-panel .sprout-preset-pick, .sprout-panel .sprout-preset-acts, .sprout-panel .sprout-saveas { display: flex; gap: 4px; }
.sprout-panel .sprout-preset select { flex: 1; min-width: 0; height: 26px; padding: 0 4px; font-weight: 600; cursor: pointer; }
.sprout-panel .sprout-preset-acts { flex-wrap: wrap; }
.sprout-panel .sprout-preset-acts .sprout-btn { flex: 0 1 auto; }
.sprout-panel .sprout-preset-gap { flex: 1; }
.sprout-panel .sprout-saveas { margin-top: 4px; }
.sprout-panel .sprout-saveas .sprout-btn { flex: none; }
.sprout-panel .sprout-desc { color: #a3a9b5; font-size: 11.5px; line-height: 1.4; padding: 6px 1px 7px; white-space: normal; }

/* Rows */
.sprout-panel .sprout-body .tp-rotv { background: none; box-shadow: none; }
.sprout-panel .sprout-body .tp-tabv_t, .sprout-panel .sprout-body .tp-tabv_i { display: none; }
.sprout-panel .sprout-body .tp-tabv_c, .sprout-panel .sprout-body .tp-tbpv_c { padding-left: 0; }
.sprout-panel .sprout-body .tp-lblv_l { position: relative; padding-left: 8px; padding-right: 18px; line-height: 1.25; }
.sprout-panel .sprout-body .tp-txtv_i, .sprout-panel .sprout-body .tp-lstv_s { font-variant-numeric: tabular-nums; }
.sprout-panel .sprout-rv { position: absolute; right: 2px; top: 50%; transform: translateY(-50%); border: 0; background: none; color: var(--accent);
  cursor: pointer; padding: 2px; font: 13px/1 sans-serif; visibility: hidden; opacity: 0.75; }
.sprout-panel .sprout-rv:hover { opacity: 1; }
.sprout-panel .sprout-mod .sprout-rv { visibility: visible; }
.sprout-panel .sprout-mod { position: relative; }
.sprout-panel .sprout-mod::before { content: ''; position: absolute; left: 1px; top: 4px; bottom: 4px; width: 2px; border-radius: 1px;
  background: var(--accent); }
.sprout-panel .sprout-mod > .tp-lblv_l { color: #d6ecff; }
@keyframes sprout-flash { 0%, 40% { background: rgba(143,208,255,0.35); } 100% { background: transparent; } }
.sprout-panel .sprout-flash { animation: sprout-flash 1.6s ease-out; border-radius: 4px; }
.sprout-panel .sprout-macro > .tp-lblv_l { color: #b9e6c4; font-weight: 600; }
.sprout-panel .sprout-macro > .tp-lblv_l::before { content: '◆'; margin-right: 5px; font-size: 8px; vertical-align: 1px; opacity: 0.8; }

/* Folders: the top ones read as headings, the nested ones as quiet groups */
.sprout-panel .sprout-body .tp-fldv_b { padding-left: 8px; }
.sprout-panel .sprout-body .tp-fldv_t { display: inline; padding-left: 0; }
.sprout-panel .sprout-top { margin-top: 3px; }
.sprout-panel .sprout-top > .tp-fldv_b { font-weight: 650; font-size: 12.5px; color: var(--text); height: 28px; line-height: 28px; }
.sprout-panel .sprout-top > .tp-fldv_i { top: 28px; }
/* Nested groups must not read as settings: a tinted, rounded header with a turning chevron, a
   little inset, and a guide line down the left of what they hold while open. */
.sprout-panel .sprout-sub, .sprout-panel .sprout-adv { margin: 5px 6px 3px 8px; }
.sprout-panel .sprout-sub > .tp-fldv_b, .sprout-panel .sprout-adv > .tp-fldv_b { height: 24px; line-height: 24px; padding-left: 6px;
  border-radius: 5px; background: rgba(143,208,255,0.07); color: #a9d8ff; font-size: 11.5px; font-weight: 600; letter-spacing: 0.01em; }
.sprout-panel .sprout-sub > .tp-fldv_b:hover, .sprout-panel .sprout-adv > .tp-fldv_b:hover { background: rgba(143,208,255,0.14); }
.sprout-panel .sprout-sub > .tp-fldv_b .tp-fldv_t::before, .sprout-panel .sprout-adv > .tp-fldv_b .tp-fldv_t::before { content: '›';
  display: inline-block; width: 10px; margin-right: 3px; text-align: center; font-size: 13px; transition: transform 0.15s; }
.sprout-panel .sprout-sub.tp-fldv-expanded > .tp-fldv_b .tp-fldv_t::before,
.sprout-panel .sprout-adv.tp-fldv-expanded > .tp-fldv_b .tp-fldv_t::before { transform: rotate(90deg); }
.sprout-panel .sprout-sub > .tp-fldv_b .tp-fldv_m, .sprout-panel .sprout-adv > .tp-fldv_b .tp-fldv_m { display: none; }
.sprout-panel .sprout-sub > .tp-fldv_i, .sprout-panel .sprout-adv > .tp-fldv_i { display: none; }
.sprout-panel .sprout-sub.tp-fldv-expanded > .tp-fldv_c, .sprout-panel .sprout-adv.tp-fldv-expanded > .tp-fldv_c {
  margin: 2px 0 2px 5px; border-left: 2px solid rgba(143,208,255,0.22); }
.sprout-panel .sprout-adv > .tp-fldv_b { background: rgba(255,255,255,0.04); color: var(--muted); font-style: italic; }
.sprout-panel .sprout-adv.tp-fldv-expanded > .tp-fldv_c { border-left-color: rgba(255,255,255,0.12); }
.sprout-panel .sprout-note { margin-left: 7px; color: var(--muted); font-weight: 400; font-size: 11px; }
.sprout-panel .sprout-moves { display: flex; align-items: center; gap: 3px; padding: 3px 4px 4px 8px; flex-wrap: wrap; }
.sprout-panel .sprout-moves span { color: var(--muted); font-size: 11px; margin-right: 3px; }
.sprout-panel .sprout-moves .sprout-btn { flex: none; height: 21px; padding: 0 6px; font-size: 11px; }

/* Drag the left edge to make the panel wider or narrower */
.sprout-panel .sprout-grip { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; cursor: ew-resize; z-index: 2; }
.sprout-panel .sprout-grip:hover, .sprout-panel .sprout-grip.on { background: linear-gradient(to right, rgba(143,208,255,0.5), transparent); }
`;

type Binding = { element: HTMLElement; hidden: boolean; refresh(): void; min?: number; max?: number };
type Folder = FolderApi;

/** A new element with a class and a text. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

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

  container.classList.add('sprout-panel');
  const head = el('div', 'sprout-head');
  const body = el('div', 'sprout-body');
  container.append(head, body);
  const pane = new Pane({ container: body });
  installTooltips(container);
  installSelectMenus(container);
  const folderTip = (f: Folder, text?: string) => tip(f.element.querySelector('.tp-fldv_b'), text);
  const btnTip = (b: { element: HTMLElement }, text: string) => tip(b.element.querySelector('button'), text);
  /** A plain button of the head or a preset card. */
  const button = (parent: HTMLElement, text: string, tipText: string, cls = 'sprout-btn') => {
    const b = el('button', cls, text);
    b.type = 'button';
    tip(b, tipText);
    parent.appendChild(b);
    return b;
  };
  /** Another text on a button for 3 s (a question before a second click, or a message). */
  const say = (b: HTMLButtonElement, text: string, idle: string) => {
    b.textContent = text;
    clearTimeout(Number(b.dataset.timer));
    b.dataset.timer = String(window.setTimeout(() => (b.textContent = idle), 3000));
  };

  let panelState: Record<string, boolean> = {};
  try {
    panelState = JSON.parse(localStorage.getItem(PANEL_KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  const savePanelState = () => {
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(panelState));
    } catch {
      /* ignore */
    }
  };
  let syncFoldAll = () => {};
  const remember = (id: string, f: Folder) =>
    f.on('fold', (ev) => {
      panelState[id] = ev.expanded;
      savePanelState();
      syncFoldAll();
    });

  // ---- Title bar: the panel-wide switches ----
  const TAB_IDS = ['look', 'reaction', 'setup'] as const;
  type TabId = (typeof TAB_IDS)[number];
  const titleBar = el('div', 'sprout-title');
  const nameEl = el('span', 'sprout-name', 'Sprouting Halo');
  tip(nameEl, 'Sprouting Halo settings. Every change is saved at once and sent to the other open viewers and OBS.\nKeys: H hides the panels, G shows the voice scope, S searches, / lists every key.');
  titleBar.appendChild(nameEl);
  const showAdv = { showAdvanced: !!panelState.showAdvanced };
  const advFolders: Folder[] = [];
  const advBtn = button(titleBar, 'Advanced', 'Show the Advanced fold of each folder, with the rarely needed settings. Search finds them either way.', 'sprout-chip');
  const syncAdv = () => {
    advBtn.classList.toggle('on', showAdv.showAdvanced);
    for (const f of advFolders) f.hidden = !showAdv.showAdvanced;
  };
  advBtn.addEventListener('click', () => {
    showAdv.showAdvanced = !showAdv.showAdvanced;
    panelState.showAdvanced = showAdv.showAdvanced;
    savePanelState();
    syncAdv();
  });
  const foldAllBtn = button(titleBar, 'Fold all', '', 'sprout-chip');
  button(titleBar, '?', 'Show every keyboard shortcut.\nKey: /', 'sprout-chip sprout-round').addEventListener('click', () => toggleSheet());
  const foldBtn = button(titleBar, '–', '', 'sprout-chip sprout-round');
  const setFolded = (folded: boolean) => {
    container.classList.toggle('sprout-folded', folded);
    foldBtn.textContent = folded ? '+' : '–';
    tip(foldBtn, folded ? 'Open the panel again.' : 'Fold the panel down to this bar.\nKey: H hides the panels altogether.');
  };
  foldBtn.addEventListener('click', () => setFolded(!container.classList.contains('sprout-folded')));
  setFolded(false);
  head.appendChild(titleBar);

  // ---- Status: what the viewer hears right now (the app keeps `status` up to date) ----
  const statusBox = el('div', 'sprout-status');
  const stat = (key: keyof UIStatus, label: string, tipText: string) => {
    const row = el('div', 'sprout-stat sprout-stat-' + key);
    const value = el('span', 'sprout-stat-v');
    row.append(el('span', 'sprout-stat-l', label), value);
    tip(row, tipText);
    statusBox.appendChild(row);
    return value;
  };
  const statEls: Record<keyof UIStatus, HTMLElement> = {
    feed: stat('feed', 'feed', 'Where the voice data comes from right now: live taps from Sprout.exe, or the fake singer.'),
    layers: stat('layers', '', 'Live tracks (a halo each) and recorded takes (a tree each).'),
    pitch: stat('pitch', 'pitch', 'The note the first live track is singing, in cents off the note, and the vibrato rate when there is vibrato.'),
    voice: stat('voice', 'voice', 'Effort: soft (0) to full voice (1), from the overtones, so 0.5 = how you usually sing and mic distance does not matter. Breath: how airy the singing is (only while a note is sung; inhales do not count). Soft: what the visuals use, high for soft, airy singing. G opens the voice scope to see them over time'),
  };
  const shown: Partial<UIStatus> = {};
  const showStatus = () => {
    for (const k of Object.keys(statEls) as (keyof UIStatus)[]) {
      if (shown[k] === status[k]) continue;
      shown[k] = status[k];
      statEls[k].textContent = status[k] || '–';
    }
    statusBox.dataset.feed = status.feed.startsWith('live') ? 'live' : status.feed.startsWith('waiting') ? 'waiting' : 'fake';
  };
  showStatus();
  window.setInterval(showStatus, 200);
  head.appendChild(statusBox);

  // ---- Test buttons: the preview tools used most, with their keys ("/" lists every key) ----
  let fakeSync = () => {};
  {
    const bar = el('div', 'sprout-toolbar');
    const add = (text: string, key: string, tipText: string, run: () => void) => {
      const b = button(bar, text, `${tipText}\nKey: ${key}`);
      b.addEventListener('click', () => {
        run();
        pane.refresh();
      });
      return b;
    };
    const fakeBtn = add('Fake singer', 'F', 'Switch between the fake singer and live taps from Sprout.exe (the mode you had before), to test without a DAW and come back.', () => actions.toggleFake());
    fakeSync = () => fakeBtn.classList.toggle('on', p.source.mode === 'fake');
    fakeSync();
    add('↻ Restart', 'R', 'Restart growth: the fake singer and every tree start from the beginning.', () => actions.restart());
    add('Halo → tree', 'T', 'Play the planting animation: the live take finishes recording and its halo becomes a tree (fake singer).', () => actions.commitLive());
    add('End phrase', 'E', 'Fake singer: end the phrase now with a full stop (a long pause), to see the phrase-end effects.', () => actions.endPhrase());
    head.appendChild(bar);
  }

  // ---- Search: any setting or button by its name, its folder or what its tooltip says ----
  const searchBox = el('div', 'sprout-search');
  const searchIn = el('input');
  searchIn.type = 'search';
  searchIn.placeholder = 'Find a setting…';
  searchIn.spellcheck = false;
  tip(searchIn, 'Type a few letters of a setting, a folder or what it does: Enter (or a click) opens its folder and scrolls to it, in any tab. Up and down choose, Esc clears.\nKey: S');
  const resultsEl = el('div', 'sprout-results');
  searchBox.append(searchIn, resultsEl);
  head.appendChild(searchBox);

  // ---- Tabs: Look (visual preset), Reaction (reactivity preset), Setup (rig and this viewer;
  // testing preset) - docs/fable-consult-5-colour-themes-panel.md, D.1 ----
  const TAB_TITLES: Record<TabId, string> = { look: 'Look', reaction: 'Reaction', setup: 'Setup' };
  const TAB_TIPS: Record<TabId, string> = {
    look: 'How it looks: theme and leaves, colours, tree shape, halo, glow. The Look preset at the top sets all of it.',
    reaction: 'How it answers your voice, grouped by what the voice does. The Reaction preset at the top sets all of it.',
    setup: 'Fit to your avatar, connection, performance, voice detection, and the preview tools and fake singer (Setup preset). No Look or Reaction preset touches these.',
  };
  const KIND_TAB: Record<Kind, TabId> = { visual: 'look', reactivity: 'reaction', testing: 'setup' };
  const mainTab = pane.addTab({ pages: TAB_IDS.map((id) => ({ title: TAB_TITLES[id] })) });
  const pageOf = (id: TabId) => mainTab.pages[TAB_IDS.indexOf(id)];
  const currentTab = () => TAB_IDS[Math.max(0, mainTab.pages.findIndex((pg) => pg.selected))];
  const tabBar = el('div', 'sprout-tabs');
  const tabBtns = TAB_IDS.map((id, i) => {
    const b = button(tabBar, TAB_TITLES[id], '', 'sprout-tab');
    b.addEventListener('click', () => (mainTab.pages[i].selected = true));
    return b;
  });
  head.appendChild(tabBar);
  const syncTabs = () => {
    const cur = currentTab();
    tabBtns.forEach((b, i) => b.classList.toggle('sel', TAB_IDS[i] === cur));
    syncFoldAll();
  };
  try {
    const last = Number(localStorage.getItem(TAB_KEY) ?? 0);
    if (mainTab.pages[last]) mainTab.pages[last].selected = true;
  } catch {
    /* ignore */
  }
  mainTab.on('select', (ev) => {
    syncTabs();
    body.scrollTop = 0;
    try {
      localStorage.setItem(TAB_KEY, String(ev.index));
    } catch {
      /* ignore */
    }
  });

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

  // ---- Presets: Visual, Reactivity and Testing, each in a card at the top of its tab ----
  const STASH = '__stash', CUSTOM = '__custom';
  const KIND_CAPTION: Record<Kind, string> = { visual: 'Look preset', reactivity: 'Reaction preset', testing: 'Setup preset' };
  const LIST_TIPS: Record<Kind, string> = {
    visual: 'Pick a look: tree shape, leaves, colour tint and glow. Built-in looks first, then your own (·). It also sets the theme in every Sprout Tap window.\nKeys: 1 to 9 and 0 pick the first ten (numbered in the list).',
    reactivity: 'Pick how it answers your voice: growth speed, withering, brightness, glow flashes, motion and the planting animation. Built-in first, then your own (·).\nKeys: Shift + 1 to 9 and 0 pick the first ten (numbered in the list).',
    testing: 'Pick a test scene for this browser only: what the fake singer sings, how many takes, preview speed. Never sent to OBS.\nKeys: Alt + 1 to 9 and 0 pick the first ten (numbered in the list).',
  };
  interface Section {
    k: Kind;
    card: HTMLDivElement;
    select: HTMLSelectElement;
    stateEl: HTMLElement;
    descEl: HTMLDivElement;
    saveBtn: HTMLButtonElement;
    revertBtn: HTMLButtonElement;
    delBtn: HTMLButtonElement;
    nameIn: HTMLInputElement;
    namedFor: string | null | undefined;
  }
  const sections = {} as Record<Kind, Section>;
  /** The quick movement buttons of each colour role (shown only with a gradient). */
  const moveBars = new Map<string, HTMLDivElement>();
  /** A kind's presets in list order: built-in first, then your own by name. */
  const presetOrder = (k: Kind) => [...BUILTINS[k], ...[...store[k].user].sort((a, b) => a.name.localeCompare(b.name))];
  /** The first ten carry the number key that picks them (1..9, 0). */
  const keyNum = (i: number) => (i < 10 ? `${(i + 1) % 10}   ` : '     ');
  const listOptions = (k: Kind) => [
    ...(active[k] ? [] : [{ text: '(custom)', value: CUSTOM }]),
    ...presetOrder(k).map((x, i) => ({ text: keyNum(i) + (x.id.startsWith('user:') ? '· ' : '') + x.name, value: x.id })),
    ...(store[k].stash ? [{ text: 'Unsaved tweaks', value: STASH }] : []),
  ];
  const pickPreset = (k: Kind, i: number) => {
    const pr = presetOrder(k)[i];
    if (pr) choose(k, pr.id);
  };
  const cyclePreset = (k: Kind, step: number) => {
    const list = presetOrder(k), n = list.length;
    if (!n) return;
    const at = list.findIndex((x) => x.id === active[k]);
    const i = at < 0 ? (step > 0 ? 0 : n - 1) : (((at + step) % n) + n) % n;
    choose(k, list[i].id);
  };
  /** Refill a kind's preset list (its options change after save / delete / import). */
  const rebuildList = (k: Kind) => {
    const sel = sections[k].select;
    sel.replaceChildren(...listOptions(k).map((o) => new Option(o.text, o.value)));
    sel.value = active[k] ?? CUSTOM;
  };

  function choose(k: Kind, id: string) {
    if (id === CUSTOM || (id !== STASH && !byId(k, id))) return;
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
    migrateGrowth(raw.growth as Record<string, unknown> | undefined); // a preset saved by an older version
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

  /** Pick a file and load it; `failed` is told when it is not JSON. */
  const importFile = (into: Kind | null, failed?: (message: string) => void) => {
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
        failed?.('Not a valid .json file');
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
              migrateGrowth(pr.values?.growth as Record<string, unknown> | undefined);
              const values = diffOf(pr.values, k);
              if (Object.keys(values).length) store[k].user = [...store[k].user.filter((x) => x.id !== pr.id), { ...pr, values }];
            }
        } else if (ps && typeof ps === 'object') {
          const byKind = ps as Partial<PresetStore>;
          for (const k of KINDS)
            for (const pr of byKind[k]?.user ?? []) {
              migrateGrowth(pr.values?.growth as Record<string, unknown> | undefined);
              store[k].user = [...store[k].user.filter((x) => x.id !== pr.id), pr];
            }
        }
        for (const k of KINDS) active[k] = derive(k, active[k]);
      }
      afterPresetChange(null, true);
    };
    input.click();
  };

  const pageEls = mainTab.element.querySelectorAll<HTMLElement>('.tp-tbpv');
  for (const k of KINDS) {
    const what = KIND_TITLES[k].toLowerCase();
    const card = el('div', 'sprout-preset');
    const cap = el('div', 'sprout-preset-cap');
    const capName = el('span', '', KIND_CAPTION[k]);
    tip(capName, FOLDER_HINTS.preset);
    const stateEl = el('b');
    cap.append(capName, stateEl);
    const pickRow = el('div', 'sprout-preset-pick');
    const select = el('select');
    tip(select, LIST_TIPS[k]);
    select.addEventListener('change', () => choose(k, select.value));
    pickRow.appendChild(select);
    const prevBtn = button(pickRow, '◂', `The ${what} preset before this one in the list, round and round.`, 'sprout-btn sprout-narrow');
    prevBtn.addEventListener('click', () => cyclePreset(k, -1));
    const nextBtn = button(pickRow, '▸', `Next preset: the next ${what} preset in the list, round and round (Shift-click: the one before).`, 'sprout-btn sprout-narrow');
    nextBtn.addEventListener('click', (e) => cyclePreset(k, e.shiftKey ? -1 : 1));
    const descEl = el('div', 'sprout-desc');
    const acts = el('div', 'sprout-preset-acts');
    const saveBtn = button(acts, 'Save', `Overwrite this saved ${what} preset with the current values.`);
    const saveAsBtn = button(acts, 'Save as…', `Save the current ${what} settings as a new preset under a name of your choice. Kept in this browser; use Export to move it.`);
    const revertBtn = button(acts, 'Revert', `Revert all changes: every ${what} value back to the active preset. Your changes are kept as "Unsaved tweaks" in the list.`);
    acts.appendChild(el('span', 'sprout-preset-gap'));
    const exportBtn = button(acts, 'Export', `Save the current ${what} settings as a preset file (.json) to share or move to another browser.`, 'sprout-btn sprout-quiet');
    const importBtn = button(acts, 'Import', `Load a ${what} preset file (it is added to this list). Older preset files are split into their visual and reactivity parts.`, 'sprout-btn sprout-quiet');
    const delBtn = button(acts, 'Delete', 'Delete this saved preset (asks for a second click). The values stay on screen.', 'sprout-btn sprout-quiet');
    // "Save as…" opens a name field under the buttons.
    const saveAs = el('div', 'sprout-saveas');
    saveAs.hidden = true;
    const nameIn = el('input');
    nameIn.type = 'text';
    nameIn.maxLength = 32;
    nameIn.value = 'Mine';
    nameIn.spellcheck = false;
    tip(nameIn, 'Name for the new preset. Enter saves, Esc cancels.');
    saveAs.appendChild(nameIn);
    const saveNewBtn = button(saveAs, 'Save new', 'Save the current values as a preset with this name.');
    button(saveAs, '✕', 'Cancel.', 'sprout-btn sprout-quiet sprout-narrow').addEventListener('click', () => (saveAs.hidden = true));
    card.append(cap, pickRow, descEl, acts, saveAs);
    pageEls[TAB_IDS.indexOf(KIND_TAB[k])]?.prepend(card);
    sections[k] = { k, card, select, stateEl, descEl, saveBtn, revertBtn, delBtn, nameIn, namedFor: undefined };
    rebuildList(k);

    saveBtn.addEventListener('click', () => {
      const pr = activePreset(k);
      if (!pr || pr.builtin) return;
      pr.values = diffOf(p, k);
      afterPresetChange(k, false);
    });
    saveAsBtn.addEventListener('click', () => {
      saveAs.hidden = !saveAs.hidden;
      if (!saveAs.hidden) {
        nameIn.focus();
        nameIn.select();
      }
    });
    let overwriteArmed = 0;
    const saveNew = () => {
      let name = nameIn.value.trim().slice(0, 32);
      if (!name) return;
      if (BUILTINS[k].some((x) => x.name.toLowerCase() === name.toLowerCase())) name += ' (mine)';
      const id = 'user:' + slug(name);
      if (store[k].user.some((x) => x.id === id) && performance.now() > overwriteArmed) {
        overwriteArmed = performance.now() + 3000;
        say(saveNewBtn, 'Overwrite?', 'Save new');
        return;
      }
      overwriteArmed = 0;
      saveNewBtn.textContent = 'Save new';
      saveAs.hidden = true;
      store[k].user = [...store[k].user.filter((x) => x.id !== id), { id, name, values: diffOf(p, k) }];
      active[k] = id;
      afterPresetChange(k, false);
    };
    saveNewBtn.addEventListener('click', saveNew);
    nameIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveNew();
      else if (e.key === 'Escape') saveAs.hidden = true;
    });
    revertBtn.addEventListener('click', () => {
      if (active[k] === null) return;
      if (isDirty(p, activePreset(k), k)) store[k].stash = diffOf(p, k);
      applyPreset(p, activePreset(k), k);
      afterPresetChange(k, true);
    });
    let deleteArmed = 0;
    delBtn.addEventListener('click', () => {
      if (performance.now() > deleteArmed) {
        deleteArmed = performance.now() + 3000;
        say(delBtn, 'Really delete?', 'Delete');
        return;
      }
      deleteArmed = 0;
      delBtn.textContent = 'Delete';
      store[k].user = store[k].user.filter((x) => x.id !== active[k]);
      active[k] = null;
      afterPresetChange(k, false);
    });
    exportBtn.addEventListener('click', () => {
      const pr = activePreset(k);
      const name = pr?.name ?? 'custom';
      download(`sprout-${k}-${slug(name)}.json`, { sprout: 'preset', version: 2, kind: k, name, description: pr?.description, values: diffOf(p, k) });
    });
    importBtn.addEventListener('click', () => importFile(k, (message) => say(importBtn, message, 'Import')));
  }

  // ---- Combined sliders (not settings: each moves several real settings) ----
  type MacroRow = { spec: (typeof MACROS)[number]; obj: Record<string, number>; binding: { label: string | undefined; refresh(): void; element: HTMLElement } };
  const macroRows: MacroRow[] = [];
  for (const spec of MACROS) {
    const obj: Record<string, number> = { [spec.id]: 0.5 };
    const b = pageOf(spec.tab).addBinding(obj, spec.id, { min: 0, max: 1, label: spec.label });
    b.element.classList.add('sprout-macro');
    tip(b.element, 'Combined slider. ' + spec.tip + '\n“~” after the name: the settings it moves were changed one by one; moving it puts them back in line.');
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
  const folderRows: { folder: Folder; rows: Row[] }[] = [];
  /** Every folder with its tab; `top` for the ones directly on a tab page ("Fold all"). */
  const allFolders: { folder: Folder; tab: TabId; top: boolean }[] = [];

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
    const revert = el('button', 'sprout-rv', '↺');
    revert.addEventListener('click', (e) => {
      e.stopPropagation();
      const to = e.shiftKey ? getPath(defaults, path) : baseline(path);
      obj[key] = structuredClone(to);
      if (spec && typeof to === 'number') stretch(binding, spec, to);
      binding.refresh();
      updateMarks();
      userChange();
    });
    binding.element.querySelector('.tp-lblv_l')?.appendChild(revert);
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
    const row = { path, binding, button: revert, spec };
    rows.push(row);
    for (const g of groups) g.push(row);
  };

  const pathTab = new Map<string, TabId>();
  /** Where a setting lives, for the search results: "Look › Colours › Branches". */
  const pathTrail = new Map<string, string>();
  /** The buttons inside folders, so search finds them too. */
  const folderButtons: { label: string; trail: string; text: string; tab: TabId; folders: Folder[]; element: HTMLElement }[] = [];
  const specs: FolderSpec[] = [...FOLDERS, ...(unsorted.length ? [{ id: 'unsorted', tab: 'setup' as const, title: 'Unsorted', keys: unsorted }] : [])];
  for (const spec of specs) {
    const folder = pageOf(spec.tab).addFolder({ title: spec.title, expanded: panelState[spec.id] ?? !!spec.open });
    /** A nested folder dressed as a group: its class, its quiet note, its tooltip. */
    const dress = (f: Folder, cls: string, note: string | undefined, hint: string | undefined, top = false) => {
      f.element.classList.add(cls);
      if (note) f.element.querySelector('.tp-fldv_t')?.after(el('span', 'sprout-note', note));
      folderTip(f, hint);
      allFolders.push({ folder: f, tab: spec.tab, top });
    };
    remember(spec.id, folder);
    dress(folder, 'sprout-top', spec.note, FOLDER_HINTS[spec.id], true);
    const trail = `${TAB_TITLES[spec.tab]} › ${spec.title}`;
    const fRows: Row[] = [];
    folderRows.push({ folder, rows: fRows });
    const place = (path: string, folders: Folder[], groups: Row[][], where: string) => {
      addRow(folders[folders.length - 1], path, groups);
      pathFolders.set(path, folders);
      pathTab.set(path, spec.tab);
      pathTrail.set(path, where);
    };
    for (const path of [...spec.keys, ...(extra.get(spec.id) ?? [])]) place(path, [folder], [fRows], trail);
    for (const sub of spec.sub ?? []) {
      const sf = folder.addFolder({ title: sub.title, expanded: panelState[spec.id + '.' + sub.id] ?? false });
      remember(spec.id + '.' + sub.id, sf);
      dress(sf, 'sprout-sub', sub.note, FOLDER_HINTS[sub.id]);
      const sRows: Row[] = [];
      folderRows.push({ folder: sf, rows: sRows });
      for (const path of sub.keys) place(path, [folder, sf], [fRows, sRows], `${trail} › ${sub.title}`);
      if (sub.id.startsWith('col')) {
        // Quick "movement" buttons: they set the role to a gradient and its movers. They sit
        // under "colour from" (placed once the rows exist: see the note at the top).
        const bar = el('div', 'sprout-moves');
        bar.appendChild(el('span', '', 'movement'));
        moveBars.set(sub.id, bar);
        for (const mv of MOVEMENTS) {
          button(bar, mv.label, mv.tip).addEventListener('click', () => {
            const role = (p as unknown as Record<string, Record<string, unknown>>)[sub.id];
            role.source = 'gradient';
            Object.assign(role, mv.values);
            quietUntil = performance.now() + 60;
            pane.refresh();
            updateMarks();
            userChange();
          });
        }
        const source = sRows.find((r) => r.path === `${sub.id}.source`);
        if (source) source.binding.element.after(bar);
        else sf.element.querySelector('.tp-fldv_c')?.appendChild(bar);
      }
    }
    if (spec.advanced?.length) {
      const adv = folder.addFolder({ title: 'Advanced', expanded: panelState[spec.id + '.adv'] ?? false });
      remember(spec.id + '.adv', adv);
      dress(adv, 'sprout-adv', undefined, 'Values you rarely need to change.');
      adv.hidden = !showAdv.showAdvanced;
      advFolders.push(adv);
      const aRows: Row[] = [];
      folderRows.push({ folder: adv, rows: aRows });
      for (const path of spec.advanced) place(path, [folder, adv], [fRows, aRows], `${trail} › Advanced`);
    }
    /** A button at the foot of this folder (search finds it by its title and tooltip). */
    const action = (b: ButtonApi, text: string) => {
      btnTip(b, text);
      folderButtons.push({ label: b.title ?? '', trail, text, tab: spec.tab, folders: [folder], element: b.element });
      return b;
    };
    if (spec.id === 'theme') {
      action(folder.addButton({ title: 'Edit themes…' }), 'Make your own themes with your own pictures (opens the theme editor of Sprout.exe in a new tab).')
        .on('click', () => window.open(`http://localhost:${p.source.port}/themes`, '_blank'));
      action(confirmButton(folder, 'Set every tap to Auto', 'Click again: every tap follows this look', () => actions.tapsToAuto()),
        'Every Sprout Tap window: Theme, Leaves and Colour back to Auto, so every track follows the look picked here. A tap set to its own theme or colour keeps it until then (asks for a second click).');
    }
    if (spec.id === 'commit') {
      action(folder.addButton({ title: 'Test: commit the live take' }), 'Fake singer: pretend the live take finished recording, to watch the planting animation.')
        .on('click', () => {
          actions.commitLive();
          pane.refresh();
        });
      action(folder.addButton({ title: 'Test: delete the last take' }), 'Fake singer: remove the newest take, to watch it fade with falling leaves.')
        .on('click', () => {
          actions.deleteTake();
          pane.refresh();
        });
    }
    if (spec.id === 'test') {
      action(folder.addButton({ title: 'Load avatar PNG…' }), 'Show your own avatar picture (PNG with transparency) instead of the grey shape, to judge the look. Stays in this browser; never shown in OBS.')
        .on('click', () => actions.loadAvatar());
      action(folder.addButton({ title: 'Remove avatar PNG' }), 'Back to the grey placeholder shape.').on('click', () => actions.clearAvatar());
    }
    if (spec.id === 'fake') {
      action(folder.addButton({ title: 'Restart growth' }), 'Start the fake singer and all trees from the beginning.').on('click', () => actions.restart());
    }
    if (spec.id === 'backup') {
      action(folder.addButton({ title: 'Export everything (.json)' }), 'Save every setting and your own presets to one file (a backup, or to move to another browser).')
        .on('click', () => download('sprout-settings.json', { sprout: 'settings', version: 2, params: p, presets: store }));
      const importAll = action(folder.addButton({ title: 'Import…' }), 'Load a settings file or a preset file.');
      importAll.on('click', () => importFile(null, (message) => {
        importAll.title = message;
        setTimeout(() => (importAll.title = 'Import…'), 3000);
      }));
      action(confirmButton(folder, 'Reset everything', 'Click again to reset everything', () => {
        deepMerge(p as unknown as Record<string, unknown>, structuredClone(defaults));
        for (const k of KINDS) active[k] = 'default';
        afterPresetChange(null, true);
      }), 'Every setting back to factory defaults, including the fit to your avatar and colours (asks for a second click).');
    }
  }
  syncAdv();

  // "Fold all" closes every folder of the tab in view; with all of them closed it opens the top ones.
  const anyOpen = () => allFolders.some((f) => f.top && f.tab === currentTab() && f.folder.expanded);
  syncFoldAll = () => {
    const open = anyOpen();
    foldAllBtn.textContent = open ? 'Fold all' : 'Open all';
    tip(foldAllBtn, open ? 'Close every folder of this tab, for an overview.' : 'Open every folder of this tab (the folders inside them stay closed).');
  };
  foldAllBtn.addEventListener('click', () => {
    const open = anyOpen(), tb = currentTab();
    for (const f of allFolders) {
      if (f.tab !== tb) continue;
      if (open) f.folder.expanded = false;
      else if (f.top) f.folder.expanded = true;
    }
    syncFoldAll();
  });
  syncTabs();

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
    // A dot on every folder that holds a changed row.
    for (const f of folderRows)
      f.folder.element.classList.toggle('sprout-dot', f.rows.some((r) => r.binding.element.classList.contains('sprout-mod')));
    const hide = (path: string, h: boolean) => rows.filter((r) => r.path === path).forEach((r) => (r.binding.hidden = h));
    // Colour roles: the gradient and its movers only when the source is a gradient.
    for (const r of ['colBranch', 'colLeaf', 'colAccent', 'colHalo'] as const) {
      const role = p[r] as { source: string; voice: string };
      const grad = role.source === 'gradient';
      for (const k of ['gradient', 'along', 'speed', 'voice', 'voiceAmount', 'perTake', 'scatter']) hide(`${r}.${k}`, !grad);
      hide(`${r}.voiceAmount`, !grad || role.voice === 'none');
      hide(`${r}.takeMix`, role.source === 'take' || role.source === 'branches');
      const bar = moveBars.get(r);
      if (bar) bar.style.display = grad ? '' : 'none';
    }
    hide('glow.tint', false);
    // Look palette: its list and pick only when the look brings its own colours.
    const pal = p.palette.from === 'list';
    hide('palette.list', !pal);
    hide('palette.pick', !pal);
    hide('palette.seed', !pal || p.palette.pick !== 'random');
    // Branch per phrase replaces "new tree each phrase"; its own settings only while on.
    hide('growth.newTreeEachPhrase', p.growth.branchEachPhrase);
    for (const k of ['branchesKept', 'branchOrder', 'branchSymmetry', 'branchWitherSeconds', 'branchDroopDeg', 'branchFallSeconds']) hide(`growth.${k}`, !p.growth.branchEachPhrase);
    for (const e of editors) e.ed.el.style.display = e.binding.hidden ? 'none' : '';
    hide('growth.witherDipSemitones', !p.growth.witherOnPitchDip);
    hide('growth.witherDepth', !p.growth.onPause && !p.growth.witherOnPitchDip);
    hide('growth.fadeAfter', !p.growth.onPhraseEnd);
    hide('growth.witherFromTips', p.growth.witherEffect === 'ungrow');
    hide('plants.trunkLean', !(p.plants.trunk > 0));
    hide('harmony.colourMode', p.harmony.colour <= 0);
    hide('harmony.colourValue', p.harmony.colour <= 0 || p.harmony.colourMode !== 'colour');
    hide('harmony.colourMix', p.harmony.colour <= 0 || p.harmony.colourMode === 'colour');
    for (const k of ['waveLead', 'waveFrom', 'waveLength', 'waveSpeed']) hide('harmony.' + k, p.harmony.colour <= 0 || p.harmony.colourMode !== 'waves');
    hide('fake.together', p.fake.voices !== 'duet');
    hide('fake.harmony', p.fake.voices === 'together');
    hide('scene.scopeLayer', !p.scene.showScope);
    hide('scene.scopeSeconds', !p.scene.showScope);
    const motion = p.motion as unknown as Record<string, unknown>;
    if ('shiver' in motion) hide('motion.shiverDeg', !motion.shiver);

    for (const k of KINDS) {
      const sec = sections[k];
      const pr = activePreset(k);
      const dirty = active[k] === null ? false : isDirty(p, pr, k);
      // A dot on the tab and "changed" on the card: values differ from the preset picked.
      const tabBtn = tabBtns[TAB_IDS.indexOf(KIND_TAB[k])];
      tabBtn.classList.toggle('sprout-dirty', dirty);
      tip(tabBtn, TAB_TIPS[KIND_TAB[k]] + (dirty ? `\nThe dot: something was changed since “${pr?.name ?? ''}” was picked (Save, Save as… or Revert on its preset card).` : ''));
      sec.stateEl.textContent = dirty ? 'changed' : pr ? '' : 'matches no preset';
      const text = pr?.description ?? '';
      sec.descEl.textContent = text;
      sec.descEl.hidden = !text;
      sec.saveBtn.hidden = !pr || !!pr.builtin;
      sec.saveBtn.disabled = !dirty;
      sec.revertBtn.disabled = !dirty;
      sec.delBtn.hidden = !pr || !!pr.builtin;
      // Suggest a name only when the active preset changes (never over what is being typed).
      if (active[k] !== sec.namedFor) {
        sec.namedFor = active[k];
        sec.nameIn.value = pr ? (pr.builtin ? pr.name + ' 2' : pr.name) : 'Mine';
      }
      if (sec.select.value !== (active[k] ?? CUSTOM)) sec.select.value = active[k] ?? CUSTOM;
    }
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
  /** Show the panel, open a tab and these folders, scroll to an element and flash it. */
  function show(tb: TabId | undefined, folders: Folder[], element: HTMLElement) {
    container.style.display = '';
    setFolded(false);
    if (tb) pageOf(tb).selected = true;
    for (const f of folders) {
      f.expanded = true;
      if (f.hidden && advFolders.includes(f)) f.hidden = false;
    }
    setTimeout(() => {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element.classList.remove('sprout-flash');
      void element.offsetWidth;
      element.classList.add('sprout-flash');
    }, 60);
  }
  function reveal(path: string) {
    const row = rows.find((r) => r.path === path);
    if (!row) return;
    row.binding.hidden = false;
    show(pathTab.get(path), pathFolders.get(path) ?? [], row.binding.element);
  }

  // ---- Search results ----
  type Hit = { label: string; trail: string; go(): void };
  let hits: Hit[] = [], hitAt = 0;
  const closeResults = () => {
    hits = [];
    resultsEl.replaceChildren();
    resultsEl.style.display = 'none';
  };
  const markHit = () => [...resultsEl.querySelectorAll('.sprout-hit')].forEach((b, i) => {
    b.classList.toggle('sel', i === hitAt);
    if (i === hitAt) b.scrollIntoView({ block: 'nearest' });
  });
  const runSearch = () => {
    const terms = searchIn.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    closeResults();
    if (!terms.length) return;
    /** Every word has to be somewhere; a word in the name counts most, then the folder, then the tooltip. */
    const score = (label: string, where: string, text: string) => {
      let s = 0;
      for (const t of terms) {
        if (label.includes(t)) s += label.startsWith(t) ? 5 : 4;
        else if (where.includes(t)) s += 2;
        else if (text.includes(t)) s += 1;
        else return 0;
      }
      return s;
    };
    const found: (Hit & { s: number })[] = [];
    for (const r of rows) {
      const label = LABELS[r.path] ?? r.path.split('.')[1];
      const trail = pathTrail.get(r.path) ?? '';
      const s = score(label.toLowerCase(), (trail + ' ' + r.path).toLowerCase(), (TIPS[r.path] ?? HINTS[r.path] ?? '').toLowerCase());
      if (s) found.push({ s, label, trail: trail + (r.binding.hidden ? '  ·  not in use right now' : ''), go: () => reveal(r.path) });
    }
    for (const b of folderButtons) {
      const s = score(b.label.toLowerCase(), b.trail.toLowerCase(), b.text.toLowerCase());
      if (s) found.push({ s, label: b.label + '  (button)', trail: b.trail, go: () => show(b.tab, b.folders, b.element) });
    }
    found.sort((a, b) => b.s - a.s);
    hits = found.slice(0, 12);
    hitAt = 0;
    for (const h of hits) {
      const b = el('button', 'sprout-hit', h.label);
      b.type = 'button';
      b.appendChild(el('small', '', h.trail));
      b.addEventListener('click', () => pick(h));
      resultsEl.appendChild(b);
    }
    if (!hits.length) resultsEl.appendChild(el('div', 'sprout-hit-none', 'Nothing found.'));
    else if (found.length > hits.length) resultsEl.appendChild(el('div', 'sprout-hit-none', `…and ${found.length - hits.length} more: type another word.`));
    resultsEl.style.display = 'block';
    markHit();
  };
  const pick = (h: Hit | undefined) => {
    if (!h) return;
    closeResults();
    searchIn.select();
    h.go();
  };
  searchIn.addEventListener('input', runSearch);
  searchIn.addEventListener('focus', () => {
    if (searchIn.value && !hits.length) runSearch();
  });
  searchIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pick(hits[hitAt]);
    else if (e.key === 'Escape') {
      searchIn.value = '';
      closeResults();
      searchIn.blur();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) hitAt = (hitAt + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      markHit();
    }
  });
  function search() {
    container.style.display = '';
    setFolded(false);
    searchIn.focus();
    searchIn.select();
  }

  // ---- Width: drag the left edge (double-click: back to the usual width) ----
  {
    const fit = (w: number | null) => {
      container.style.width = w ? `${w}px` : '';
      // The value column keeps its share of the row at any width.
      const now = container.getBoundingClientRect().width;
      if (now > 0) container.style.setProperty('--tp-blade-value-width', `${Math.round(now * VALUE_SHARE)}px`);
    };
    const grip = el('div', 'sprout-grip');
    tip(grip, 'Drag to make the panel wider or narrower. Double-click: the usual width.');
    container.appendChild(grip);
    let saved: number | null = null;
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) saved = w;
    } catch {
      /* ignore */
    }
    fit(saved);
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('on');
      const x0 = e.clientX, w0 = container.getBoundingClientRect().width;
      const move = (ev: PointerEvent) => fit(Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w0 + x0 - ev.clientX))));
      const up = () => {
        grip.classList.remove('on');
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        try {
          localStorage.setItem(WIDTH_KEY, String(Math.round(container.getBoundingClientRect().width)));
        } catch {
          /* ignore */
        }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => {
      fit(null);
      try {
        localStorage.removeItem(WIDTH_KEY);
      } catch {
        /* ignore */
      }
    });
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
  return { refresh, reveal, search, themesChanged, pickPreset, cyclePreset };
}
