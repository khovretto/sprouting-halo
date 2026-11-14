// Scope: rolling graphs of what the voice is doing and how the visuals read it, so the numbers in
// the panel can be followed over time instead of in the moment. Preview only (never in OBS).
//
// Toggle with G or Scene → showScope. Click the scope to freeze it; hover to read values at any
// moment. One layer at a time (Scene → scopeLayer: 0 = the live halo, 1.. = takes).
//
// Each lane shows a raw value from the tap (thin, dim) next to what the viewer makes of it (bold),
// so it is visible how smoothing, gates and envelopes shape the response.

export interface Series {
  key: string;
  label: string;
  colour: string;
  /** Drawn thin and dim: a raw input. */
  raw?: boolean;
  /** Steps instead of a line (on/off values). */
  step?: boolean;
}

export interface Lane {
  title: string;
  min: number;
  max: number;
  series: Series[];
  /** Horizontal reference lines, with labels. */
  guides?: { v: number; label: string }[];
  /** Value formatting in the readout. */
  fmt?: (key: string, v: number) => string;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => {
  if (m <= 0) return '–';
  const n = Math.round(m);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
};

export const LANES: Lane[] = [
  {
    title: 'Loudness',
    min: 0, max: 1,
    series: [
      { key: 'level', label: 'level (tap)', colour: '#9fb4c8', raw: true },
      { key: 'energy', label: 'energy (glow, bright)', colour: '#ffd166' },
      { key: 'slow', label: 'slow (sway)', colour: '#ef8a62' },
    ],
    guides: [{ v: 0.05, label: 'voice gate' }],
  },
  {
    title: 'Pitch',
    min: 40, max: 92,
    series: [
      { key: 'midi', label: 'pitch (tap)', colour: '#9fb4c8', raw: true },
      { key: 'pitchHeld', label: 'held (steer, shine)', colour: '#7bdff2' },
    ],
    guides: [48, 60, 72, 84].map((m) => ({ v: m, label: noteName(m) })),
    fmt: (_k, v) => (v > 0 ? `${noteName(v)} ${v.toFixed(1)}` : '–'),
  },
  {
    title: 'Voice quality',
    min: 0, max: 1,
    series: [
      { key: 'effortRaw', label: 'effort (tap)', colour: '#c3a6ff', raw: true },
      { key: 'effort', label: 'effort (width, thorns)', colour: '#b388ff' },
      { key: 'breath', label: 'breath', colour: '#80cbc4' },
      { key: 'softness', label: 'softness (droop, glow)', colour: '#f48fb1' },
    ],
    guides: [{ v: 0.5, label: 'neutral' }],
  },
  {
    title: 'Vibrato',
    min: 0, max: 1,
    series: [
      { key: 'vibRaw', label: 'depth (tap)', colour: '#9fb4c8', raw: true },
      { key: 'vib', label: 'depth (shiver)', colour: '#a5d6a7' },
      { key: 'vibRate', label: 'rate / 10 Hz', colour: '#ffcc80', step: true },
    ],
    fmt: (k, v) => (k === 'vibRate' ? `${(v * 10).toFixed(1)} Hz` : v.toFixed(2)),
  },
  {
    title: 'Onsets & phrase',
    min: 0, max: 1,
    series: [
      { key: 'flash', label: 'onset flash', colour: '#ffffff' },
      { key: 'voice', label: 'singing', colour: '#66bb6a', step: true },
      { key: 'phraseOn', label: 'in a phrase', colour: '#42a5f5', step: true },
    ],
  },
  {
    title: 'Growth',
    min: 0, max: 1,
    series: [
      { key: 'open', label: 'open / reveal', colour: '#2fb84f' },
      { key: 'wither', label: 'wither', colour: '#ff8a65' },
      { key: 'alpha', label: 'tree brightness', colour: '#e0e0e0' },
    ],
  },
];

const CAP = 60 * 40; // samples kept (40 s at 60 fps)

export class Scope {
  private t = new Float64Array(CAP);
  private data = new Map<string, Float32Array>();
  private events: { t: number; kind: 'phrase' | 'onset' | 'dip' }[] = [];
  private head = 0;
  private count = 0;
  private frozen = false;
  private hoverX = -1;
  private hoverY = -1;
  private ctx: CanvasRenderingContext2D;
  private buttons: { x: number; y: number; w: number; h: number; label: string; tip: string; act: () => void }[] = [];
  title = '';
  /** Names of the layers the scope can follow (0 = live halo, then takes). */
  layers: string[] = [];
  selected = 0;
  onSelect?: (k: number) => void;
  onSeconds?: (delta: number) => void;
  onClose?: () => void;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (const lane of LANES) for (const s of lane.series) this.data.set(s.key, new Float32Array(CAP));
    const at = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const hit = (x: number, y: number) => this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    canvas.addEventListener('click', (e) => {
      const [x, y] = at(e);
      const b = hit(x, y);
      if (b) b.act();
      else if (y > 26) this.frozen = !this.frozen;
    });
    canvas.addEventListener('mousemove', (e) => {
      [this.hoverX, this.hoverY] = at(e);
      canvas.style.cursor = hit(this.hoverX, this.hoverY) ? 'pointer' : 'crosshair';
    });
    canvas.addEventListener('mouseleave', () => (this.hoverX = this.hoverY = -1));
  }

