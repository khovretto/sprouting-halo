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
  /** Top tab: Look (visual preset), Reaction (reactivity preset), Setup (rig and this viewer). */
  tab: 'look' | 'reaction' | 'setup';
  title: string;
  open?: boolean;
  keys: string[];
  advanced?: string[];
  /** Nested folders with their own title. */
  sub?: { id: string; title: string; keys: string[] }[];
  /** Any key of these sections not listed anywhere lands here (so new params still show up). */
  catchSections?: string[];
}

/** Tooltips for folder titles. */
export const FOLDER_HINTS: Record<string, string> = {
  preset: 'Three kinds of preset, picked independently. Visual: how it looks (shape, leaves, tint, glow). Reactivity: how it answers your voice (growth, withering, brightness, motion, the planting). Testing: fake singer and preview, this browser only. Your palette and the fit to your avatar belong to none of them. A star means something changed since picking it.',
  shape: 'The take trees: how big, flat, dense and arched the shared canopy behind you is, and how the branch tips curve.',
  life: 'How fast a tree grows while you sing, how long old trees stay, and how the outer twigs grow back in pauses.',
  leaves: 'Leaves, thorns or wreath on the branches and the halo, their size and amount. Every Sprout Tap starts on Auto and follows this; a tap set to its own theme, amount or colour keeps it (Set every tap to Auto undoes that).',
  colours: 'The live halo colour and the colour of each take (unless the track uses its DAW colour), or a rainbow.',
  halo: 'The live vine looping round the ring while you record: where it grows from, how fast, how long it trails and what sprouts from it.',
  voice: 'How your voice drives the look: loudness to brightness, effort to thickness, high notes growing upward, and what counts as the end of a phrase.',
  glow: 'Bloom around everything: how strong and wide, what makes it flare, and how it steps back where branches are dense so the detail shows.',
  motion: 'How the plants move: wind that grows with loudness, leaf flutter, and the shiver on vibrato.',
  pauses: 'What the branches do when you stop singing, by how long the silence is: a short pause (a breath) acts on the outer twigs, the end of the phrase and a full stop on the whole tree. Each has its own choice: keep, ungrow, fade or fall away, from the tips inward or all at once. And whether the leaves let go.',
  harmony: 'What happens while two tracks sing in harmony: different notes that sound well together (a third, fourth, fifth or sixth apart, in any octave), at the same time. The viewer finds it from the pitches of the tracks, live and played back. Every effect has its own amount; 0 turns it off, so any of them can be combined. Theme parts can also open in harmony (theme editor: opens).',
  commit: 'What happens when a take finishes recording (the halo winds up and is planted as the new tree) and when a take is deleted.',
  many: 'Behaviour with many takes: how neighbouring plants interleave, how the canopy shrinks, and the optional carousel spin.',
  fit: 'Fit the overlay to your avatar: framing, halo position and size, where the trees grow from, and the keep-out region behind your head and body.',
  detect: 'How Sprout.exe recognises things in your voice. These live in Sprout.exe (saved next to it), so every viewer and OBS use the same values; a viewer that connects shows them. Needs Sprout.exe running: the fake singer always sings with clear vibrato.',
  perf: 'How often and how large the picture is drawn. Lower values leave more of the graphics card to OBS, VTube Studio and your browser. Shared with the OBS page. Hidden pages and OBS sources that are not shown draw nothing at all.',
  connection: 'Where the voice data comes from (Sprout.exe or the fake singer) and whether panel changes are shared with other open viewers such as OBS.',
  test: 'Preview tools for this browser only: the voice scope, the placeholder avatar or your own PNG, pausing, the fake singer.',
};

const ROLE = (r: string) => [`${r}.source`, `${r}.gradient`, `${r}.takeMix`, `${r}.along`, `${r}.speed`,
  `${r}.voice`, `${r}.voiceAmount`, `${r}.perTake`, `${r}.scatter`];

