// Tweak panel, generated from `params`: every value in params.ts gets a control automatically.
// RANGES sets slider limits so the full travel of each slider makes a visible difference; typed
// values may go beyond them. Changes are saved to localStorage, and presets can be exported or
// imported as JSON files.

import { Pane } from 'tweakpane';
import { defaults, Params } from './params';

const STORAGE_KEY = 'sprout.viewer.params.v2';

type Spec = { min?: number; max?: number; step?: number; options?: Record<string, string | number> };

const RANGES: Record<string, Spec> = {
  'source.mode': { options: { 'Auto (live when connected)': 'auto', 'Live taps only': 'live', 'Fake singer': 'fake' } },
  'source.port': { min: 1, max: 65535, step: 1 },
  'source.holdSeconds': { min: 0, max: 10 },
  'scene.layers': { min: 1, max: 17, step: 1 },
  'scene.timeScale': { min: 0, max: 4 },
  'scene.viewRadius': { min: 1, max: 3.5 },
  'scene.centerX': { min: -1.5, max: 1.5 },
  'scene.centerY': { min: -1.5, max: 1.5 },
  'scene.backdrop': { options: { Checker: 'checker', Black: 'black', 'None (transparent)': 'none' } },
  'growth.secondsToFull': { min: 0.5, max: 15 },
  'growth.branching': { min: 0, max: 1 },
  'growth.reach': { min: 0.4, max: 1.6 },
  'growth.restBrightness': { min: 0, max: 1 },
  'growth.spread': { min: 0.4, max: 2 },
  'growth.sweep': { min: 0, max: 1 },
  'plants.generator': { options: { 'Gesture (spine + feathers)': 'gesture', 'Space colonisation (old)': 'colonise' } },
  'plants.lift': { min: -1, max: 1 },
  'plants.wildness': { min: 0, max: 1 },
  'plants.overlap': { min: 0, max: 1 },
  'plants.planform': { min: 0, max: 1 },
  'plants.taper': { min: 0, max: 1 },
  'plants.featherSide': { options: { 'Upper side': 1, 'Lower side': -1 } },
  'plants.softDroop': { min: 0, max: 2 },
  'layout.downGap': { min: 0, max: 200 },
  'growth.witherDipSemitones': { min: 1, max: 12, step: 1 },
  'growth.witherDepth': { min: 0.05, max: 1.5 },
  'growth.witherSeconds': { min: 0.1, max: 5 },
  'growth.leafFadeSeconds': { min: 0.05, max: 3 },
  'growth.twigFadeSeconds': { min: 0.05, max: 3 },
  'growth.regrowSpeed': { min: 0.2, max: 5 },
  'growth.fadeAfter': { min: 0, max: 15 },
  'growth.fadeSeconds': { min: 0.2, max: 10 },
  'response.release': { min: 0.1, max: 8 },
  'response.phraseGap': { min: 0.1, max: 2 },
  'response.variety': { min: 0, max: 1 },
  'response.pitchSteer': { min: 0, max: 1 },
  'response.effortWidth': { min: 0, max: 2 },
  'response.brightness': { min: 0, max: 1 },
  'look.theme': { options: { Branches: 'branches', Leaves: 'leaves', Thorns: 'thorns', 'Christmas wreath': 'wreath' } },
  'look.density': { min: 0, max: 1 },
  'look.decoSize': { min: 0.2, max: 4 },
  'look.decoGlow': { min: 0, max: 1.5 },
  'look.naturalTint': { min: 0, max: 1 },
  'look.blossoms': { min: 0, max: 1 },
  'look.thornEffort': { min: 0, max: 3 },
  'colours.mode': { options: { 'Take colours': 'take', Rainbow: 'rainbow' } },
  'colours.rainbowSpeed': { min: 0, max: 0.5 },
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
  'plants.attractors': { min: 30, max: 1200, step: 1 },
  'plants.step': { min: 0.01, max: 0.1 },
  'plants.influence': { min: 0.08, max: 0.8 },
  'plants.kill': { min: 0.02, max: 0.3 },
  'plants.jitter': { min: 0, max: 1 },
  'plants.smoothing': { min: 0, max: 12, step: 1 },
  'plants.tipWidth': { min: 0.001, max: 0.04 },
  'plants.maxWidth': { min: 0.005, max: 0.12 },
  'plants.pipeExponent': { min: 1.5, max: 4 },
  'plants.maxNodes': { min: 100, max: 5000, step: 1 },
  'envelope.crownMin': { min: 0, max: 2 },
  'envelope.crownLength': { min: 0.3, max: 3 },
  'envelope.crownHalfAngle': { min: 10, max: 180 },
  'envelope.crownTaper': { min: 0, max: 1 },
  'envelope.wingMin': { min: 0, max: 2 },
  'envelope.wingLength': { min: 0.3, max: 3 },
  'envelope.wingHalfAngle': { min: 5, max: 120 },
  'envelope.wingBend': { min: -90, max: 90 },
  'envelope.wingTaper': { min: 0, max: 1 },
  'envelope.wedgeMin': { min: 0, max: 2 },
  'envelope.wedgeLength': { min: 0.3, max: 3 },
  'envelope.wedgeFill': { min: 0.2, max: 1.2 },
  'envelope.wedgeBend': { min: -90, max: 90 },
  'envelope.wedgeTaper': { min: 0, max: 1 },
  'envelope.shrinkPerTake': { min: 0, max: 0.15 },
  'layout.lowOriginY': { min: -1.5, max: 1 },
  'layout.midOriginY': { min: -1.5, max: 1 },
  'layout.wingTilt': { min: -45, max: 60 },
  'layout.tierFrom': { min: 3, max: 17, step: 1 },
  'layout.innerScale': { min: 0.3, max: 1 },
  'layout.spinFrom': { min: 1, max: 17, step: 1 },
  'layout.spinSpeed': { min: -180, max: 180 },
  'layout.ease': { min: 0.2, max: 10 },
  'transitions.liveEndSeconds': { min: 0.1, max: 5 },
  'halo.ringSpacing': { min: 0.03, max: 0.4 },
  'fake.liveTracks': { min: 1, max: 4, step: 1 },
  'transitions.pruneSeconds': { min: 0.3, max: 5 },
  'avatar.opacity': { min: 0, max: 1 },
  'avatar.headX': { min: -1, max: 1 },
  'avatar.headY': { min: -1, max: 1 },
  'avatar.headR': { min: 0, max: 1 },
  'avatar.bodyTopY': { min: -2, max: 1 },
  'avatar.bodyBottomY': { min: -4, max: 0 },
  'avatar.bodyR': { min: 0, max: 1.5 },
  'motion.swayDeg': { min: 0, max: 30 },
  'motion.swayFromLevel': { min: 0, max: 5 },
  'motion.swayHz': { min: 0.02, max: 2 },
  'motion.trembleDeg': { min: 0, max: 12 },
  'glow.strength': { min: 0, max: 6 },
  'glow.radius': { min: 0.2, max: 5 },
  'glow.wide': { min: 0, max: 3 },
  'glow.base': { min: 0, max: 2 },
  'glow.levelGain': { min: 0, max: 4 },
  'glow.onsetGain': { min: 0, max: 4 },
  'glow.pitchShine': { min: 0, max: 3 },
  'glow.front': { min: 0, max: 5 },
  'glow.softGlow': { min: 0, max: 2 },
  'fake.seed': { min: 1, max: 999, step: 1 },
  'fake.phraseMin': { min: 0.5, max: 10 },
  'fake.phraseMax': { min: 0.5, max: 15 },
  'fake.gapMin': { min: 0, max: 5 },
  'fake.gapMax': { min: 0, max: 8 },
  'fake.highNotes': { min: 0, max: 1 },
};

