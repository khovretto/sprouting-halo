// Panel layout (docs/fable-consult-3-panel.md, section 1): artist folders first, setup folders
// after a separator. Keys keep their params.ts paths (presets, sync and saved settings use them);
// only the grouping and the labels change here.
//
// Scopes:
//  - look:  what a preset owns (shape, growth, leaves, halo behaviour, glow, motion, commit)
//  - rig:   fit to this avatar and this artist's palette (synced, never touched by a preset)
//  - local: this viewer only (not synced)

export type Scope = 'look' | 'rig' | 'local';

export interface FolderSpec {
  id: string;
  title: string;
  open?: boolean;
  keys: string[];
  advanced?: string[];
  /** Any key of these sections not listed anywhere lands here (so new params still show up). */
  catchSections?: string[];
  /** Setup folders come after the separator. */
  setup?: boolean;
}

export const FOLDERS: FolderSpec[] = [
  {
    id: 'shape', title: 'Tree shape', open: true,
    keys: ['growth.reach', 'growth.flatten', 'growth.branching', 'growth.spread', 'plants.lift', 'plants.wildness', 'plants.taper'],
    advanced: ['plants.clearance', 'plants.softDroop', 'plants.moodShaping', 'plants.tipWidth', 'plants.maxWidth'],
  },
  {
    id: 'life', title: 'Growing & fading',
    keys: ['growth.secondsToFull', 'growth.newTreeEachPhrase', 'growth.fadeAfter', 'growth.fadeSeconds',
      'growth.restBrightness', 'growth.witherOnPause', 'growth.witherDepth'],
    advanced: ['growth.witherSeconds', 'growth.witherOnPitchDip', 'growth.witherDipSemitones',
      'growth.leafFadeSeconds', 'growth.twigFadeSeconds', 'growth.regrowSpeed'],
  },
  {
    id: 'leaves', title: 'Leaves & decorations',
    keys: ['look.theme', 'look.density', 'look.decoSize', 'look.naturalTint', 'look.variety', 'look.depthShade',
      'look.blossoms', 'look.thornEffort'],
  },
  {
    id: 'colours', title: 'Colours',
    keys: ['colours.mode', 'colours.rainbowSpeed', 'colours.live', 'colours.take1', 'colours.take2', 'colours.take3',
      'colours.take4', 'colours.take5', 'colours.take6', 'colours.take7'],
  },
  {
    id: 'halo', title: 'Live halo',
    keys: ['halo.origins', 'halo.bothWays', 'halo.idleSpeed', 'halo.singSpeed', 'halo.tailDeg', 'halo.sproutRate',
      'halo.sproutLength', 'halo.sproutCurl', 'halo.alwaysLeaves', 'halo.wander'],
    advanced: ['halo.startAngle', 'halo.tailFade', 'halo.sproutGrow', 'halo.spawnSeconds', 'halo.ringWidth',
      'halo.vineWidth', 'halo.sproutWidth', 'halo.ringSpacing'],
  },
  {
    id: 'voice', title: 'Voice response',
    keys: ['response.brightness', 'response.effortWidth', 'response.pitchSteer', 'response.variety',
      'response.phraseGap', 'response.release'],
  },
  {
    id: 'glow', title: 'Glow',
    keys: ['glow.strength', 'glow.radius', 'glow.base', 'glow.levelGain', 'glow.onsetGain', 'glow.pitchShine',
      'glow.front', 'look.decoGlow'],
    advanced: ['glow.wide', 'glow.softGlow', 'glow.crowd', 'glow.inkMask', 'glow.knee'],
  },
  {
    id: 'motion', title: 'Wind & shiver',
    keys: ['motion.swayDeg', 'motion.kickDeg', 'motion.springiness', 'motion.idle', 'motion.flutterDeg', 'motion.shiver',
      'motion.shiverDeg'],
    advanced: ['motion.speed', 'motion.twigs'],
    catchSections: ['motion'],
  },
  {
    id: 'commit', title: 'Take commit & removal',
    keys: ['commit.enabled', 'commit.duration', 'commit.impact', 'commit.burst', 'commit.shockRing', 'commit.plunge',
      'commit.spinTurns', 'commit.stampReveal'],
    advanced: ['commit.syncToOnset', 'commit.syncWindow', 'transitions.liveEndSeconds', 'transitions.pruneSeconds'],
  },
  {
    id: 'many', title: 'Many takes',
    keys: ['plants.overlap', 'layout.shrinkPerTake', 'layout.spinSpeed', 'layout.spinFrom'],
    advanced: ['layout.tierFrom', 'layout.innerScale', 'layout.ease'],
  },
  {
    id: 'fit', title: 'Setup: fit to avatar', setup: true,
    keys: ['scene.showGuides', 'scene.viewRadius', 'scene.centerX', 'scene.centerY', 'halo.restRadius', 'halo.restY',
      'halo.openRadius', 'halo.openY', 'layout.lowOriginY', 'layout.midOriginY', 'layout.downGap', 'avatar.avoid'],
    advanced: ['avatar.headX', 'avatar.headY', 'avatar.headR', 'avatar.bodyTopY', 'avatar.bodyBottomY', 'avatar.bodyR'],
    catchSections: ['avatar'],
  },
  {
    id: 'connection', title: 'Setup: connection & sync', setup: true,
    keys: ['source.mode', 'source.syncSettings', 'source.useTrackColours', 'source.holdSeconds'],
    advanced: ['source.port'],
    catchSections: ['source'],
  },
  {
    id: 'test', title: 'Test & preview (this viewer only)', setup: true,
    keys: ['scene.showScope', 'scene.scopeLayer', 'scene.scopeSeconds', 'scene.backdrop', 'scene.showAvatar',
      'avatar.opacity', 'scene.paused', 'scene.timeScale', 'scene.layers', 'fake.liveTracks', 'fake.recording'],
    advanced: ['fake.seed', 'fake.phraseMin', 'fake.phraseMax', 'fake.gapMin', 'fake.gapMax', 'fake.highNotes',
      'plants.step', 'plants.maxNodes'],
    catchSections: ['scene', 'fake'],
  },
];