// docs/fable-consult-5-colour-themes-panel.md, D.3: a tab is a preset kind.
export const FOLDERS: FolderSpec[] = [
  // ---------------- Look (visual preset) ----------------
  {
    id: 'colours', tab: 'look', title: 'Colours', open: true,
    keys: ['look.tint', 'look.tintAmount'],
    sub: [
      { id: 'colBranch', title: 'Branches', keys: ROLE('colBranch') },
      { id: 'colLeaf', title: 'Leaves', keys: ROLE('colLeaf') },
      { id: 'colAccent', title: 'Blossoms & berries', keys: ROLE('colAccent') },
      { id: 'colHalo', title: 'Halo ring & vine', keys: ROLE('colHalo') },
      {
        id: 'lookPalette', title: 'Take colours of this look',
        keys: ['palette.from', 'palette.list', 'palette.pick', 'palette.seed'],
      },
      {
        id: 'palette', title: 'My take colours (kept across presets)',
        keys: ['colours.lock', 'colours.live', 'colours.take1', 'colours.take2', 'colours.take3', 'colours.take4', 'colours.take5',
          'colours.take6', 'colours.take7', 'source.useTrackColours'],
      },
    ],
    catchSections: ['colBranch', 'colLeaf', 'colAccent', 'colHalo', 'colours', 'palette'],
  },
  {
    id: 'theme', tab: 'look', title: 'Theme & leaves',
    keys: ['look.theme', 'look.density', 'look.decoSize', 'look.variety', 'look.depthShade', 'look.buds', 'look.dryColour',
      'look.woodStays', 'look.leafSheen', 'look.sheenColour'],
    sub: [
      {
        id: 'leaves3d', title: '3D leaves',
        keys: ['look.leaf3d', 'leaves3d.fold', 'leaves3d.cup', 'leaves3d.arch', 'leaves3d.turn', 'leaves3d.tilt', 'leaves3d.wind', 'leaves3d.shiver',
          'leaves3d.lightAngle', 'leaves3d.lightHeight', 'leaves3d.shade', 'leaves3d.shine', 'leaves3d.underside'],
      },
      {
        id: 'falling', title: 'Falling leaves',
        keys: ['look.leafFall', 'look.leafRegrow', 'falling.speed', 'falling.sway', 'falling.spin', 'falling.flutter', 'falling.time',
          'falling.dropSeconds', 'falling.dropVariety', 'falling.dropSpeed'],
      },
    ],
    advanced: ['look.themeFrom'],
  },
  {
    id: 'shape', tab: 'look', title: 'Tree shape',
    keys: ['growth.reach', 'growth.flatten', 'growth.branching', 'growth.lowBranches', 'plants.originLimbs', 'plants.trunk', 'plants.trunkLean', 'growth.spread', 'plants.lift', 'plants.wildness', 'plants.taper',
      'plants.twist', 'plants.gnarl', 'plants.curl', 'plants.strands'],
    advanced: ['plants.clearance', 'plants.tipWidth', 'plants.maxWidth', 'plants.twistLength', 'plants.twistTighten', 'plants.twistTwigs',
      'plants.knots', 'plants.twistDepth', 'plants.strandLay'],
  },
  {
    id: 'halo', tab: 'look', title: 'Live halo',
    keys: ['halo.origins', 'halo.bothWays', 'halo.tailDeg', 'halo.sproutLength', 'halo.sproutCurl', 'halo.alwaysLeaves', 'halo.wander', 'halo.braid'],
    advanced: ['halo.twist', 'halo.startAngle', 'halo.tailFade', 'halo.ringWidth', 'halo.vineWidth', 'halo.sproutWidth', 'halo.ringSpacing'],
  },
  {
    id: 'glow', tab: 'look', title: 'Glow',
    keys: ['glow.strength', 'glow.radius', 'glow.base', 'look.decoGlow', 'glow.tint', 'glow.tintAmount', 'glow.shadow', 'glow.shadowColour'],
    advanced: ['glow.tintFlat', 'glow.wide', 'glow.crowd', 'glow.inkMask', 'glow.knee'],
  },
  {
    id: 'many', tab: 'look', title: 'Many takes',
    keys: ['plants.overlap', 'layout.shrinkPerTake', 'layout.spinSpeed', 'layout.spinFrom'],
    advanced: ['layout.tierFrom', 'layout.innerScale', 'layout.ease', 'plants.step', 'plants.maxNodes'],
    catchSections: ['layout', 'plants', 'growth', 'look', 'halo', 'glow'],
  },
  // ---------------- Reaction (reactivity preset) ----------------
  {
    id: 'phrases', tab: 'reaction', title: 'Singing & phrases: growing', open: true,
    keys: ['growth.secondsToFull', 'growth.newTreeEachPhrase', 'growth.branchEachPhrase', 'growth.fillSpace', 'response.phraseGap',
      'growth.restBrightness', 'response.release'],
    advanced: ['response.variety', 'plants.moodShaping', 'growth.branchesKept', 'growth.branchOrder', 'growth.branchSymmetry', 'growth.branchWitherSeconds', 'growth.branchDroopDeg',
      'growth.branchFallSeconds'],
  },
  {
    id: 'pauses', tab: 'reaction', title: 'Pauses & endings: ungrow, fade, fall',
    keys: ['growth.witherEffect', 'growth.witherFromTips', 'growth.onPause', 'growth.witherDepth', 'growth.onPhraseEnd', 'growth.fadeAfter', 'growth.onStop', 'growth.dieAfter',
      'growth.fadeSeconds', 'growth.shed', 'growth.fallDirection'],
    advanced: ['growth.witherSeconds', 'growth.witherOnPitchDip', 'growth.witherDipSemitones', 'growth.twigFadeSeconds', 'growth.regrowSpeed'],
  },
  {
    id: 'harmony', tab: 'reaction', title: 'Harmony: two voices together',
    keys: ['harmony.colour', 'harmony.colourMode', 'harmony.colourValue', 'harmony.colourMix', 'harmony.waveLead', 'harmony.waveFrom',
      'harmony.waveLength', 'harmony.waveSpeed', 'harmony.cross', 'harmony.blossoms', 'harmony.glow'],
    advanced: ['harmony.minSeconds', 'harmony.attack', 'harmony.unison'],
    catchSections: ['harmony'],
  },
  {
    id: 'loud', tab: 'reaction', title: 'Loudness: brightness, wind, halo speed',
    keys: ['response.brightness', 'glow.levelGain', 'motion.swayDeg', 'motion.idle', 'halo.singSpeed', 'halo.sproutRate'],
    advanced: ['halo.idleSpeed', 'motion.flutterDeg', 'motion.speed'],
  },
  {
    id: 'onsets', tab: 'reaction', title: 'Note starts: flash',
    keys: ['glow.onsetGain'],
    advanced: ['motion.kickDeg', 'motion.springiness', 'motion.twigs', 'glow.front', 'halo.sproutGrow'],
  },
  {
    id: 'timbre', tab: 'reaction', title: 'Pitch, effort and softness',
    keys: ['response.pitchSteer', 'glow.pitchShine', 'response.effortWidth', 'look.thornEffort', 'glow.softGlow', 'plants.softDroop', 'plants.twistVoice'],
  },
  {
    id: 'held', tab: 'reaction', title: 'Held notes & vibrato: blossoms, shiver',
    keys: ['look.blossoms', 'look.blossomHold', 'motion.shiver', 'motion.shiverDeg', 'motion.shiverSensitivity', 'motion.writhe', 'motion.writheVoice', 'motion.leafShake'],
    catchSections: ['motion', 'response'],
  },
  {
    id: 'commit', tab: 'reaction', title: 'Planting a take & removal',
    keys: ['commit.enabled', 'commit.duration', 'commit.limbs'],
    advanced: ['transitions.liveEndSeconds', 'transitions.pruneSeconds', 'transitions.lookChangeSeconds', 'halo.spawnSeconds'],
    catchSections: ['commit', 'transitions'],
  },
  // ---------------- Setup (rig and this viewer) ----------------
  {
    id: 'fit', tab: 'setup', title: 'Fit to avatar', open: true,
    keys: ['scene.showGuides', 'scene.viewRadius', 'scene.centerX', 'scene.centerY', 'halo.restRadius', 'halo.restY',
      'halo.openRadius', 'halo.openY', 'halo.restX', 'halo.squish', 'halo.tilt', 'layout.midOriginY',
      'layout.downGap', 'avatar.avoid'],
    advanced: ['avatar.headX', 'avatar.headY', 'avatar.headR', 'avatar.bodyTopY', 'avatar.bodyBottomY', 'avatar.bodyR'],
    catchSections: ['avatar'],
  },
  {
    id: 'detect', tab: 'setup', title: 'Voice detection',
    keys: ['detect.vibratoMinNote', 'detect.vibratoMinSemitones', 'detect.vibratoFullSemitones', 'detect.vibratoMinHz', 'detect.vibratoMaxHz'],
    catchSections: ['detect'],
  },
  {
    id: 'perf', tab: 'setup', title: 'Performance',
    keys: ['perf.fps', 'perf.idleFps', 'perf.backgroundFps'],
    advanced: ['perf.maxMegapixels', 'perf.renderScale'],
    catchSections: ['perf'],
  },
  {
    id: 'connection', tab: 'setup', title: 'Connection & sync',
    keys: ['source.mode', 'source.syncSettings', 'source.holdSeconds'],
    advanced: ['source.port'],
    catchSections: ['source'],
  },
  {
    id: 'test', tab: 'setup', title: 'Test & preview (this viewer only)',
    keys: ['scene.showScope', 'scene.scopeLayer', 'scene.scopeSeconds', 'scene.backdrop', 'scene.showAvatar', 'avatar.opacity',
      'avatar.useImage', 'avatar.imageX', 'avatar.imageY', 'avatar.imageHeight', 'scene.paused', 'scene.timeScale', 'scene.layers',
      'fake.liveTracks', 'fake.recording', 'fake.voices', 'fake.harmony', 'fake.together'],
    advanced: ['fake.seed', 'fake.phraseMin', 'fake.phraseMax', 'fake.gapMin', 'fake.gapMax', 'fake.highNotes', 'fake.noteMax', 'fake.longNotes', 'fake.fullStopEvery', 'fake.fullStopSeconds', 'fake.autoCommit'],
    catchSections: ['scene', 'fake'],
  },
];

/** Combined sliders (D.2): not settings; each writes several existing keys along a line through
 *  three anchors (0, 0.5 = default, 1) and reads its position back from the first target. */
export interface MacroSpec {
  id: string;
  label: string;
  tip: string;
  tab: 'look' | 'reaction';
  targets: { path: string; at: [number, number, number] }[];
}
export const MACROS: MacroSpec[] = [
  {
    id: 'fullness', tab: 'look', label: 'fullness',
    tip: 'Sparse to overgrown: branch density, how low the branches start, leaf amount and permanent halo leaves together. Moves the real settings, which stay editable.',
    targets: [{ path: 'growth.branching', at: [0.3, 0.6, 0.95] }, { path: 'growth.lowBranches', at: [0.3, 0.6, 1] }, { path: 'look.density', at: [0.3, 0.55, 0.85] },
      { path: 'halo.alwaysLeaves', at: [0.2, 0.4, 0.7] }],
  },
  {
    id: 'liveliness', tab: 'reaction', label: 'liveliness',
    tip: 'How strongly everything answers the voice: brightness, glow, flash and sway together.',
    targets: [{ path: 'response.brightness', at: [0.5, 0.7, 1] }, { path: 'glow.levelGain', at: [0.5, 0.8, 1.6] },
      { path: 'glow.onsetGain', at: [0.15, 0.35, 0.9] }, { path: 'motion.swayDeg', at: [4, 8, 12] }],
  },
  {
    id: 'pace', tab: 'reaction', label: 'pace',
    tip: 'Slow and lingering to fast and snappy: grow time, fades, settle time and halo speeds together.',
    targets: [{ path: 'growth.secondsToFull', at: [6, 3.5, 1.8] }, { path: 'growth.fadeAfter', at: [6, 3, 1.5] },
      { path: 'growth.fadeSeconds', at: [5, 2.5, 1.2] }, { path: 'response.release', at: [3, 1.4, 0.7] },
      { path: 'halo.idleSpeed', at: [5, 8, 20] }, { path: 'halo.singSpeed', at: [40, 70, 160] }],
  },
];
export const macroValue = (m: number, [a, b, c]: number[]) => (m < 0.5 ? a + (b - a) * m * 2 : b + (c - b) * (m - 0.5) * 2);
/** Macro position from a target's value (inverse of macroValue; anchors may run either way). */
export function macroPos(v: number, [a, b, c]: number[]) {
  const seg = (x: number, p: number, q: number) => (Math.abs(q - p) < 1e-9 ? 0 : (x - p) / (q - p));
  const lo = seg(v, a, b), hi = seg(v, b, c);
  if (lo >= 0 && lo <= 1) return lo * 0.5;
  if (hi >= 0 && hi <= 1) return 0.5 + hi * 0.5;
  return Math.abs(v - a) < Math.abs(v - c) ? 0 : 1;
}

