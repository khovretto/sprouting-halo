// Your own avatar picture for the preview (in place of the grey placeholder): a PNG with alpha,
// kept in this browser's IndexedDB (too large for settings sync or localStorage). Never shown in
// OBS, where VTube Studio draws the real avatar.

const DB = 'sprout-viewer', STORE = 'files', KEY = 'avatar';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function toImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Not an image'));
    img.src = URL.createObjectURL(blob);
  });
}

/** The saved picture, or null. */
export async function loadAvatarImage(): Promise<HTMLImageElement | null> {
  try {
    const blob = await run<Blob | undefined>('readonly', (s) => s.get(KEY));
    return blob ? await toImage(blob) : null;
  } catch {
    return null;
  }
}

/** Ask for a file, keep it, and return it. */
export function pickAvatarImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/webp,image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const img = await toImage(file);
        await run('readwrite', (s) => s.put(file, KEY)).catch(() => undefined);
        resolve(img);
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

export async function clearAvatarImage() {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* ignore */
  }
}
