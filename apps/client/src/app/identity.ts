/**
 * Per-device identity & preferences (stored only on this device).
 *  - deviceId: stable random id that represents "this person on this browser" in room membership
 *  - name, pointer colour (used for cursor, laser and the colour dot next to your name)
 *  - the list of rooms this device has joined (for the profile menu)
 */

const KEY_DEVICE = 'crdt-device-id';
const KEY_NAME = 'crdt-canvas-name';
const KEY_POINTER = 'crdt-pointer-color';
const KEY_ROOMS = 'crdt-joined-rooms';

export const POINTER_COLORS = ['#E4572E', '#F2A541', '#4CB944', '#2E86AB', '#8E5BD6', '#E2539E', '#17A398', '#C08552'];

/**
 * Guest tab: opening the app with ?guest=1 gives THIS TAB its own identity (kept in
 * sessionStorage), so you can test as a second person in the same browser.
 */
const KEY_GUEST = 'crdt-guest-tab';
function detectGuest(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('guest') === '1') sessionStorage.setItem(KEY_GUEST, '1');
    return sessionStorage.getItem(KEY_GUEST) === '1';
  } catch { return false; }
}
export const IS_GUEST_TAB = typeof window !== 'undefined' && detectGuest();

function store(): Storage { return IS_GUEST_TAB ? sessionStorage : localStorage; }
function safeGet(key: string): string | null {
  try { return store().getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string) {
  try { store().setItem(key, value); } catch { /* ignore */ }
}

export function randomId(len = 8): string {
  const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return raw.slice(0, len);
}

export function getDeviceId(): string {
  let id = safeGet(KEY_DEVICE);
  if (!id) {
    id = randomId(16);
    safeSet(KEY_DEVICE, id);
  }
  return id;
}

export function getStoredName(): string {
  return safeGet(KEY_NAME) || '';
}
export function setStoredName(name: string) {
  safeSet(KEY_NAME, name.trim());
}

export function getPointerColor(): string {
  let color = safeGet(KEY_POINTER);
  if (!color) {
    color = POINTER_COLORS[Math.floor(Math.random() * POINTER_COLORS.length)];
    safeSet(KEY_POINTER, color);
  }
  return color;
}
export function setPointerColor(color: string) {
  safeSet(KEY_POINTER, color);
}

export interface JoinedRoom {
  roomId: string;
  name: string;
  lastOpened: number;
  role?: 'host' | 'member';
}

export function getJoinedRooms(): JoinedRoom[] {
  try {
    const list = JSON.parse(safeGet(KEY_ROOMS) || '[]');
    return Array.isArray(list)
      ? list.filter((r: any) => r && typeof r.roomId === 'string').sort((a: JoinedRoom, b: JoinedRoom) => b.lastOpened - a.lastOpened)
      : [];
  } catch {
    return [];
  }
}

export function rememberRoom(entry: Omit<JoinedRoom, 'lastOpened'> & { lastOpened?: number }) {
  const list = getJoinedRooms().filter(r => r.roomId !== entry.roomId);
  list.unshift({ ...entry, lastOpened: entry.lastOpened ?? Date.now() });
  safeSet(KEY_ROOMS, JSON.stringify(list.slice(0, 30)));
  window.dispatchEvent(new Event('crdt-rooms-changed'));
}

export function forgetRoom(roomId: string) {
  safeSet(KEY_ROOMS, JSON.stringify(getJoinedRooms().filter(r => r.roomId !== roomId)));
  window.dispatchEvent(new Event('crdt-rooms-changed'));
}