/** Quick movement buttons per colour role (D.2). */
export const MOVEMENTS: { label: string; tip: string; values: Record<string, unknown> }[] = [
  { label: 'Still', tip: 'One colour per part: no movement.', values: { along: 0, speed: 0, scatter: 0, voice: 'none' } },
  { label: 'Root→tip', tip: 'The gradient runs from root to tip.', values: { along: 1, speed: 0, scatter: 0, voice: 'none' } },
  { label: 'Flow', tip: 'The colours travel slowly along the branches.', values: { along: 0.3, speed: 0.05, scatter: 0, voice: 'none' } },
  { label: 'Sparkle', tip: 'Each leaf picks its own colour from the gradient.', values: { along: 0, speed: 0, scatter: 1, voice: 'none' } },
  { label: 'Sing it', tip: 'Your pitch moves the colour along the gradient.', values: { along: 0.2, speed: 0, scatter: 0, voice: 'pitch', voiceAmount: 1 } },
];

export const LABELS: Record<string, string> = {
  'growth.reach': 'size', 'growth.spread': 'arch', 'growth.flatten': 'flatten', 'growth.branching': 'density of branches', 'growth.lowBranches': 'branches start low', 'plants.originLimbs': 'limbs from the origin (0 = auto)', 'plants.trunk': 'trunk length', 'plants.trunkLean': 'trunk lean (deg)',
  'growth.fallDirection': 'falling pieces go',
  'plants.lift': 'tips up / droop', 'plants.clearance': 'gap between branches', 'plants.maxWidth': 'trunk width',
  'plants.tipWidth': 'tip width', 'plants.softDroop': 'droop when soft', 'plants.moodShaping': 'shaped by the phrase',
  'growth.secondsToFull': 'grow time (s)', 'growth.fadeAfter': 'tree stays after singing (s)', 'growth.fadeSeconds': 'an ending takes (s)',
  'growth.witherEffect': 'withering effect', 'growth.witherFromTips': 'from the tips first',
  'growth.onPause': 'short pause: outer twigs', 'growth.onPhraseEnd': 'phrase end: whole tree', 'growth.onStop': 'full stop: whole tree',
  'falling.speed': 'fall speed', 'falling.sway': 'sway', 'falling.spin': 'turning', 'falling.flutter': 'flutter in the wind',
  'falling.time': 'time before gone',
  'falling.dropSeconds': 'straight drop first (s)', 'falling.dropVariety': 'drop differs per leaf', 'falling.dropSpeed': 'drop speed',
  'harmony.colour': 'colours come together', 'harmony.colourMode': 'shared colour', 'harmony.colourValue': 'harmony colour',
  'harmony.colourMix': 'colours blend', 'harmony.waveLead': 'waves start', 'harmony.waveFrom': 'halo waves start from',
  'harmony.waveLength': 'wave length', 'harmony.waveSpeed': 'wave speed',
  'harmony.cross': 'branches crisscross', 'harmony.blossoms': 'blossoms open in harmony', 'harmony.glow': 'glow in harmony',
  'harmony.minSeconds': 'counts after (s)', 'harmony.attack': 'comes in over (s)', 'harmony.unison': 'unison & octaves count',
  'fake.voices': 'fake voices', 'fake.harmony': 'fake harmony', 'fake.together': 'duet: phrases together',
  'look.woodStays': 'wood stays (no growing or withering)', 'look.leafFall': 'leaves fall on their own', 'look.leafRegrow': 'leaves regrow (s)',
  'motion.leafShake': 'trembling shakes leaves loose',
  'look.leaf3d': 'amount (0 = flat)', 'leaves3d.fold': 'fold (deg)', 'leaves3d.cup': 'dome', 'leaves3d.arch': 'arch',
  'leaves3d.turn': 'turn (deg)', 'leaves3d.tilt': 'tilt (deg)', 'leaves3d.wind': 'moves with the wind', 'leaves3d.shiver': 'trembles on vibrato',
  'leaves3d.lightAngle': 'light from (deg)', 'leaves3d.lightHeight': 'light height (deg)', 'leaves3d.shade': 'shade',
  'leaves3d.shine': 'shine', 'leaves3d.underside': 'pale underside', 'look.leafSheen': 'leaf sheen', 'look.sheenColour': 'sheen colour', 'growth.dieAfter': 'silence that is a full stop (s)',
  'growth.restBrightness': 'brightness when resting',
  'growth.witherDepth': 'short pause reaches in', 'growth.twigFadeSeconds': 'wither-back time (s)', 'growth.newTreeEachPhrase': 'new tree each phrase',
  'look.themeFrom': 'per-track settings', 'look.theme': 'theme', 'look.density': 'leaf amount', 'look.decoSize': 'leaf size',
  'look.naturalTint': 'natural colours', 'look.variety': 'tone variety', 'look.depthShade': 'inner shade',
  'look.blossoms': 'blossoms', 'look.blossomHold': 'blossom after note held (s)', 'look.thornEffort': 'thorn growth (thorns theme)', 'look.decoGlow': 'leaf glow',
  'glow.base': 'idle glow', 'glow.levelGain': 'glow from loudness', 'glow.onsetGain': 'flash on note starts',
  'glow.pitchShine': 'shine on high notes', 'glow.front': 'growing-edge glow', 'glow.wide': 'haze',
  'glow.crowd': 'less glow where dense', 'glow.inkMask': 'glow around, not on', 'glow.knee': 'soft roll-off',
  'glow.softGlow': 'soft voice glows wider',
  'response.brightness': 'loudness to brightness', 'response.effortWidth': 'effort to thickness',
  'response.pitchSteer': 'high notes grow upward', 'response.variety': 'reveal-order variety',
  'response.phraseGap': 'pause that ends a phrase (s)', 'response.release': 'settle time (s)',
  'growth.witherSeconds': 'pause to full reach (s)', 'growth.witherOnPitchDip': 'wither on pitch dips',
  'growth.witherDipSemitones': 'pitch dip (semitones)', 'growth.regrowSpeed': 'regrow speed',
  'halo.origins': 'growing points', 'halo.idleSpeed': 'quiet speed (deg/s)', 'halo.singSpeed': 'sing speed (deg/s)',
  'halo.sproutRate': 'shoots per second', 'halo.sproutLength': 'shoot length', 'halo.sproutCurl': 'shoot curl',
  'halo.bothWays': 'grow both ways', 'halo.wander': 'wander', 'halo.startAngle': 'start angle (deg)',
  'halo.tailFade': 'tail fade', 'halo.sproutGrow': 'shoot grow time (s)', 'halo.ringWidth': 'ring width',
  'halo.vineWidth': 'vine width', 'halo.sproutWidth': 'shoot width', 'halo.ringSpacing': 'nested halo spacing', 'halo.tailDeg': 'vine length (deg)', 'halo.alwaysLeaves': 'permanent leaves',
  'halo.spawnSeconds': 'appear time (s)', 'halo.restRadius': 'idle halo size', 'halo.restY': 'idle halo height',
  'halo.openRadius': 'recording halo size', 'halo.openY': 'recording halo height',
  'layout.midOriginY': 'hub height',
  'layout.downGap': 'gap behind body (deg)', 'layout.shrinkPerTake': 'shrink per extra take',
  'layout.spinSpeed': 'carousel speed (deg/s)', 'layout.spinFrom': 'carousel from N takes',
  'layout.tierFrom': 'two rows from N takes', 'layout.innerScale': 'inner row size', 'plants.overlap': 'interleave at seams',
  'scene.viewRadius': 'zoom out', 'scene.layers': 'fake takes + 1', 'scene.showScope': 'voice scope (G)',
  'scene.scopeLayer': 'scope follows (0 = halo)', 'scene.scopeSeconds': 'scope history (s)',
  'source.useTrackColours': 'use DAW track colours', 'source.holdSeconds': 'dropout hold (s)',
  'avatar.avoid': 'keep leaves off the avatar', 'avatar.opacity': 'placeholder opacity',
  'motion.swayDeg': 'sway (deg)', 'motion.kickDeg': 'push on note starts (deg, 0 = none)', 'motion.springiness': 'springiness',
  'motion.idle': 'wind when silent', 'motion.flutterDeg': 'leaf flutter (deg)', 'motion.shiver': 'shiver on vibrato',
  'motion.shiverDeg': 'shiver (deg)', 'motion.shiverSensitivity': 'tremble sensitivity',
  'halo.restX': 'idle halo sideways', 'halo.squish': 'idle halo squish (3D)', 'halo.tilt': 'idle halo tilt (deg)', 'avatar.useImage': 'use my avatar PNG',
  'avatar.imageX': 'picture x', 'avatar.imageY': 'picture y', 'avatar.imageHeight': 'picture height', 'motion.speed': 'wind tempo', 'motion.twigs': 'twigs move on their own',
  'detect.vibratoMinNote': 'vibrato: note at least (s)', 'detect.vibratoMinSemitones': 'vibrato: smallest swing (st)',
  'detect.vibratoFullSemitones': 'vibrato: full at swing (st)', 'detect.vibratoMinHz': 'vibrato: slowest (Hz)',
  'detect.vibratoMaxHz': 'vibrato: fastest (Hz)',
  'fake.longNotes': 'long held notes', 'fake.fullStopEvery': 'full stop every n phrases', 'fake.fullStopSeconds': 'full stop length (s)',
  'perf.fps': 'max fps', 'perf.idleFps': 'fps when silent', 'perf.backgroundFps': 'preview fps in background',
  'perf.maxMegapixels': 'max picture size (MP)', 'perf.renderScale': 'render scale',
  'transitions.lookChangeSeconds': 'look change round the halo (s)', 'commit.enabled': 'plant the halo', 'commit.duration': 'slowness',
  'growth.shed': 'leaves let go when twigs go', 'growth.branchEachPhrase': 'new branch each phrase', 'growth.fillSpace': 'fill empty space',
  'growth.branchesKept': 'branches kept', 'growth.branchOrder': 'new branch grows', 'growth.branchSymmetry': 'symmetrical branches',
  'growth.branchWitherSeconds': 'old branch dries (s)',
  'growth.branchDroopDeg': 'old branch droops (deg)', 'growth.branchFallSeconds': 'old branch falls (s)',
  'commit.limbs': 'halo divides into', 'look.buds': 'bud size', 'look.dryColour': 'withered colour',
  'palette.from': 'take colours from', 'palette.list': "this look's colours", 'palette.pick': 'pick', 'palette.seed': 'shuffle',
  'colours.lock': 'always use my take colours', 'fake.autoCommit': 'plant a take every (s)',
  'transitions.liveEndSeconds': 'halo fade when not live (s)', 'transitions.pruneSeconds': 'deleted take fade (s)',
  'plants.twist': 'twist', 'plants.gnarl': 'gnarl', 'plants.curl': 'curling tips', 'plants.strands': 'strands',
  'plants.twistLength': 'turn length', 'plants.twistTighten': 'tighter toward tips', 'plants.twistTwigs': 'twig twist',
  'plants.knots': 'knots', 'plants.twistDepth': 'depth shading', 'plants.strandLay': 'strand turn (widths)',
  'plants.twistVoice': 'voice twists new trees', 'motion.writhe': 'writhe', 'motion.writheVoice': 'writhe follows',
  'halo.braid': 'braided ring', 'halo.twist': 'vine corkscrew', 'glow.shadow': 'dark outline', 'glow.shadowColour': 'outline colour',
  'glow.tintFlat': 'dark ink glows too',
};

