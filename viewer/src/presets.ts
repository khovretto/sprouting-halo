// Presets in three independent kinds, each with its own built-ins, saved presets and revert:
//
//  - visual:     what it looks like (tree shape, leaves, colour tint, glow look, halo look)
//  - reactivity: how it answers the voice (growth timing, withering, response, motion,
//                sound-driven glow, halo speeds, the commit animation)
//  - testing:    the fake singer and preview switches (this viewer only, never synced)
//
// Rig keys (fit to the avatar, the colour palette, connection) belong to no preset. A preset is a
// partial object over its kind's keys, applied on top of the defaults. Which preset is active and
// whether it was changed are always derived by comparing values, so they cannot go stale after a
// sync or an import.

import { defaults, Params } from './params';
import { scopeOf } from './panel-layout';

export type Values = Record<string, Record<string, unknown>>;
export type Kind = 'visual' | 'reactivity' | 'testing';
export const KINDS: Kind[] = ['visual', 'reactivity', 'testing'];
export const KIND_TITLES: Record<Kind, string> = { visual: 'Visual', reactivity: 'Reactivity', testing: 'Testing' };

export interface Preset {
  id: string;
  name: string;
  description?: string;
  values: Values;
  builtin?: boolean;
}

const D = defaults as unknown as Values;

/** Every params path as "section.key". */
export const PATHS: string[] = Object.entries(D).flatMap(([s, o]) => Object.keys(o).map((k) => `${s}.${k}`));

/** Keys that respond to the voice (the reactivity kind). */
const REACTIVE = new Set([
  'growth.newTreeEachPhrase', 'growth.secondsToFull', 'growth.restBrightness', 'growth.fadeAfter', 'growth.fadeSeconds',
  'growth.witherEffect', 'growth.witherFromTips', 'growth.onPause', 'growth.onPhraseEnd', 'growth.onStop', 'growth.dieAfter', 'plants.twistVoice', 'motion.leafShake',
  'growth.witherOnPitchDip', 'growth.witherDipSemitones', 'growth.witherDepth',
  'growth.witherSeconds', 'growth.twigFadeSeconds', 'growth.regrowSpeed', 'growth.shed', 'growth.fallDirection', 'growth.fillSpace', 'growth.branchEachPhrase',
  'growth.branchesKept', 'growth.branchOrder', 'growth.branchSymmetry', 'growth.branchWitherSeconds', 'growth.branchDroopDeg', 'growth.branchFallSeconds',
  'glow.levelGain', 'glow.onsetGain', 'glow.pitchShine', 'glow.softGlow', 'glow.front',
  'halo.idleSpeed', 'halo.singSpeed', 'halo.sproutRate', 'halo.sproutGrow', 'halo.spawnSeconds',
  'plants.softDroop', 'plants.moodShaping', 'look.blossoms', 'look.blossomHold', 'look.thornEffort',
]);
const REACTIVE_SECTIONS = new Set(['response', 'motion', 'commit', 'transitions', 'harmony']);
/** Preview keys a testing preset may set (never synced; other local keys stay as they are). */
const TESTING = new Set([
  'scene.layers', 'scene.timeScale', 'scene.backdrop', 'scene.showAvatar', 'scene.showGuides', 'scene.showScope',
  'scene.scopeLayer', 'scene.scopeSeconds',
]);

/** Which kind of preset owns this key (null: rig and connection keys, never in a preset). */
export function kindOf(path: string): Kind | null {
  if (path.startsWith('fake.') || TESTING.has(path)) return 'testing';
  if (scopeOf(path) !== 'look') return null;
  if (REACTIVE.has(path) || REACTIVE_SECTIONS.has(path.split('.')[0])) return 'reactivity';
  return 'visual';
}
export const KIND_PATHS: Record<Kind, string[]> = {
  visual: PATHS.filter((p) => kindOf(p) === 'visual'),
  reactivity: PATHS.filter((p) => kindOf(p) === 'reactivity'),
  testing: PATHS.filter((p) => kindOf(p) === 'testing'),
};

export function getPath(p: Params | Values, path: string): unknown {
  const [s, k] = path.split('.');
  return (p as Values)[s]?.[k];
}
export function setPath(p: Params | Values, path: string, v: unknown) {
  const [s, k] = path.split('.');
  const o = p as Values;
  (o[s] ??= {})[k] = v;
}

export function same(a: unknown, b: unknown) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** The value a key has under this preset (the default where the preset says nothing). */
export function presetValue(pr: Preset | undefined, path: string): unknown {
  const v = pr ? getPath(pr.values, path) : undefined;
  const d = getPath(D, path);
  return v !== undefined && typeof v === typeof d ? v : d;
}

/** Keys of this kind that differ from the preset. */
export function isDirty(p: Params, pr: Preset | undefined, kind: Kind) {
  return KIND_PATHS[kind].some((path) => !same(getPath(p, path), presetValue(pr, path)));
}

/** Set every key of this kind to the preset's value (defaults where it is silent). */
export function applyPreset(p: Params, pr: Preset | undefined, kind: Kind) {
  for (const path of KIND_PATHS[kind]) setPath(p, path, structuredClone(presetValue(pr, path)));
}