export const LABELS: Record<string, string> = {
  'growth.reach': 'size', 'growth.spread': 'arch', 'growth.flatten': 'flatten', 'growth.branching': 'density of branches',
  'plants.lift': 'tips up / droop', 'plants.clearance': 'gap between branches', 'plants.maxWidth': 'trunk width',
  'plants.tipWidth': 'tip width', 'plants.softDroop': 'droop when soft', 'plants.moodShaping': 'shaped by the phrase',
  'growth.secondsToFull': 'grow time (s)', 'growth.fadeAfter': 'old tree stays (s)', 'growth.fadeSeconds': 'old tree fade (s)',
  'growth.restBrightness': 'brightness when resting', 'growth.witherOnPause': 'wither in pauses',
  'growth.witherDepth': 'wither depth', 'growth.newTreeEachPhrase': 'new tree each phrase',
  'look.theme': 'theme (fallback)', 'look.density': 'leaf amount (fallback)', 'look.decoSize': 'leaf size',
  'look.naturalTint': 'natural colours', 'look.variety': 'tone variety', 'look.depthShade': 'inner shade',
  'look.blossoms': 'blossoms (leaves theme)', 'look.thornEffort': 'thorn growth (thorns theme)', 'look.decoGlow': 'leaf glow',
  'glow.base': 'idle glow', 'glow.levelGain': 'glow from loudness', 'glow.onsetGain': 'flash on note starts',
  'glow.pitchShine': 'shine on high notes', 'glow.front': 'growing-edge glow', 'glow.wide': 'haze',
  'glow.crowd': 'less glow where dense', 'glow.inkMask': 'glow around, not on', 'glow.knee': 'soft roll-off',
  'glow.softGlow': 'soft voice glows wider',
  'response.brightness': 'loudness to brightness', 'response.effortWidth': 'effort to thickness',
  'response.pitchSteer': 'high notes grow upward', 'response.variety': 'reveal-order variety',
  'response.phraseGap': 'pause that ends a phrase (s)', 'response.release': 'settle time (s)',
  'halo.origins': 'growing points', 'halo.tailDeg': 'vine length (deg)', 'halo.alwaysLeaves': 'permanent leaves',
  'halo.spawnSeconds': 'appear time (s)', 'halo.restRadius': 'idle halo size', 'halo.restY': 'idle halo height',
  'halo.openRadius': 'recording halo size', 'halo.openY': 'recording halo height',
  'layout.lowOriginY': 'hub height (1 take)', 'layout.midOriginY': 'hub height (2+ takes)',
  'layout.downGap': 'gap behind body (deg)', 'layout.shrinkPerTake': 'shrink per extra take',
  'layout.spinSpeed': 'carousel speed (deg/s)', 'layout.spinFrom': 'carousel from N takes',
  'layout.tierFrom': 'two rows from N takes', 'layout.innerScale': 'inner row size', 'plants.overlap': 'interleave at seams',
  'scene.viewRadius': 'zoom out', 'scene.layers': 'fake takes + 1', 'scene.showScope': 'voice scope (G)',
  'scene.scopeLayer': 'scope follows (0 = halo)', 'scene.scopeSeconds': 'scope history (s)',
  'source.useTrackColours': 'use DAW track colours', 'source.holdSeconds': 'dropout hold (s)',
  'avatar.avoid': 'keep leaves off the avatar', 'avatar.opacity': 'placeholder opacity',
  'motion.swayDeg': 'sway (deg)', 'motion.kickDeg': 'push on note starts (deg)', 'motion.springiness': 'springiness',
  'motion.idle': 'wind when silent', 'motion.flutterDeg': 'leaf flutter (deg)', 'motion.shiver': 'shiver on vibrato',
  'motion.shiverDeg': 'shiver (deg)', 'motion.speed': 'wind tempo', 'motion.twigs': 'twigs move on their own',
  'commit.enabled': 'plant the halo', 'commit.duration': 'pace', 'commit.impact': 'impact',
  'commit.burst': 'leaves thrown', 'commit.shockRing': 'shock ring', 'commit.plunge': 'plunge depth',
  'commit.spinTurns': 'spin (turns)', 'commit.stampReveal': 'tree grown at impact',
  'commit.syncToOnset': 'land on the next note', 'commit.syncWindow': 'wait up to (s)',
  'transitions.liveEndSeconds': 'halo fade when not live (s)', 'transitions.pruneSeconds': 'deleted take fade (s)',
};

/** Keys only this viewer uses (stripped from sync in main.ts). */
export const LOCAL_KEYS = new Set([
  'source.mode', 'source.port', 'source.syncSettings', 'scene.paused', 'scene.timeScale', 'scene.layers',
  'scene.backdrop', 'scene.showAvatar', 'scene.showGuides', 'scene.showScope', 'scene.scopeLayer', 'scene.scopeSeconds',
]);
/** Fit to this avatar and palette: synced, never part of a preset. */
export const RIG_KEYS = new Set([
  'scene.viewRadius', 'scene.centerX', 'scene.centerY', 'halo.restRadius', 'halo.restY', 'halo.openRadius', 'halo.openY',
  'layout.lowOriginY', 'layout.midOriginY', 'layout.downGap', 'colours.live', 'colours.take1', 'colours.take2',
  'colours.take3', 'colours.take4', 'colours.take5', 'colours.take6', 'colours.take7', 'source.useTrackColours',
  'source.holdSeconds',
]);

export function scopeOf(path: string): Scope {
  if (LOCAL_KEYS.has(path) || path.startsWith('fake.')) return 'local';
  if (RIG_KEYS.has(path) || path.startsWith('avatar.')) return 'rig';
  return 'look';
}