/** Keys only this viewer uses (stripped from sync in main.ts). */
export const LOCAL_KEYS = new Set([
  'detect.vibratoMinNote', 'detect.vibratoMinSemitones', 'detect.vibratoFullSemitones', 'detect.vibratoMinHz', 'detect.vibratoMaxHz',
  'source.mode', 'source.port', 'source.syncSettings', 'scene.paused', 'scene.timeScale', 'scene.layers',
  'scene.backdrop', 'scene.showAvatar', 'scene.showGuides', 'avatar.opacity', 'avatar.useImage', 'avatar.imageX',
  'avatar.imageY', 'avatar.imageHeight', 'scene.showScope', 'scene.scopeLayer', 'scene.scopeSeconds',
]);
/** Fit to this avatar and palette: synced, never part of a preset. */
export const RIG_KEYS = new Set([
  'scene.viewRadius', 'scene.centerX', 'scene.centerY', 'halo.restRadius', 'halo.restY', 'halo.openRadius', 'halo.openY',
  'halo.squish', 'halo.tilt', 'halo.restX',
  'layout.midOriginY', 'layout.downGap', 'colours.live', 'colours.take1', 'colours.take2',
  'colours.take3', 'colours.take4', 'colours.take5', 'colours.take6', 'colours.take7', 'colours.lock', 'source.useTrackColours',
  'source.holdSeconds',
]);

export function scopeOf(path: string): Scope {
  if (LOCAL_KEYS.has(path) || path.startsWith('fake.')) return 'local';
  if (RIG_KEYS.has(path) || path.startsWith('avatar.') || path.startsWith('perf.')) return 'rig';
  return 'look';
}

/**
 * Tooltips written for the panel. They win over the doc comments in params.ts, and cover every
 * value that has no comment there (or shares one with its neighbour).
 */
