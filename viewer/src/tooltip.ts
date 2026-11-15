// Panel tooltips: one shared box, quick to appear (300 ms; instant while moving between rows),
// placed beside the panel so it never covers the control being used. Any element with
// `data-tip` gets one; set it with tip(el, text).

const DELAY = 300;
const WARM = 600; // after a tip was shown, the next one appears at once for this long

let box: HTMLDivElement | null = null;
let current: HTMLElement | null = null;
let timer = 0;
let lastHide = -1e9;

export function tip(el: Element | null | undefined, text: string | undefined) {
  if (!el) return;
  const h = el as HTMLElement;
  if (text) h.dataset.tip = text;
  else delete h.dataset.tip;
  h.removeAttribute('title');
  if (current === h && box && box.style.display !== 'none') box.textContent = text ?? '';
}

function ensureBox() {
  if (box) return box;
  box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', zIndex: '1000', maxWidth: '360px', padding: '6px 8px', borderRadius: '5px',
    background: 'rgba(20,22,28,0.97)', color: '#e6e9ee', font: '12px/1.4 system-ui, sans-serif',
    boxShadow: '0 4px 14px rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.12)',
    pointerEvents: 'none', display: 'none', whiteSpace: 'pre-line',
  } as CSSStyleDeclaration);
  document.body.appendChild(box);
  return box;
}

function show(el: HTMLElement) {
  const b = ensureBox();
  b.textContent = el.dataset.tip ?? '';
  b.style.display = 'block';
  const r = el.getBoundingClientRect();
  const w = b.offsetWidth, h = b.offsetHeight;
  // Left of the hovered row when there is room (the panel sits at the right edge), else below it.
  let x = r.left - w - 10, y = r.top + r.height / 2 - h / 2;
  if (x < 6) {
    x = Math.min(window.innerWidth - w - 6, Math.max(6, r.left));
    y = r.bottom + 6;
    if (y + h > window.innerHeight - 6) y = r.top - h - 6;
  }
  b.style.left = `${Math.round(x)}px`;
  b.style.top = `${Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, y)))}px`;
}

function hide() {
  clearTimeout(timer);
  if (box && box.style.display !== 'none') {
    box.style.display = 'none';
    lastHide = performance.now();
  }
  current = null;
}

/** Tooltips for every [data-tip] element inside root. */
export function installTooltips(root: HTMLElement) {
  root.addEventListener('pointerover', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (el === current) return;
    hide();
    if (!el || !root.contains(el)) return;
    current = el;
    const warm = performance.now() - lastHide < WARM;
    timer = window.setTimeout(() => current === el && show(el), warm ? 0 : DELAY);
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('pointerdown', hide);
  root.addEventListener('wheel', hide, { passive: true });
}
