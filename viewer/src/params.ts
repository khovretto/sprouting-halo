// Every tweakable value lives here. Anything added to `defaults` shows up in the panel
// automatically, is saved with presets, and syncs to other open viewers through Sprout.exe.
// Slider ranges are in ui.ts (RANGES); each range is chosen so the whole slider visibly matters.

export const defaults = {
  source: {
    /** auto: live taps when Sprout.exe is reachable, otherwise the fake singer. */
    mode: 'auto' as 'auto' | 'live' | 'fake',
    /** Sprout.exe web port (used when this page comes from the dev server). */
    port: 7777,
    /** Keep a take that disappeared this long before it is pruned (s). */
    holdSeconds: 1.5,
    useTrackColours: false,
    /** Mirror panel settings to every other open viewer (OBS, other tabs) via Sprout.exe. */
    syncSettings: true,
  },
  scene: {
    /** Layer count for the fake singer (live mode counts the connected taps). */
    layers: 3,
    timeScale: 1,
    paused: false,
    viewRadius: 1.9,
    centerX: 0,
    centerY: 0.1,
    backdrop: 'checker' as 'checker' | 'black' | 'none',
    showAvatar: true,
    showGuides: false,
  },
  /** High-level growth controls. Start here; the "plants" section holds the fine detail. */
  growth: {
    /** Every phrase grows a brand-new tree (new seed); the previous one fades away. Off = one tree keeps growing. */
    newTreeEachPhrase: true,
    /** Seconds of full voice to grow a whole tree (higher = slower). */
    secondsToFull: 3.5,
    /** 0 = a spine with a few bare limbs; 1 = dense, ivy-like: many limbs with shoots on shoots. */
    branching: 0.65,
    /** Overall length: multiplies each plant's spine (and with it every feather). */
    reach: 1.0,
    /** Fan aperture: how far the feathers open from the spine. */
    spread: 1.25,
    /** 0 = every plant a symmetric tree; 1 = side plants are one-sided wings (feathers on the upper side). */
    sweep: 0.75,
    /** Brightness of a tree between phrases (it never ungrows). */
    restBrightness: 0.55,
    /** A tree starts fading this many seconds after it stopped growing (its phrase ended). */
    fadeAfter: 3,
    /** Seconds the fade itself takes. */
    fadeSeconds: 2.5,
    /** In a pause, the outer twigs and leaves fade (leaves first) and regrow when singing resumes. */
    witherOnPause: true,
    /** A drop in pitch (a dip of witherDipSemitones or more) also withers the outer twigs. */
    witherOnPitchDip: false,
    witherDipSemitones: 3,
    /** How far in from the tips withering can reach (plant units; the trunk never withers). */
    witherDepth: 0.45,
    /** Pause length that withers to the full depth (s). */
    witherSeconds: 0.8,
    /** Fade time of withering leaves / twigs (s). Leaves go first. */
    leafFadeSeconds: 0.3,
    twigFadeSeconds: 0.7,
    /** How fast branches (re)grow along their length (plant units per second). */
    regrowSpeed: 1.2,
  },
  /** How sound drives brightness, order and thickness. */
  response: {
    /** Silence this long ends a phrase (s). Shorter pauses only wither the outer twigs. */
    phraseGap: 1.0,
    /** After a phrase ends: seconds for the halo to close and the glow to settle. */
    release: 1.4,
    /** Branches light up in a random order instead of strictly from the root out. */
    variety: 0.5,
    /** High notes grow the upper/outer side first. */
    pitchSteer: 0.5,
    /** Branch thickness follows vocal effort (soft = thin, full = thick). */
    effortWidth: 0.8,
    /** Brightness follows loudness (0 = constant). */
    brightness: 0.7,
  },
  look: {
    /** Fallback theme. Each track sets its own theme and amount in the Sprout Tap window; this
     *  is used only for the fake singer and taps set to "Viewer default". */
    theme: 'leaves' as 'branches' | 'leaves' | 'thorns' | 'wreath',
    /** Fallback decoration amount (per track in the Sprout Tap window). */
    density: 0.55,
    /** Decoration size multiplier. */
    decoSize: 1.8,
    /** How much decorations glow, relative to the branches (dense themes blow out above ~0.6). */
    decoGlow: 0.3,
    /** 0 = decorations in the take colour, 1 = natural colours (green, red berries…). */
    naturalTint: 0.35,
    /** Blossoms open on full / high singing (leaves theme). */
    blossoms: 0.7,
    /** Thorns grow with vocal effort (thorns theme). */
    thornEffort: 1,
  },
  colours: {
    mode: 'take' as 'take' | 'rainbow',
    rainbowSpeed: 0.05,
    live: '#2fb84f',
    take1: '#b5e61d',
    take2: '#3d4fd6',
    take3: '#00dd88',
    take4: '#ff7ac8',
    take5: '#ffb347',
    take6: '#a77bff',
    take7: '#4fd1ff',
  },
  halo: {
    /** Number of points the live vine grows from, spread evenly round the ring (1 = one point). */
    origins: 1,
    /** Where the first origin sits, in degrees (-90 = bottom, behind the neck; 90 = top). */
    startAngle: -90,
    /** Each origin grows both ways round the ring (off = one way). */
    bothWays: true,
    /** Growth speed round the ring while quiet / added at full voice (degrees per second). */
    idleSpeed: 8,
    singSpeed: 70,
    /** How much vine trails behind each growing tip (degrees); the oldest part fades away. */
    tailDeg: 300,
    /** Share of the tail that is fading out. */
    tailFade: 0.45,
    /** Side shoots per second at full voice (note starts add more). */
    sproutRate: 3,
    /** Shoot length; full / loud singing grows longer shoots. */
    sproutLength: 11,
    /** Shoot curl; soft singing curls tighter. */
    sproutCurl: 0.8,
    /** Seconds for a side shoot to grow out. */
    sproutGrow: 0.6,
    /** Share of the ring's leaves (thorns, needles) that are always there, spread evenly. */
    alwaysLeaves: 0.4,
    /** Resting halo: small, on top of the head, when nothing is being recorded. */
    restRadius: 0.3,
    restY: 0.78,
    /** Open halo while recording: around the head and shoulders. It opens with the first phrase
     *  of a recording and stays open until the recording stops. */
    openRadius: 1.05,
    openY: 0.1,
    ringWidth: 0.009,
    vineWidth: 0.007,
    sproutWidth: 0.005,
    /** Vine wander away from the ring (fraction of the radius). */
    wander: 0.08,
    spawnSeconds: 0.9,
    /** Several live tracks: each gets its own halo, nested inside the first, this much smaller. */
    ringSpacing: 0.14,
  },
  plants: {
    /** gesture: spine + feathers + twigs (the redesign). colonise: the old space-colonisation trees. */
    generator: 'gesture' as 'gesture' | 'colonise',
    /** Tips curve toward the sky (positive) or droop (negative). */
    lift: 0.25,
    /** Length jitter, wander and the longer "hero" feather. */
    wildness: 0.5,
    /** Feathers cross over one another: more on both sides of the spine, more varied angles. */
    overlap: 0.5,
    /** 0 = pointed outline (longest limbs near the base), 1 = broad: limbs as long at the tip. */
    planform: 0.8,
    /** 0 = stems keep their width to a blunt end, 1 = fine pointed tips. */
    taper: 0.35,
    /** Which side of a side plant carries the feathers: 1 = the upper side, -1 = the lower side. */
    featherSide: 1,
    /** How much soft / breathy singing makes a new tree droop. */
    softDroop: 1,
    /** Each new tree takes its character from the phrase that grows it (effort, pitch, softness, vibrato). */
    moodShaping: true,
    attractors: 220,
    step: 0.03,
    influence: 0.32,
    kill: 0.09,
    jitter: 0.08,
    /** Smoothing passes over the branch shapes (more = rounder, less lightning-like). */
    smoothing: 4,
    tipWidth: 0.008,
    maxWidth: 0.035,
    pipeExponent: 2.4,
    maxNodes: 2600,
  },
  envelope: {
    crownMin: 0.75,
    crownLength: 1.9,
    crownHalfAngle: 70,
    crownTaper: 0.15,
    wingMin: 0.45,
    wingLength: 1.7,
    wingHalfAngle: 50,
    wingBend: 22,
    wingTaper: 0.6,
    wedgeMin: 0.45,
    wedgeLength: 1.5,
    wedgeFill: 0.8,
    wedgeBend: 14,
    wedgeTaper: 0.4,
    shrinkPerTake: 0.02,
  },
  layout: {
    lowOriginY: -0.35,
    midOriginY: 0.05,
    wingTilt: 20,
    /** 3+ takes: leave this many degrees free straight down (behind the body); 0 = spread all round.
     *  Only used while spin is off. */
    downGap: 100,
    tierFrom: 7,
    innerScale: 0.8,
    spinFrom: 3,
    /** Degrees per second. */
    spinSpeed: 0,
    ease: 2.5,
  },
  transitions: {
    /** A live track stopped being live (recording done): its halo fades out (s). */
    liveEndSeconds: 0.8,
    /** A take was deleted: the plant retracts and its leaves fall (s). */
    pruneSeconds: 1.6,
  },
  avatar: {
    avoid: true,
    /** Placeholder silhouette opacity (preview only). */
    opacity: 0.3,
    headX: 0,
    headY: 0.2,
    headR: 0.42,
    bodyTopY: -0.1,
    bodyBottomY: -2.5,
    bodyR: 0.55,
  },
  motion: {
    /** Shiver on vibrato. */
    tremble: true,
    /** Tip bend in degrees at rest and per unit of slow loudness. */
    swayDeg: 5,
    swayFromLevel: 1.5,
    swayHz: 0.3,
    /** Tip shiver in degrees at full vibrato. */
    trembleDeg: 2.5,
  },
  glow: {
    strength: 1.6,
    radius: 1.8,
    /** Weight of the widest bloom level (the heavy haze). */
    wide: 1.0,
    base: 0.3,
    levelGain: 0.8,
    onsetGain: 0.7,
    pitchShine: 0.4,
    /** Extra glow on the growing edge of the construct. */
    front: 0.8,
    /** Soft singing glows more diffusely (0 = ignore softness). */
    softGlow: 0.4,
  },
  fake: {
    seed: 7,
    phraseMin: 2,
    phraseMax: 6,
    gapMin: 0.4,
    gapMax: 1.6,
    highNotes: 0.25,
    /** Pretend the DAW is recording (the halo opens with the first phrase and stays open). */
    recording: true,
    /** Live tracks for the fake singer (more than 1 = concentric halos). */
    liveTracks: 1,
  },
};

export type Params = typeof defaults;
