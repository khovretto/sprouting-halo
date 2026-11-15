// Dropdowns for OBS's "Interact" window: OBS's browser source cannot open the native <select>
// popup, so inside OBS (window.obsstudio) every <select> in the panel opens this menu instead.
// `?customSelect` forces it in a normal browser (testing).

let menu: HTMLDivElement | null = null;
let owner: HTMLSelectElement | null = null;

function close() {
  if (menu) menu.style.display = 'none';
  owner = null;
}

function open(sel: HTMLSelectElement) {
  if (!menu) {
    menu = document.createElement('div');
    Object.assign(menu.style, {
      position: 'fixed', zIndex: '1002', overflowY: 'auto', padding: '3px 0', borderRadius: '5px',
      background: 'rgba(28,30,36,0.98)', border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: '0 6px 18px rgba(0,0,0,0.5)', font: '12px/1.2 system-ui, sans-serif', color: '#e6e9ee',
    } as CSSStyleDeclaration);
    document.body.appendChild(menu);
    // Close on any click elsewhere, Escape or scrolling the panel.
    document.addEventListener('mousedown', (e) => {
      if (menu && owner && !menu.contains(e.target as Node) && e.target !== owner) close();
    }, true);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    window.addEventListener('wheel', (e) => {
      if (menu && !menu.contains(e.target as Node)) close();
    }, { passive: true });
  }
  owner = sel;
  const m = menu;
  m.replaceChildren();
  [...sel.options].forEach((o, i) => {
    const item = document.createElement('div');
    item.textContent = o.textContent;
    const on = i === sel.selectedIndex;
    Object.assign(item.style, {
      padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
      background: on ? 'rgba(143,208,255,0.25)' : 'transparent',
    } as CSSStyleDeclaration);
    item.addEventListener('mouseenter', () => (item.style.background = 'rgba(255,255,255,0.12)'));
    item.addEventListener('mouseleave', () => (item.style.background = on ? 'rgba(143,208,255,0.25)' : 'transparent'));
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      if (sel.selectedIndex !== i) {
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    m.appendChild(item);
  });
  const r = sel.getBoundingClientRect();
  m.style.display = 'block';
  m.style.minWidth = `${Math.round(r.width)}px`;
  const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
  const h = Math.min(m.scrollHeight, Math.max(below, above));
  m.style.maxHeight = `${Math.round(h)}px`;
  m.style.left = `${Math.round(Math.min(r.left, window.innerWidth - m.offsetWidth - 6))}px`;
  m.style.top = `${Math.round(below >= Math.min(m.scrollHeight, 160) || below >= above ? r.bottom + 2 : r.top - h - 2)}px`;
}

/** Use the custom menu for every <select> inside root (only where the native popup fails). */
export function installSelectMenus(root: HTMLElement) {
  const inObs = typeof (window as unknown as { obsstudio?: unknown }).obsstudio !== 'undefined';
  if (!inObs && !new URLSearchParams(location.search).has('customSelect')) return;
  root.addEventListener('mousedown', (e) => {
    const sel = (e.target as HTMLElement).closest('select');
    if (!sel || !root.contains(sel)) return;
    e.preventDefault(); // no native popup (it would not open in OBS anyway)
    if (owner === sel) close();
    else open(sel as HTMLSelectElement);
  }, true);
}