const TITLES: Record<string, string> = {
  source: 'Audio source & sync',
  scene: 'Scene',
  growth: 'Growth (start here)',
  response: 'Response',
  look: 'Look (fallback; per track in the VST)',
  colours: 'Colours',
  halo: 'Live halo',
  plants: 'Take plants (structure)',
  envelope: 'Take plants (shape)',
  layout: 'Layout',
  transitions: 'Transitions',
  avatar: 'Avatar keep-out',
  motion: 'Sway & tremble',
  glow: 'Glow & shine',
  fake: 'Fake singer',
};

const OPEN_FOLDERS = new Set(['growth']);

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
    if (saved) deepMerge(p, JSON.parse(saved));
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

export function saveParams(p: Params) {
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
}

export function buildUI(container: HTMLElement, p: Params, actions: UIActions, status: UIStatus): UI {
  const pane = new Pane({ container, title: 'Sprout viewer  (H hides)' });
  pane.addBinding(status, 'feed', { readonly: true, label: 'feed' });
  pane.addBinding(status, 'layers', { readonly: true, label: 'layers' });
  pane.addBinding(status, 'pitch', { readonly: true, label: 'live pitch' });
  pane.addBinding(status, 'voice', { readonly: true, label: 'live voice' });

  // Changes applied from another viewer must never be sent back: that echo, arriving late, is
  // what overwrote newer values while dragging. Ignore panel events for a moment after a refresh.
  let quietUntil = 0;
  const isQuiet = () => performance.now() < quietUntil;
  const userChange = () => {
    saveParams(p);
    actions.changed();
  };

  const act = pane.addFolder({ title: 'Actions', expanded: false });
  act.addButton({ title: 'Restart growth' }).on('click', () => actions.restart());
  act.addButton({ title: 'Commit live take (fake singer test)' }).on('click', () => {
    actions.commitLive();
    pane.refresh();
  });
  act.addButton({ title: 'Delete last take (fake singer test)' }).on('click', () => {
    actions.deleteTake();
    pane.refresh();
  });
  act.addButton({ title: 'Export preset (.json)' }).on('click', () => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sprout-preset.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  act.addButton({ title: 'Import preset…' }).on('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      deepMerge(p, JSON.parse(await file.text()));
      refresh();
      userChange();
    };
    input.click();
  });
  act.addButton({ title: 'Reset to defaults' }).on('click', () => {
    deepMerge(p, structuredClone(defaults));
    refresh();
    userChange();
  });

  for (const [section, obj] of Object.entries(p) as [string, Record<string, unknown>][]) {
    const folder = pane.addFolder({ title: TITLES[section] ?? section, expanded: OPEN_FOLDERS.has(section) });
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      const opts: Record<string, unknown> = { label: key, ...(RANGES[`${section}.${key}`] ?? {}) };
      if (typeof v === 'string' && v.startsWith('#')) opts.view = 'color';
      else if (typeof v === 'number' && opts.min === undefined) {
        opts.min = Math.min(0, v * 4);
        opts.max = Math.max(1, v * 4);
      }
      folder.addBinding(obj, key, opts);
    }
  }

  let timer = 0;
  pane.on('change', () => {
    if (isQuiet()) return;
    clearTimeout(timer);
    timer = window.setTimeout(userChange, 80);
  });

  function refresh() {
    quietUntil = performance.now() + 400;
    clearTimeout(timer);
    pane.refresh();
  }
  return { refresh };
}
