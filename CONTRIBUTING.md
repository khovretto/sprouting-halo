# Contributing

Thanks for wanting to help with Sprouting Halo (https://github.com/khovretto/sprouting-halo). Bug reports, looks and themes, and code are all welcome.

## Reporting a problem

Please include:

- Windows version, DAW and its version, OBS version.
- What you did, what you expected, what happened.
- For the overlay: the browser console's output (F12 in a browser, or OBS's Browser Source
  "Interact" window), and `sprout.perf()` if it's about speed.
- For the plugin: whether its window says Connected, and its Role.
- If it's about a look: your settings. Look tab → **Export preset (.json)** and attach the file.

## Sharing a look or a theme

- A **look** is a preset: Export preset (.json) from the panel. Built-in presets live in
  `viewer/src/presets.ts` (`BUILTINS`), one object per preset holding only the settings it changes.
- A **theme** is a JSON file from the `themes` folder next to Sprout.exe (pictures included).
  Built-in themes are in `viewer/src/themes.ts` (`BUILTIN_THEMES`).

## Setting up

See the [README](README.md#build) for the C++ build (Visual Studio 2022, CMake, JUCE and Spout2 in
`external/`). For the viewer only, Node.js 20+ is enough:

```bash
npm --prefix viewer ci
```

```bash
npm --prefix viewer run dev
```

Open `http://localhost:5173/?offline`: it runs on the built-in fake singer, no Sprout.exe or DAW
needed. Saving a `.ts` or shader file reloads the page.

To test the whole chain without a DAW, run `build/Release/Sprout.exe`, then
`build/Release/fake_tap.exe --takes 3`, and open `http://localhost:7777/`.

## Before you send a change

- **Viewer:** `npm --prefix viewer run build` (type check and build) must pass.
- **Every built-in preset still runs.** In the dev page's console:

  ```js
  const m = await import('/src/presets.ts');
  for (const k in m.BUILTINS) for (const p of m.BUILTINS[k]) {
    for (const [s, o] of Object.entries(p.values)) Object.assign(sprout.params[s], o);
    sprout.restart(); sprout.advance(4, 1 / 30);
  }
  ```

  Then reload the page (this changes the settings) and clear them with "Revert all changes".
- **C++:** `cmake --build build --config Release` without new warnings in our code.
- **Protocol:** changing `SlotInfo`, `Slot` or `Bus` in `common/SproutBus.h` needs a new `kVersion`
  and mapping name, and a note in the changelog that Sprout.exe and the plugin must be updated
  together.

## Where things are

- `viewer/src/params.ts`: every setting, with a doc comment. Add one here and it appears in the
  panel, presets and sync. Then give it a place in `panel-layout.ts` (folder, label, tooltip), a
  slider range in `ui.ts` (`RANGES`), and, if it responds to the voice, add it to `REACTIVE` in
  `presets.ts`. The dev page's console lists settings no built-in preset uses yet; new features
  should show up in at least one preset.
- `docs/architecture.md` explains the parts and how they talk; `viewer/README.md` has the viewer's
  file map.
- `docs/` also holds the design notes the visuals were built from.

## Style

- TypeScript: strict, no frameworks in the viewer beyond Tweakpane. Comments say why, in plain
  language; a setting's doc comment is what its tooltip falls back to.
- C++20, JUCE style in `tap/`, Win32 style in `app/`. No exceptions across the bus.
- Text people read (tooltips, labels, docs): short sentences, no jargon where a plain word works.

## Licence

By contributing you agree that your contribution is licensed like the folder it goes into: MIT
for everything except `tap/`, which is AGPLv3 (see `LICENSE` and `tap/LICENSE`).
