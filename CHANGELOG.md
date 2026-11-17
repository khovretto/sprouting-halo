# Changelog

Sprout.exe and the Sprout Tap plugin share a protocol version (the "bus"). When it changes,
update both together.

## 0.1.0 (unreleased, bus v5)

The first public version.

### Overlay (viewer)

- Web overlay for OBS's Browser Source, served by Sprout.exe at `http://localhost:7777`, with a
  settings panel synced live between every open page and OBS (`/controls` for the panel alone).
- **Live halo:** a vine that grows round a ring behind the head, opening while recording, small
  and tilted on the head when idle. Several live tracks nest.
- **Take trees:** every take grows its own tree into a shared canopy round the avatar (hub,
  territories, forking limbs, ivy shoots in free space). Trees grow with each phrase; a new tree or
  a new branch per phrase; outer twigs wither in pauses; a long silence ends the whole tree
  (wither, fade or both).
- **Planting:** when a take is done, the halo winds up and unrolls along the new tree's limbs into
  its root. Deleted takes fade while their leaves fall.
- **Voice:** loudness, note starts, pitch, vibrato, effort and breathiness each drive something:
  growth, glow, wind springs, shiver, blossoms on held notes, thorns with effort, leaves shaken
  loose by trembling.
- **Shapes:** twist, gnarl, knots, curling tips, rope strands, writhe; braided halo ring.
- **Colour:** branch, leaf, blossom and halo colour roles from the take colour, the theme or a
  gradient that can flow, run root to tip, scatter or follow the voice; per-look take palettes.
- **Themes:** Leaves, Thorns, Christmas wreath, Briar, Branches, and your own from up to six
  parts and PNG pictures with an origin point (`/themes` editor, saved by Sprout.exe).
- **Presets:** 12 Looks, 12 Reactions, 13 test setups, plus your own (export and import as files).
- Leaves and petals fall instead of shrinking; Autumn's wood stays while its leaves fall and
  regrow.
- Light, dark and split checker backdrops for the preview; an optional dark outline and flat
  glow so looks read over bright scenes.
- Voice scope (rolling graphs of what the overlay hears), tooltips that say how each setting reads
  the voice, hotkeys (`/` lists them), a fake singer for testing without a DAW.
- Performance controls: frame-rate cap, idle and background rates, maximum picture size.

### Sprout.exe

- Reads up to 16 Sprout Taps from shared memory; per voice: level, onsets, pitch (MPM, octave
  guard, to F6), vibrato depth and rate, effort, breathiness.
- HTTP and WebSocket server for the overlay; merges and keeps the synced settings
  (`sprout-settings.json`), voice detection settings (`sprout-detect.json`) and user themes
  (`themes\`).
- A simple ring halo over Spout (the first output path).

### Sprout Tap (VST3)

- Role: Auto (follows REAPER's record arm), Live voice, Take playback, Instrument.
- Per-track overrides, all on Auto by default: Theme (built-ins, Briar and your own themes),
  Leaves amount, Colour (track colour, own colour, own gradient). "All Auto" resets them.
- Track name and colour from the DAW; record state from REAPER; reclaims its slot after a clash.
