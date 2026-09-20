/**
 * IndexedDB wrapper.
 *
 * Small and hand-rolled: three object stores with get/put/delete/list is the
 * whole requirement, and everything here has to keep working offline in an
 * installed PWA with no server behind it.
 */

const DB_NAME = 'eq-scope';
const DB_VERSION = 1;

export const STORES = {
  snapshots: 'snapshots',
  targets: 'targets',
  micProfiles: 'micProfiles',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

export interface StoredSnapshot {
  id: string;
  name: string;
  createdAt: number;
  sampleRate: number;
  fraction: number;
  /** Nominal band centres, so a snapshot can be read back at any setting. */
  bandCenters: number[];
  bandDb: number[];
  longBandDb: number[];
  noiseFloorDb: number[] | null;
  micProfileId: string | null;
  splAt0dBFS: number | null;
  weighting: string;
  note?: string;
}

export interface StoredTarget {
  id: string;
  name: string;
  createdAt: number;
  points: { f: number; db: number }[];
}

export interface StoredMicProfile {
  id: string;
  name: string;
  createdAt: number;
  points: { f: number; db: number }[];
  trustedFromHz: number;
  trustedToHz: number;
  sensitivityDb?: number;
  source: 'imported' | 'measured';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = action(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function putRecord<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
  return run<void>(store, 'readwrite', (s) => s.put(value));
}

export function deleteRecord(store: StoreName, id: string): Promise<void> {
  return run<void>(store, 'readwrite', (s) => s.delete(id));
}

export function getRecord<T>(store: StoreName, id: string): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (s) => s.get(id));
}

export function listRecords<T>(store: StoreName): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.getAll());
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