/** The current values of this kind as a diff against the defaults. */
export function diffOf(p: Params | Values, kind: Kind): Values {
  const out: Values = {};
  for (const path of KIND_PATHS[kind]) {
    const v = getPath(p, path);
    if (v !== undefined && !same(v, getPath(D, path))) setPath(out, path, v);
  }
  return out;
}

/**
 * Older settings in the current words, in place:
 * - growth.ending and growth.witherOnPause (one way to end) became one choice per length of silence
 *   (onPause, onPhraseEnd, onStop: keep, ungrow, fadeTips, fade, fallTips, fall);
 * - those choices became one withering effect (growth.witherEffect, witherFromTips) and a switch per
 *   length of silence. The effect comes from the phrase end's choice, else the full stop's, else
 *   the pause's; "keep" turns that switch off.
 */
export function migrateGrowth(gr: Record<string, unknown> | undefined) {
  if (!gr) return;
  if (typeof gr.ending === 'string' || typeof gr.witherOnPause === 'boolean') {
    const fades = gr.ending === 'fade' || gr.ending === 'both';
    const act = gr.ending === 'fade' ? 'fade' : gr.ending === 'both' ? 'fadeTips' : 'ungrow';
    if (gr.onPause === undefined) gr.onPause = gr.witherOnPause === false ? 'keep' : fades ? 'fadeTips' : 'ungrow';
    if (gr.onPhraseEnd === undefined) gr.onPhraseEnd = act;
    if (gr.onStop === undefined) gr.onStop = act;
    delete gr.ending;
    delete gr.witherOnPause;
  }
  const stages = ['onPhraseEnd', 'onStop', 'onPause'].filter((k) => typeof gr[k] === 'string');
  if (!stages.length) return;
  // A stage that was not saved was at the old default, 'ungrow' (settings are stored as changes).
  const val = (k: string) => (typeof gr[k] === 'string' ? (gr[k] as string) : 'ungrow');
  const act = ['onPhraseEnd', 'onStop', 'onPause'].map(val).find((v) => v !== 'keep');
  if (gr.witherEffect === undefined) {
    if (act !== undefined) {
      gr.witherEffect = act.startsWith('fade') ? 'fade' : act.startsWith('fall') ? 'fall' : 'ungrow';
      if (act !== 'ungrow' && gr.witherFromTips === undefined) gr.witherFromTips = act.endsWith('Tips');
    } else {
      // Every stage kept: a replaced tree used to fade out (all at once).
      gr.witherEffect = 'fade';
      if (gr.witherFromTips === undefined) gr.witherFromTips = false;
    }
  }
  for (const k of stages) gr[k] = gr[k] !== 'keep';
}

const built = (list: Preset[]) => list.map((p) => ({ ...p, builtin: true }));

