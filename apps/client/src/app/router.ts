/**
 * Hash routing. Everything after `#` stays in the browser — in particular the
 * board encryption key is never sent to the signaling server or any host.
 *
 *   #/                         home
 *   #/b/<room>                 open board
 *   #/b/<room>?k=<key>         open board with its end-to-end encryption key
 *   #/b/<room>?view=1          view-only link
 *   #/b/<room>?present=1       open straight into presentation mode
 *   #/b/<room>?as=<name>       open as a named guest (second-peer demos)
 */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; roomId: string; key?: string; viewOnly: boolean; present: boolean; as?: string };

export function parseRoute(hash: string = window.location.hash): Route {
  const clean = hash.replace(/^#/, '');
  const [path, query = ''] = clean.split('?');
  const params = new URLSearchParams(query);
  const match = /^\/b\/([^/]+)$/.exec(path);
  if (match) {
    let roomId = match[1];
    try { roomId = decodeURIComponent(roomId); } catch { /* keep raw */ }
    roomId = sanitizeRoomId(roomId);
    if (roomId) {
      return {
        name: 'board',
        roomId,
        key: params.get('k') || undefined,
        viewOnly: params.get('view') === '1' || params.get('role') === 'viewer',
        present: params.get('present') === '1',
        as: params.get('as') || undefined,
      };
    }
  }
  // Legacy ?room= links from the first version.
  const legacy = new URLSearchParams(window.location.search).get('room');
  if (legacy && sanitizeRoomId(legacy)) {
    return { name: 'board', roomId: sanitizeRoomId(legacy), viewOnly: new URLSearchParams(window.location.search).get('role') === 'viewer', present: false };
  }
  return { name: 'home' };
}

export function boardHash(roomId: string, options: { key?: string; viewOnly?: boolean; present?: boolean; as?: string } = {}): string {
  const params = new URLSearchParams();
  if (options.key) params.set('k', options.key);
  if (options.viewOnly) params.set('view', '1');
  if (options.present) params.set('present', '1');
  if (options.as) params.set('as', options.as);
  const query = params.toString();
  return `#/b/${encodeURIComponent(roomId)}${query ? `?${query}` : ''}`;
}

export function boardUrl(roomId: string, options: Parameters<typeof boardHash>[1] = {}): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}${boardHash(roomId, options)}`;
}

export function navigate(hash: string, replace = false) {
  if (replace) window.history.replaceState(null, '', hash);
  else window.history.pushState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function goHome() {
  navigate('#/');
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute());
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  return route;
}

export function sanitizeRoomId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_\-.]/g, '-').replace(/-+/g, '-').slice(0, 64);
}

/** Readable, unguessable room id such as `amber-otter-7k3q9d`. */
export function generateRoomId(): string {
  const adjectives = ['amber', 'brisk', 'calm', 'deep', 'eager', 'fable', 'gentle', 'hazel', 'ivory', 'jolly', 'keen', 'lunar', 'mellow', 'noble', 'opal', 'pine', 'quiet', 'rapid', 'sunny', 'tidal', 'umber', 'vivid', 'witty', 'zesty'];
  const nouns = ['otter', 'falcon', 'maple', 'comet', 'harbor', 'meadow', 'canyon', 'ember', 'glacier', 'heron', 'island', 'lantern', 'orbit', 'pebble', 'quartz', 'river', 'summit', 'thistle', 'willow', 'zephyr'];
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes.slice(2), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  return `${adjectives[bytes[0] % adjectives.length]}-${nouns[bytes[1] % nouns.length]}-${suffix}`;
}

/** 128-bit random key, base64url encoded (22 chars). */
export function generateBoardKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
