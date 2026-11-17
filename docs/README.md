# Documentation

## Using it

- [User guide](user-guide.md): install, DAW, OBS, fitting to your avatar, the panel, presets,
  themes, the Sprout Tap window, how it reacts to the voice, troubleshooting.
- [Viewer README](../viewer/README.md): the overlay page in more depth (behaviour, panel, console
  helpers, performance, code layout).

## How it works

- [Architecture](architecture.md): the parts, the shared-memory bus, the WebSocket messages,
  settings sync, files on disk, the test tools.
- [Procedural growth research](procedural-growth-research.md): background reading on growing
  plants procedurally (space colonisation, L-systems, ivy), and what this project took from it.

## Design notes

The visuals were designed in a series of written consultations with Claude Fable 5.2, an AI model,
each answering a brief about one part of the overlay. They record the reasoning, the formulas and
the numbers the code started from; the code has moved on in places, and where they disagree the
code and the guides above are right.

| Note | Subject |
| --- | --- |
| [fable-brief.md](fable-brief.md), [fable-consult.md](fable-consult.md) | Part A: gesture-first take trees. Part B: the halo planting itself as a tree ("unwind and stamp"). |
| [fable-brief-2.md](fable-brief-2.md), [fable-consult-2.md](fable-consult-2.md) | Tree shape: hub, territories, sector subdivision, de-blobbing the glow. |
| [fable-consult-3-motion.md](fable-consult-3-motion.md) | Motion: wind as a world vector, springs, per-shoot bend, vibrato shiver. |
| [fable-consult-3-panel.md](fable-consult-3-panel.md) | The settings panel: grouping for artists, presets, revert. |
| [fable-consult-4-performance.md](fable-consult-4-performance.md) | Frame-rate cap, idle and background rates, OBS behaviour. |
| [fable-consult-5-colour-themes-panel.md](fable-consult-5-colour-themes-panel.md) | Colour roles, gradients, user themes, the panel tabs. |
| [fable-consult-6-presets-growth.md](fable-consult-6-presets-growth.md) | Presets, planting fronds, branch per phrase, shedding, taps on Auto. |
| [fable-consult-7-twist.md](fable-consult-7-twist.md) | Twisting branches, rope strands, writhe, braided halo, light backdrops, outline glow. |
| [fable-consult-8-goth.md](fable-consult-8-goth.md) | The Briar theme and the Black briar look. |

## Images

`images/` holds the screenshots used in the README (the fake singer in the preview page).