export const BUILTINS: Record<Kind, Preset[]> = {
  visual: built([
    { id: 'default', name: 'Sprout', description: 'The standard look: leafy canopy in your take colours, a white glint travelling round the halo.', values: { look: { leaf3d: 0.8 } } },
    {
      id: 'ivy', name: 'Lush ivy', description: 'Dense and overgrown. Woody dark stems that turn into your take colour, leaves from deep to light green.',
      values: {
        colBranch: { source: 'gradient', gradient: 'ok;0:2e2116,0.45:t,1:t', along: 1, speed: 0, perTake: 0, takeMix: 0 },
        colLeaf: { source: 'gradient', gradient: 'ok;0:14532a,0.5:3fae4e,1:9bdc3a', takeMix: 0.4, along: 0.8, scatter: 0.5 },
        colAccent: { takeMix: 0.2 },
        colHalo: { source: 'take' },
        growth: { branching: 0.95, lowBranches: 1, reach: 1.1, spread: 1.3, flatten: 0.45 },
        look: { theme: 'leaves', density: 0.85, decoSize: 1.5, variety: 0.8, depthShade: 0.8, decoGlow: 0.12, buds: 0.3, leaf3d: 1 },
        plants: { wildness: 0.7, overlap: 0.8, clearance: 0.03, taper: 0.55, lift: 0.05, maxNodes: 3600, twist: 0.25, twistTwigs: 1.4, curl: 0.35 },
        halo: { origins: 2, tailDeg: 540, tailFade: 0.3, sproutLength: 16, alwaysLeaves: 0.7, wander: 0.14 },
        glow: { strength: 1.2, wide: 0.5, crowd: 1.1, inkMask: 0.85, tint: '#d8ffb0', tintAmount: 0.25 },
      },
    },
    {
      id: 'winter', name: 'Winter branches', description: 'Bare twigs from deep blue roots to white tips, a cold haze. Airy singing frosts them further.',
      values: {
        colBranch: { source: 'gradient', gradient: 'ok;0:0b2a6b,0.4:2f7fe0,0.75:8fe3ff,1:f2fdff', along: 1, speed: 0, perTake: 0, takeMix: 0.35, voice: 'breath', voiceAmount: 0.3 },
        colHalo: { source: 'branches' },
        colLeaf: { takeMix: 0.9 },
        growth: { branching: 0.3, lowBranches: 0.4, spread: 0.7, flatten: 0.35 },
        look: { theme: 'branches', density: 0.3, decoSize: 1.0, variety: 0.35, depthShade: 0.4, buds: 0, dryColour: '#9aa3ad' },
        plants: { taper: 0.8, wildness: 0.6, lift: 0.35, clearance: 0.07, overlap: 0.25, twist: 0.3, gnarl: 0.6, knots: 0.3, trunk: 0.6 },
        halo: { alwaysLeaves: 0.2, sproutLength: 8, sproutCurl: 0.4, tailDeg: 220 },
        glow: { strength: 1.9, radius: 2.6, wide: 1.2, base: 0.2, crowd: 0.4, knee: 1.2, tint: '#bfe3ff', tintAmount: 0.6 },
        palette: { from: 'list', list: 'step;0:e8f4ff,0.2:9fd0ff,0.4:6aa8f0,0.6:b8a8ff,0.8:8fe3ff', pick: 'order' },
      },
    },
    {
      id: 'festive', name: 'Festive wreath', description: 'A full wreath: natural greens, baubles in red, gold and white, a candy-striped ring, warm glow.',
      values: {
        colLeaf: { source: 'theme', takeMix: 0.1 },
        colAccent: { source: 'gradient', gradient: 'step;0:e61424,0.5:ffd24a,0.8:ffffff', takeMix: 0, along: 0, scatter: 1 },
        colHalo: { source: 'gradient', gradient: 'step~;0:c8102e,0.167:f4f4f4,0.333:c8102e,0.5:f4f4f4,0.667:c8102e,0.833:f4f4f4', along: 2, speed: 0.04, perTake: 0, takeMix: 0 },
        growth: { branching: 0.7, flatten: 0.4 },
        look: { theme: 'wreath', density: 0.8, decoSize: 2.2, decoGlow: 0.35, variety: 0.7, dryColour: '#5b4630', leaf3d: 0.7 },
        plants: { lift: 0.3 },
        halo: { origins: 2, tailDeg: 720, tailFade: 0.2, alwaysLeaves: 0.9, sproutLength: 7, sproutCurl: 0.5, wander: 0.04, ringWidth: 0.014, vineWidth: 0.01, braid: 0.5 },
        glow: { strength: 2.0, base: 0.45, crowd: 0.9, tint: '#ffcf7a', tintAmount: 0.35 },
        palette: { from: 'list', list: 'step;0:c8102e,0.25:1a7333,0.5:ffd24a,0.75:f4f4f4', pick: 'order' },
      },
    },
    {
      id: 'bramble', name: 'Red bramble', description: 'A drooping thicket: stems from black-red to crimson that flare when you push, pale bone thorns, red glow.',
      values: {
        colBranch: { source: 'gradient', gradient: 'ok;0:2a0508,0.5:8a0f22,1:e0304a', along: 1, speed: 0, perTake: 0, takeMix: 0.1, voice: 'effort', voiceAmount: 0.35 },
        colLeaf: { source: 'theme', takeMix: 0.2 },
        colHalo: { source: 'branches' },
        growth: { branching: 0.95, lowBranches: 0.9, spread: 1.5, flatten: 0.6 },
        look: { theme: 'thorns', density: 0.95, decoSize: 1.5, variety: 0.8, depthShade: 0.85, decoGlow: 0.05, tint: '#c0142c', tintAmount: 0.25, dryColour: '#3a2226' },
        plants: { lift: -0.2, taper: 0.85, wildness: 0.75, clearance: 0.045, overlap: 0.7, maxNodes: 3400, twist: 0.5, gnarl: 0.5, knots: 0.4, curl: 0.25 },
        halo: { sproutCurl: 0.3, sproutLength: 14, wander: 0.12, alwaysLeaves: 0.6, twist: 0.4 },
        glow: { strength: 0.75, radius: 1.3, wide: 0.35, base: 0.12, crowd: 1.1, inkMask: 0.85, tint: '#ff2a3c', tintAmount: 0.5, tintFlat: 0.4, shadow: 0.3 },
        palette: { from: 'list', list: 'step;0:c0142c,0.33:8a0f22,0.66:e0304a,1:6b1030', pick: 'order' },
      },
    },
    {
      id: 'minimal', name: 'Minimal', description: 'Small, quiet, one flat colour per take: no gradients, no buds, low glow. Lightest on the GPU.',
      values: {
        colLeaf: { source: 'take' }, colAccent: { source: 'take' }, colHalo: { source: 'take' },
        growth: { branching: 0.3, reach: 0.8 },
        look: { density: 0.3, decoSize: 1.2, decoGlow: 0.1, buds: 0 },
        plants: { wildness: 0.25, maxNodes: 1500 },
        halo: { sproutLength: 7, alwaysLeaves: 0.2, tailDeg: 180, wander: 0.04 },
        glow: { strength: 0.8, radius: 1.2, wide: 0.3, base: 0.15 },
      },
    },
    {
      id: 'neon', name: 'Neon stage', description: 'Pink, cyan and lime light running along wide-arching trees; your pitch pushes the colours. Strong glow.',
      values: {
        colBranch: { source: 'gradient', gradient: 'rgb~;0:ff2bd6,0.33:2bd9ff,0.66:7dff2b', along: 0.3, speed: 0.12, perTake: 0.33, takeMix: 0, voice: 'pitch', voiceAmount: 0.5 },
        colLeaf: { source: 'gradient', gradient: 'rgb~;0:ff2bd6,0.33:2bd9ff,0.66:7dff2b', along: 0, speed: 0.12, scatter: 1, takeMix: 0.1 },
        colAccent: { source: 'gradient', gradient: 'ok;0:ffffff', takeMix: 0, scatter: 0 },
        colHalo: { source: 'branches' },
        growth: { branching: 0.7, spread: 1.4 },
        look: { density: 0.64 },
        halo: { origins: 3, tailDeg: 200, alwaysLeaves: 0.49, braid: 0.6 },
        plants: { strands: 2, twistDepth: 0.8 },
        glow: { strength: 2.4, base: 0.2, knee: 1.2 },
      },
    },
    {
      id: 'rainbow', name: 'Rainbow', description: 'Every take runs through the rainbow, each a step further along; pastel leaves; the halo jumps colour on note starts.',
      values: {
        colBranch: { source: 'gradient', takeMix: 0 },
        colLeaf: { source: 'gradient', gradient: 'rgb~;0:ffa6a6,0.167:ffffa6,0.333:a6ffa6,0.5:a6ffff,0.667:a6a6ff,0.833:ffa6ff', along: 0.3, speed: 0.05, perTake: 0.13, scatter: 0.6, takeMix: 0.1 },
        colAccent: { source: 'gradient', gradient: 'ok;0:ffffff', takeMix: 0, scatter: 0 },
        colHalo: { source: 'gradient', gradient: 'rgb~;0:ff4d4d,0.167:ffff4d,0.333:4dff4d,0.5:4dffff,0.667:4d4dff,0.833:ff4dff', along: 1, speed: 0.05, perTake: 0.15, takeMix: 0, voice: 'flash', voiceAmount: 0.15 },
        look: { leaf3d: 0.7 },
        glow: { strength: 1.8 },
      },
    },
    {
      id: 'sakura', name: 'Cherry blossom', description: 'Dark bark with rosy tips, a canopy of pink petals, big buds that open on long notes, soft pink glow.',
      values: {
        colBranch: { source: 'gradient', gradient: 'ok;0:3b2620,0.6:6b4038,1:c98a8a', along: 1, speed: 0, perTake: 0, takeMix: 0.15 },
        colLeaf: { source: 'gradient', gradient: 'ok;0:ffd1e6,0.5:ff9ccb,1:ffffff', along: 0, scatter: 0.8, takeMix: 0.1 },
        colAccent: { source: 'gradient', gradient: 'ok;0:ff7ac8,0.6:ffd1e6,1:ffffff', along: 0, scatter: 1, takeMix: 0 },
        colHalo: { source: 'gradient', gradient: 'ok;0:ff9ccb,1:ffffff', along: 1, speed: 0.05, perTake: 0, takeMix: 0.2 },
        growth: { branching: 0.775, spread: 1.2 },
        look: { theme: 'leaves', density: 0.7, decoSize: 1.6, variety: 0.7, buds: 0.35, dryColour: '#c9a0a8', leaf3d: 0.6 },
        plants: { lift: -0.1, wildness: 0.55, twist: 0.2, gnarl: 0.4, curl: 0.2, trunk: 0.5 },
        falling: { speed: 0.7, sway: 0.9, spin: 0.6, time: 1.4 },
        halo: { alwaysLeaves: 0.55, sproutCurl: 1.2 },
        glow: { strength: 1.5, tint: '#ffc4de', tintAmount: 0.45 },
        palette: { from: 'list', list: 'step;0:ff9ccb,0.25:ffc4de,0.5:f47fb0,0.75:ffe3ef', pick: 'order' },
      },
    },
    {
      id: 'autumn', name: 'Autumn', description: 'Brown wood that is simply there, never growing or withering; leaves from rust to gold keep falling and growing back, in showers when your voice trembles. No blossoms; amber glow.',
      values: {
        colBranch: { source: 'gradient', gradient: 'ok;0:2e1c10,1:6b4a2b', along: 1, speed: 0, perTake: 0, takeMix: 0.2 },
        colLeaf: { source: 'gradient', gradient: 'ok;0:7a1f0e,0.4:d9541e,0.7:f2a51e,1:f7dc6f', along: 0.3, scatter: 0.9, takeMix: 0.1, voice: 'loudness', voiceAmount: 0.2 },
        colAccent: { source: 'gradient', gradient: 'ok;0:f7dc6f,1:fff6cf', scatter: 1, takeMix: 0 },
        colHalo: { source: 'gradient', gradient: 'ok;0:d9541e,0.5:f2a51e,1:f7dc6f', along: 1, speed: 0.04, perTake: 0, takeMix: 0.2 },
        growth: { branching: 0.67 },
        look: { theme: 'leaves', density: 0.75, variety: 0.8, dryColour: '#6b4a2b', blossoms: 0, buds: 0, woodStays: true, leafFall: 0.6, leafRegrow: 2.5, leaf3d: 0.8 },
        plants: { lift: 0.05, trunk: 0.6 },
        falling: { sway: 0.8, spin: 0.8, flutter: 0.6, time: 1.3 },
        halo: { alwaysLeaves: 0.46 },
        glow: { tint: '#ffb060', tintAmount: 0.4 },
        palette: { from: 'list', list: 'step;0:d9541e,0.25:f2a51e,0.5:7a1f0e,0.75:f7dc6f', pick: 'random' },
      },
    },
    {
      id: 'blackbriar', name: 'Black briar', description: 'Gothic bramble: charcoal wood with a little gnarl, pure black leaves with a hairline silver vein, bone thorns, a few blood-red roses on held notes, a thorn-crown halo; a cold moonlight rim and a soft dark outline keep it readable on dark and light backgrounds. Pairs with the Nocturne reaction.',
      values: {
        colBranch: { source: 'gradient', gradient: 'ok;0:0a090b,0.55:19161c,1:34303a', along: 1, speed: 0, perTake: 0, takeMix: 0, voice: 'effort', voiceAmount: 0.15 },
        colLeaf: { source: 'gradient', gradient: 'ok;0:040405,1:0c0b0f', along: 0, speed: 0, perTake: 0, scatter: 1, takeMix: 0 },
        colAccent: { source: 'theme', takeMix: 0 },
        colHalo: { source: 'gradient', gradient: 'ok;0:121015,0.5:3c3844,0.82:8d8a9c,1:ecebf5', along: 2, speed: 0.03, perTake: 0, takeMix: 0 },
        growth: { branching: 0.7, reach: 1.0, spread: 1.1, flatten: 0.5 },
        look: { theme: 'briar', density: 0.55, decoSize: 1.6, variety: 0.7, depthShade: 0.5, decoGlow: 0.3, buds: 0.3,
          tintAmount: 0, dryColour: '#6f6a78', leafSheen: 0.35, sheenColour: '#8f96c8', leaf3d: 0.5 },
        plants: { lift: 0.1, wildness: 0.6, taper: 0.75, clearance: 0.05, overlap: 0.6, maxWidth: 0.045, tipWidth: 0.005, maxNodes: 3200,
          twist: 0.3, twistLength: 0.45, gnarl: 0.65, knots: 0.5, curl: 0, strands: 1, twistTwigs: 0.6, twistTighten: 0.3, twistDepth: 0.4 },
        halo: { origins: 2, tailDeg: 360, sproutLength: 10, sproutCurl: 0.5, wander: 0.08, alwaysLeaves: 0.75,
          ringWidth: 0.011, vineWidth: 0.008, braid: 0.7, twist: 0.25 },
        glow: { strength: 1.0, radius: 1.5, wide: 0.45, base: 0.3, crowd: 0.8, inkMask: 1, knee: 1.0,
          tint: '#aeb6e8', tintAmount: 1, tintFlat: 1, shadow: 0.35, shadowColour: '#07060a' },
        palette: { from: 'list', list: 'step;0:b9b4c8,0.2:7d1626,0.4:5b6b8c,0.6:8a7f9e,0.8:c9c2b4', pick: 'order' },
      },
    },
    {
      id: 'twisted', name: 'Dark & twisted', description: 'Gnarled black-violet limbs wound like rope, elbows, curled tips, bone-tipped thorns, a braided halo; a crimson rim and a dark outline keep it readable on dark and light backgrounds.',
      values: {
        colBranch: { source: 'gradient', gradient: 'ok;0:0d0a10,0.5:2a1030,0.85:5a1f4a,1:b23a6a', along: 1, speed: 0, perTake: 0, takeMix: 0.15, voice: 'effort', voiceAmount: 0.2 },
        colLeaf: { source: 'gradient', gradient: 'ok;0:1a0d16,0.55:6b2244,1:d9c7b0', along: 0.6, scatter: 0.4, takeMix: 0.1 },
        colAccent: { source: 'gradient', gradient: 'ok;0:8a0f22,1:ff3355', takeMix: 0, scatter: 0.6 },
        colHalo: { source: 'gradient', gradient: 'ok;0:1a0d16,0.5:6b2244,0.8:b23a6a,1:f0e6d8', along: 2, speed: 0.03, perTake: 0, takeMix: 0 },
        growth: { branching: 0.75, reach: 1.05, spread: 1.6, flatten: 0.5 },
        look: { theme: 'thorns', density: 0.6, decoSize: 1.3, variety: 0.9, depthShade: 0.9, decoGlow: 0.05, buds: 0,
          tint: '#3a0f2a', tintAmount: 0.15, dryColour: '#4a4046' },
        plants: { lift: -0.35, wildness: 0.9, taper: 0.9, clearance: 0.06, overlap: 0.6, maxWidth: 0.06, tipWidth: 0.004,
          step: 0.02, maxNodes: 4200,
          twist: 0.8, twistLength: 0.4, gnarl: 0.7, knots: 0.6, curl: 0.6, strands: 2, twistTighten: 0.6, twistDepth: 0.75, strandLay: 7 },
        halo: { origins: 2, tailDeg: 420, sproutLength: 18, sproutCurl: 2.2, wander: 0.16, alwaysLeaves: 0.5,
          ringWidth: 0.011, vineWidth: 0.009, braid: 0.8, twist: 0.7 },
        glow: { strength: 1.1, radius: 1.6, wide: 0.6, base: 0.25, crowd: 1.0, inkMask: 1, knee: 1.0,
          tint: '#d0204f', tintAmount: 1, tintFlat: 0.85, shadow: 0.7, shadowColour: '#12060e' },
        palette: { from: 'list', list: 'step;0:7a1238,0.2:4a1a6b,0.4:a3262e,0.6:2f3a6b,0.8:6b6b2a', pick: 'order' },
      },
    },
  ]),
  reactivity: built([
    { id: 'default', name: 'Responsive', description: 'The standard response: grows in about 3.5 s of singing, leaves fall in pauses, blossoms on notes held 1.5 s.', values: {} },
    {
      id: 'calm', name: 'Calm (ballad)', description: 'Slow and lingering. Each phrase grows one new branch; old ones dry, droop and fall. Gentle motion.',
      values: {
        growth: { secondsToFull: 6, fadeAfter: 6, fadeSeconds: 5, witherEffect: 'fade', dieAfter: 7, restBrightness: 0.7, witherDepth: 0.3, witherSeconds: 1.5, twigFadeSeconds: 1.2, regrowSpeed: 0.8,
          branchEachPhrase: true, branchesKept: 4, branchWitherSeconds: 4, branchDroopDeg: 25, branchFallSeconds: 2 },
        response: { release: 3, brightness: 0.6, variety: 0.3 },
        look: { blossoms: 0.9, blossomHold: 2 },
        halo: { idleSpeed: 5, singSpeed: 40, sproutRate: 2, sproutGrow: 1.0 },
        glow: { levelGain: 0.65, onsetGain: 0.25, softGlow: 0.8 },
        motion: { swayDeg: 6, springiness: 0.3, flutterDeg: 10, speed: 0.7 },
        commit: { duration: 1.4, limbs: 2 },
      },
    },
    {
      id: 'stage', name: 'Punchy (stage)', description: 'Fast and hard: trees shoot up and clear quickly, pitch drops throw leaves, short holds bloom, big planting.',
      values: {
        growth: { secondsToFull: 1.8, fadeAfter: 1.5, fadeSeconds: 1.2, dieAfter: 2.5, restBrightness: 0.4, witherOnPitchDip: true, witherDepth: 0.7, witherSeconds: 0.4, regrowSpeed: 2.5 },
        response: { phraseGap: 0.6, release: 0.7, brightness: 1, effortWidth: 1.5, pitchSteer: 0.8, variety: 0.8 },
        look: { blossoms: 1, blossomHold: 0.8, thornEffort: 2 },
        halo: { idleSpeed: 20, singSpeed: 160, sproutRate: 8, sproutGrow: 0.3, spawnSeconds: 0.5 },
        glow: { levelGain: 1.6, onsetGain: 0.9, pitchShine: 1.0, front: 1.8 },
        motion: { swayDeg: 12, springiness: 0.7, speed: 1.4, shiverDeg: 1.7, writhe: 0.25, writheVoice: 'effort' },
        transitions: { liveEndSeconds: 0.4, pruneSeconds: 0.9 },
        commit: { duration: 0.7, limbs: 4 },
      },
    },
    {
      id: 'subtle', name: 'Subtle', description: 'Small reactions: little brightness change, light motion, few blossoms, the halo plants as a single quiet frond.',
      values: {
        growth: { restBrightness: 0.35, fadeAfter: 1.5, fadeSeconds: 2, witherEffect: 'fade', witherFromTips: false, dieAfter: 5 },
        response: { brightness: 0.5, effortWidth: 0.5 },
        look: { blossoms: 0.4, blossomHold: 2.5 },
        halo: { sproutRate: 1.5 },
        glow: { levelGain: 0.5, onsetGain: 0.15, pitchShine: 0.2, front: 0.4 },
        motion: { swayDeg: 4, flutterDeg: 8, shiverDeg: 0.5 },
        commit: { duration: 0.8, limbs: 1 },
      },
    },
    {
      id: 'vibrato', name: 'Vibrato-sensitive', description: 'Light vibrato already makes twigs and leaves shimmer; soft singing glows wider; blossoms after a 1 s hold.',
      values: {
        look: { blossomHold: 1 },
        motion: { shiverDeg: 2, shiverSensitivity: 2, flutterDeg: 18, writhe: 0.35, writheVoice: 'vibrato' },
        plants: { twistVoice: 1.5 },
        glow: { softGlow: 0.8 },
      },
    },
    {
      id: 'branches', name: 'Branch by branch', description: 'One tree per take: every phrase grows a new branch on it while the oldest withers, droops and falls off.',
      values: {
        growth: { branchEachPhrase: true, branchesKept: 3, branchWitherSeconds: 2.5, branchDroopDeg: 35, branchFallSeconds: 1.4, secondsToFull: 3, restBrightness: 0.7,
          dieAfter: 5 },
      },
    },
    {
      id: 'bloom', name: 'Blossom ballad', description: 'One tree keeps growing through the song. Notes held for a second open the blossoms; their petals fall when the note ends.',
      values: {
        growth: { newTreeEachPhrase: false, secondsToFull: 5, restBrightness: 0.75, witherDepth: 0.35, witherSeconds: 1.5, witherEffect: 'fade', onPhraseEnd: false, dieAfter: 6, fadeSeconds: 3.5 },
        look: { blossoms: 1, blossomHold: 1 },
        glow: { softGlow: 0.8 },
        motion: { shiverDeg: 1.7, shiverSensitivity: 1.5 },
      },
    },
    {
      id: 'fall', name: 'Falling leaves', description: 'Pauses and pitch drops strip the outer twigs deep into the tree and the leaves rain down; it regrows fast when you sing.',
      values: {
        growth: { newTreeEachPhrase: false, witherOnPitchDip: true, witherDipSemitones: 2, witherDepth: 0.8, witherSeconds: 0.6, twigFadeSeconds: 1.2, regrowSpeed: 2,
          onPhraseEnd: false, dieAfter: 3.5, fadeSeconds: 3 },
      },
    },
    {
      id: 'fallaway', name: 'Falling away', description: 'Nothing grows back into the tree: in a pause the outer twigs break off piece by piece and fall, and when the phrase ends the whole tree comes down from the tips inward.',
      values: {
        growth: { witherEffect: 'fall', shed: false, fadeAfter: 0, witherDepth: 0.5, witherSeconds: 1.0, fadeSeconds: 2.2, regrowSpeed: 1.6 },
      },
    },
    {
      id: 'driftingaway', name: 'Drifting away', description: 'Like Falling away, but with no gravity: in a pause the outer twigs break off and drift straight out, away from where the tree grows, with their leaves; when the phrase ends the whole tree drifts apart, tips first.',
      values: {
        growth: { witherEffect: 'fall', fallDirection: 'away', shed: true, fadeAfter: 0, witherDepth: 0.5, witherSeconds: 1.0, fadeSeconds: 2.2, regrowSpeed: 1.6 },
      },
    },
    {
      id: 'duet', name: 'Duet (harmony)', description: 'Made for two voices: in harmony their colours run into each other, the branches crisscross, blossoms open and everything glows. Trees stay between phrases.',
      values: {
        growth: { newTreeEachPhrase: false, onPhraseEnd: false, restBrightness: 0.7, dieAfter: 6, fadeSeconds: 3 },
        harmony: { colour: 1, colourMode: 'gradient', cross: 1, blossoms: 1, glow: 0.8 },
      },
    },
    {
      id: 'steady', name: 'Steady (no withering)', description: 'Nothing retracts or falls: one tree grows and stays, blossoms open whenever you sing. For comparing.',
      values: {
        growth: { newTreeEachPhrase: false, onPause: false, onPhraseEnd: false, onStop: false, witherEffect: 'fade', witherFromTips: false, shed: false, restBrightness: 0.8, dieAfter: 0 },
        look: { blossomHold: 0 },
      },
    },
    {
      id: 'nocturne', name: 'Nocturne', description: 'For dark, solid looks (Black briar): trees stay opaque when you are quiet and the voice shows in the rim glow instead; slow growth, stiff branches that only sway, thorns that grow when you push, roses on notes held a second.',
      values: {
        growth: { secondsToFull: 4, restBrightness: 0.9, fadeAfter: 4, fadeSeconds: 3.5, dieAfter: 6,
          witherDepth: 0.5, witherSeconds: 1.2, twigFadeSeconds: 1.0, regrowSpeed: 1.0 },
        response: { brightness: 0.25, effortWidth: 1.1, release: 2.2 },
        look: { thornEffort: 0.9, blossoms: 0.6, blossomHold: 1.2 },
        plants: { twistVoice: 0.6 },
        halo: { idleSpeed: 5, singSpeed: 50, sproutRate: 3, sproutGrow: 0.8 },
        glow: { levelGain: 0.9, onsetGain: 0.45, pitchShine: 0.3, front: 1.2, softGlow: 0.5 },
        motion: { writhe: 0, swayDeg: 5, idle: 0.4, speed: 0.7, springiness: 0.4, twigs: 0.8, flutterDeg: 9, shiverDeg: 1 },
      },
    },
    {
      id: 'writhe', name: 'Writhing', description: 'Slow and heavy: branches squirm on vibrato and stay solid when you sing quietly; full voice thickens them and grows the thorns; phrases with vibrato grow more twisted trees.',
      values: {
        growth: { secondsToFull: 4.5, regrowSpeed: 0.9, restBrightness: 0.8, fadeAfter: 5, fadeSeconds: 4,
          witherDepth: 0.6, witherSeconds: 1.2, twigFadeSeconds: 1.4, witherEffect: 'fade', onPause: false, dieAfter: 6 },
        response: { brightness: 0.3, effortWidth: 1.4, pitchSteer: 0.3, variety: 0.8, release: 2.5 },
        look: { thornEffort: 2.2, blossoms: 0 },
        plants: { twistVoice: 1.6, softDroop: 1.5 },
        halo: { idleSpeed: 4, singSpeed: 55, sproutRate: 4, sproutGrow: 0.9 },
        glow: { levelGain: 0.5, onsetGain: 0.55, pitchShine: 0.2, front: 1.4, softGlow: 0.2 },
        motion: { writhe: 0.7, writheVoice: 'vibrato', swayDeg: 5, idle: 0.5, speed: 0.6, springiness: 0.75,
          twigs: 1.6, flutterDeg: 6, shiverDeg: 1.7, shiverSensitivity: 1.5 },
        commit: { duration: 1.3, limbs: 3 },
      },
    },
    {
      id: 'fade', name: 'Fade away (nothing dies)', description: 'Nothing withers back or falls: in pauses the outer twigs and their leaves fade, and after a long silence the whole tree fades out.',
      values: {
        growth: { witherEffect: 'fade', witherFromTips: false, shed: false, witherOnPitchDip: false, witherDepth: 0.5, witherSeconds: 1.2, dieAfter: 4, fadeAfter: 2, fadeSeconds: 3,
          branchEachPhrase: false, newTreeEachPhrase: true },
        response: { release: 2 },
      },
    },
  ]),
  testing: built([
    { id: 'default', name: 'Normal song', description: 'Fake singer: phrases of 2 to 6 s, short pauses, one live track recording, two takes.', values: {} },
    {
      id: 'ballad', name: 'Ballad', description: 'Long phrases and notes (lots of vibrato), longer pauses.',
      values: { fake: { phraseMin: 4, phraseMax: 9, gapMin: 1, gapMax: 2.5, highNotes: 0.1, noteMax: 3.5 } },
    },
    {
      id: 'fast', name: 'Fast pop', description: 'Short phrases, short pauses, more high notes.',
      values: { fake: { phraseMin: 1, phraseMax: 3, gapMin: 0.2, gapMax: 0.6, highNotes: 0.35, fullStopEvery: 0 } },
    },
    { id: 'six', name: 'Six takes', description: 'A full scene: one live halo and six take trees.', values: { scene: { layers: 7 } } },
    { id: 'idle', name: 'Not recording', description: 'The live track is not recording: the small resting halo on the head.', values: { fake: { recording: false } } },
    { id: 'duet', name: 'Two live tracks', description: 'Two live tracks at once: nested halos.', values: { fake: { liveTracks: 2 } } },
    {
      id: 'trade', name: 'Duet: trading phrases', description: 'The live voice and one take trade phrases: one sings alone, then the other, and about half the phrases together in harmony. Shows the harmony effects coming and going.',
      values: { fake: { voices: 'duet', together: 0.5, harmony: 1 }, scene: { layers: 2 } },
    },
    {
      id: 'independent', name: 'Independent voices', description: 'Every voice has its own phrases, pauses and notes, so the takes grow and end at different times and come in and out of harmony.',
      values: { fake: { voices: 'independent' } },
    },
    {
      id: 'study', name: 'Slow-motion study', description: 'Quarter speed with the voice scope open, to study how the voice is read.',
      values: { scene: { timeScale: 0.25, showScope: true } },
    },
    {
      id: 'held', name: 'Held notes (blossoms)', description: 'Fake singer holds notes up to 4.5 s: blossoms open, and their petals fall when the note ends.',
      values: { fake: { phraseMin: 5, phraseMax: 9, noteMax: 4.5, gapMin: 0.6, gapMax: 1.2, highNotes: 0.15, longNotes: 0.6 } },
    },
    {
      id: 'pauses', name: 'Short phrases, long pauses', description: 'Every pause ends the phrase: shows a new tree or a new branch per phrase, withering and falling leaves.',
      values: { fake: { phraseMin: 1.5, phraseMax: 3, gapMin: 1.5, gapMax: 3, fullStopEvery: 1, fullStopSeconds: 3 } },
    },
    {
      id: 'light', name: 'On a light background', description: 'Light checkerboard behind the preview, to check a look against bright scenes (or pick "half dark, half light" under Test & preview).',
      values: { scene: { backdrop: 'checker-light' } },
    },
    {
      id: 'stops', name: 'Full stops', description: 'Every second phrase ends with an 8 s full stop: shows what the tree does at a phrase end and at a full stop, then a new one grows.',
      values: { fake: { fullStopEvery: 2, fullStopSeconds: 8 } },
    },
    {
      id: 'jumps', name: 'Pitch jumps', description: 'Many jumps to very high notes and back down: shows pitch-dip withering and pitch-driven colour.',
      values: { fake: { highNotes: 0.8, noteMax: 0.8, fullStopEvery: 0 } },
    },
    {
      id: 'planting', name: 'Planting loop', description: 'The live take is planted as a tree every 7 s and the oldest of four is removed: shows the planting and the removal.',
      values: { fake: { autoCommit: 7 }, scene: { layers: 2 } },
    },
  ]),
};

