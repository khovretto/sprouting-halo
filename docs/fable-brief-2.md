# Design consult brief 2 for Claude Fable 5.2: the take tree, second round

For: Claude Fable 5.2. From: the Sprout Visualizer project. This follows your first consult
(`docs/fable-consult.md`, Part A) and is only about **the take tree** (Part B, the commit
animation, waits until the tree is right). Please read `docs/fable-brief.md` for the project
context if you need it; this brief assumes it.

## 1. What happened since your first answer

We built your gesture-first generator (`viewer/src/growth/plant.ts`, `buildGesture`) and then
iterated with the artist watching live. Changes to your spec, in order, each driven by what the
artist or the frames showed:

1. **The radial clamp pinned every feather to the spine.** Measured "outward from the plant root"
   with 28° near the silhouette, any feather attached along the spine could diverge at most 28° from
   it, so wings came out as narrow plumes and the crown as a triangle. We replaced it with a clamp
   at the **head outline**: limbs are free behind the head; a limb *leaving* the head's outline
   (measured from the head centre) must do so within 28–70°; far out, nothing may turn more than 80°
   from radial-to-root (no curling into a ring).
2. **Feathers attach from near the base** (u from 0.06–0.1, packed toward the base with u^1.35) —
   the artist asked to "branch more at the start".
