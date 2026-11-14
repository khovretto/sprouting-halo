// Tweak panel, generated from `params`: every value in params.ts gets a control automatically,
// grouped by panel-layout.ts (artist folders, then setup folders; keys not listed there still
// appear). RANGES sets slider limits so the full travel of each slider makes a visible difference;
// typed values may go beyond them. Labels come from panel-layout.ts, tooltips from the doc
// comments in params.ts. Presets (presets.ts): built-in looks, saved looks, a revert button on
// every changed row (to the active preset; Shift-click: the factory default).

import { FolderApi, ListBladeApi, Pane } from 'tweakpane';
import { defaults, Params } from './params';
import paramsSource from './params.ts?raw';
import { FOLDER_HINTS, FOLDERS, LABELS, scopeOf } from './panel-layout';
import { installTooltips, tip } from './tooltip';
import {
  applyPreset, BUILTIN_PRESETS, getPath, isDirty, loadStore, lookDiff, PATHS, Preset, presetValue, same, saveStore, slug, Values,
} from './presets';

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
  'scene.scopeLayer': { min: 0, max: 16, step: 1 },
  'scene.scopeSeconds': { min: 3, max: 40, step: 1 },
  'scene.backdrop': { options: { Checker: 'checker', Black: 'black', 'None (transparent)': 'none' } },
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
  'growth.fadeSeconds': { min: 0.2, max: 10 },
  'response.release': { min: 0.1, max: 8 },
  'response.phraseGap': { min: 0.1, max: 2 },
  'response.variety': { min: 0, max: 1 },
  'response.pitchSteer': { min: 0, max: 1 },
  'response.effortWidth': { min: 0, max: 2 },
  'response.brightness': { min: 0, max: 1 },
  'look.themeFrom': { options: { 'Each track (Sprout Tap window)': 'tracks', 'This preset (all tracks)': 'preset' } },
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
  'halo.tilt': { min: -45, max: 45 },
  'avatar.imageX': { min: -2, max: 2 },
  'avatar.imageY': { min: -3, max: 2 },
  'avatar.imageHeight': { min: 0.5, max: 8 },
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
  'fake.seed': { min: 1, max: 999, step: 1 },
  'fake.phraseMin': { min: 0.5, max: 10 },
  'fake.phraseMax': { min: 0.5, max: 15 },
  'fake.gapMin': { min: 0, max: 5 },
  'fake.gapMax': { min: 0, max: 8 },
  'fake.highNotes': { min: 0, max: 1 },
};

