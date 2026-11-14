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

/** Tooltips for folder titles. */
export const FOLDER_HINTS: Record<string, string> = {
  preset: 'Ready-made looks and your saved ones. A preset changes the look only, never the fit to your avatar or your colour palette. A star means you changed something since picking it.',
  shape: 'The take trees: how big, flat, dense and arched the shared canopy behind you is, and how the branch tips curve.',
  life: 'How fast a tree grows while you sing, how long old trees stay, and how the outer twigs grow back in pauses.',
  leaves: 'Leaves, thorns or wreath on the branches and the halo, their size, amount and colours. Picking a preset sets its theme and amount in every Sprout Tap window (via Sprout.exe). "Theme comes from: this preset" forces it in the viewer even for taps that do not follow.',
  colours: 'The live halo colour and the colour of each take (unless the track uses its DAW colour), or a rainbow.',
  halo: 'The live vine looping round the ring while you record: where it grows from, how fast, how long it trails and what sprouts from it.',
  voice: 'How your voice drives the look: loudness to brightness, effort to thickness, high notes growing upward, and what counts as the end of a phrase.',
  glow: 'Bloom around everything: how strong and wide, what makes it flare, and how it steps back where branches are dense so the detail shows.',
  motion: 'How the plants move: wind that grows with loudness, a push on every note start that swings back, leaf flutter, and the shiver on vibrato.',
  commit: 'What happens when a take finishes recording (the halo winds up and is planted as the new tree) and when a take is deleted.',
  many: 'Behaviour with many takes: how neighbouring plants interleave, how the canopy shrinks, and the optional carousel spin.',
  fit: 'Fit the overlay to your avatar: framing, halo position and size, where the trees grow from, and the keep-out region behind your head and body.',
  connection: 'Where the voice data comes from (Sprout.exe or the fake singer) and whether panel changes are shared with other open viewers such as OBS.',
  test: 'Preview tools for this browser only: the voice scope, the placeholder avatar or your own PNG, pausing, the fake singer.',
};

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
      'growth.twigFadeSeconds', 'growth.regrowSpeed'],
  },
  {
    id: 'leaves', title: 'Leaves & decorations',
    keys: ['look.themeFrom', 'look.theme', 'look.density', 'look.decoSize', 'look.naturalTint', 'look.variety', 'look.depthShade',
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
      'motion.shiverDeg', 'motion.shiverSensitivity'],
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
      'halo.openRadius', 'halo.openY', 'halo.squish', 'halo.tilt', 'layout.lowOriginY', 'layout.midOriginY', 'layout.downGap', 'avatar.avoid'],
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
      'avatar.opacity', 'avatar.useImage', 'avatar.imageX', 'avatar.imageY', 'avatar.imageHeight', 'scene.paused', 'scene.timeScale', 'scene.layers', 'fake.liveTracks', 'fake.recording'],
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
  'growth.witherDepth': 'wither depth', 'growth.twigFadeSeconds': 'wither-back time (s)', 'growth.newTreeEachPhrase': 'new tree each phrase',
  'look.themeFrom': 'theme comes from', 'look.theme': 'theme', 'look.density': 'leaf amount', 'look.decoSize': 'leaf size',
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
  'motion.shiverDeg': 'shiver (deg)', 'motion.shiverSensitivity': 'tremble sensitivity',
  'halo.squish': 'idle halo squish (3D)', 'halo.tilt': 'idle halo tilt (deg)', 'avatar.useImage': 'use my avatar PNG',
  'avatar.imageX': 'picture x', 'avatar.imageY': 'picture y', 'avatar.imageHeight': 'picture height', 'motion.speed': 'wind tempo', 'motion.twigs': 'twigs move on their own',
  'commit.enabled': 'plant the halo', 'commit.duration': 'pace', 'commit.impact': 'impact',
  'commit.burst': 'leaves thrown', 'commit.shockRing': 'shock ring', 'commit.plunge': 'plunge depth',
  'commit.spinTurns': 'spin (turns)', 'commit.stampReveal': 'tree grown at impact',
  'commit.syncToOnset': 'land on the next note', 'commit.syncWindow': 'wait up to (s)',
  'transitions.liveEndSeconds': 'halo fade when not live (s)', 'transitions.pruneSeconds': 'deleted take fade (s)',
};

