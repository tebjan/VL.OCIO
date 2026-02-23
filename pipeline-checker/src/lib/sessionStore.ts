/**
 * Session persistence for pipeline-checker.
 *
 * - File handle (FileSystemFileHandle) stored in IndexedDB for reload.
 * - View state (stage index) stored in localStorage (lightweight).
 */

const DB_NAME = 'pipeline-checker';
const STORE_NAME = 'session';
const FILE_KEY = 'lastFileHandle';
const VIEW_STATE_KEY = 'pipeline-checker:viewState';

// ── IndexedDB helpers ──────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
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

export interface StoredFileRef {
  handle: FileSystemFileHandle;
  fileType: string;
  fileName: string;
}

/**
 * Persist a FileSystemFileHandle so we can re-read the file after reload.
 */
export async function saveFileHandle(
  handle: FileSystemFileHandle,
  fileType: string,
  fileName: string,
): Promise<void> {
  try {
    const db = await openDB();
    await idbPut(db, FILE_KEY, { handle, fileType, fileName });
    db.close();
  } catch (err) {
    console.warn('[sessionStore] Failed to save file handle:', err);
  }
}

/**
 * Load the previously persisted file handle, or null if none exists.
 * Verifies read permission is still granted.
 */
export async function loadFileHandle(): Promise<StoredFileRef | null> {
  try {
    const db = await openDB();
    const result = await idbGet<StoredFileRef>(db, FILE_KEY);
    db.close();
    if (!result?.handle) return null;

    // Check permission — granted persists across reloads in the same tab.
    // queryPermission is part of the File System Access API (Chrome/Edge).
    const handle = result.handle as FileSystemFileHandle & {
      queryPermission?(opts: { mode: string }): Promise<string>;
    };
    if (handle.queryPermission) {
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        console.log('[sessionStore] File permission not granted, skipping restore');
        return null;
      }
    }

    return result;
  } catch (err) {
    console.warn('[sessionStore] Failed to load file handle:', err);
    return null;
  }
}

export interface ViewState {
  stageIndex: number;
  compactMode?: boolean;
}

/**
 * Save the current view state to localStorage.
 */
export function saveViewState(viewState: ViewState): void {
  try {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(viewState));
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

/**
 * Load the previously saved view state, or null if none.
 */
export function loadViewState(): ViewState | null {
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.stageIndex === 'number') return parsed;
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
