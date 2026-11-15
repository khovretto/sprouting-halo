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
    /** Rolling graphs of the voice and how the visuals read it (G toggles). */
    showScope: false,
    /** Which layer the scope follows: 0 = the live halo, 1.. = takes. */
    scopeLayer: 0,
    /** Seconds of history shown. */
    scopeSeconds: 12,
  },
  /** High-level growth controls. Start here; the "plants" section holds the fine detail. */
  growth: {
    /** Every phrase grows a brand-new tree (new seed); the previous one fades away. Off = one tree keeps growing. */
    newTreeEachPhrase: true,
    /** Seconds of full voice to grow a whole tree (higher = slower). */
    secondsToFull: 3.5,
    /** 0 = a few limbs; 1 = dense, ivy-like: tips closer together, more and deeper side shoots. */
    branching: 0.6,
    /** Canopy size: half-width of the shared outline = 2.15 × reach. */
    reach: 1.0,
    /** 0 = round canopy, 1 = flat: height 40 % of the half-width. */
    flatten: 0.55,
    /** 0.4 = straight rays from the hub, 2 = limbs arch strongly out from each plant's middle. */
    spread: 1.0,
    /** Brightness of a tree between phrases (it never ungrows). */
    restBrightness: 0.55,
    /** A tree starts fading this many seconds after it stopped growing (its phrase ended). */
    fadeAfter: 3,
    /** Seconds the fade itself takes. */
    fadeSeconds: 2.5,
    /** In a pause, the outer twigs grow back toward their stubs (leaves and all) and regrow when singing resumes. */
    witherOnPause: true,
    /** A drop in pitch (a dip of witherDipSemitones or more) also withers the outer twigs. */
    witherOnPitchDip: false,
    witherDipSemitones: 3,
    /** How far in from the tips withering can reach (plant units; the trunk never withers). */
    witherDepth: 0.45,
    /** Pause length that withers to the full depth (s). */
    witherSeconds: 0.8,
    /** Seconds for withered twigs to grow back to their stubs (they regrow when singing resumes). */
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
    /** Branches light up in a slightly varied order instead of strictly from the root out. */
    variety: 0.5,
    /** High notes grow the upper/outer side first. */
    pitchSteer: 0.5,
    /** Branch thickness follows vocal effort (soft = thin, full = thick). */
    effortWidth: 0.8,
    /** Brightness follows loudness (0 = constant). */
    brightness: 0.7,
  },
  look: {
    /** Where each track's theme and amount come from: its Sprout Tap window, or theme and density
     *  below for every track. (Picking a preset already sets every Sprout Tap window to its theme.) */
    themeFrom: 'tracks' as 'tracks' | 'preset',
    /** Fallback theme. Each track sets its own theme and amount in the Sprout Tap window; this
     *  is used only for the fake singer and taps set to "Viewer default". */
    theme: 'leaves' as 'branches' | 'leaves' | 'thorns' | 'wreath',
    /** Fallback decoration amount (per track in the Sprout Tap window): leaf *spacing* on take
     *  plants (low = sparse, high = close), so leaves never pile up. */
    density: 0.55,
    /** Brightness and tint differences between limbs and between leaves. */
    variety: 0.6,
    /** How much dimmer the inside of a plant is than its rim. */
    depthShade: 0.6,
    /** A colour every branch, leaf and the halo lean toward (a look's own colouring, over your palette). */
    tint: '#ffffff',
    /** How far toward the tint colour (0 = your palette as is). */
    tintAmount: 0,
    /** Decoration size multiplier. */
    decoSize: 1.8,
    /** How much decorations glow, relative to the branches (dense themes blow out above ~0.6). */
    decoGlow: 0.2,
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
    /** Move the resting halo sideways (with tilt it can hang to one side). The recording halo opens centred. */
    restX: 0,
    /** Flatten the resting halo vertically, like a ring seen from slightly above (0 = flat-on
     *  circle). The recording halo opens round. */
    squish: 0,
    /** Tilt of the squished resting halo (degrees, follows a tilted head). */
    tilt: 0,
  },
  plants: {
    /** Tips curve toward the sky (positive) or droop (negative). */
    lift: 0.2,
    /** Wander, ragged outline, the longer "hero" tip. */
    wildness: 0.45,
    /** How far neighbouring plants' territories interleave at the seams. */
    overlap: 0.5,
    /** 0 = stems keep their width to a blunt end, 1 = fine pointed tips. */
    taper: 0.4,
    /** Gap a side shoot keeps from other branches (the "branches repel" idea as one number). */
    clearance: 0.045,
    /** How much soft / breathy singing makes a new tree droop. */
    softDroop: 1,
    /** Each new tree takes its character from the phrase that grows it (effort, pitch, softness, vibrato). */
    moodShaping: true,
    step: 0.03,
    tipWidth: 0.006,
    /** Width of the hidden trunk; limbs start at 0.42 of it. */
    maxWidth: 0.035,
    maxNodes: 2600,
  },
  layout: {
    lowOriginY: -0.35,
    /** Height of the hub behind the neck that every plant grows from. */
    midOriginY: 0.05,
    /** Degrees left free straight down (behind the body); the plants share the rest of the circle.
     *  Only used while spin is off. */
    downGap: 100,
    /** 3+ takes: each further take makes the canopy this much smaller. */
    shrinkPerTake: 0.02,
    tierFrom: 7,
    innerScale: 0.8,
    spinFrom: 3,
    /** Degrees per second. */
    spinSpeed: 0,
    ease: 2.5,
  },
  /** A live take that finishes recording winds into a staff and is planted as its tree. */
  commit: {
    enabled: true,
    /** Overall pace (1 = about 1.4 s to the impact). */
    duration: 1,
    /** Flash, shock ring and quiver at the impact. */
    impact: 1,
    /** How much of the tree the stamp leaves grown. */
    stampReveal: 0.6,
    /** Leaves thrown along the tree at the impact. */
    burst: 36,
    /** The staff waits (up to syncWindow s) for the next note start, so the hit lands on the music. */
    syncToOnset: true,
    syncWindow: 0.3,
    /** How far the staff drives into the root (world units). */
    plunge: 0.28,
    /** Minimum spin of the winding ring (turns). */
    spinTurns: 0.75,
    shockRing: true,
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
    /** Preview: show your own avatar picture (Test & preview → Load avatar PNG) instead of the grey shape. */
    useImage: true,
    /** Picture centre and height (world units; the halo ring is 1 across the middle). */
    imageX: 0,
    imageY: -0.35,
    imageHeight: 3.2,
    headX: 0,
    headY: 0.2,
    headR: 0.42,
    bodyTopY: -0.1,
    bodyBottomY: -2.5,
    bodyR: 0.55,
  },
  /** Wind, push and shiver (docs/fable-consult-3-motion.md). */
  motion: {
    /** How far the tips lean in a full-voice gust (degrees). */
    swayDeg: 8,
    /** Share of the wind that stays when nobody sings (0 = stands still). */
    idle: 0.35,
    /** Wind tempo: how quickly gusts, sway and flutter change. */
    speed: 1,
    /** Push from every note start, degrees at the tips (scaled by effort and loudness). */
    kickDeg: 6,
    /** After a push: 0 settles at once, 1 swings back and forth for a while. */
    springiness: 0.5,
    /** How much thin shoots move on their own compared with the limbs. */
    twigs: 1,
    /** Leaf flutter about the stalk (degrees). */
    flutterDeg: 14,
    /** Shimmer of twigs and leaves on vibrato. */
    shiver: true,
    shiverDeg: 3,
    /** How strongly vibrato is read: higher = even light vibrato makes it tremble fully. */
    shiverSensitivity: 1,
  },
  glow: {
    strength: 1.6,
    radius: 1.8,
    /** Weight of the widest bloom level (the heavy haze). */
    wide: 0.8,
    base: 0.3,
    levelGain: 0.8,
    onsetGain: 0.7,
    pitchShine: 0.4,
    /** Extra glow on the growing edge of the construct. */
    front: 0.8,
    /** Soft singing glows more diffusely (0 = ignore softness). */
    softGlow: 0.4,
    /** Where branches and leaves are dense the glow steps back, so the detail shows (0 = off). */
    crowd: 0.7,
    /** Glow lies around the ink, not on top of it (0..1). */
    inkMask: 0.7,
    /** Bright glow rolls off softly instead of clipping to a flat colour (0 = off). */
    knee: 0.8,
  },
  /** Performance: how often and how large the picture is drawn. Shared with OBS, never part of a preset. */
  perf: {
    /** Most frames per second (OBS, and the preview while its window has focus). Snaps to a whole
     *  division of the display rate: on a 144 Hz monitor 60 becomes 72. */
    fps: 60,
    /** Frames per second while nobody sings and nothing is growing or being planted (only wind
     *  and slow fades). Same as max fps = always the full rate. */
    idleFps: 30,
    /** Preview only: frames per second while another window has focus (DAW, a video). */
    backgroundFps: 30,
    /** Largest picture drawn, in megapixels (2.1 = 1920 x 1080, 8.3 = 4K). A larger window or
     *  source is drawn at this size and scaled up. */
    maxMegapixels: 2.1,
    /** Draw smaller and scale up (1 = full size, 0.7 = half the pixels). For weak GPUs. */
    renderScale: 1,
  },
  /** Voice detection in Sprout.exe (kept there, so every viewer and OBS use the same). */
  detect: {
    /** Seconds of one continuous note before vibrato can be read. */
    vibratoMinNote: 0.45,
    /** Smallest vibrato swing that counts (semitones up and down from the note). */
    vibratoMinSemitones: 0.08,
    /** Swing that reads as full vibrato depth (semitones). */
    vibratoFullSemitones: 0.58,
    /** Accepted vibrato rates (wobbles per second). */
    vibratoMinHz: 3.5,
    vibratoMaxHz: 9,
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
