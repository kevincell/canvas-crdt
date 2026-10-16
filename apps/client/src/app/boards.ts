/**
 * Local board registry — the "Home" list. Boards themselves live in IndexedDB
 * (one database per room); this registry only remembers titles, keys,
 * thumbnails and ordering for this device.
 */
import { useSyncExternalStore } from 'react';
import { readJSON, readString, removeKey, writeJSON } from './storage';

export interface BoardEntry {
  id: string;
  title: string;
  /** End-to-end encryption key (base64url) — kept on this device only. */
  key?: string;
  lastOpened: number;
  favorite?: boolean;
  thumbnail?: string;
  shapeCount?: number;
  /** Set for branches: the board this one can merge back into. */
  parentId?: string;
}

const KEY = 'crdt-canvas-boards';
let cache: BoardEntry[] | null = null;
const listeners = new Set<() => void>();

function load(): BoardEntry[] {
  if (cache) return cache;
  let entries = readJSON<BoardEntry[]>(KEY, []);
  if (!Array.isArray(entries)) entries = [];
  if (!entries.length) entries = migrateLegacy();
  cache = entries.filter(entry => entry && typeof entry.id === 'string');
  return cache;
}

function migrateLegacy(): BoardEntry[] {
  const recents = readJSON<Array<{ roomId: string; title?: string }>>('crdt-canvas-recent-boards', []);
  const favorites = readJSON<string[]>('crdt-canvas-favorite-boards', []);
  const ids = [...new Set([...(Array.isArray(favorites) ? favorites : []), ...(Array.isArray(recents) ? recents.map(r => r?.roomId) : [])])].filter(Boolean);
  const now = Date.now();
  const entries = ids.map((id, index) => ({
    id,
    title: readString(`crdt-canvas-title-${id}`) || id,
    lastOpened: now - index * 1000,
    favorite: favorites.includes(id),
  }));
  if (entries.length) writeJSON(KEY, entries);
  return entries;
}

function commit(next: BoardEntry[]) {
  cache = next.sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 200);
  writeJSON(KEY, cache);
  listeners.forEach(listener => listener());
}

export function listBoards(): BoardEntry[] {
  return load();
}

export function getBoard(id: string): BoardEntry | undefined {
  return load().find(entry => entry.id === id);
}

export function upsertBoard(id: string, patch: Partial<Omit<BoardEntry, 'id'>>) {
  const entries = load();
  const existing = entries.find(entry => entry.id === id);
  const next = existing
    ? entries.map(entry => entry.id === id ? { ...entry, ...stripUndefined(patch) } : entry)
    : [...entries, { id, title: id, lastOpened: Date.now(), ...stripUndefined(patch) }];
  commit(next);
}

export function removeBoard(id: string) {
  commit(load().filter(entry => entry.id !== id));
  removeKey(`crdt-canvas-title-${id}`);
  removeKey(`crdt-canvas-meta-${id}`);
  try { indexedDB.deleteDatabase(`crdt-canvas-${id}`); } catch { /* ignore */ }
}

export function subscribeBoards(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) { cache = null; listener(); }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useBoards(): BoardEntry[] {
  return useSyncExternalStore(subscribeBoards, listBoards, listBoards);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