3. **Splay:** divergence narrows only 1.15 → 0.75 toward the tip (you had 1.0 → 0.35, which read as
   a swept plume), ±40 % random spread, recurve 0.1 instead of 0.35, and an **overlap** control
   that puts full-length feathers on the off side so limbs cross ("allow them to be on top of one
   another").
4. **Ivy:** the artist said it should be *"more inspired by ivy"*. Every limb (and the visible spine)
   now throws alternating side shoots at a regular spacing along its whole length, recursing up to
   3 levels below the feathers; more feathers (6–14); a **broad planform** (feathers as long at the
   tip as at the base, so the outline is not a star/triangle) and **low taper** (stems keep width).
5. **Repulsion (experiment, artist's suggestion):** each new step of a limb steers weakly away from
   other limbs within `repelRadius` 0.12 (strength 0.6), so later branches spread into free space.

Current high-level defaults: branching 0.65, reach 1.0, spread 1.25, sweep 0.75, lift 0.25,
wildness 0.5, overlap 0.5, planform 0.8, taper 0.35, repel 0.6, maxNodes 2600, layout downGap 100.

## 2. The artist's verdict on the latest frames (verbatim, then our reading)

> "Still not enough. The blue part at the top from the latest preview is best, but still not good.
> The good part of it is being more flattened, without the middle becoming a single colored
> textureless mess and being a step closer actually becoming wide and actually cradling the model.
> Maybe a mechanic of branch paths weakly repelling each other so it doesn't bunch up?"

Earlier verdicts: *"splayed and like a tree representing freedom, not that hunchbacked mess"*;
*"too grouped, allow them to be more splayed and be on top of one another"*; *"branch too rarely"*;
*"more inspired by ivy"*; *"wider and less tapered at the end, so it doesn't make a star or
triangle"*.

Our reading of what they want now:

- **Flattened**: a broad, low canopy — wide more than tall — like the top (blue) tree in frame 1,
  which spreads sideways over the head instead of rising as a column or ending in a point.
- **Textured, not a blob**: you must be able to see individual branches and leaves everywhere. In
  the side plants the centre of each plant becomes one bright, uniform glow (many overlapping
  strokes and leaves + heavy bloom → saturates), which reads as a "textureless mess".
- **Wide and cradling the model**: the plants together should form a broad shape that holds the
  avatar — reaching out wide and wrapping *around* the sides of head and shoulders. Note the
  apparent tension with the first brief ("don't encircle the model"): what was rejected then was
  limbs **hugging the silhouette** (running along it, hunched). Cradling means the *overall mass*
  frames and holds the figure from a distance, with individual limbs still leaving it freely.
- **Not bunched**: space should be used evenly — no dense knots, no empty gaps that look
  accidental.

## 3. Frames (please look at them)

All at 800×600, halo ring radius ≈ 1 open, avatar placeholder in grey (the real avatar is opaque in
OBS and hides the centre). Folder:
`C:\Users\User\AppData\Local\Temp\claude\e940c5311d3e228a\7f595b02-b9fb-455f-96d8-9463f8727a44\scratchpad\consult2\`

1. `1-liked-3takes-leaves-before-repel.jpg` — the frame the artist referred to: the **top blue
   tree is "best"** (flatter, textured, wider); the two side plants are dense balls.
2. `2-3takes-leaves-repel-off.jpg` — current code, repulsion off.
3. `3-3takes-leaves-repel-0.6.jpg` — repulsion on: side plants spread up and down and start to
   curve round the halo (closer to cradling), but their centres are still a uniform glow.
4. `4-3takes-bare-branches-repel-0.6.jpg` — the same structure without leaves: you can see the
   limb layout, the long bare spines and where branches bunch.
5. `5-2takes-leaves-repel-0.6.jpg` — two takes: the yellow (left) plant's core is a saturated blob
   — the failure case — while the blue (right) one wraps down around the halo — closer to the goal.

Automated checks (your A7 metrics, `viewer/src/debug.ts`), 3 takes: outline CoV 0.18–0.27 (fine);
with repulsion the share of stroke length >60° off radial rose from ~10 % to 29–36 % and "near the
silhouette and >35° off radial" rose to 17–59 %; visible share ~94 %.

## 4. Rendering facts relevant to the "blob"

- Strokes: tapered capsules, premultiplied "over" blending, colour × intensity (loudness), alpha 1.
- Leaves: sprite per leaf (decorations on branch nodes, density 0.55 per node chance, size 0.055 ×
  decoSize 1.8 plant units), same colour family as the plant (`naturalTint` 0.35 toward green).
- Both write a glow buffer: strokes with glow ≈ 0.3 + loudness terms, leaves × `decoGlow` 0.3;
  bloom is three Gaussian levels (½, ¼, ⅛) with strength 1.6 and a wide weight 1.0. Many
  overlapping glowing elements in a small area therefore saturate to one bright patch.
- Per-plant colour is a single hue (the take's colour); there is no per-branch or depth variation.

## 5. What we'd like from you

1. **A diagnosis**: why the current trees bunch and blob (structure? leaf density? glow? colour?),
   with reference to the frames.
2. **A concrete revision of the generator** to get *flattened, wide, cradling, evenly spread,
   ivy-like* plants — fully specified (algorithm, parameters, defaults, pseudocode against
   `buildGesture`). Consider and decide on, with reasons:
   - space claiming / even spacing: repulsion (keep? tune? apply to shoots differently?), occupancy
     grid, "available space" budgets per limb, Poisson-disk style tip placement, light-seeking;
   - a *canopy / cradle* silhouette per layout (what shape should 1, 2, 3, 6 takes form together
     around the head and shoulders, and how far out);
   - how to make the top-of-head plant and the side plants read as one cradling composition;
   - keeping limbs from hugging the silhouette while the mass cradles it.
3. **De-blobbing in rendering**, specified concretely for our pipeline: e.g. leaf density by depth
   or by local crowding, leaf size/orientation variety, per-branch brightness or hue jitter, a
   darker core / lighter rim on strokes, glow that scales down with local overlap, bloom threshold,
   thinner inner stems — whatever you judge most effective. Rank by impact vs cost.
4. **Defaults and the artist's sliders** after the change (keep the existing names where they still
   mean something; we already have many — propose which to retire).
5. **A test plan**: which frames and metrics will tell us quickly that "flattened, textured, wide,
   cradling, not bunched" is achieved. Add a metric for bunching/blobbing if you can (e.g. local
   stroke density or overdraw histogram).

Be implementation-oriented; we will build from your answer directly.

## 6. Files to read

- `viewer/src/growth/plant.ts` — current generator (`buildGesture`, `grow`, the clamps, repulsion,
  shoots, reveal schedule)
- `viewer/src/layout.ts` — placements (`downGap`, `lengthMul`)
- `viewer/src/params.ts` — current defaults
- `viewer/src/deco.ts`, `viewer/src/main.ts` (`pushTree`, `lookOf`, `styleOf`) and
  `viewer/src/shaders/*` — leaves, glow, bloom
- `viewer/src/debug.ts` — the A7 metrics
- `docs/fable-consult.md` — your first answer
