// Keyboard shortcuts of the preview page, and the cheat sheet that "/" (or "?") shows.

export interface Hotkey {
  /** Shown in the sheet, e.g. "F". */
  key: string;
  /** What it does, shown in the sheet. */
  label: string;
  run(): void;
}

const keys: Hotkey[] = [];
let sheet: HTMLDivElement | null = null;

export function addHotkeys(list: Hotkey[]) {
  keys.push(...list);
}

/** The key letter of an action, for button labels and tooltips ("" when none). */
export const keyOf = (label: string) => keys.find((k) => k.label === label)?.key ?? '';

export function toggleSheet(show = !sheet || sheet.style.display === 'none') {
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'hotkeys';
    Object.assign(sheet.style, {
      position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: '1001',
      background: 'rgba(20,22,28,0.96)', color: '#e6e9ee', font: '13px/1.6 system-ui, sans-serif',
      padding: '14px 18px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)',
      boxShadow: '0 8px 28px rgba(0,0,0,0.5)', display: 'none', minWidth: '260px',
    } as CSSStyleDeclaration);
    sheet.addEventListener('click', () => toggleSheet(false));
    document.body.appendChild(sheet);
  }
  if (show) {
    const rows = keys.map((k) =>
      `<tr><td style="padding-right:14px"><kbd style="display:inline-block;min-width:18px;text-align:center;padding:0 5px;border:1px solid #666;border-radius:4px;background:#2a2d35;font:12px monospace">${k.key}</kbd></td><td>${k.label}</td></tr>`).join('');
    sheet.innerHTML = `<div style="font-weight:600;margin-bottom:6px">Keyboard shortcuts</div><table>${rows}</table>` +
      `<div style="margin-top:8px;color:#9aa0aa;font-size:12px">/ or Esc closes this</div>`;
  }
  sheet.style.display = show ? 'block' : 'none';
}

/** Listen for the keys (ignored while typing in a text field). */
export function installHotkeys() {
  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/' || e.key === '?') {
      e.preventDefault();
      toggleSheet();
      return;
    }
    if (e.key === 'Escape' && sheet && sheet.style.display !== 'none') {
      toggleSheet(false);
      return;
    }
    const k = keys.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (k) {
      e.preventDefault();
      k.run();
    }
  });
}
