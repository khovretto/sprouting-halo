// The /themes page (docs/fable-consult-5-colour-themes-panel.md, C.3): make your own themes.
// The normal renderer shows the theme being edited (fake singer, two takes and the halo); this
// panel edits it. Save sends it to Sprout.exe (themes folder next to it), so OBS gets it too;
// "Use in viewer" makes it the theme of every viewer.

import { Pane } from 'tweakpane';
import { allThemes, BUILTIN_IDS, BUILTIN_SHAPES, isBuiltin, MOVES, pivotOf, setDraft, ThemeDef, ThemePart, themeDef } from './themes';
import { GradientEditor } from './gradient-editor';
import type { FolderApi } from 'tweakpane';
import { installTooltips, tip } from './tooltip';
import { installSelectMenus } from './select-menu';
import { slug } from './presets';
import { allowTypedBeyond } from './ui';

export interface ThemeEditorHooks {
  /** Send a message to Sprout.exe; false when not connected. */
  send(msg: Record<string, unknown>): boolean;
  connected(): boolean;
  /** Make `id` the theme of every viewer (synced). */
  useInViewer(id: string): void;
  /** Show `id` in this page's preview. */
  preview(id: string): void;
}

const PLACES: Record<string, string> = {
  'Spaced along branches (like leaves)': 'spaced',
  'Several on every node (like needles)': 'every',
  'At branch tips (like blossoms)': 'tips',
  'Small clusters (like berries)': 'clusters',
  'Mirrored pairs (like holly)': 'pairs',
};

/** A colour or gradient as a gradient string (one stop = one colour). */
const asGradient = (v: string) => (v.includes(';') ? v : `ok;0:${v.replace('#', '').slice(0, 6) || 'ffffff'}`);

/** A row with the gradient editor: label on the left, the editor under it. */
function gradientRow(f: Pane | FolderApi, label: string, value: string, tipText: string, onChange: (v: string) => void) {
  const holder = { v: value };
  const b = f.addBinding(holder, 'v', { label });
  tip(b.element, tipText);
  const input = b.element.querySelector<HTMLElement>('.tp-lblv_v');
  if (input) input.style.display = 'none';
  const ed = new GradientEditor(asGradient(value), onChange);
  ed.el.style.padding = '2px 4px 4px 8px';
  ed.el.style.flexBasis = '100%';
  b.element.style.flexWrap = 'wrap';
  b.element.appendChild(ed.el);
}

/** Origin (pivot) of a part: two sliders and a picture of the shape to click on. */
function originRow(f: FolderApi, part: ThemePart, texture: string | undefined, touched: () => void) {
  const o = { x: pivotOf(part)[0], y: pivotOf(part)[1] };
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  c.style.cssText = 'width:72px;height:72px;margin:2px 0 4px 0;cursor:crosshair;border-radius:3px;' +
    'background:repeating-conic-gradient(#3a3a3a 0 25%,#2a2a2a 0 50%) 0 0/12px 12px';
  tip(c, 'Click (or drag) where the shape sits on the branch: it grows, flutters and turns about that point. Drawn pointing up, as on a branch going up.');
  const img = new Image();
  if (texture) img.src = texture;
  const paint = () => {
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 96, 96);
    if (texture && img.complete && img.naturalWidth) {
      const asp = Math.min(2, Math.max(0.3, img.naturalWidth / img.naturalHeight)), h = 84, w = Math.min(84, h * asp);
      ctx.drawImage(img, (96 - w) / 2, 6, w, h);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(18, 6, 60, 84);
      ctx.fillStyle = '#aaa';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(part.shape, 48, 50);
    }
    const px = 6 + o.x * 84, py = 90 - o.y * 84;
    ctx.strokeStyle = '#ff5ad0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px - 7, py); ctx.lineTo(px + 7, py); ctx.moveTo(px, py - 7); ctx.lineTo(px, py + 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.stroke();
  };
  img.onload = paint;
  const set = () => {
    part.pivot = [+o.x.toFixed(3), +o.y.toFixed(3)];
    paint();
    touched();
  };
  const bx = f.addBinding(o, 'x', { label: 'origin ←→', min: 0, max: 1, step: 0.01 });
  tip(bx.element, 'Across the shape: 0 = its left edge, 0.5 = the middle, 1 = its right edge.');
  const by = f.addBinding(o, 'y', { label: 'origin ↓↑', min: 0, max: 1, step: 0.01 });
  tip(by.element, 'Along the shape: 0 = its bottom (a stalk, like leaves), 0.5 = its middle (like blossoms), 1 = its top.');
  bx.on('change', set);
  by.on('change', set);
  const pick = (e: PointerEvent) => {
    const r = c.getBoundingClientRect();
    o.x = Math.min(1, Math.max(0, ((e.clientX - r.left) / r.width * 96 - 6) / 84));
    o.y = Math.min(1, Math.max(0, (90 - (e.clientY - r.top) / r.height * 96) / 84));
    bx.refresh();
    by.refresh();
    set();
  };
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    pick(e);
    const move = (ev: PointerEvent) => pick(ev);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', () => c.removeEventListener('pointermove', move), { once: true });
  });
  // Inside the row (tweakpane places later rows by index: a sibling element would shift them).
  const line = document.createElement('div');
  line.style.cssText = 'flex-basis:100%;display:flex;justify-content:flex-end;padding-right:4px';
  line.appendChild(c);
  by.element.style.flexWrap = 'wrap';
  by.element.appendChild(line);
  paint();
}