export const TIPS: Record<string, string> = {
  'look.woodStays': 'Trees are there in full from the start (no growing), one per take, and their branches never wither, fade or die: pauses and endings only touch the leaves. Overrides the growing and withering settings under Reaction. For seasonal looks like Autumn.',
  'look.leafFall': 'Leaves let go on their own and fall while the branches stay, then grow back. 0 = never. A steady trickle, showers when your voice trembles (vibrato) and, with the wood staying, in pauses. This is apart from what happens to leaves when twigs wither in pauses: that is “leaves let go when twigs go” (Reaction, Pauses & endings).\nReads: each leaf falls with chance leafFall × (0.12 + 0.9 × shake × vibrato + 0.5 × pause) per second.',
  'look.leafRegrow': 'Seconds before a fallen leaf grows back (each a little different).',
  'falling.speed': 'How fast falling leaves and petals fall (1 = as before).',
  'falling.sway': 'How far falling leaves swing from side to side as they fall (1 = as before).',
  'falling.spin': 'How much falling leaves turn and rock as they fall (1 = as before).',
  'falling.flutter': 'How much the wind still flutters a leaf about its stalk while it falls (1 = as much as on its twig, 0 = not at all).',
  'falling.time': 'How long a falling leaf lasts before it is gone (1 = about 1.1 to 1.7 s).',
  'falling.dropSeconds': 'A leaf that lets go first drops straight down for about this long, then slows and starts to sway and rock, like a real leaf catching the air. 0 = every leaf sways from the moment it lets go.',
  'falling.dropVariety': 'How much the straight drop differs from leaf to leaf, so they do not all start swaying at the same moment. 0 = all alike; 1 = some sway at once, others drop up to twice as long.',
  'falling.dropSpeed': 'How much faster a leaf falls during its straight drop than once it sways (1 = the same speed).',
  'look.leaf3d': 'How three-dimensional the leaves look: each leaf is two halves folded along the midrib, turned and tilted in 3D and lit (the settings below). 0 = flat leaves, as before.',
  'leaves3d.fold': 'How far the two halves of a leaf slope down from the midrib, like a roof, in degrees. 0 = flat.',
  'leaves3d.cup': 'A little dome across the leaf (it only changes the shading).',
  'leaves3d.arch': 'A little arch along the leaf (it only changes the shading).',
  'leaves3d.turn': 'Most a leaf turns about its midrib, in degrees; each leaf has its own amount, either way. Turned far, one half folds over the other and the paler underside can show.',
  'leaves3d.tilt': 'Most a leaf tilts toward or away from you about its stalk, in degrees; tilted, it looks shorter.',
  'leaves3d.wind': 'How much the turning and tilting move with the wind (0 = each leaf holds its pose).',
  'leaves3d.shiver': 'On vibrato, leaves also tremble in 3D: they turn and tilt back and forth at your vibrato\'s rate, so the light flickers over them. This many times the shiver angle (Reaction → Held notes & vibrato). 0 = they only shiver flat.',
  'leaves3d.lightAngle': 'Where the light comes from on screen, in degrees: 0 = right, 90 = above, 135 = upper left, 180 = left.',
  'leaves3d.lightHeight': 'How high the light is above the picture, in degrees: low = long, strong shading; 90 = straight from the front.',
  'leaves3d.shade': 'How dark the side of a leaf turned away from the light gets.',
  'leaves3d.shine': 'The glint where the light hits a leaf head-on.',
  'leaves3d.underside': 'How pale and dull the underside looks when a leaf is turned over.',
  'look.leafSheen': 'A faint light vein and edge on every leaf. Made for very dark leaves, which otherwise lose their form.',
  'look.sheenColour': 'Colour of the leaf vein and edge.',
  'motion.leafShake': 'With "leaves fall" (Look): how much trembling, i.e. vibrato, shakes the leaves loose. 0 = only the slow trickle.',
  // Twist (docs/fable-consult-7-twist.md)
  'plants.twist': 'Branches wind from side to side like a corkscrew instead of running straight. The tree keeps its size, outline and limbs. Strong twist looks best with a smaller segment length (Many takes, advanced).',
  'plants.gnarl': 'Makes the twist irregular: uneven turns and sharp elbows, like old wood.',
  'plants.curl': 'Limb ends and some twigs finish in a small spiral.',
  'plants.strands': 'Main limbs are drawn as 2 or 3 strands wound round each other, like rope. Thin twigs stay single.',
  'plants.twistLength': 'Length of one full turn on a main limb. Short turns need a small segment length (Many takes, advanced).',
  'plants.twistTighten': 'Turns get shorter along the branch.',
  'plants.twistTwigs': 'How much the side shoots twist compared with the limbs (0 = straight twigs).',
  'plants.knots': 'Branches thicken at the turns and where a fork leaves.',
  'plants.twistDepth': 'The near side of each turn (and the front strand of a rope) is brighter than the far side.',
  'plants.strandLay': 'One strand turn per this many branch widths (lower = a tighter rope).',
  'plants.twistVoice': 'A phrase sung with vibrato or effort grows a more twisted tree; a soft one a straighter tree.\nReads: when a tree is created, twist × (1 + this × (0.6 × vibrato + 0.5 × (effort − 0.5))). Needs “shaped by the phrase”.',
  'motion.writhe': 'Branches slowly squirm from side to side.',
  'motion.writheVoice': 'What makes them squirm harder: vibrato, effort, loudness, or always the same.',
  'halo.braid': 'The ring becomes two strands braided round each other.',
  'halo.twist': 'The vine winds in and out across the ring (shows on new growth).',
  'glow.shadow': 'A soft dark edge round everything, so light colours and glow stay readable on a bright background. It is part of what OBS gets.',
  'glow.shadowColour': 'Colour of that outline (a light one gives dark branches a pale edge over dark scenes).',
  'glow.tintFlat': 'Glow no longer follows how bright a branch is: dark branches get the full glow colour (needs a glow colour amount above 0).',
  // Tree shape
  'growth.reach': 'How big the canopy of trees behind you is (its width; the height follows flatten).',
  'growth.flatten': '0 = a round canopy, 1 = wide and flat (about 40 % as tall as it is wide).',
  'growth.branching': 'Few bold limbs (0) up to a dense, ivy-like tangle of shoots (1).',
  'plants.originLimbs': 'How many limbs leave the origin point behind your neck (or the top of the trunk): the tree divides into this many there. 0 = automatic, by the size of the tree’s share of the canopy (usually 2 to 7). More = a fuller fan right from the start.',
  'plants.trunk': 'A trunk from behind your body up into the point every limb fans out from (its length). One for the whole scene, shared by every take. 0 = no trunk: every limb leaves from one point behind your neck.',
  'plants.trunkLean': 'Tilt of the trunk, in degrees: + = its top to the right.',
  'growth.fallDirection': 'Where branches, leaves and petals that let go end up. Down: they fall with gravity, turning so their loose end hangs down. Away: no gravity; they drift straight out, away from the point the tree grows from.',
  'growth.lowBranches': 'Where the limbs start to fork and sprout. 0 = they run out bare from behind your head and branch toward their ends (top-heavy); 1 = right where they leave your head, so the tree fills in close to you.',
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
  'look.themeFrom': 'Used: a Sprout Tap set to its own theme or amount keeps it (taps on Auto follow this look). Ignored: this look\'s theme and amount for every track, whatever the Tap windows say.',
  'look.theme': 'Leaves, thorns, Christmas wreath, briar (leaves and thorns), bare branches, or one of your own themes. Used by every track whose Sprout Tap Theme is on Auto, by the fake singer, and by every track when "per-track settings" is Ignored.',
  'look.density': 'How close together the leaves (or thorns) sit. They always keep a little space, so they never pile up.',
  'look.decoSize': 'Size of leaves, thorns, needles and blossoms.',
  'look.tint': 'A colour the whole look leans toward: branches, leaves and the halo. Part of the look preset, so a look can have its own colouring over your palette.',
  'look.tintAmount': 'How far everything leans toward the tint colour (0 = your palette as it is, 1 = all tint).',
  // Glow (plain wording)
  'glow.wide': 'The wide, soft haze around everything.',
  'glow.inkMask': 'Keeps the glow around the branches and leaves rather than on top of them, so they stay crisp.',
  'glow.front': 'Extra glow on the tips that are growing right now.',
  // Take commit (plain wording)
  'layout.spinSpeed': 'Carousel: the trees slowly circle round you (degrees per second; 0 = off).',
  // Connection / test (plain wording)
  'source.mode': 'Auto: live taps whenever Sprout.exe is running, otherwise the fake singer. Live: live taps only. Fake singer: always the built-in test singer.',
  'scene.layers': 'Fake singer: how many layers to fake (1 live halo plus this minus 1 takes).',
  // Colours
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
  'commit.enabled': 'When a take finishes recording, its halo curls up, moves to where the new tree starts and unrolls into it, fully grown. Off: the halo simply fades and the tree grows in.',
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
  'scene.backdrop': 'Preview background only (OBS always gets transparency): a dark or light checkerboard, both side by side, black, white, or transparent. The light ones show how the look reads over a bright scene or a pale avatar.',
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
  'fake.noteMax': 'Fake singer: longest ordinary note it holds (seconds).',
  'growth.shed': 'On: when a twig goes (ungrows, fades or falls) or a blossom closes after a held note, its leaves and petals let go and fall. Off: leaves go the way of their twig. They shrink back with a twig that ungrows, fade with one that fades, and fall only with one that falls.',
  'fake.voices': 'Fake singer: how the voices (the live track and the takes) relate. Independent: each has its own phrases, pauses and notes, like takes of different parts. Duet: they trade phrases, one alone, then another, and some together. Together: every voice sings every phrase at a fixed interval (stacked takes of one part).',
  'fake.harmony': 'Fake singer: how often a second voice joins the first in harmony (a third, fourth, fifth or sixth apart) rather than clashing with it. 0 = never in harmony, 1 = always.',
  'fake.together': 'Fake singer, duet: share of the phrases that all voices sing together (in harmony); the others are sung by one voice alone, in turn.',
  'growth.fillSpace': 'Empty space gets filled. With “new branch each phrase”, a new branch also reaches into the empty space beside it, up to the nearest living branch. And a take that has been away for a while (silent, nothing of its tree left) leaves its space to the new trees of the takes that are here; it gets it back as soon as it sings. Only where trees are replaced as the song goes on (a new tree each phrase, or a new branch each phrase), so a tree that stays for good never keeps a neighbour’s space. 0 = everyone keeps their own space.',
  'growth.branchOrder': 'Where each new branch grows on the take\'s tree. Spread out: the middle first, then far jumps. Random: any place no living branch holds. Top to bottom / bottom to top: one place after the next, then round again (the oldest branch has gone from there by then).',
  'growth.branchSymmetry': 'Each new branch is a mirrored pair at the same height on both sides of straight up (over the top it is one branch), so a tree over the head is never lopsided. A tree off to one side grows one branch at that height.',
  'growth.branchEachPhrase': "Each phrase grows one new branch on the take's tree; when there are more than \u201cbranches kept\u201d, the oldest dries, droops, drops its leaves and falls. Replaces \u201cnew tree each phrase\u201d while on.",
  'transitions.lookChangeSeconds': 'When you switch the Look preset, the new look sweeps round the live halo as a wave, from its start point both ways, in this many seconds: every shoot and leaf takes it in its turn, vine the new look does not keep fades as it passes.',
  'commit.limbs': 'The halo breaks into this many pieces, and each unrolls along one main limb of the new tree. 1 = a single frond.',
  'commit.duration': 'How slowly the planting goes. 1 = about a second to curl up, a second to move to the tree and one and a half to unroll; 2 = twice as long.',
  'look.buds': 'Closed blossoms show as small buds of this size (relative to the open flower); 0 = nothing until it opens.',
  'look.dryColour': 'Falling leaves and old, drying branches turn toward this colour.',
  'palette.from': "Where take colours come from: your own (My take colours, kept across presets) or this look's list.",
  'palette.list': "This look's take colours: each stop is one colour (with \u201cspread\u201d, the whole gradient).",
  'palette.pick': 'In order: the first colour no take uses. Random: a free colour picked by the take (the same take keeps it). Spread: well-spaced points along the gradient.',
  'palette.seed': 'Another number gives another random pick.',
  'colours.lock': "Always use my take colours, even with a look that brings its own.",
  'fake.autoCommit': 'Fake singer: plant the live take every n seconds (0 = never), to watch the planting animation hands-free.',
  'fake.longNotes': 'Fake singer: share of notes held 1.8 to 3.5 s, long enough to open blossoms (see “blossom after”).',
  'fake.fullStopEvery': 'Fake singer: every n-th phrase (of each voice) ends with a long pause, so what happens at a phrase end and at a full stop shows. 0 = never. The End phrase button (E) makes one now.',
  'fake.fullStopSeconds': 'Fake singer: how long a full stop pauses (seconds).',
  'plants.step': 'Length of each branch segment. Smaller = smoother curves, more work per frame.',
  'plants.maxNodes': 'Upper limit of branch points per tree, which caps the cost of very dense trees.',
};