if (import.meta.env.DEV) {
  for (const kind of Object.keys(BUILTINS) as Kind[]) {
    const unused = KIND_PATHS[kind].filter((path) => !BUILTINS[kind].some((pr) => {
      const v = getPath(pr.values, path);
      return v !== undefined && !same(v, getPath(D, path));
    }));
    if (unused.length) console.info(`[presets] ${kind} keys no built-in preset changes yet:`, unused.join(', '));
  }
}

// ---- Storage ---------------------------------------------------------------------------------------

const KEY = 'sprout.viewer.presets.v2';
const OLD_KEY = 'sprout.viewer.presets.v1';

export interface KindStore {
  active: string | null;
  user: Preset[];
  /** Diff saved when switching away from unsaved tweaks. */
  stash?: Values;
}
export type PresetStore = Record<Kind, KindStore>;

const empty = (): PresetStore => ({
  visual: { active: 'default', user: [] },
  reactivity: { active: 'default', user: [] },
  testing: { active: 'default', user: [] },
});

export function loadStore(): PresetStore {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && s.visual && s.reactivity && s.testing) {
      for (const pr of (s as PresetStore).reactivity.user ?? []) migrateGrowth(pr.values?.growth);
      migrateGrowth((s as PresetStore).reactivity.stash?.growth);
      return s;
    }
    // v1 (one kind of preset): split each saved preset into a visual and a reactivity preset.
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null');
    const st = empty();
    if (old && Array.isArray(old.user)) {
      for (const pr of old.user as Preset[])
        for (const k of ['visual', 'reactivity'] as Kind[]) {
          const values = diffOf(pr.values, k);
          if (Object.keys(values).length) st[k].user.push({ id: pr.id, name: pr.name, values });
        }
    }
    return st;
  } catch {
    return empty();
  }
}

export function saveStore(s: PresetStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const STORE_KEY = KEY;
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