const newPart = (): ThemePart => ({ place: 'spaced', shape: 'leaf', size: 1, amount: 1, role: 'leaf', natural: '#52c757', colour: 'tint', glow: 1, flutter: 1, opens: 'always', sizeFrom: 'none' });

/** Shrink a picked image to at most 256 × 256 and return it as a PNG data URL. */
async function fileToTexture(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

const b64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function buildThemeEditor(container: HTMLElement, hooks: ThemeEditorHooks) {
  installTooltips(container);
  installSelectMenus(container);
  let pane: Pane | null = null;
  let current: ThemeDef = JSON.parse(JSON.stringify(themeDef('leaves')!));
  let editable = false;
  let status = 'Pick a theme, or start a new one.';

  const select = (id: string) => {
    const d = themeDef(id);
    if (!d) return;
    current = JSON.parse(JSON.stringify(d));
    editable = !isBuiltin(id);
    status = editable ? 'Edit the parts; Save keeps it in Sprout.exe.' : 'A built-in theme: Duplicate to make your own version.';
    show();
  };
  const show = () => {
    setDraft(editable ? current : null);
    hooks.preview(current.id);
    rebuild();
  };
  /** A value changed: update the preview only (the panel stays). */
  const touched = () => {
    if (editable) setDraft(current);
  };

  function rebuild() {
    pane?.dispose();
    pane = new Pane({ container, title: 'Sprouting Halo themes' });
    const p = pane;
    // Status line: plain text under the title (a readonly text field would scroll sideways).
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'color:#b8bec8;font:11px/1.4 system-ui,sans-serif;padding:4px 8px 6px;white-space:normal';
    statusEl.textContent = status;
    p.element.querySelector('.tp-rotv_c')?.prepend(statusEl);
    const setStatus = (s: string) => {
      status = s;
      statusEl.textContent = s;
    };

    // ---- Theme list ----
    const opts = allThemes().map((d) => ({ text: (isBuiltin(d.id) ? '' : '· ') + d.name, value: d.id }));
    if (!opts.some((o) => o.value === current.id)) opts.push({ text: '· ' + current.name + ' (not saved)', value: current.id });
    const list = p.addBlade({ view: 'list', label: 'theme', options: opts, value: current.id }) as unknown as { on(e: 'change', f: (ev: { value: string }) => void): void; element: HTMLElement };
    tip(list.element, 'Built-in themes first, then yours (·).');
    list.on('change', (ev) => select(ev.value));
    const row = (title: string, tipText: string, fn: () => void) => {
      const b = p.addButton({ title });
      tip(b.element.querySelector('button'), tipText);
      b.on('click', fn);
      return b;
    };
    row('New theme', 'Start an empty theme with one leaf part.', () => {
      const name = 'My theme ' + (allThemes().length - BUILTIN_IDS.length + 1);
      current = { id: uniqueId(name), name, version: 1, parts: [newPart()], textures: {} };
      editable = true;
      status = 'A new theme: give it a name, set its parts, then Save.';
      show();
    });
    row('Duplicate', 'Copy this theme as a new one of your own.', () => {
      const name = current.name + ' copy';
      current = { ...JSON.parse(JSON.stringify(current)), id: uniqueId(name), name };
      editable = true;
      status = 'A copy: change it, then Save.';
      show();
    });
    row('Import… (.json)', 'Load a theme file (exported from this page).', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          const d = JSON.parse(await f.text()) as ThemeDef;
          if (!Array.isArray(d.parts)) throw new Error();
          current = { ...d, version: 1, id: uniqueId(d.name || 'imported'), name: d.name || 'Imported' };
          editable = true;
          status = 'Imported: Save to keep it.';
          show();
        } catch {
          setStatus('That file is not a Sprout theme.');
        }
      };
      input.click();
    });

    if (!editable) {
      p.addBlade({ view: 'separator' });
      const parts = current.parts.map((x) => `${x.shape} (${x.place})`).join(', ') || 'no decorations';
      p.addBinding({ parts }, 'parts', { readonly: true, label: 'parts' });
      return;
    }

    // ---- Theme ----
    p.addBlade({ view: 'separator' });
    const nameRow = p.addBinding(current, 'name', { label: 'name' });
    tip(nameRow.element, 'The name shown in the theme lists.');
    nameRow.on('change', () => touched());
    p.addBinding({ id: current.id }, 'id', { readonly: true, label: 'file' });
    gradientRow(p, 'branch colour', current.branch?.natural ?? '#7a5a3a',
      'The branches\' own colour (one stop) or gradient, used when Look -> Colours -> Branches says "Theme colour".',
      (v) => {
        current.branch = { natural: v };
        touched();
      });

    current.parts.forEach((part, k) => {
      part.colour ??= 'tint';
      part.glow ??= 1;
      part.flutter ??= 1;
      part.opens ??= 'always';
      part.sizeFrom ??= 'none';
      part.move ??= 'Sparkle';
      const f = p.addFolder({ title: `Part ${k + 1}: ${part.shape.replace('tex:', '')}`, expanded: k === current.parts.length - 1 || current.parts.length <= 2 });
      const add = (key: keyof ThemePart, o: Record<string, unknown>, tipText: string, rebuildAfter = false) => {
        const v = (part as unknown as Record<string, unknown>)[key as string];
        const spec = typeof v === 'number' && typeof o.min === 'number' ? { min: o.min as number, max: o.max as number } : undefined;
        // Typed values may go past the slider (which stretches to hold them; never below 0).
        if (spec) o = { ...o, min: Math.min(spec.min, v as number), max: Math.max(spec.max, v as number) };
        const b = f.addBinding(part as unknown as Record<string, unknown>, key as string, o);
        if (spec) allowTypedBeyond(b as unknown as { element: HTMLElement; min: number; max: number }, 'theme.' + String(key), spec);
        tip(b.element, tipText);
        b.on('change', () => (rebuildAfter ? show() : touched()));
      };
      add('place', { label: 'where', options: PLACES }, 'Where on the branches this part grows.');
      const shapes: Record<string, string> = Object.fromEntries(BUILTIN_SHAPES.map((s) => [s, s]));
      for (const t of Object.keys(current.textures ?? {})) shapes['picture: ' + t] = 'tex:' + t;
      add('shape', { label: 'shape', options: shapes }, 'A built-in shape, or one of the pictures you loaded for this theme.', true);
      const load = f.addButton({ title: 'Load a picture (PNG)…' });
      tip(load.element.querySelector('button'), 'A PNG with transparency, drawn pointing UP (set where it sits on the branch with "origin"). White or grey pictures take their colour from the colour settings ("tint"); colourful ones can keep their own colours. Scaled to fit 256 × 256.');
      load.on('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/webp,image/*';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const url = await fileToTexture(file);
            const name = slug(file.name.replace(/\.[a-z0-9]+$/i, '')).slice(0, 24) || 'picture';
            current.textures = { ...(current.textures ?? {}), [name]: url };
            part.shape = 'tex:' + name;
            show();
          } catch {
            setStatus('Could not read that picture.');
          }
        };
        input.click();
      });
      originRow(f, part, current.textures?.[part.shape.slice(4)], touched);
      add('size', { label: 'size', min: 0.2, max: 3 }, 'Size compared with the built-in part in that place (1 = the same).');
      add('amount', { label: 'amount', min: 0, max: 2 }, 'How many, compared with the built-in part (1 = the same; the track\'s amount still applies).');
      add('role', { label: 'coloured as', options: { 'Leaves colour': 'leaf', 'Blossoms & berries colour': 'accent' } }, 'Which colour settings paint it (Look → Colours).');
      gradientRow(f, 'natural colour', part.natural, 'Its own colour (one stop) or gradient, used when the colour settings say "Theme colour". A gradient is spread over the parts as set in "colour movement".',
        (v) => {
          part.natural = v;
          touched();
        });
      add('move', { label: 'colour movement', options: Object.fromEntries(Object.keys(MOVES).map((k) => [k, k])) },
        'How a natural gradient is spread: Still (one colour), Root→tip, Flow (travels), Sparkle (each its own), Sing it (follows your pitch).');
      add('colour', { label: 'picture colours', options: { 'Tinted by the colour settings': 'tint', 'Keep the picture\'s own colours': 'own' } }, 'For pictures: tint a white/grey picture, or keep a colourful picture as it is (it still brightens and dims with the voice).');
      add('glow', { label: 'glow', min: 0, max: 3 }, 'How much it glows compared with leaves.');
      add('flutter', { label: 'flutter', min: 0, max: 1 }, 'How much it flutters in the wind (0 = rigid like a thorn, 1 = like a leaf).');
      add('opens', { label: 'opens', options: { Always: 'always', 'On long held notes (like blossoms)': 'bloom' } }, 'Always there, or only opening on long held notes.');
      add('sizeFrom', { label: 'grows with effort', options: { No: 'none', Yes: 'effort' } }, 'Grows bigger with vocal effort (like thorns).');
      const rm = f.addButton({ title: 'Remove this part' });
      rm.on('click', () => {
        current.parts.splice(k, 1);
        show();
      });
    });
    if (current.parts.length < 6) {
      const addPart = p.addButton({ title: '+ Add a part' });
      tip(addPart.element.querySelector('button'), 'Up to 6 parts: e.g. leaves, flowers at the tips, berries.');
      addPart.on('click', () => {
        current.parts.push(newPart());
        show();
      });
    }

    // ---- Save / use / export / delete ----
    p.addBlade({ view: 'separator' });
    row('Save', 'Keep this theme in Sprout.exe (themes folder next to it), so every viewer and OBS can use it.', () => {
      if (!hooks.connected()) return setStatus('Not connected to Sprout.exe: open this page from http://localhost:7777/themes with Sprout.exe running.');
      const text = JSON.stringify({ ...current, version: 1 });
      if (text.length > 1.9e6) return setStatus('Too big to save (over 2 MB): use fewer or smaller pictures.');
      hooks.send({ type: 'themeSave', id: current.id, data: b64(text) });
      setStatus(`Saved "${current.name}".`);
    });
    row('Use in viewer', 'Save, then make this the theme of every viewer and OBS (every track; "theme comes from" switches to this preset).', () => {
      if (!hooks.connected()) return setStatus('Not connected to Sprout.exe.');
      hooks.send({ type: 'themeSave', id: current.id, data: b64(JSON.stringify({ ...current, version: 1 })) });
      hooks.useInViewer(current.id);
      setStatus(`"${current.name}" is now the theme of every viewer.`);
    });
    row('Export (.json)', 'Download this theme as a file to share or back up.', () => {
      const blob = new Blob([JSON.stringify({ ...current, version: 1 }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sprout-theme-${current.id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    let armed = 0;
    const del = row('Delete', 'Delete this theme from Sprout.exe (asks for a second click).', () => {
      if (performance.now() > armed) {
        armed = performance.now() + 3000;
        del.title = 'Click again to delete';
        setTimeout(() => (del.title = 'Delete'), 3000);
        return;
      }
      if (!hooks.connected()) return setStatus('Not connected to Sprout.exe.');
      hooks.send({ type: 'themeDelete', id: current.id });
      select('leaves');
    });
  }

  const uniqueId = (name: string) => {
    const base = slug(name).slice(0, 34) || 'theme';
    let id = base, n = 2;
    while (isBuiltin(id) || allThemes().some((d) => d.id === id)) id = `${base}-${n++}`;
    return id;
  };

  select('leaves');
  return {
    /** The theme list changed (saved elsewhere): keep editing, refresh the list. */
    refresh: () => rebuild(),
  };
}
