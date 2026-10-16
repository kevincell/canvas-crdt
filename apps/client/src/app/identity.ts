/**
 * Local identity: a display name, a colour and a random per-device id.
 * The CRDT actor id is `name#xxxx` so two people called "Alex" never share an
 * edit register; UIs show `actorLabel(actor)`.
 */
import { readString, writeString } from './storage';

export const PEER_COLORS = ['#e03131', '#f08c00', '#2f9e44', '#0c8599', '#1971c2', '#6741d9', '#c2255c', '#5c940d', '#d9480f', '#7048e8'];

export interface Identity {
  name: string;
  color: string;
  deviceId: string;
  actor: string;
}

export function loadIdentity(): Identity {
  let deviceId = readString('crdt-canvas-device');
  if (!/^[a-z0-9]{8}$/.test(deviceId)) {
    deviceId = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    writeString('crdt-canvas-device', deviceId);
  }
  const name = readString('crdt-canvas-name').trim().slice(0, 32);
  let color = readString('crdt-canvas-color');
  if (!/^#[0-9a-f]{6}$/i.test(color) || color === '#7c3aed') color = PEER_COLORS[hash(deviceId) % PEER_COLORS.length];
  return { name, color, deviceId, actor: makeActor(name || 'Guest', deviceId) };
}

export function saveIdentity(next: Pick<Identity, 'name' | 'color'>) {
  writeString('crdt-canvas-name', next.name.trim().slice(0, 32));
  writeString('crdt-canvas-color', next.color);
}

export function makeActor(name: string, deviceId: string): string {
  return `${name.trim().slice(0, 32) || 'Guest'}#${deviceId.slice(0, 4)}`;
}

/** Strip the device suffix: `Kevin#ab12` → `Kevin`. Legacy plain names pass through. */
export function actorLabel(actor: string | undefined): string {
  if (!actor) return 'Someone';
  return actor.replace(/#[a-z0-9]{4}$/, '') || 'Someone';
}

/** Stable colour for an actor whose live presence is unknown. */
export function actorColor(actor: string): string {
  return PEER_COLORS[hash(actor) % PEER_COLORS.length];
}

export function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}
