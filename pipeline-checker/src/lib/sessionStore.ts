/**
 * Session persistence for pipeline-checker.
 *
 * - Image data (ArrayBuffer) stored in IndexedDB (can be several MB).
 * - View state (stage index) stored in localStorage (lightweight).
 */

const DB_NAME = 'pipeline-checker';
const STORE_NAME = 'session';
const IMAGE_KEY = 'lastImage';
const VIEW_STATE_KEY = 'pipeline-checker:viewState';

// ── IndexedDB helpers ──────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Public API ─────────────────────────────────────────────────────

export interface StoredImageData {
  data: ArrayBuffer;
  fileType: 'exr' | 'dds';
  fileName: string;
}

/**
 * Persist the raw file ArrayBuffer so it can be restored after reload.
 */
export async function saveImageData(
  data: ArrayBuffer,
  fileType: 'exr' | 'dds',
  fileName: string,
): Promise<void> {
  try {
    const db = await openDB();
    await idbPut(db, IMAGE_KEY, { data, fileType, fileName });
    db.close();
  } catch (err) {
    console.warn('[sessionStore] Failed to save image data:', err);
  }
}

/**
 * Load the previously persisted image data, or null if none exists.
 */
export async function loadImageData(): Promise<StoredImageData | null> {
  try {
    const db = await openDB();
    const result = await idbGet<StoredImageData>(db, IMAGE_KEY);
    db.close();
    return result ?? null;
  } catch (err) {
    console.warn('[sessionStore] Failed to load image data:', err);
    return null;
  }
}

/**
 * Save the currently selected stage index to localStorage.
 */
export function saveViewState(stageIndex: number): void {
  try {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ stageIndex }));
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

/**
 * Load the previously selected stage index, or null if none.
 */
export function loadViewState(): number | null {
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.stageIndex === 'number') return parsed.stageIndex;
    return null;
  } catch {
    return null;
  }
}

/**
 * Clear all persisted session data (IndexedDB + localStorage).
 */
export async function clearSession(): Promise<void> {
  try {
    localStorage.removeItem(VIEW_STATE_KEY);
  } catch {
    // ignore
  }
  try {
    const db = await openDB();
    await idbClear(db);
    db.close();
  } catch (err) {
    console.warn('[sessionStore] Failed to clear session:', err);
  }
}