/** Keys only this viewer uses (stripped from sync in main.ts). */
export const LOCAL_KEYS = new Set([
  'source.mode', 'source.port', 'source.syncSettings', 'scene.paused', 'scene.timeScale', 'scene.layers',
  'scene.backdrop', 'scene.showAvatar', 'scene.showGuides', 'avatar.opacity', 'avatar.useImage', 'avatar.imageX',
  'avatar.imageY', 'avatar.imageHeight', 'scene.showScope', 'scene.scopeLayer', 'scene.scopeSeconds',
]);
/** Fit to this avatar and palette: synced, never part of a preset. */
export const RIG_KEYS = new Set([
  'scene.viewRadius', 'scene.centerX', 'scene.centerY', 'halo.restRadius', 'halo.restY', 'halo.openRadius', 'halo.openY',
  'halo.squish', 'halo.tilt',
  'layout.lowOriginY', 'layout.midOriginY', 'layout.downGap', 'colours.live', 'colours.take1', 'colours.take2',
  'colours.take3', 'colours.take4', 'colours.take5', 'colours.take6', 'colours.take7', 'source.useTrackColours',
  'source.holdSeconds',
]);

export function scopeOf(path: string): Scope {
  if (LOCAL_KEYS.has(path) || path.startsWith('fake.')) return 'local';
  if (RIG_KEYS.has(path) || path.startsWith('avatar.')) return 'rig';
  return 'look';
}

/**
 * Tooltips written for the panel. They win over the doc comments in params.ts, and cover every
 * value that has no comment there (or shares one with its neighbour).
 */