/** Sound-driven settings: what each does and exactly how it reads the voice (wins over TIPS). */
Object.assign(TIPS, {
  'growth.secondsToFull': 'Seconds of full voice to grow a whole tree (higher = slower).\nReads: singing = loudness above 0.05; silence longer than “pause that ends a phrase” ends the phrase. While singing, a tree grows by (0.4 + loudness) ÷ this per second, so quiet singing grows at 40 % speed. loudness: Sprout.exe measures the last 10 ms in dB, −55 dB = 0 up to −10 dB = 1 (rises in 25 ms, falls in 0.3 s).',
  'growth.newTreeEachPhrase': 'Every phrase grows a brand-new tree; the previous one stays until its own fade. Off: one tree keeps growing.\nReads: a new phrase = singing again after a pause longer than “pause that ends a phrase”. singing = loudness above 0.05; silence longer than “pause that ends a phrase” ends the phrase.',
  'growth.restBrightness': 'Brightness of a tree between phrases (it rests there unless “phrase end: tree” or a full stop takes it away).\nReads: a phrase is over after “pause that ends a phrase” of silence; the tree then dims to this over the settle time. singing = loudness above 0.05; silence longer than “pause that ends a phrase” ends the phrase.',
  'growth.witherEffect': 'How branches go when a silence acts on them, and when a tree is replaced (a new phrase, or a look change). Ungrow: they grow back into the tree from the tips. Fade: they fade out. Fall away: pieces break off and fall (see “falling pieces go”).',
  'growth.witherFromTips': 'Fade or fall away from the tips inward (on), or all at once (off). Ungrowing always starts at the tips.',
  'growth.onPause': 'A short pause (a breath) acts on the outer twigs, as far in as “short pause reaches in”; they grow back when you sing again. Off: pauses leave the tree as it is.',
  'growth.onPhraseEnd': 'Once its phrase is over (and “tree stays after singing” has passed), the whole tree goes by the withering effect, trunk and all. A tree that was not replaced comes back when its take sings again. Off: it stays, resting, until a new phrase replaces it.',
  'growth.onStop': 'At a full stop (a silence as long as “silence that is a full stop”) every tree goes by the withering effect, and the next phrase starts a new one. Off: a full stop is like any phrase end.',
  'growth.dieAfter': 'A silence this long is a full stop: “full stop: tree” acts on the whole tree, and your next phrase grows a new one. 0 = never.\nReads: seconds since you last sang on that take; a planted take waits for its first phrase.',
  'growth.fadeAfter': 'A tree stays whole this long after its take stopped singing; then “phrase end: tree” acts on it. Higher = the old tree stands next to the new one for longer, so the trees overlap into a fuller canopy. 0 = as soon as the phrase is over, so a pause runs straight on into the ending.\nReads: the clock starts when you stop singing on that take (singing = loudness above 0.05); it is never shorter than “pause that ends a phrase”.',
  'growth.fadeSeconds': 'Seconds an ending takes (the phrase end\'s and the full stop\'s): ungrowing to the root, fading out, or the last piece breaking off.\nReads: timing only.',
  'growth.witherDepth': 'How far in from the tips a short pause reaches (the trunk and the first part of the limbs are never touched by it).',
  'growth.witherSeconds': 'Pause length that reaches the full depth.\nReads: seconds of silence after the first 0.12 s; see “short pause: twigs”.',
  'harmony.colour': 'While two tracks sing in harmony, the colours of both move toward a shared colour, gradually, and back when the harmony ends. 0 = off.\nReads: mix = this × harmony (leaves and blossoms half as far). harmony: both tracks sing, a third, fourth, fifth or sixth apart in any octave (within half a semitone), for at least “counts after”; it comes in over “comes in over” and leaves in about twice that.',
  'harmony.colourMode': 'The shared colour. Waves: bands of the other voice\'s colour run out along the branches from the root, and round the halo, a sine wave between the two colours (see waves start, wave length, wave speed). Gradient: each voice\'s branches run from its own colour at the root to the other voice\'s at the tips (the halo: once round the ring). Mix: both turn into the mix of the two colours. Colour: both turn into the harmony colour below.',
  'harmony.colourMix': 'How the two colours blend between each other. Even (OKLab): a smooth, perceptual blend, no grey or dark band half way. Straight (RGB): a plain blend (complementary colours go greyish half way). As light: as coloured lights add up, brighter half way. Round the colour wheel: through the hues between, at full strength (red to blue passes magenta). Painter\'s wheel: as paints mix, yellow and blue make green, red and blue violet, a little muddier half way. Hard cut: one colour or the other, nothing between (sharp bands).',
  'harmony.waveLead': 'How the waves start. Higher (or lower) voice leads: its colour runs into the other voice first; half a wave later the bands reach it too, and from then on both carry the same bands in step (one wave across both). Each takes the other colour: both start at once, each taking the other\'s colour, so they show opposite colours.\nThe voice that leads is decided when the harmony starts.',
  'harmony.waveFrom': 'Where the waves round the halo start. Side facing the other voice: the point of the ring toward the tree it is in harmony with, so the bands run on from that tree (its waves start at its root) round both ways. The halo\'s growing points: where its vine grows from (halo origins and start angle).',
  'harmony.waveLength': 'From one band of a colour to the next, in world units (the open halo\'s radius is 1.05). The same on the trees and the halo, so their bands match.',
  'harmony.waveSpeed': 'How fast the bands run out along the branches and round the halo (world units per second).\nOne band passes every wave length ÷ wave speed seconds.',
  'harmony.colourValue': 'The colour both voices turn into (with shared colour set to Colour).',
  'harmony.cross': 'While in harmony the branches turn wavy, neighbours the opposite way, so they cross each other. They do not move: every branch keeps its course and the tree its outline. The halo ring braids. 0 = off.\nReads: wave = this × harmony.',
  'harmony.blossoms': 'Blossoms (and theme parts that open on long held notes) also open while in harmony. 0 = only on held notes.\nReads: open = the larger of the held-note bloom and this × harmony.',
  'harmony.glow': 'Extra glow while in harmony.\nReads: glow += this × harmony.',
  'harmony.minSeconds': 'Two voices have to stay in harmony this long before it counts, so notes that only pass each other do not trigger it.',
  'harmony.attack': 'Seconds the harmony effects take to come in; they leave in about twice that.',
  'harmony.unison': 'Off: only different notes count (thirds, fourths, fifths, sixths). On: the same note and octaves count too, so doubled takes of one part trigger the effects.',
  'growth.witherOnPitchDip': 'A drop in pitch also makes the outer twigs grow back for a moment.\nReads: the pitch is compared with its recent peak (the peak falls back with a 0.35 s time constant); a drop of at least “pitch dip (semitones)” adds 0.6 wither at once. pitch: the sung note (detected over 43 ms); C3 = 0 up to F6 = 1, the last note is held through pauses (smoothed ~0.1 s).',
  'growth.witherDipSemitones': 'How far the pitch has to drop to count as a dip.\nReads: semitones below the recent peak of the sung pitch (see “wither on pitch dips”).',
  'response.phraseGap': 'Silence this long ends a phrase. Shorter pauses only act on the outer twigs.\nReads: singing = loudness above 0.05; silence longer than “pause that ends a phrase” ends the phrase.',
  'response.release': 'After a phrase ends: seconds for the halo to close and the trees to dim to their rest brightness.\nReads: the phrase ends after “pause that ends a phrase” of silence; this is the time constant from there.',
  'response.pitchSteer': 'High notes grow the upper side of a tree first, low notes the lower side.\nReads: the held pitch shifts the reveal order by up to ±0.35 × this toward the top or bottom. pitch: the sung note (detected over 43 ms); C3 = 0 up to F6 = 1, the last note is held through pauses (smoothed ~0.1 s).',
  'response.effortWidth': 'Branches get thicker with vocal effort and thinner when you sing softly.\nReads: width = 1 + this × (effort − 0.5) × 1.6 (never below 25 %). effort: energy in the overtones (2nd harmonic up to 5 kHz) against the fundamental, plus loudness, both compared with your own running average, so 0.5 = how you usually sing and mic gain does not matter (smoothed ~0.2 s).',
  'response.brightness': 'Brightness follows how loud you sing (0 = constant).\nReads: brightness = 0.45 + 0.75 × energy (×1.3, capped) + 0.12 × note-start flash, mixed in by this amount; below 1 it shows as see-through, not dark. energy: the loudness Sprout.exe measures (last 10 ms, −55 dB = 0 up to −10 dB = 1), smoothed again (rises in about 30 ms, falls in about 0.2 s); note start: the last 10 ms is 3× louder than the last 0.3 s on average (and above −49 dB), at most every 0.12 s.',
  'glow.levelGain': 'Extra glow with loudness.\nReads: glow += this × energy. energy: the loudness Sprout.exe measures (last 10 ms, −55 dB = 0 up to −10 dB = 1), smoothed again (rises in about 30 ms, falls in about 0.2 s).',
  'glow.onsetGain': 'A flash of glow on every note start.\nReads: glow += this × flash; the flash swells in on a note start (reaching about 1 after about 80 ms) and fades with a 0.25 s time constant. note start: the last 10 ms is 3× louder than the last 0.3 s on average (and above −49 dB), at most every 0.12 s.',
  'glow.pitchShine': 'High, loud notes shine brighter.\nReads: glow += this × pitch × energy. pitch: the sung note (detected over 43 ms); C3 = 0 up to F6 = 1, the last note is held through pauses (smoothed ~0.1 s); energy: the loudness Sprout.exe measures (last 10 ms, −55 dB = 0 up to −10 dB = 1), smoothed again (rises in about 30 ms, falls in about 0.2 s).',
  'glow.softGlow': 'Soft singing glows more diffusely.\nReads: glow += this × softness × energy. softness = 0.7 × (1 − effort) + 0.3 × airiness (soft, airy singing = high); effort: energy in the overtones (2nd harmonic up to 5 kHz) against the fundamental, plus loudness, both compared with your own running average, so 0.5 = how you usually sing and mic gain does not matter (smoothed ~0.2 s); airiness: how breathy the singing is (air noise between the harmonics, a less clear pitch), only while a note is sung; clean singing ≈ 0, clearly breathy singing ≈ 0.6–0.7; inhales, whispers and consonants do not count.',
  'glow.front': 'Extra glow on the branches that are growing right now.\nReads: only while a segment is still growing (the growth itself follows grow time and loudness).',
  'motion.swayDeg': 'How far the tips lean in a full-voice gust (degrees).\nReads: wind strength = this × (wind-when-silent + (1 − that) × slow loudness × 1.5, capped at 1); a note getting louder than the slow loudness slowly lifts the limbs, a fading one lets them sag (eased over about a quarter second, so a note start never jerks them). slow loudness: loudness averaged over about 1 s.',
  'motion.idle': 'Share of the wind that stays when nobody sings (0 = stands still).\nReads: mixed with the slow loudness (see sway). slow loudness: loudness averaged over about 1 s.',
  'motion.kickDeg': 'A push on every note start, in degrees at the tips; it then swings back. 0 = off: note starts only flash and never move the plants.\nReads: each push = this × (0.35 + 0.65 × effort) × (0.5 + 0.5 × loudness × 1.5, capped). note start: the last 10 ms is 3× louder than the last 0.3 s on average (and above −49 dB), at most every 0.12 s.',
  'motion.springiness': 'How long branches keep swinging after the wind or a push moved them: 0 settles at once, 1 swings back and forth for a while.\nReads: soft singing adds damping: × (1 + 0.8 × softness), so breathy singing rings less. softness = 0.7 × (1 − effort) + 0.3 × airiness (soft, airy singing = high).',
  'motion.flutterDeg': 'Leaf flutter about the stalk (degrees).\nReads: flutter = this × (wind-when-silent + (1 − that) × energy × 1.3 + 0.5 × airiness), capped at 1.5×. energy: the loudness Sprout.exe measures (last 10 ms, −55 dB = 0 up to −10 dB = 1), smoothed again (rises in about 30 ms, falls in about 0.2 s); airiness: how breathy the singing is (air noise between the harmonics, a less clear pitch), only while a note is sung; clean singing ≈ 0, clearly breathy singing ≈ 0.6–0.7; inhales, whispers and consonants do not count.',
  'motion.shiver': 'Twigs and leaves shimmer at the rate of your vibrato.\nReads: vibrato depth: from the last ~0.6 s of one held note; needs a 3.5–9 Hz wobble of at least ±0.08 semitone; ±0.08 = 0 up to ±0.58 semitone = 1 (smoothed ~0.15 s); the shimmer follows the measured vibrato rate.',
  'motion.shiverDeg': 'How far twigs and leaves shimmer at full vibrato (degrees).\nReads: shimmer = this × min(1.5, vibrato depth × tremble sensitivity). vibrato depth: from the last ~0.6 s of one held note; needs a 3.5–9 Hz wobble of at least ±0.08 semitone; ±0.08 = 0 up to ±0.58 semitone = 1 (smoothed ~0.15 s).',
  'motion.shiverSensitivity': 'How strongly the measured vibrato depth moves things. It does not change when vibrato is detected (that is Setup: voice detection, by default ~0.45 s of one note, 3.5–9 Hz, at least ±0.08 semitone); it multiplies the depth: at 2, a ±0.33 semitone vibrato already gives full shimmer; the result is capped at 1.5× “shiver”.\nReads: vibrato depth: from the last ~0.6 s of one held note; needs a 3.5–9 Hz wobble of at least ±0.08 semitone; ±0.08 = 0 up to ±0.58 semitone = 1 (smoothed ~0.15 s).',
  'halo.idleSpeed': 'How fast the vine creeps round the ring while you are quiet (degrees per second).\nReads: always on, plus the sing speed (see below).',
  'halo.singSpeed': 'Extra speed round the ring when singing (degrees per second).\nReads: speed = quiet speed + this × energy × 1.2 (capped at full). energy: the loudness Sprout.exe measures (last 10 ms, −55 dB = 0 up to −10 dB = 1), smoothed again (rises in about 30 ms, falls in about 0.2 s).',
  'halo.sproutRate': 'Side shoots per second at full voice; every note start adds one.\nReads: shoots per second = this × energy × 1.3 (capped), plus one per note start. energy: the loudness Sprout.exe measures (last 10 ms, −55 dB = 0 up to −10 dB = 1), smoothed again (rises in about 30 ms, falls in about 0.2 s); note start: the last 10 ms is 3× louder than the last 0.3 s on average (and above −49 dB), at most every 0.12 s.',
  'halo.sproutLength': 'Length of the halo\'s side shoots.\nReads: each shoot = this × (0.4 + effort) × a random 0.6–1.3; it also grows thicker with effort. High notes send shoots outward, low notes inward. effort: energy in the overtones (2nd harmonic up to 5 kHz) against the fundamental, plus loudness, both compared with your own running average, so 0.5 = how you usually sing and mic gain does not matter (smoothed ~0.2 s); pitch: the sung note (detected over 43 ms); C3 = 0 up to F6 = 1, the last note is held through pauses (smoothed ~0.1 s).',
  'halo.sproutCurl': 'How much the halo\'s side shoots curl.\nReads: curl = this × (0.5 + 1.5 × softness): soft singing curls tighter. softness = 0.7 × (1 − effort) + 0.3 × airiness (soft, airy singing = high).',
  'halo.openRadius': 'Size of the open halo around head and shoulders while recording.\nReads: while the DAW records and you sing, the halo opens by (0.4 + loudness) ÷ (grow time × 0.5) per second; when recording stops it closes over the settle time. loudness: Sprout.exe measures the last 10 ms in dB, −55 dB = 0 up to −10 dB = 1 (rises in 25 ms, falls in 0.3 s).',
  'look.blossoms': 'How many branch tips can carry a blossom (leaves theme, and user themes with a tips part). They open only on long held notes (see blossom after).\nReads: the held-note time, see “blossom after note held”.',
  'look.blossomHold': 'Blossoms open only on a note held longer than this, and close again after it ends (0 = whenever you sing).\nReads: how long the current note has been held: it counts while you keep singing within a semitone of where the note settled (vibrato swings less), and starts over on a pitch jump, a new note start or a pause. Blossoms open over ~0.25 s once it passes this, and close over ~0.7 s after the note.',
  'look.thornEffort': 'Thorns grow with vocal effort (thorns theme).\nReads: thorn size × (0.6 + this × effort). effort: energy in the overtones (2nd harmonic up to 5 kHz) against the fundamental, plus loudness, both compared with your own running average, so 0.5 = how you usually sing and mic gain does not matter (smoothed ~0.2 s).',
  'plants.softDroop': 'How much soft, breathy singing makes a new tree droop.\nReads: when a tree is created, its tips bend down by up to this × softness of the phrase that grows it. softness = 0.7 × (1 − effort) + 0.3 × airiness (soft, airy singing = high).',
  'plants.moodShaping': 'Each new tree takes its character from the phrase that grows it.\nReads: read once when the tree starts: effort makes it 5 % smaller to 8 % bigger and more spread, pitch lifts the tips, softness droops them, vibrato makes it wilder. effort: energy in the overtones (2nd harmonic up to 5 kHz) against the fundamental, plus loudness, both compared with your own running average, so 0.5 = how you usually sing and mic gain does not matter (smoothed ~0.2 s); pitch: the sung note (detected over 43 ms); C3 = 0 up to F6 = 1, the last note is held through pauses (smoothed ~0.1 s); softness = 0.7 × (1 − effort) + 0.3 × airiness (soft, airy singing = high); vibrato depth: from the last ~0.6 s of one held note; needs a 3.5–9 Hz wobble of at least ±0.08 semitone; ±0.08 = 0 up to ±0.58 semitone = 1 (smoothed ~0.15 s).',
});

