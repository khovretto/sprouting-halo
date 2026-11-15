// Gradient picker (docs/fable-consult-5-colour-themes-panel.md, B.3 / B.4). A bar that always
// shows the gradient; click it to open the editor below:
//  - click the bar or the empty track: a new stop there (in the colour the gradient has there)
//  - drag a stop sideways (Shift snaps to 0.05); drag it down, right-click or Delete removes it
//  - arrows move the focused stop by 0.01 (Shift 0.1)
//  - Smooth / Linear / Steps, Loop, Reverse, Spread, presets (built-in and saved)
//  - the selected stop: colour (inline picker, works in OBS's Interact window), position, or the
//    take colour itself
//  - the text of the gradient, with Copy / Paste (the text field works where the clipboard is blocked)

import { Pane } from 'tweakpane';
import { bakeGradient, formatGradient, Gradient, GRADIENT_PRESETS, parseGradient, Stop } from './gradient';
import { hexToRgb } from './math';
import { tip } from './tooltip';

const SAVED_KEY = 'sprout.viewer.gradients.v1';

const CSS = `
.sprout-grad { width: 100%; }
.sprout-grad-bar { position: static !important; inset: auto !important; display: block; width: 100% !important; height: 18px !important; border-radius: 3px; cursor: pointer; image-rendering: auto;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.15); }
.sprout-grad-track { position: relative; height: 14px; margin: 1px 0 2px; cursor: copy; }
.sprout-grad-stop { position: absolute; top: 0; width: 10px; height: 13px; margin-left: -5px; padding: 0; border: 1px solid #ddd;
  border-radius: 2px 2px 5px 5px; cursor: ew-resize; box-shadow: 0 1px 2px rgba(0,0,0,0.6); }
.sprout-grad-stop.sel { border: 2px solid #8fd0ff; width: 12px; margin-left: -6px; }
.sprout-grad-stop.take { background: transparent !important; box-shadow: inset 0 0 0 2px #fff, 0 1px 2px rgba(0,0,0,0.6); }
.sprout-grad-stop.removing { opacity: 0.35; }
.sprout-grad-body { padding: 4px 0 2px; font: 11px system-ui, sans-serif; color: #ccc; }
.sprout-grad-row { display: flex; gap: 4px; align-items: center; margin: 3px 0; flex-wrap: wrap; }
.sprout-grad-row button, .sprout-grad-row select, .sprout-grad-row input { font: 11px system-ui, sans-serif; color: #ddd;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); border-radius: 3px; padding: 2px 5px; }
.sprout-grad-row button.on { background: rgba(143,208,255,0.3); }
.sprout-grad-row input[type=text] { flex: 1; min-width: 0; font-family: ui-monospace, Consolas, monospace; }
.sprout-grad-row input[type=number] { width: 52px; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', tipText?: string) => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (tipText) tip(e, tipText);
  return e;
};

function loadSaved(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export class GradientEditor {
  readonly el = el('div');
  private g: Gradient;
  private sel = 0;
  private bar = el('canvas');
  private track = el('div');
  private body = el('div');
  private text = el('input');
  private interpSel = el('select');
  private loopBtn = el('button', 'Loop', 'The end blends back into the start, so travelling colours never jump.');
  private presetSel = el('select');
  private pos = el('input');
  private takeBox = el('input');
  private picker: Pane;
  private pick = { colour: '#ffffff' };
  private suppress = false;

  constructor(value: string, private onChange: (v: string) => void, private take = '#b5e61d') {
    if (!document.getElementById('sprout-grad-css')) {
      const st = el('style');
      st.id = 'sprout-grad-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.g = parseGradient(value);
    this.el.className = 'sprout-grad';
    this.bar.className = 'sprout-grad-bar';
    this.bar.width = 256;
    this.bar.height = 1;
    tip(this.bar, 'Click to edit the gradient; when open, click to add a colour stop there.');
    this.track.className = 'sprout-grad-track';
    this.body.className = 'sprout-grad-body';
    this.body.hidden = true;
    this.el.append(this.bar, this.track, this.body);
    this.track.hidden = true;
    this.bar.addEventListener('click', (e) => {
      if (this.body.hidden) this.open(true);
      else this.addAt(this.posOf(e));
    });
    this.track.addEventListener('pointerdown', (e) => {
      if (e.target === this.track) this.addAt(this.posOf(e));
    });

    // Toolbar.
    const row1 = el('div');
    row1.className = 'sprout-grad-row';
    for (const [label, v] of [['Smooth', 'ok'], ['Linear', 'rgb'], ['Steps', 'step']]) {
      const o = el('option', label);
      o.value = v;
      this.interpSel.appendChild(o);
    }
    tip(this.interpSel, 'Smooth: blends through clean colours (OKLab). Linear: plain RGB blend. Steps: hard bands, like a palette.');
    this.interpSel.addEventListener('change', () => {
      this.g.interp = this.interpSel.value as Gradient['interp'];
      this.commit();
    });
    this.loopBtn.addEventListener('click', () => {
      this.g.loop = !this.g.loop;
      this.commit();
    });
    const rev = el('button', 'Reverse', 'Mirror the gradient.');
    rev.addEventListener('click', () => {
      for (const s of this.g.stops) s.pos = +(1 - s.pos).toFixed(3);
      this.commit();
    });
    const spread = el('button', 'Spread', 'Space the colour stops evenly.');
    spread.addEventListener('click', () => {
      const n = this.g.stops.length;
      this.g.stops.sort((a, b) => a.pos - b.pos).forEach((s, i) => (s.pos = n === 1 ? 0 : +(i / (this.g.loop ? n : n - 1)).toFixed(3)));
      this.commit();
    });
    tip(this.presetSel, 'Built-in gradients, your saved ones, or save this one.');
    this.presetSel.addEventListener('change', () => this.choosePreset());
    row1.append(this.interpSel, this.loopBtn, rev, spread, this.presetSel);

    // Selected stop.
    const row2 = el('div');
    row2.className = 'sprout-grad-row';
    this.pos.type = 'number';
    this.pos.step = '0.01';
    this.pos.min = '0';
    this.pos.max = '1';
    tip(this.pos, 'Position of the selected colour stop (0 = start, 1 = end).');
    this.pos.addEventListener('change', () => {
      const s = this.g.stops[this.sel];
      s.pos = Math.min(1, Math.max(0, +this.pos.value || 0));
      this.commit();
    });
    this.takeBox.type = 'checkbox';
    const takeLabel = el('label', ' take colour', 'This stop is the take\'s own colour (each take its own).');
    takeLabel.prepend(this.takeBox);
    this.takeBox.addEventListener('change', () => {
      const s = this.g.stops[this.sel];
      s.col = this.takeBox.checked ? 't' : this.pick.colour.slice(1).toLowerCase();
      this.commit();
    });
    const del = el('button', 'Remove', 'Remove the selected colour stop (also: drag it down, right-click it, or Delete).');
    del.addEventListener('click', () => this.remove(this.g.stops[this.sel]));
    row2.append(el('span', 'stop'), this.pos, takeLabel, del);

    // Colour picker for the selected stop.
    const pickHost = el('div');
    this.picker = new Pane({ container: pickHost });
    this.picker
      .addBinding(this.pick, 'colour', { view: 'color', picker: 'inline', expanded: true, label: 'colour' })
      .on('change', (ev) => {
        if (this.suppress) return;
        const s = this.g.stops[this.sel];
        if (!s) return;
        s.col = String(ev.value).slice(1, 7).toLowerCase();
        this.commit(false);
      });

    // Text, copy, paste.
    const row3 = el('div');
    row3.className = 'sprout-grad-row';
    this.text.type = 'text';
    tip(this.text, 'The gradient as text: copy it to another colour, a preset or a friend. Edit it here and press Enter.');
    this.text.addEventListener('change', () => this.set(this.text.value, true));
    const copy = el('button', 'Copy', 'Copy the gradient text.');
    copy.addEventListener('click', () => void navigator.clipboard?.writeText(this.text.value).catch(() => this.text.select()));
    const paste = el('button', 'Paste', 'Paste a gradient text (or paste into the text field).');
    paste.addEventListener('click', async () => {
      try {
        const v = await navigator.clipboard.readText();
        if (v) this.set(v, true);
      } catch {
        this.text.focus();
        this.text.select();
      }
    });
    const close = el('button', 'Close', 'Fold the editor away (the bar stays).');
    close.addEventListener('click', () => this.open(false));
    row3.append(this.text, copy, paste, close);

    this.body.append(row1, row2, pickHost, row3);
    this.fillPresets();
    this.render();
  }

  /** From outside (sync, revert, preset): show a new value without reporting a change. */
  set(value: string, fire = false) {
    if (!fire && value === formatGradient(this.g)) return;
    this.g = parseGradient(value);
    this.sel = Math.min(this.sel, this.g.stops.length - 1);
    this.render();
    if (fire) this.onChange(formatGradient(this.g));
  }

  setTake(hex: string) {
    if (hex === this.take) return;
    this.take = hex;
    this.paint();
  }

  private open(on: boolean) {
    this.body.hidden = !on;
    this.track.hidden = !on;
  }

  private posOf(e: MouseEvent) {
    const r = this.bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  private colourAt(pos: number) {
    const { lut } = bakeGradient(formatGradient(this.g), hexToRgb(this.take));
    const i = Math.min(255, Math.floor(pos * 256)) * 3;
    return [0, 1, 2].map((k) => Math.round(lut[i + k] * 255).toString(16).padStart(2, '0')).join('');
  }

  private addAt(pos: number) {
    if (this.g.stops.length >= 12) return;
    const stop = { pos: +pos.toFixed(3), col: this.colourAt(pos) };
    this.g.stops.push(stop);
    this.g.stops.sort((a, b) => a.pos - b.pos);
    this.sel = this.g.stops.indexOf(stop);
    this.commit();
  }

  private remove(s: Stop | undefined) {
    if (!s || this.g.stops.length <= 1) return;
    this.g.stops.splice(this.g.stops.indexOf(s), 1);
    this.sel = Math.min(this.sel, this.g.stops.length - 1);
    this.commit();
  }

  private commit(rebuild = true) {
    const keep = this.g.stops[this.sel];
    this.g.stops.sort((a, b) => a.pos - b.pos);
    this.sel = Math.max(0, this.g.stops.indexOf(keep));
    if (rebuild) this.render();
    else this.paint();
    this.onChange(formatGradient(this.g));
  }

  private paint() {
    const { lut } = bakeGradient(formatGradient(this.g), hexToRgb(this.take));
    const ctx = this.bar.getContext('2d')!, img = ctx.createImageData(256, 1);
    for (let i = 0; i < 256; i++) {
      img.data[i * 4] = lut[i * 3] * 255;
      img.data[i * 4 + 1] = lut[i * 3 + 1] * 255;
      img.data[i * 4 + 2] = lut[i * 3 + 2] * 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.text.value = formatGradient(this.g);
  }

  private render() {
    this.paint();
    this.interpSel.value = this.g.interp;
    this.loopBtn.classList.toggle('on', this.g.loop);
    this.track.replaceChildren(...this.g.stops.map((s, i) => {
      const h = el('button');
      h.className = 'sprout-grad-stop' + (i === this.sel ? ' sel' : '') + (s.col === 't' ? ' take' : '');
      h.style.left = `${s.pos * 100}%`;
      h.style.background = s.col === 't' ? 'transparent' : '#' + s.col;
      tip(h, 'Drag to move (Shift snaps), drag down or right-click to remove, click to edit its colour.');
      h.addEventListener('pointerdown', (e) => this.drag(e, s, h));
      h.addEventListener('keydown', (e) => this.key(e, s));
      h.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.remove(s);
      });
      return h;
    }));
    const cur = this.g.stops[this.sel];
    this.pos.value = String(+cur.pos.toFixed(3));
    this.takeBox.checked = cur.col === 't';
    this.suppress = true;
    this.pick.colour = cur.col === 't' ? this.take : '#' + cur.col;
    this.picker.refresh();
    this.suppress = false;
  }

  private drag(e: PointerEvent, s: Stop, h: HTMLElement) {
    e.preventDefault();
    if (this.sel !== this.g.stops.indexOf(s)) {
      this.sel = this.g.stops.indexOf(s);
      this.render();
      h = this.track.children[this.sel] as HTMLElement;
    }
    h.focus();
    h.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 2) moved = true;
      if (!moved) return;
      let pos = this.posOf(ev);
      if (ev.shiftKey) pos = Math.round(pos * 20) / 20;
      s.pos = +pos.toFixed(3);
      h.style.left = `${pos * 100}%`;
      h.classList.toggle('removing', ev.clientY - y0 > 30 && this.g.stops.length > 1);
      this.paint();
      this.onChange(formatGradient(this.g));
    };
    const up = (ev: PointerEvent) => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      if (ev.clientY - y0 > 30) this.remove(s);
      else this.commit();
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
  }

  private key(e: KeyboardEvent, s: Stop) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.remove(s);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
      s.pos = +Math.min(1, Math.max(0, s.pos + d)).toFixed(3);
      this.commit();
      (this.track.children[this.sel] as HTMLElement | undefined)?.focus();
    }
  }

  private fillPresets() {
    const saved = loadSaved();
    this.presetSel.replaceChildren();
    const add = (text: string, value: string, disabled = false) => {
      const o = el('option', text);
      o.value = value;
      o.disabled = disabled;
      this.presetSel.appendChild(o);
    };
    add('Presets…', '', true);
    for (const name of Object.keys(GRADIENT_PRESETS)) add(name, 'b:' + name);
    for (const name of Object.keys(saved)) add('· ' + name, 's:' + name);
    add('Save current…', 'save');
    if (Object.keys(saved).length) add('Delete a saved one…', 'delete');
    this.presetSel.value = '';
  }

  private choosePreset() {
    const v = this.presetSel.value;
    this.presetSel.value = '';
    const saved = loadSaved();
    if (v.startsWith('b:')) this.set(GRADIENT_PRESETS[v.slice(2)], true);
    else if (v.startsWith('s:') && saved[v.slice(2)]) this.set(saved[v.slice(2)], true);
    else if (v === 'save') {
      const name = (prompt('Name for this gradient:') ?? '').trim().slice(0, 32);
      if (name) {
        saved[name] = formatGradient(this.g);
        localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
      }
    } else if (v === 'delete') {
      const name = (prompt('Delete which saved gradient? ' + Object.keys(saved).join(', ')) ?? '').trim();
      if (name && saved[name]) {
        delete saved[name];
        localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
      }
    }
    this.fillPresets();
  }
}
