import { type Shape, type ShapeData } from '@crdt-canvas/engine';

const DATABASE_NAME = 'crdt-canvas-stencils';
const DATABASE_VERSION = 1;
const STORE_NAME = 'stencils';
const MAX_STENCILS = 50;
const MAX_VERSIONS = 10;
const MAX_VERSION_BYTES = 4 * 1024 * 1024;

export interface StencilVersion {
  version: number;
  savedAt: number;
  shapes: Array<{ id: string; data: ShapeData }>;
}

export interface Stencil {
  id: string;
  name: string;
  createdAt: number;
  versions: StencilVersion[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the stencil library.'));
    request.onblocked = () => reject(new Error('The stencil library is blocked by another tab.'));
  });
}

export async function listStencils(): Promise<Stencil[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as Stencil[]).sort((a, b) => a.name.localeCompare(b.name)));
      request.onerror = () => reject(request.error ?? new Error('Could not read the stencil library.'));
    });
  } finally { database.close(); }
}

export async function saveStencil(nameInput: string, shapes: Shape[]): Promise<Stencil> {
  const name = nameInput.trim().slice(0, 60);
  const sourceShapes = shapes.filter(shape => !shape.deleted);
  if (!name) throw new Error('Enter a name for this stencil.');
  if (!sourceShapes.length) throw new Error('Select at least one object to save as a stencil.');
  const shapeData = sourceShapes.map(shape => ({ id: shape.id, data: structuredClone(shape.data) }));
  const bytes = new Blob([JSON.stringify(shapeData)]).size;
  if (bytes > MAX_VERSION_BYTES) throw new Error('This stencil version is larger than the 4 MB limit. Remove large images or save fewer objects.');

  const database = await openDatabase();
  try {
    return await new Promise<Stencil>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      let result: Stencil | null = null;
      request.onsuccess = () => {
        const records = request.result as Stencil[];
        const existing = records.find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (!existing && records.length >= MAX_STENCILS) {
          transaction.abort();
          reject(new Error(`The stencil library holds up to ${MAX_STENCILS} items. Delete one before saving another.`));
          return;
        }
        const nextVersion = (existing?.versions.at(-1)?.version ?? 0) + 1;
        const version: StencilVersion = { version: nextVersion, savedAt: Date.now(), shapes: shapeData };
        result = existing
          ? { ...existing, name, versions: [...existing.versions, version].slice(-MAX_VERSIONS) }
          : { id: crypto.randomUUID(), name, createdAt: Date.now(), versions: [version] };
        store.put(result);
      };
      request.onerror = () => {
        transaction.abort();
        reject(formatQuotaError(request.error) ?? new Error('Could not save this stencil.'));
      };
      transaction.oncomplete = () => result ? resolve(result) : reject(new Error('The stencil was not saved.'));
      transaction.onerror = () => reject(formatQuotaError(transaction.error) ?? new Error('Could not save this stencil.'));
      transaction.onabort = () => {
        const error = formatQuotaError(transaction.error);
        reject(error ?? new Error('Saving this stencil was cancelled.'));
      };
    });
  } finally { database.close(); }
}

function formatQuotaError(error: unknown): Error | null {
  if (!error) return null;
  const isQuota = (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22))
    || (error instanceof Error && /quota/i.test(error.message));
  if (isQuota) {
    return new Error('Storage quota exceeded. Your browser storage is full. Please delete unused stencils or remove large embedded images to free up space.');
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function getStencilStorageEstimate(): Promise<{
  usageBytes: number;
  quotaBytes: number;
  stencilCount: number;
  maxStencils: number;
}> {
  let usageBytes = 0;
  let quotaBytes = 0;
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      usageBytes = estimate.usage ?? 0;
      quotaBytes = estimate.quota ?? 0;
    } catch {
      // ignore
    }
  }
  const stencils = await listStencils().catch(() => []);
  return {
    usageBytes,
    quotaBytes,
    stencilCount: stencils.length,
    maxStencils: MAX_STENCILS,
  };
}

export async function deleteStencil(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete this stencil.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Deleting this stencil was cancelled.'));
    });
  } finally { database.close(); }
}
