export type MediaType = 'youtube' | 'direct' | 'screen-share';

export interface PeerBroadcast {
  id: string;             // broadcast ID
  hostName: string;       // name of the peer hosting
  hostActorId: string;    // actor/client ID
  mediaType: MediaType;
  url: string;
  title: string;
  playlistId?: string;
  playlistIndex?: number;
  videoId?: string;
  playing: boolean;
  currentTime: number;
  timestamp: number;      // Date.now() when currentTime was recorded
  loop: boolean;
  autoPlayNext: boolean;
  action: 'load' | 'play' | 'pause' | 'seek' | 'rate' | 'heartbeat';
  updatedAt: number;
  /** Host-controlled playback speed (1 = normal). Listeners follow it unless they override locally. */
  playbackRate?: number;
  /** Optional WebVTT subtitle track for direct (uploaded) media, served by the local media server. */
  subtitleUrl?: string;
}

export type SharedMediaState = Partial<PeerBroadcast> & {
  playing: boolean;
  currentTime: number;
  timestamp: number;
  [key: string]: any;
};

export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/
  );
  if (match) return match[1];
  if (/^[\w-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

export function extractYouTubePlaylistId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return null;
}

export function extractYouTubePlaylistIndex(url: string): number | null {
  if (!url) return null;
  const match = url.match(/[?&]index=(\d+)/);
  if (match) {
    const idx = parseInt(match[1], 10);
    return isNaN(idx) ? null : Math.max(0, idx - 1);
  }
  return null;
}

/**
 * Calculates current estimated playback time accounting for clock drift if playing
 */
export function calculateEffectiveTime(
  state: { playing: boolean; currentTime: number; timestamp: number; playbackRate?: number }
): number {
  if (!state.playing) {
    return Math.max(0, state.currentTime);
  }
  const elapsed = (serverNow() - state.timestamp) / 1000;
  // Cap elapsed drift to avoid runaway values
  const safeElapsed = Math.max(0, Math.min(elapsed, 7200));
  const rate = state.playbackRate && state.playbackRate > 0 ? state.playbackRate : 1;
  return Math.max(0, state.currentTime + safeElapsed * rate);
}

// ── Shared clock ────────────────────────────────────────────────────────────
// Laptops on an offline hotspot have no NTP, so their clocks can be seconds apart. Every peer
// estimates its offset to the signaling server's clock (NTP-style, best of several round trips)
// and all broadcast timestamps use that shared clock — so "host is at 1:35" means the same
// instant on every device.
let clockOffsetMs = 0;
let clockSyncPromise: Promise<void> | null = null;
let lastClockSync = 0;

/** Current time on the shared (server) clock, in ms. Falls back to the local clock. */
export function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

export function getClockOffsetMs(): number {
  return clockOffsetMs;
}

export function syncClockWithServer(force = false): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return Promise.resolve();
  if (clockSyncPromise) return clockSyncPromise;
  if (!force && Date.now() - lastClockSync < 20_000) return Promise.resolve();
  clockSyncPromise = (async () => {
    const samples: Array<{ rtt: number; offset: number }> = [];
    for (let i = 0; i < 5; i++) {
      try {
        const t0 = Date.now();
        const resp = await fetch(`${getMediaServerOrigin()}/api/time`, { cache: 'no-store' });
        const data = await resp.json();
        const t1 = Date.now();
        if (typeof data?.now === 'number') {
          samples.push({ rtt: t1 - t0, offset: data.now - (t0 + t1) / 2 });
        }
      } catch {
        /* server unreachable — keep previous offset */
      }
      await new Promise(r => setTimeout(r, 120));
    }
    if (samples.length > 0) {
      // The fastest round trip has the least network asymmetry → most accurate offset
      samples.sort((a, b) => a.rtt - b.rtt);
      clockOffsetMs = Math.round(samples[0].offset);
      lastClockSync = Date.now();
    }
  })().finally(() => {
    clockSyncPromise = null;
  });
  return clockSyncPromise;
}

/**
 * Origin (scheme://host:port) of the local signaling/media server this peer talks to.
 * Mirrors the logic in useCRDTConnection so every peer reaches the same Node server
 * that relays the canvas — this is what makes uploads stream over an offline hotspot.
 */
export function getMediaServerOrigin(): string {
  const envUrl = (import.meta as any).env?.VITE_SIGNALING_URL as string | undefined;
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
      return `${protocol}//${parsed.host}`;
    } catch {
      /* fall through */
    }
  }
  if (typeof window === 'undefined') return '';
  // Page served over https cannot load http media (mixed content) — use the dev-server proxy instead.
  if (window.location.protocol === 'https:') return '';
  const host = window.location.hostname || 'localhost';
  return `http://${host}:3001`;
}

/**
 * Uploaded media is broadcast as a server-relative path (`/api/media/<id>`) so each peer
 * resolves it against its own route to the server (localhost for the host laptop,
 * the hotspot IP for everyone else). Absolute URLs are returned unchanged.
 */
export function resolveMediaUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('/api/media/')) return `${getMediaServerOrigin()}${url}`;
  return url;
}

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const YOUTUBE_QUALITIES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'highres', label: '4K+' },
  { value: 'hd1080', label: '1080p' },
  { value: 'hd720', label: '720p' },
  { value: 'large', label: '480p' },
  { value: 'medium', label: '360p' },
  { value: 'small', label: '240p' },
];

/** Convert SubRip (.srt) subtitles to WebVTT so <track> can use them. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${body.trim()}\n`;
}