/** Older settings files: the sine sway/tremble became wind and shiver. */
export function migrate(v: unknown) {
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
  loadAvatar(): void;
  /** A preset was picked: its theme and amount go to every Sprout Tap. */
  presetApplied(theme: string, density: number): void;
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
      if (pending) out[`${section}.${key[1]}`] = pending;
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
.sprout-desc { color: #9aa0a8; font: 11px/1.35 sans-serif; padding: 2px 8px 6px; white-space: normal; }
`;

type Binding = { element: HTMLElement; hidden: boolean; refresh(): void };
type Folder = FolderApi;

export function buildUI(container: HTMLElement, p: Params, actions: UIActions, status: UIStatus): UI {
  if (!document.getElementById('sprout-ui-css')) {
    const st = document.createElement('style');
    st.id = 'sprout-ui-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const store = loadStore();
  const all = () => [...BUILTIN_PRESETS, ...store.user];
  const byId = (id: string | null) => (id ? all().find((x) => x.id === id) : undefined);
  /** Active preset: keep the stored one, else the one the values match, else none (custom). */
  const derive = (current: string | null): string | null => {
    const cur = byId(current);
    if (cur && !isDirty(p, cur)) return cur.id;
    const m = all().find((x) => !isDirty(p, x));
    if (m) return m.id;
    return cur ? cur.id : null;
  };
  let active = derive(store.active);
  const activePreset = () => byId(active);
  const baseline = (path: string) => (scopeOf(path) === 'look' ? presetValue(activePreset(), path) : getPath(defaults, path));

  const pane = new Pane({ container, title: 'Sprout viewer  (H hides, G scope)' });
  installTooltips(container);
  const folderTip = (f: Folder, text?: string) => tip(f.element.querySelector('.tp-fldv_b'), text);
  const btnTip = (b: { element: HTMLElement }, text: string) => tip(b.element.querySelector('button'), text);
  tip(pane.addBinding(status, 'feed', { readonly: true, label: 'feed' }).element,
    'Where the voice data comes from right now: live taps from Sprout.exe, or the fake singer.');
  tip(pane.addBinding(status, 'layers', { readonly: true, label: 'layers' }).element,
    'Live tracks (a halo each) and recorded takes (a tree each).');
  tip(pane.addBinding(status, 'pitch', { readonly: true, label: 'live pitch' }).element,
    'The note the first live track is singing, in cents off the note, and the vibrato rate when there is vibrato.');
  tip(pane.addBinding(status, 'voice', { readonly: true, label: 'live voice' }).element,
    'Effort (0 soft .. 1 full voice, measured from the overtones, so mic gain does not matter), breathiness, and softness (what the visuals use: low effort plus breath). G opens the voice scope to see them over time.');

  // Changes applied from another viewer must never be sent back: that echo, arriving late, is
  // what overwrote newer values while dragging. Ignore panel events for a moment after a refresh.
  let quietUntil = 0;
  const isQuiet = () => performance.now() < quietUntil;
  const userChange = () => {
    saveParams(p);
    store.active = active;
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

  // ---- Preset folder ----
  const pf = pane.addFolder({ title: 'Preset', expanded: panelState.preset ?? true });
  remember('preset', pf);
  folderTip(pf, FOLDER_HINTS.preset);
  const STASH = '__stash', CUSTOM = '__custom';
  const listOptions = () => [
    ...(active ? [] : [{ text: '(custom)', value: CUSTOM }]),
    ...BUILTIN_PRESETS.map((x) => ({ text: x.name, value: x.id })),
    ...[...store.user].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ text: '· ' + x.name, value: x.id })),
    ...(store.stash ? [{ text: 'Unsaved tweaks', value: STASH }] : []),
  ];
  let list = pf.addBlade({ view: 'list', label: 'preset', options: listOptions(), value: active ?? CUSTOM }) as ListBladeApi<string>;
  let suppressList = false;
  // Description: a plain line under the list (a readonly text binding scrolls sideways).
  const descEl = document.createElement('div');
  descEl.className = 'sprout-desc';
  const placeDesc = () => list.element.after(descEl);
  placeDesc();
  const saveBtn = pf.addButton({ title: 'Save' });
  btnTip(saveBtn, 'Overwrite this saved preset with the current values.');
  const nameObj = { name: 'My look' };
  const nameRow = pf.addBinding(nameObj, 'name', { label: 'new name' });
  let namedFor: string | null | undefined;
  const saveAsBtn = pf.addButton({ title: 'Save as new preset' });
  btnTip(saveAsBtn, 'Save the current look under the name above. It is kept in this browser; use Export to move it.');
  const revertAllBtn = pf.addButton({ title: 'Revert all changes' });
  btnTip(revertAllBtn, 'Put every look value back to the active preset. Your changes are kept as "Unsaved tweaks" in the list.');
  const delBtn = confirmButton(pf, 'Delete preset', 'Click again to delete', () => {
    store.user = store.user.filter((x) => x.id !== active);
    active = null;
    afterPresetChange(false);
  });
  const exportBtn = pf.addButton({ title: 'Export preset (.json)' });
  btnTip(exportBtn, 'Save the current look as a preset file to share or move to another browser.');
  exportBtn.on('click', () => {
    const pr = activePreset();
    const name = pr?.name ?? 'custom';
    download(`sprout-preset-${slug(name)}.json`, { sprout: 'preset', version: 1, name, description: pr?.description, values: lookDiff(p) });
  });
  const importBtn = pf.addButton({ title: 'Import… (preset or settings)' });
  btnTip(importBtn, 'Load a preset file (adds it to the list) or a full settings file (replaces everything).');

  const choose = (id: string) => {
    if (id === CUSTOM) return;
    const cur = activePreset();
    const dirtyNow = active === null || isDirty(p, cur);
    const stashFrom = dirtyNow ? lookDiff(p) : undefined;
    if (id === STASH) {
      const st = store.stash;
      applyPreset(p, undefined);
      if (st) deepMerge(p as unknown as Record<string, unknown>, st);
      store.stash = stashFrom;
      active = derive(null);
    } else {
      if (stashFrom) store.stash = stashFrom;
      applyPreset(p, byId(id));
      active = id;
      actions.presetApplied(p.look.theme, p.look.density);
    }
    afterPresetChange(true);
  };
  list.on('change', (ev) => {
    if (!suppressList) choose(ev.value);
  });

  /** Rebuild the list (options change after save / delete / import) and push the change out. */
  function afterPresetChange(valuesChanged: boolean) {
    const idx = pf.children.indexOf(list);
    list.dispose();
    list = pf.addBlade({ view: 'list', label: 'preset', options: listOptions(), value: active ?? CUSTOM, index: idx }) as ListBladeApi<string>;
    list.on('change', (ev) => {
      if (!suppressList) choose(ev.value);
    });
    placeDesc();
    if (valuesChanged) {
      quietUntil = performance.now() + 200;
      pane.refresh();
    }
    updateMarks();
    userChange();
  }

  saveBtn.on('click', () => {
    const pr = activePreset();
    if (!pr || pr.builtin) return;
    pr.values = lookDiff(p);
    afterPresetChange(false);
  });
  let overwriteArmed = 0;
  saveAsBtn.on('click', () => {
    let name = nameObj.name.trim().slice(0, 32);
    if (!name) return;
    if (BUILTIN_PRESETS.some((x) => x.name.toLowerCase() === name.toLowerCase())) name += ' (mine)';
    const id = 'user:' + slug(name);
    const existing = store.user.find((x) => x.id === id);
    if (existing && performance.now() > overwriteArmed) {
      overwriteArmed = performance.now() + 3000;
      saveAsBtn.title = `Overwrite "${name}"?`;
      setTimeout(() => (saveAsBtn.title = 'Save as new preset'), 3000);
      return;
    }
    overwriteArmed = 0;
    saveAsBtn.title = 'Save as new preset';
    const pr = { id, name, values: lookDiff(p) };
    store.user = [...store.user.filter((x) => x.id !== id), pr];
    active = id;
    afterPresetChange(false);
  });
  revertAllBtn.on('click', () => {
    if (active === null) return;
    if (isDirty(p, activePreset())) store.stash = lookDiff(p);
    applyPreset(p, activePreset());
    afterPresetChange(true);
  });

  const importFile = () => {
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
        importBtn.title = 'Not a valid .json file';
        setTimeout(() => (importBtn.title = 'Import… (preset or settings)'), 3000);
        return;
      }
      if (json.sprout === 'preset') {
        let name = String(json.name ?? 'Imported').slice(0, 32);
        if (all().some((x) => x.name.toLowerCase() === name.toLowerCase())) name += ' (imported)';
        const pr = { id: 'user:' + slug(name), name, description: json.description as string | undefined, values: (json.values ?? {}) as Values };
        store.user = [...store.user.filter((x) => x.id !== pr.id), pr];
        applyPreset(p, pr);
        active = pr.id;
      } else {
        // A full settings file (or an export from before presets existed).
        deepMerge(p as unknown as Record<string, unknown>, migrate(json.sprout === 'settings' ? json.params : json));
        if (json.sprout === 'settings' && Array.isArray(json.presets)) {
          for (const pr of json.presets as Preset[]) store.user = [...store.user.filter((x) => x.id !== pr.id), pr];
        }
        active = derive(active);
      }
      afterPresetChange(true);
    };
    input.click();
  };
  importBtn.on('click', importFile);

  // ---- Parameter folders ----
  type Row = { path: string; binding: Binding; button: HTMLButtonElement };
  const rows: Row[] = [];
  const folderRows: { folder: Folder; title: string; rows: Row[] }[] = [];

  const placed = new Set(FOLDERS.flatMap((f) => [...f.keys, ...(f.advanced ?? [])]));
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

  const addRow = (folder: Folder, path: string, groups: Row[][]) => {
    const [section, key] = path.split('.');
    const obj = (p as unknown as Record<string, Record<string, unknown>>)[section];
    if (!obj || !(key in obj)) return;
    const v = obj[key];
    const opts: Record<string, unknown> = { label: LABELS[path] ?? key, ...(RANGES[path] ?? {}) };
    if (typeof v === 'string' && v.startsWith('#')) opts.view = 'color';
    else if (typeof v === 'number' && opts.min === undefined) {
      opts.min = Math.min(0, v * 4);
      opts.max = Math.max(1, v * 4);
    }
    const binding = folder.addBinding(obj, key, opts) as unknown as Binding;
    tip(binding.element, HINTS[path]);
    const button = document.createElement('button');
    button.className = 'sprout-rv';
    button.textContent = '↺';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const to = e.shiftKey ? getPath(defaults, path) : baseline(path);
      obj[key] = structuredClone(to);
      binding.refresh();
      updateMarks();
      userChange();
    });
    binding.element.querySelector('.tp-lblv_l')?.appendChild(button);
    const row = { path, binding, button };
    rows.push(row);
    for (const g of groups) g.push(row);
  };

  let separated = false;
  const specs = [...FOLDERS, ...(unsorted.length ? [{ id: 'unsorted', title: 'Unsorted', keys: unsorted, setup: true }] : [])];
  for (const spec of specs) {
    if (spec.setup && !separated) {
      pane.addBlade({ view: 'separator' });
      separated = true;
    }
    const folder = pane.addFolder({ title: spec.title, expanded: panelState[spec.id] ?? !!spec.open });
    remember(spec.id, folder);
    folderTip(folder, (spec as { hint?: string }).hint ?? FOLDER_HINTS[spec.id]);
    const fRows: Row[] = [];
    folderRows.push({ folder, title: spec.title, rows: fRows });
    for (const path of [...spec.keys, ...(extra.get(spec.id) ?? [])]) addRow(folder, path, [fRows]);
    if (spec.advanced?.length) {
      const adv = folder.addFolder({ title: 'Advanced', expanded: panelState[spec.id + '.adv'] ?? false });
      remember(spec.id + '.adv', adv);
      folderTip(adv, 'Values you rarely need to change.');
      const aRows: Row[] = [];
      folderRows.push({ folder: adv, title: 'Advanced', rows: aRows });
      for (const path of spec.advanced) addRow(adv, path, [fRows, aRows]);
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
      folder.addButton({ title: 'Restart growth' }).on('click', () => actions.restart());
      folder.addButton({ title: 'Export everything (.json)' }).on('click', () =>
        download('sprout-settings.json', { sprout: 'settings', version: 1, params: p, presets: store.user }));
      folder.addButton({ title: 'Import…' }).on('click', importFile);
      confirmButton(folder, 'Reset everything', 'Click again to reset everything', () => {
        deepMerge(p as unknown as Record<string, unknown>, structuredClone(defaults));
        active = 'default';
        afterPresetChange(true);
      });
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
    for (const r of rows) {
      const mod = !same(getPath(p, r.path), baseline(r.path));
      r.binding.element.classList.toggle('sprout-mod', mod);
      if (mod) {
        const b = baseline(r.path), d = getPath(defaults, r.path);
        const fmt = (x: unknown) => (typeof x === 'number' ? +x.toFixed(3) : String(x));
        const pr = scopeOf(r.path) === 'look' ? activePreset()?.name : undefined;
        tip(r.button, `Revert to ${fmt(b)}${pr ? ` (${pr})` : ''}` + (same(b, d) ? '' : `.
Shift-click: factory default ${fmt(d)}`));
      }
    }
    for (const f of folderRows) {
      const any = f.rows.some((r) => r.binding.element.classList.contains('sprout-mod'));
      f.folder.title = f.title + (any ? ' •' : '');
    }
    const hide = (path: string, h: boolean) => rows.filter((r) => r.path === path).forEach((r) => (r.binding.hidden = h));
    hide('colours.rainbowSpeed', p.colours.mode !== 'rainbow');
    hide('growth.witherDipSemitones', !p.growth.witherOnPitchDip);
    hide('scene.scopeLayer', !p.scene.showScope);
    hide('scene.scopeSeconds', !p.scene.showScope);
    hide('commit.syncWindow', !p.commit.syncToOnset);
    const motion = p.motion as unknown as Record<string, unknown>;
    if ('shiver' in motion) hide('motion.shiverDeg', !motion.shiver);

    const pr = activePreset();
    const dirty = active === null ? false : isDirty(p, pr);
    const desc = { text: '' };
    pf.title = 'Preset: ' + (pr ? pr.name : 'Custom') + (dirty ? ' *' : '');
    desc.text = pr?.description ?? (pr ? '' : 'Values match no preset.');
    descEl.textContent = desc.text;
    descEl.style.display = desc.text ? '' : 'none';
    saveBtn.hidden = !pr || !!pr.builtin;
    saveBtn.disabled = !dirty;
    revertAllBtn.disabled = !dirty;
    delBtn.hidden = !pr || !!pr.builtin;
    // Suggest a name only when the active preset changes (never over what is being typed).
    if (active !== namedFor) {
      namedFor = active;
      nameObj.name = pr ? (pr.builtin ? pr.name + ' 2' : pr.name) : 'My look';
      nameRow.refresh();
    }
    if (list.value !== (active ?? CUSTOM)) {
      suppressList = true;
      list.value = active ?? CUSTOM;
      suppressList = false;
    }
  }

  let timer = 0;
  pane.on('change', () => {
    if (isQuiet() || marking) return;
    updateMarks();
    clearTimeout(timer);
    timer = window.setTimeout(userChange, 80);
  });
  updateMarks();

  // Another tab on the same origin saved a preset: pick up its library.
  window.addEventListener('storage', (e) => {
    if (e.key !== 'sprout.viewer.presets.v1') return;
    const s = loadStore();
    store.user = s.user;
    store.stash = s.stash;
    afterPresetChangeSilent();
  });
  function afterPresetChangeSilent() {
    const idx = pf.children.indexOf(list);
    list.dispose();
    list = pf.addBlade({ view: 'list', label: 'preset', options: listOptions(), value: active ?? CUSTOM, index: idx }) as ListBladeApi<string>;
    list.on('change', (ev) => {
      if (!suppressList) choose(ev.value);
    });
    placeDesc();
    updateMarks();
  }

  function refresh() {
    quietUntil = performance.now() + 400;
    clearTimeout(timer);
    pane.refresh();
    const before = active;
    active = derive(active);
    if (before !== active || (active === null) !== (before === null)) afterPresetChangeSilent();
    else updateMarks();
  }
  return { refresh };
}