/** Voice detection (Sprout.exe): what each threshold does to the vibrato reading. */
Object.assign(TIPS, {
  'detect.vibratoMinNote': 'How long one note has to be held before its vibrato can be measured (seconds). Shorter: vibrato shows sooner, but short wobbly notes may count. A big pitch jump starts the count again.\nReads: the pitch track of the live and take taps in Sprout.exe.',
  'detect.vibratoMinSemitones': 'The smallest swing that counts as vibrato (semitones up and down from the note). Lower: subtle vibrato is picked up; too low and an unsteady held note counts. Vibrato depth is 0 here.\nReads: the swing of the pitch around the note over the measuring window.',
  'detect.vibratoFullSemitones': 'The swing that reads as full vibrato depth (1). Lower: lighter vibrato already gives full shimmer (like raising tremble sensitivity, but in Sprout.exe for everything that uses vibrato).\nReads: the same swing; depth rises evenly from the smallest swing to this.',
  'detect.vibratoMinHz': 'Slowest wobble that counts as vibrato (per second). Slower wobbles are treated as the note sliding.\nReads: the wobble rate, from how often the pitch crosses its average.',
  'detect.vibratoMaxHz': 'Fastest wobble that counts as vibrato (per second). Faster wobbles are treated as noise or a trill.\nReads: the wobble rate.',
});