  private pick(delta: number) {
    const n = Math.max(1, this.layers.length);
    this.onSelect?.((((this.selected + delta) % n) + n) % n);
  }

  /** Forget everything (the selected layer changed). */
  clear() {
    this.count = 0;
    this.events = [];
  }

  push(time: number, values: Record<string, number>, ev: { phrase?: boolean; onset?: boolean; dip?: boolean }) {
    if (this.frozen) return;
    this.t[this.head] = time;
    for (const [k, arr] of this.data) arr[this.head] = values[k] ?? NaN;
    this.head = (this.head + 1) % CAP;
    this.count = Math.min(CAP, this.count + 1);
    if (ev.phrase) this.events.push({ t: time, kind: 'phrase' });
    if (ev.onset) this.events.push({ t: time, kind: 'onset' });
    if (ev.dip) this.events.push({ t: time, kind: 'dip' });
    const oldest = this.t[(this.head - this.count + CAP) % CAP];
    while (this.events.length && this.events[0].t < oldest) this.events.shift();
  }

  draw(seconds: number) {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(320, Math.min(980, window.innerWidth - 340));
    const laneH = 58, header = 28;
    const cssH = header + LANES.length * laneH + 6;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = 'rgba(12,12,16,0.86)';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';

    const labelW = 112, readW = 250;
    const x0 = labelW, x1 = cssW - readW;
    const now = this.count ? this.t[(this.head - 1 + CAP) % CAP] : 0;
    const tMin = now - seconds;
    const X = (tt: number) => x0 + ((tt - tMin) / seconds) * (x1 - x0);
    const hoverT = this.hoverX >= x0 && this.hoverX <= x1 ? tMin + ((this.hoverX - x0) / (x1 - x0)) * seconds : NaN;

    // Header: layer switcher on the left, window / freeze / close on the right. Hovering a button
    // shows what it does.
    this.buttons = [];
    const btn = (x: number, w: number, label: string, tipText: string, act: () => void, on = false) => {
      const b = { x, y: 4, w, h: 19, label, tip: tipText, act };
      this.buttons.push(b);
      const hov = this.hoverX >= b.x && this.hoverX <= b.x + b.w && this.hoverY >= b.y && this.hoverY <= b.y + b.h;
      ctx.fillStyle = on ? 'rgba(143,208,255,0.35)' : hov ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#e6e9ee';
      ctx.textAlign = 'center';
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      ctx.textAlign = 'left';
      return b;
    };
    btn(6, 22, '◀', 'Previous layer (live halo, then each take)', () => this.pick(-1));
    btn(30, 22, '▶', 'Next layer', () => this.pick(1));
    const n = this.layers.length;
    const label = `${this.title}${n > 1 ? `   (${this.selected + 1} of ${n})` : ''}`;
    btn(56, Math.min(300, ctx.measureText(label).width + 16), label, 'Following this layer. Click for the next one.', () => this.pick(1));
    let rx = cssW - 6;
    const right = (w: number, l: string, tipText: string, act: () => void, on = false) => btn((rx -= w + 4), w, l, tipText, act, on);
    right(22, '×', 'Close the scope (G opens it again)', () => this.onClose?.());
    right(64, this.frozen ? '▶ live' : '❚❚ freeze', this.frozen ? 'Resume: follow the voice again' : 'Freeze the graphs to study them (or click anywhere on the graphs)', () => (this.frozen = !this.frozen), this.frozen);
    right(22, '+', 'Show more history', () => this.onSeconds?.(+4));
    right(46, `${seconds.toFixed(0)} s`, 'Seconds of history shown', () => this.onSeconds?.(+4));
    right(22, '−', 'Show less history (zoom in)', () => this.onSeconds?.(-4));
    // Time grid: one line per second.
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let s = Math.ceil(tMin); s <= now; s++) {
      ctx.beginPath();
      ctx.moveTo(X(s), header);
      ctx.lineTo(X(s), cssH - 4);
      ctx.stroke();
    }
    // Phrase starts across all lanes.
    for (const e of this.events) {
      if (e.t < tMin || e.kind !== 'phrase') continue;
      ctx.strokeStyle = 'rgba(66,165,245,0.6)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(X(e.t), header);
      ctx.lineTo(X(e.t), cssH - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Index of the sample nearest the hover time.
    let hoverIdx = -1;
    if (!isNaN(hoverT)) {
      let best = Infinity;
      for (let k = 0; k < this.count; k++) {
        const i = (this.head - 1 - k + CAP) % CAP;
        const d = Math.abs(this.t[i] - hoverT);
        if (d < best) {
          best = d;
          hoverIdx = i;
        }
        if (this.t[i] < hoverT - 0.5) break;
      }
    }

    LANES.forEach((lane, li) => {
      const top = header + li * laneH, bot = top + laneH - 8;
      const Y = (v: number) => bot - ((v - lane.min) / (lane.max - lane.min)) * (bot - top);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(x0, top, x1 - x0, bot - top);
      ctx.fillStyle = '#bbb';
      ctx.fillText(lane.title, 8, top + 8);
      for (const g of lane.guides ?? []) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, Y(g.v));
        ctx.lineTo(x1, Y(g.v));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.textAlign = 'right';
        ctx.fillText(g.label, x0 - 4, Y(g.v));
        ctx.textAlign = 'left';
      }
      // Onset ticks and pitch dips in their lanes.
      if (lane.title === 'Onsets & phrase' || lane.title === 'Pitch')
        for (const e of this.events) {
          if (e.t < tMin) continue;
          if (e.kind === 'onset' && lane.title === 'Onsets & phrase') {
            ctx.strokeStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(X(e.t), top);
            ctx.lineTo(X(e.t), top + 8);
            ctx.stroke();
          } else if (e.kind === 'dip' && lane.title === 'Pitch') {
            ctx.fillStyle = '#ff8a65';
            ctx.fillText('▼', X(e.t) - 4, top + 6);
          }
        }

      lane.series.forEach((s, si) => {
        const arr = this.data.get(s.key)!;
        ctx.strokeStyle = s.colour;
        ctx.globalAlpha = s.raw ? 0.55 : 1;
        ctx.lineWidth = s.raw ? 1 : 1.8;
        ctx.beginPath();
        let pen = false, lastY = 0;
        for (let k = this.count - 1; k >= 0; k--) {
          const i = (this.head - 1 - k + CAP) % CAP;
          if (this.t[i] < tMin) continue;
          const v = arr[i];
          if (isNaN(v) || (lane.title === 'Pitch' && v <= 0)) {
            pen = false;
            continue;
          }
          const x = X(this.t[i]), y = Y(Math.min(lane.max, Math.max(lane.min, v)));
          if (!pen) ctx.moveTo(x, y);
          else if (s.step) {
            ctx.lineTo(x, lastY);
            ctx.lineTo(x, y);
          } else ctx.lineTo(x, y);
          pen = true;
          lastY = y;
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        // Readout: value now (or at the hover point).
        const idx = hoverIdx >= 0 ? hoverIdx : (this.head - 1 + CAP) % CAP;
        const v = this.count ? arr[idx] : NaN;
        const txt = isNaN(v) ? '–' : lane.fmt ? lane.fmt(s.key, v) : v.toFixed(2);
        ctx.fillStyle = s.colour;
        ctx.fillText(`${s.label}`, x1 + 8, top + 6 + si * 12);
        ctx.fillStyle = '#eee';
        ctx.textAlign = 'right';
        ctx.fillText(txt, cssW - 6, top + 6 + si * 12);
        ctx.textAlign = 'left';
      });
    });

    // Button tip, just below the header.
    const hb = this.buttons.find((b) => this.hoverX >= b.x && this.hoverX <= b.x + b.w && this.hoverY >= b.y && this.hoverY <= b.y + b.h);
    if (hb) {
      const w = ctx.measureText(hb.tip).width + 14;
      const x = Math.min(cssW - w - 4, Math.max(4, hb.x + hb.w / 2 - w / 2));
      ctx.fillStyle = 'rgba(30,33,40,0.97)';
      ctx.fillRect(x, header + 2, w, 20);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.strokeRect(x + 0.5, header + 2.5, w - 1, 19);
      ctx.fillStyle = '#e6e9ee';
      ctx.fillText(hb.tip, x + 7, header + 12.5);
    } else if (this.hoverY > header && this.hoverX >= 0 && this.hoverX < x0) {
      const t = 'Thin lines: what the tap sends. Bold: what the viewer makes of it. Hover the graphs to read any moment.';
      ctx.fillStyle = 'rgba(30,33,40,0.97)';
      ctx.fillRect(4, header + 2, ctx.measureText(t).width + 14, 20);
      ctx.fillStyle = '#e6e9ee';
      ctx.fillText(t, 11, header + 12.5);
    }

    if (hoverIdx >= 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(this.hoverX, header);
      ctx.lineTo(this.hoverX, cssH - 4);
      ctx.stroke();
      ctx.fillStyle = '#ddd';
      ctx.textAlign = 'right';
      ctx.fillText(`${(this.t[hoverIdx] - now).toFixed(2)} s`, this.hoverX - 6, header + 10);
      ctx.textAlign = 'left';
    }
  }
}
