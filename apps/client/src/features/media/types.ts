export type MediaType = 'youtube' | 'direct';

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
  action: 'load' | 'play' | 'pause' | 'seek';
  updatedAt: number;
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
  state: { playing: boolean; currentTime: number; timestamp: number }
): number {
  if (!state.playing) {
    return Math.max(0, state.currentTime);
  }
  const elapsed = (Date.now() - state.timestamp) / 1000;
  // Cap elapsed drift to avoid runaway values
  const safeElapsed = Math.max(0, Math.min(elapsed, 7200));
  return Math.max(0, state.currentTime + safeElapsed);
}