export const TIPS: Record<string, string> = {
  // Tree shape
  'growth.reach': 'How big the canopy of trees behind you is (its width; the height follows flatten).',
  'growth.flatten': '0 = a round canopy, 1 = wide and flat (about 40 % as tall as it is wide).',
  'growth.branching': 'Few bold limbs (0) up to a dense, ivy-like tangle of shoots (1).',
  'growth.spread': 'Low = limbs run straight out from behind your neck; high = they arch out more.',
  'plants.wildness': 'How much the branches wander, how ragged the outline is, and one longer "hero" branch.',
  'plants.clearance': 'Gap a side shoot keeps from other branches, so they spread out instead of bunching.',
  'plants.lift': 'Branch tips curve up toward the sky (positive) or droop (negative).',
  'plants.tipWidth': 'Thickness of the branch tips (with taper high, the finest twig ends).',
  'plants.maxWidth': 'Thickness at the root, hidden behind you; the main limbs start at about 40 % of it.',
  // Growing & fading
  'growth.witherDipSemitones': 'How far the pitch has to drop (in semitones) to count as a dip that withers the twigs.',
  'growth.witherOnPitchDip': 'A drop in pitch (by at least the semitones below) also makes the outer twigs grow back for a moment.',
  // Leaves & decorations
  'look.themeFrom': 'Each track: every track keeps the theme and amount set in its Sprout Tap window (presets set those for you). This preset: the theme and amount below for every track, whatever the Tap windows say.',
  'look.theme': 'Leaves, thorns, Christmas wreath, or bare branches. Used by the fake singer, by taps set to "Viewer default", and for every track when "theme comes from" is this preset.',
  'look.density': 'How close together the leaves (or thorns) sit. They always keep a little space, so they never pile up.',
  'look.decoSize': 'Size of leaves, thorns, needles and blossoms.',
  // Glow (plain wording)
  'glow.wide': 'The wide, soft haze around everything.',
  'glow.inkMask': 'Keeps the glow around the branches and leaves rather than on top of them, so they stay crisp.',
  'glow.front': 'Extra glow on the tips that are growing right now.',
  // Take commit (plain wording)
  'commit.syncToOnset': 'Before planting, the halo waits a moment for your next note start so the hit lands on the music.',
  'commit.stampReveal': 'How much of the new tree is already grown at the moment it is planted.',
  'commit.spinTurns': 'How many turns the halo at least spins while it winds up.',
  'commit.plunge': 'How far the rolled-up halo drives into the root behind you.',
  'layout.spinSpeed': 'Carousel: the trees slowly circle round you (degrees per second; 0 = off).',
  // Connection / test (plain wording)
  'source.mode': 'Auto: live taps whenever Sprout.exe is running, otherwise the fake singer. Live: live taps only. Fake singer: always the built-in test singer.',
  'scene.layers': 'Fake singer: how many layers to fake (1 live halo plus this minus 1 takes).',
  // Colours
  'colours.mode': 'Take colours: each take its own colour (below, or its DAW track colour). Rainbow: every take cycles through the hues.',
  'colours.rainbowSpeed': 'How fast the rainbow hues travel (cycles per second).',
  'colours.live': 'Colour of the live halo (further live tracks get it hue-shifted). Tracks using their DAW colour ignore it.',
  'colours.take1': 'Colour of the 1st take (unless its track uses its DAW colour).',
  'colours.take2': 'Colour of the 2nd take.',
  'colours.take3': 'Colour of the 3rd take.',
  'colours.take4': 'Colour of the 4th take.',
  'colours.take5': 'Colour of the 5th take.',
  'colours.take6': 'Colour of the 6th take.',
  'colours.take7': 'Colour of the 7th take (the 8th starts again at the 1st).',
  // Live halo
  'halo.idleSpeed': 'How fast the vine creeps round the ring while you are quiet (degrees per second).',
  'halo.singSpeed': 'Extra speed round the ring at full voice (degrees per second, added to the quiet speed).',
  'halo.spawnSeconds': 'How long a new halo takes to pop in.',
  'halo.ringWidth': 'Thickness of the plain ring line.',
  'halo.vineWidth': 'Thickness of the vine that loops round the ring.',
  'halo.sproutWidth': 'Thickness of the side shoots that sprout from the vine.',
  'halo.restY': 'Height of the small resting halo (above the head when nothing is recorded).',
  'halo.openY': 'Height of the centre of the open halo while recording.',
  'halo.restRadius': 'Size of the small resting halo on top of the head (when nothing is being recorded).',
  'halo.openRadius': 'Size of the open halo around head and shoulders while recording.',
  // Glow
  'glow.strength': 'Overall strength of the glow around everything.',
  'glow.radius': 'How far the glow spreads.',
  'glow.base': 'Glow that is always there, even when silent.',
  'glow.levelGain': 'Extra glow with loudness.',
  'glow.onsetGain': 'A flash of glow on every note start.',
  'glow.pitchShine': 'High, loud notes make everything shine brighter.',
  // Wind & shiver
  'motion.shiverDeg': 'How far twigs and leaves shimmer at full vibrato (degrees). See tremble sensitivity for how easily it starts.',
  // Take commit
  'commit.enabled': 'When a take finishes recording, its halo winds up and is planted as the new tree. Off: the halo simply fades and the tree grows in.',
  'commit.shockRing': 'A ring of light spreading from behind you at the moment the tree is planted.',
  'commit.syncWindow': 'Longest the planting waits for the next note start (seconds), so the hit lands on the music.',
  // Many takes
  'layout.spinFrom': 'The carousel spin (if its speed is not 0) starts from this many takes.',
  'layout.tierFrom': 'From this many takes, the trees form two rows: an outer one and a smaller inner one.',
  'layout.innerScale': 'Size of the inner row of trees compared with the outer row.',
  'layout.ease': 'How quickly trees glide to their new places when takes are added or removed (higher = faster).',
  // Fit to avatar
  'scene.showGuides': 'Preview: draw the canopy outline, each tree\'s area and the keep-out region.',
  'scene.viewRadius': 'Preview zoom: how much of the scene fits the window (higher = further away).',
  'scene.centerX': 'Moves the whole picture left or right in the frame.',
  'scene.centerY': 'Moves the whole picture up or down in the frame.',
  'layout.lowOriginY': 'With one take, the height its trunk starts from (hidden behind the body).',
  'avatar.avoid': 'Keep branches, shoots and leaves off the region of your head and body below.',
  'avatar.headX': 'Head centre, left / right (the keep-out circle).',
  'avatar.headY': 'Head centre height (the keep-out circle).',
  'avatar.headR': 'Head radius (the keep-out circle).',
  'avatar.bodyTopY': 'Height of the shoulders (top of the body keep-out).',
  'avatar.bodyBottomY': 'Bottom of the body keep-out (usually below the frame).',
  'avatar.bodyR': 'Half the width of the body keep-out.',
  // Connection
  'source.useTrackColours': 'Use each track\'s DAW colour for its tree or halo, for taps set to "Viewer palette" too.',
  // Test & preview
  'scene.backdrop': 'Preview background: checkerboard, black, or transparent (as in OBS).',
  'scene.showAvatar': 'Preview: show the placeholder avatar (or your PNG) in the middle. Never shown in OBS.',
  'avatar.opacity': 'Preview: how solid the placeholder avatar or your PNG is drawn.',
  'avatar.imageX': 'Moves your avatar picture left or right.',
  'avatar.imageY': 'Moves your avatar picture up or down.',
  'avatar.imageHeight': 'Height of your avatar picture (its width follows).',
  'scene.paused': 'Preview: freeze the animation (OBS always runs).',
  'scene.timeScale': 'Preview: play the animation slower or faster (OBS always runs in real time).',
  'fake.seed': 'Fake singer: a different number gives a different song and different trees.',
  'fake.phraseMin': 'Fake singer: shortest phrase (seconds).',
  'fake.phraseMax': 'Fake singer: longest phrase (seconds).',
  'fake.gapMin': 'Fake singer: shortest pause between phrases (seconds).',
  'fake.gapMax': 'Fake singer: longest pause between phrases (seconds).',
  'fake.highNotes': 'Fake singer: how often it jumps to very high notes (up to F6).',
  'plants.step': 'Length of each branch segment. Smaller = smoother curves, more work per frame.',
  'plants.maxNodes': 'Upper limit of branch points per tree, which caps the cost of very dense trees.',
};
