const DATABASE_NAME = 'crdt-canvas-migration-recovery';
const DATABASE_VERSION = 1;
const STORE_NAME = 'backups';

export interface MigrationRecoveryBackup {
  roomId: string;
  savedAt: number;
  update: Uint8Array;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'roomId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local recovery store.'));
    request.onblocked = () => reject(new Error('The local recovery store is blocked by another tab.'));
  });
}

export async function saveMigrationBackup(roomId: string, update: Uint8Array): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ roomId, savedAt: Date.now(), update } satisfies MigrationRecoveryBackup);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the pre-migration recovery copy.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving the pre-migration recovery copy was cancelled.'));
    });
  } finally { database.close(); }
}

export async function getMigrationBackup(roomId: string): Promise<MigrationRecoveryBackup | null> {
  const database = await openDatabase();
  try {
    return await new Promise<MigrationRecoveryBackup | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(roomId);
      request.onsuccess = () => resolve((request.result as MigrationRecoveryBackup | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not read the local recovery copy.'));
    });
  } finally { database.close(); }
}

export async function deleteMigrationBackup(roomId: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(roomId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear the completed migration backup.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Clearing the completed migration backup was cancelled.'));
    });
  } finally { database.close(); }
}

export async function downloadMigrationBackup(roomId: string): Promise<void> {
  const backup = await getMigrationBackup(roomId);
  if (!backup) throw new Error('No pre-migration recovery copy is available on this device.');
  const buffer = backup.update.buffer.slice(backup.update.byteOffset, backup.update.byteOffset + backup.update.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName(roomId)}-pre-migration.yupdate`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'board';
}
