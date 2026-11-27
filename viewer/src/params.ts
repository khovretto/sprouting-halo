import { RAINBOW } from './gradient';

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
    backdrop: 'checker' as 'checker' | 'checker-light' | 'checker-split' | 'black' | 'white' | 'none',
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
    /** Each phrase grows one new branch on the take's tree; older ones dry, droop and fall
     *  (consult 6, 3). Replaces newTreeEachPhrase while on. */
    branchEachPhrase: false,
    /** Empty space gets filled: a new branch (new branch each phrase) also reaches into the empty
     *  space beside it, and takes that have been away for a while (silent, no tree) leave their
     *  space to the new trees of the takes that are here. 0 = everyone keeps their own space. */
    fillSpace: 0.5,
    /** Branches a take keeps before the oldest dries and falls. */
    branchesKept: 3,
    /** Where each phrase's new branch grows on the take's tree: spread (the middle first, then far
     *  jumps), random (a free place), top to bottom, or bottom to top (then round again). */
    branchOrder: 'topDown' as 'spread' | 'random' | 'topDown' | 'bottomUp',
    /** A new branch is a mirrored pair at the same height either side of straight up (one branch
     *  over the top), so a tree over the head is never lopsided; a tree off to one side grows one
     *  branch at that height. Its places are height bands, so top to bottom is exact. */
    branchSymmetry: true,
    /** Seconds an old branch takes to dry out. */
    branchWitherSeconds: 2.5,
    /** How far an old branch droops while it dries (degrees). */
    branchDroopDeg: 30,
    /** Seconds an old branch takes to fall and fade. */
    branchFallSeconds: 1.4,
    /** Leaves and blossoms let go and fall when their twig goes or their bloom closes. Off: they go
     *  the way of their twig (shrink back with it, fade with it, fall only when it falls). */
    shed: true,
    /** Seconds of full voice to grow a whole tree (higher = slower). */
    secondsToFull: 3.5,
    /** 0 = a few limbs; 1 = dense, ivy-like: tips closer together, more and deeper side shoots. */
    branching: 0.6,
    /** Where the limbs start to fork and sprout: 0 = they run out bare from behind the head and
     *  branch toward their ends (top-heavy, as it was); 1 = right where they leave the head, so the
     *  tree fills in close to you. */
    lowBranches: 0.6,
    /** Canopy size: half-width of the shared outline = 2.15 × reach. */
    reach: 1.0,
    /** 0 = round canopy, 1 = flat: height 40 % of the half-width. */
    flatten: 0.55,
    /** 0.4 = straight rays from the hub, 2 = limbs arch strongly out from each plant's middle. */
    spread: 1.0,
    /** Brightness of a tree between phrases (it rests, until a long silence ends it: dieAfter). */
    restBrightness: 0.55,
    /** How branches go when a silence acts on them, and when a tree is replaced (a new phrase, a
     *  look change): ungrow = they grow back into the tree from the tips; fade = they fade out;
     *  fall = pieces break off and fall (growth.fallDirection). */
    witherEffect: 'ungrow' as 'ungrow' | 'fade' | 'fall',
    /** fade / fall: from the tips inward (on) or all at once (off). Ungrowing is always from the tips. */
    witherFromTips: true,
    /** A short pause acts on the outer twigs (within witherDepth of the tips); they grow back when
     *  singing resumes. Off: pauses leave the tree as it is. */
    onPause: true,
    /** The end of a phrase acts on the whole tree, trunk and all (fadeAfter seconds after its take
     *  stopped singing, and never before response.phraseGap), over fadeSeconds. A tree that was not
     *  replaced comes back when its take sings again. Off: it stays (resting) until it is replaced. */
    onPhraseEnd: true,
    /** A full stop (a silence of dieAfter seconds) acts on every tree, and the next phrase starts a
     *  new one. Off: full stops are like any phrase end. */
    onStop: true,
    /** A silence this long is a full stop (s): onStop acts on every tree and the next phrase starts
     *  a new one. 0 = never. */
    dieAfter: 4,
    /** A tree stays whole this many seconds after its take stopped singing before onPhraseEnd acts
     *  on it, so it outlives the start of the next phrase and the trees overlap. Never shorter than
     *  response.phraseGap: 0 = as soon as the phrase is over. */
    fadeAfter: 3,
    /** Seconds an ending takes (the phrase end's or the full stop's). */
    fadeSeconds: 2.5,
    /** Where branches, leaves and petals that let go go: down (gravity), away: no gravity, they
     *  drift straight out, away from the point the tree grows from, or up: they float up. A look
     *  can bring its own (look.gravity). */
    fallDirection: 'down' as 'down' | 'away' | 'up',
    /** A drop in pitch (a dip of witherDipSemitones or more) also withers the outer twigs. */
    witherOnPitchDip: false,
    witherDipSemitones: 3,
    /** How far in from the tips withering in pauses can reach (plant units; it never reaches the trunk). */
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
    /** This look's gravity: where what lets go goes (reaction = as the reaction says,
     *  growth.fallDirection; otherwise this, whatever the reaction). */
    gravity: 'reaction' as 'reaction' | 'down' | 'away' | 'up',
    /** The wood stays: trees are there in full from the start (no growing), one per take, and
     *  their branches never wither, fade or die. Pauses and endings only touch the leaves (they
     *  fall, see leafFall). For seasonal looks like Autumn. */
    woodStays: false,
    /** Leaves let go on their own and fall while the branches stay, then grow back (0 = never).
     *  Trembling (vibrato) and pauses shake more loose. */
    leafFall: 0,
    /** Seconds before a fallen leaf grows back. */
    leafRegrow: 3,
    /** A faint light vein and edge on leaves, so near-black leaves keep their form (0 = off). */
    leafSheen: 0,
    /** How three-dimensional the leaves look (the settings in leaves3d): 0 = flat, 1 = in full. */
    leaf3d: 0,
    sheenColour: '#ffffff',
    /** Where each track's theme and amount come from: its Sprout Tap window, or theme and density
     *  below for every track. Taps on Auto always follow the look. */
    themeFrom: 'tracks' as 'tracks' | 'preset',
    /** Fallback theme. Each track sets its own theme and amount in the Sprout Tap window; this
     *  is used for the fake singer and every tap whose Theme is on Auto. */
    theme: 'leaves' as string,
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
    /** Blossoms open on full / high singing (leaves theme). */
    blossoms: 0.7,
    /** Blossoms open only on a note held longer than this (seconds), and close after it ends. */
    blossomHold: 1.5,
    /** Thorns grow with vocal effort (thorns theme). */
    thornEffort: 1,
    /** Size of a closed blossom (a bud), relative to the open flower. 0 = no buds. */
    buds: 0.25,
    /** Colour that falling leaves and old, drying branches turn toward. */
    dryColour: '#8a6f45',
  },
  /** Take colours of this look (consult 6, 7): your own (Setup), or this look's list. */
  palette: {
    /** mine: your own take colours. list: this look's colours below. */
    from: 'mine' as 'mine' | 'list',
    /** The look's colours: the stops of this gradient, in order. */
    list: 'step;0:b5e61d,0.143:ff7ac8,0.286:00dd88,0.429:3d4fd6,0.571:ffb347,0.714:a77bff,0.857:4fd1ff',
    /** order: the first free colour. random: a free colour chosen by the take's id. spread: any
     *  gradient, sampled at well-spaced positions. */
    pick: 'order' as 'order' | 'random' | 'spread',
    /** Another number gives another random choice. */
    seed: 1,
  },
  /** Your palette: the live halo colour and one colour per take (unless a track uses its DAW colour). */
  colours: {
    /** Always use these take colours, even with a look that brings its own. */
    lock: false,
    live: '#2fb84f',
    take1: '#b5e61d',
    take2: '#ff7ac8',
    take3: '#00dd88',
    take4: '#3d4fd6',
    take5: '#ffb347',
    take6: '#a77bff',
    take7: '#4fd1ff',
  },
  /** Colour of the take trees' branches (docs/fable-consult-5-colour-themes-panel.md, A). */
  colBranch: {
    /** take: the take's colour. theme: the theme's natural colour. gradient: the gradient below. */
    source: 'take' as 'take' | 'theme' | 'gradient',
    gradient: RAINBOW,
    /** How much of the take colour is mixed back in (0 = pure gradient or natural colour). */
    takeMix: 0,
    /** Gradient lengths from root to tip (negative runs the other way). */
    along: 0.3,
    /** Gradient lengths per second (the colours travel). */
    speed: 0.05,
    /** What in the voice moves the colour along the gradient. */
    voice: 'none' as 'none' | 'pitch' | 'loudness' | 'effort' | 'breath' | 'vibrato' | 'flash',
    voiceAmount: 0.5,
    /** Each further take starts this far along the gradient. */
    perTake: 0.13,
    /** Random spread per leaf (decorations only). */
    scatter: 0,
  },
  /** Colour of leaves, thorns and needles. */
  colLeaf: {
    source: 'theme' as 'take' | 'theme' | 'gradient',
    gradient: 'ok;0:1f6b2e,0.5:52c757,1:b5e61d',
    takeMix: 0.65,
    along: 1,
    speed: 0,
    voice: 'none' as 'none' | 'pitch' | 'loudness' | 'effort' | 'breath' | 'vibrato' | 'flash',
    voiceAmount: 0.5,
    perTake: 0,
    scatter: 0.25,
  },
  /** Colour of blossoms and berries. */
  colAccent: {
    source: 'theme' as 'take' | 'theme' | 'gradient',
    gradient: 'ok;0:ff7ac8,0.6:ffd1e6,1:ffffff',
    takeMix: 0.35,
    along: 0,
    speed: 0,
    voice: 'none' as 'none' | 'pitch' | 'loudness' | 'effort' | 'breath' | 'vibrato' | 'flash',
    voiceAmount: 0.5,
    perTake: 0,
    scatter: 0.5,
  },
  /** Colour of the halo ring and its vine (branches = the same settings as the trees' branches). */
  colHalo: {
    source: 'gradient' as 'branches' | 'take' | 'gradient',
    /** The take colour with a white glint travelling round the ring. */
    gradient: 'ok;0:t,0.7:t,1:ffffff',
    takeMix: 0,
    along: 1,
    speed: 0.08,
    voice: 'none' as 'none' | 'pitch' | 'loudness' | 'effort' | 'breath' | 'vibrato' | 'flash',
    voiceAmount: 0.5,
    perTake: 0,
    scatter: 0,
  },
  halo: {
    /** The ring becomes two strands braided round each other (consult 7). 0 = a plain ring. */
    braid: 0,
    /** The vine winds in and out across the ring like a corkscrew (new growth only). */
    twist: 0,
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
    squish: 0.35,
    /** Tilt of the squished resting halo (degrees, follows a tilted head). */
    tilt: 0,
  },
  plants: {
    /** How many limbs leave the origin point (the tree divides into this many there). 0 = auto,
     *  by the size of the tree's share of the canopy (usually 2 to 7). */
    originLimbs: 0,
    /** A trunk from behind the body up into the point every limb fans out from (world units), one
     *  for the whole scene (main.ts drawTrunk). 0 = every limb leaves from one point. */
    trunk: 0,
    /** Tilt of the trunk (degrees; + = its top to the right). */
    trunkLean: 0,
    /** Branches wind from side to side like a corkscrew instead of running straight (consult 7).
     *  The tree keeps its size, outline and limbs. 0 = straight. */
    twist: 0,
    /** Makes the twist irregular: uneven turns and sharp elbows, like old wood. */
    gnarl: 0,
    /** Limb ends and some twigs finish in a small spiral. */
    curl: 0,
    /** Main limbs drawn as 2 or 3 strands wound round each other, like rope (1 = one stroke). */
    strands: 1,
    /** Length of one full turn on a main limb (plant units). */
    twistLength: 0.35,
    /** Turns get shorter toward the tips (0 = the same all along). */
    twistTighten: 0.5,
    /** How much side shoots twist compared with the limbs (0 = straight twigs). */
    twistTwigs: 1,
    /** Branches thicken at the crests of the turns and where a fork leaves. */
    knots: 0,
    /** The near side of each turn (and the front strand) is brighter than the far side. */
    twistDepth: 0.6,
    /** One strand turn per this many branch widths (lower = a tighter rope). */
    strandLay: 9,
    /** A phrase sung with vibrato or effort grows a more twisted tree (needs "shaped by the phrase"). */
    twistVoice: 1,
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
  /** A live take that finishes recording is planted as its tree (growth/commit.ts): the halo
   *  curls up, the coil moves to where the tree starts and unrolls into the fully grown tree. */
  commit: {
    enabled: true,
    /** The halo breaks into this many pieces; each unrolls along one main limb of the new tree. */
    limbs: 3,
    /** Overall pace (1 = about 1 s to curl, 1 s to move, 1.5 s to unroll). */
    duration: 1,
  },
  transitions: {
    /** A live track stopped being live (recording done): its halo fades out (s). */
    liveEndSeconds: 0.8,
    /** A Look preset sweeps round the live halo as a wave in this many seconds (from its start
     *  point both ways): every shoot takes the new look in its turn. */
    lookChangeSeconds: 3,
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
    /** Branches slowly squirm from side to side (a wave travelling along them). 0 = off. */
    writhe: 0,
    /** With look.leafFall: how much trembling (vibrato) shakes the leaves loose (0 = not at all). */
    leafShake: 1,
    /** What makes them squirm harder: vibrato, effort, loudness, or none (always the same). */
    writheVoice: 'vibrato' as 'none' | 'vibrato' | 'effort' | 'loudness',
    /** How far the tips lean in a full-voice gust (degrees). */
    swayDeg: 8,
    /** Share of the wind that stays when nobody sings (0 = stands still). */
    idle: 0.35,
    /** Wind tempo: how quickly gusts, sway and flutter change. */
    speed: 1,
    /** Push from every note start, degrees at the tips (scaled by effort and loudness). 0 = note
     *  starts only flash (glow.onsetGain) and never move anything. */
    kickDeg: 0,
    /** After a push: 0 settles at once, 1 swings back and forth for a while. */
    springiness: 0.5,
    /** How much thin shoots move on their own compared with the limbs. */
    twigs: 1,
    /** Leaf flutter about the stalk (degrees). */
    flutterDeg: 14,
    /** Shimmer of twigs and leaves on vibrato. */
    shiver: true,
    /** Degrees at full vibrato, for twigs and for leaves about their stalk. */
    shiverDeg: 1,
    /** How strongly vibrato is read: higher = even light vibrato makes it tremble fully. */
    shiverSensitivity: 1,
  },
  /** 3D leaves (look.leaf3d is the amount): Look → Theme & leaves → 3D leaves. Each leaf is two
   *  halves folded along the midrib, turned about the midrib and tilted about its stalk in 3D, and
   *  lit. Angles in degrees. */
  leaves3d: {
    /** How far the halves slope down from the midrib, like a roof (a ridge, so the light reads the
     *  same way on every leaf). */
    fold: 25,
    /** A little dome across the leaf (shading only). */
    cup: 0.4,
    /** A little arch along the leaf (shading only). */
    arch: 0.35,
    /** Most a leaf turns about its midrib (each leaf its own amount, both ways). */
    turn: 45,
    /** Most a leaf tilts toward or away from you about its stalk (it looks shorter). */
    tilt: 35,
    /** How much the turning and tilting move with the wind (0 = they hold still). */
    wind: 1,
    /** On vibrato, leaves also tremble in 3D: turned and tilted back and forth at the vibrato's rate,
     *  this many times the shiver angle (motion.shiverDeg), so the light flickers over them. */
    shiver: 8,
    /** Where the light comes from on screen (0 = right, 90 = above, 135 = upper left). */
    lightAngle: 135,
    /** How high the light is above the picture (90 = straight from the front). */
    lightHeight: 40,
    /** How dark the side turned away from the light gets (0 = no shading: the leaves read as 3D
     *  from their shape, glint and underside). */
    shade: 0,
    /** The glint where the light hits head-on. */
    shine: 0.35,
    /** How pale the underside looks when a leaf is turned over. */
    underside: 0.35,
  },
  /** Leaves and petals that let go (Look → Theme & leaves → Falling leaves). */
  falling: {
    /** How fast they fall (1 = as before). */
    speed: 1,
    /** How far they swing from side to side as they fall (1 = as before). */
    sway: 0.5,
    /** How much they turn and rock as they fall (1 = as before). */
    spin: 0.5,
    /** How much the wind still flutters them while they fall (1 = like a leaf on its twig). */
    flutter: 0.4,
    /** How long they fall before they are gone (1 = about 1.1 to 1.7 s). */
    time: 1,
    /** First a straight drop, then the sway: about this many seconds of falling straight down
     *  before a leaf starts to swing from side to side (0 = they all sway at once). */
    dropSeconds: 0.35,
    /** How much the drop differs from leaf to leaf: 0 = all alike, 1 = some sway at once, others
     *  drop twice as long. */
    dropVariety: 0.8,
    /** How much faster a leaf falls during the drop than once it sways (1 = the same). */
    dropSpeed: 1.6,
    /** How differently each leaf falls: 0 = all alike; up to 1 each has its own speed, swing and
     *  rhythm, and some tumble end over end and slide away. */
    variety: 0.8,
  },
  glow: {
    /** A soft dark outline round everything, so light colours and glow stay readable on a bright
     *  background (part of the OBS output, under the ink and glow). 0 = off. */
    shadow: 0,
    shadowColour: '#000000',
    /** Dark branches glow in the glow colour as strongly as mid-bright ones (needs a glow colour
     *  amount above 0). 0 = glow follows how bright the ink is. */
    tintFlat: 0,
    strength: 1.6,
    radius: 1.8,
    /** Weight of the widest bloom level (the heavy haze). */
    wide: 0.8,
    base: 0.3,
    levelGain: 0.8,
    onsetGain: 0.35,
    pitchShine: 0.4,
    /** Extra glow on the growing edge of the construct. */
    front: 0.8,
    /** Seconds a change of glow (a swell of the voice, a note start) takes to run from a tree's
     *  root to its tips, and round the halo from where it grows (0 = all of it at once). */
    travel: 0.5,
    /** Soft singing glows more diffusely (0 = ignore softness). */
    softGlow: 0.4,
    /** Where branches and leaves are dense the glow steps back, so the detail shows (0 = off). */
    crowd: 0.7,
    /** Glow lies around the ink, not on top of it (0..1). */
    inkMask: 0.7,
    /** Bright glow rolls off softly instead of clipping to a flat colour (0 = off). */
    knee: 0.8,
    /** A colour the glow leans toward (the strokes keep theirs). */
    tint: '#ffffff',
    tintAmount: 0,
  },
  /** Harmony: two tracks singing different notes that sound well together. The viewer finds it
   *  from the tracks' pitches (harmony.ts); each effect has its own amount, 0 = off. */
  harmony: {
    /** Seconds two voices have to stay in harmony before it counts. */
    minSeconds: 0.25,
    /** Seconds the effects take to come in; they leave in about twice that. */
    attack: 0.6,
    /** Unison and octaves (the same note) count as harmony too. */
    unison: false,
    /** How far each voice's colours move toward the shared colour (0 = not at all). */
    colour: 0.7,
    /** The shared colour. waves: bands of the other voice's colour run out along the branches
     *  (from the root) and round the halo, a sine between the two colours. gradient: each voice's
     *  branches run from its own colour at the root to the other's at the tips. mix: both turn
     *  into the mix of the two. colour: the colour below. */
    colourMode: 'waves' as 'waves' | 'gradient' | 'mix' | 'colour',
    colourValue: '#ffe9a8',
    /** How the two colours blend: oklab (even, perceptual), rgb (straight), light (as light adds
     *  up, brighter), hue (round the colour wheel), paint (the painter's wheel: yellow and blue
     *  make green), hard (a hard cut, no blend). */
    colourMix: 'oklab' as 'oklab' | 'rgb' | 'light' | 'hue' | 'paint' | 'hard',
    /** waves: higher / lower: that voice leads; its colour runs into the other first, then both
     *  carry the same bands in step. each: each voice takes the other's colour at once. */
    waveLead: 'higher' as 'higher' | 'lower' | 'each',
    /** waves on the halo start from: partner = the point of the ring facing the tree it is in
     *  harmony with; origins = the halo's growing points (halo.origins, halo.startAngle). */
    waveFrom: 'partner' as 'partner' | 'origins',
    /** waves: from one band of a colour to the next (world units; the open halo's radius is 1.05). */
    waveLength: 0.7,
    /** waves: how fast the bands run out (world units per second). */
    waveSpeed: 1.2,
    /** Branches turn wavy, neighbours the opposite way, so they cross each other; every branch
     *  keeps its course and the tree its outline. It does not move; off (0) unless a look or
     *  reaction wants it (the Duet preset). */
    cross: 0,
    /** Blossoms (and theme parts that open "on long held notes") also open in harmony. */
    blossoms: 0,
    /** Extra glow while in harmony. */
    glow: 0.4,
  },
  /** Performance: how often and how large the picture is drawn. Shared with OBS, never part of a preset. */
  perf: {
    /** Most frames per second (OBS, and the preview while its window has focus). Snaps to a whole
     *  division of the display rate: on a 144 Hz monitor 60 becomes 72. */
    fps: 60,
    /** Frames per second while nobody sings and nothing is growing or being planted (only wind
     *  and slow fades). Same as max fps = always the full rate. */
    idleFps: 30,
    /** Preview only: frames per second while another window has focus (DAW, a video). Never
     *  applies inside OBS (detected by its browser source), which always draws at max fps while
     *  the source is shown and stops when it is not. */
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
    /** Longest note the fake singer holds (seconds); long ones open blossoms. */
    noteMax: 1.1,
    /** Share of notes held long (1.8 to 3.5 s), long enough to open blossoms. */
    longNotes: 0.12,
    /** Every n-th phrase ends with a full stop: a long pause (fullStopSeconds), so phrase-end
     *  effects (withering, falling tips, a new branch) show. 0 = never. */
    fullStopEvery: 3,
    fullStopSeconds: 7,
    /** Plant the live take every n seconds (0 = never), to watch the planting hands-free. */
    autoCommit: 0,
    /** Pretend the DAW is recording (the halo opens with the first phrase and stays open). */
    recording: true,
    /** Live tracks for the fake singer (more than 1 = concentric halos). */
    liveTracks: 1,
    /** How the fake voices relate. independent: each has its own phrases, pauses and notes.
     *  duet: they trade phrases, one alone, then another, some together. together: every voice
     *  sings every phrase at a fixed interval. */
    voices: 'independent' as 'independent' | 'duet' | 'together',
    /** How often a second voice joins the first in harmony (a third, fourth, fifth or sixth)
     *  rather than clashing with it. */
    harmony: 0.25,
    /** duet: share of the phrases that all voices sing together. */
    together: 0.4,
  },
};

export type Params = typeof defaults;