/** Labels for the restructured panel (D.4). */
Object.assign(LABELS, {
  'look.tint': 'lean everything toward', 'look.tintAmount': 'how far',
  'look.theme': 'theme', 'look.themeFrom': 'per-track settings',
  'glow.tint': 'glow colour', 'glow.tintAmount': 'glow colour amount',
  'look.blossomHold': 'blossoms after holding (s)', 'look.blossoms': 'blossom amount',
  'look.thornEffort': 'thorns grow with effort', 'glow.levelGain': 'glow', 'response.brightness': 'brightness',
  'motion.swayDeg': 'wind sway (deg)', 'halo.singSpeed': 'halo speed (deg/s)', 'halo.sproutRate': 'halo shoots per second',
  'glow.onsetGain': 'flash', 'motion.kickDeg': 'push (deg)', 'glow.front': 'growing-edge glow',
  'glow.pitchShine': 'high notes shine', 'response.effortWidth': 'effort thickens branches',
  'glow.softGlow': 'soft voice glows wider', 'plants.softDroop': 'soft voice droops new trees',
  'response.release': 'settle time after a phrase (s)',
});
for (const r of ['colBranch', 'colLeaf', 'colAccent', 'colHalo'])
  Object.assign(LABELS, {
    [`${r}.source`]: 'colour from', [`${r}.gradient`]: 'gradient', [`${r}.takeMix`]: 'take colour mixed in',
    [`${r}.along`]: 'spread root to tip', [`${r}.speed`]: 'flow speed', [`${r}.voice`]: 'voice moves it',
    [`${r}.voiceAmount`]: 'how far', [`${r}.perTake`]: 'shift per take', [`${r}.scatter`]: 'random per leaf',
  });
LABELS['colHalo.along'] = 'spread round the ring';

Object.assign(FOLDER_HINTS, {
  colours: 'What colours everything. Each part takes its colour from the take, from the theme\'s natural colours, or from a gradient that can move with time, along the branch, or with your voice. Your own take colours are kept across presets.',
  theme: 'Which decorations grow on the branches and the halo, how many and how big.',
  loud: 'Everything your loudness drives.',
  onsets: 'What happens at the start of every note.',
  timbre: 'What high notes, full singing and soft, breathy singing change.',
  held: 'What a long held note and vibrato do.',
  phrases: 'How the trees grow while you sing, and what a phrase is.',
  pauses: 'What short pauses do to the outer twigs.',
  colBranch: 'Colour of the take trees\' branches.',
  colLeaf: 'Colour of leaves, thorns and needles.',
  colAccent: 'Colour of blossoms and berries.',
  colHalo: 'Colour of the halo ring and its vine.',
  palette: 'Your own colours: the live halo and one per take. Presets never change them.',
});

/** Tooltips for the colour role settings (same in every role). */
for (const r of ['colBranch', 'colLeaf', 'colAccent', 'colHalo'])
  Object.assign(TIPS, {
    [`${r}.source`]: r === 'colHalo'
      ? 'Same as branches: the halo follows the branch colour settings. Track colour: the live colour. Gradient: its own gradient below.'
      : 'Track colour: each take\'s own colour. Theme colour: the natural colours of the theme (green leaves, pink blossoms…). Gradient: colours from the gradient below.',
    [`${r}.gradient`]: 'The colours to pick from. Click the bar to edit: add, drag and remove colour stops, presets, rainbow.',
    [`${r}.takeMix`]: 'How much of the take\'s own colour is mixed back in, so takes stay recognisable (0 = none).',
    [`${r}.along`]: r === 'colHalo' ? 'How many times the gradient runs round the ring.' : 'How much of the gradient runs from root (start) to tip (end) of each branch. Negative = the other way.',
    [`${r}.speed`]: 'How fast the colours travel along the gradient (gradient lengths per second; 0 = still).',
    [`${r}.voice`]: 'What in your voice moves the colour along the gradient.',
    [`${r}.voiceAmount`]: 'How far along the gradient the voice moves the colour at its strongest (negative = the other way).\nReads: the chosen value, 0..1: pitch (C3 to F6), loudness, effort, airiness, vibrato depth, or the note-start flash.',
    [`${r}.perTake`]: 'Each further take starts this far along the gradient, so takes get different colours from one gradient.',
    [`${r}.scatter`]: 'Each leaf picks a colour this far around its place on the gradient (sparkle).',
  });
Object.assign(TIPS, {
  'glow.tint': 'A colour the glow leans toward; the branches and leaves keep their own colours.',
  'glow.tintAmount': 'How far the glow leans toward the glow colour.',
});
