import { useState, useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import {
  type PeerBroadcast,
  type MediaType,
  extractYouTubeId,
  extractYouTubePlaylistId,
  extractYouTubePlaylistIndex,
  calculateEffectiveTime,
} from './types';

export function useMediaSync(
  doc: Y.Doc | null,
  actorName: string,
  participants: Array<{ id: string; name: string }> = []
) {
  const [broadcasts, setBroadcasts] = useState<PeerBroadcast[]>([]);
  const [tunedInHost, setTunedInHost] = useState<string | null>(null);

  // Read broadcasts from Yjs document
  useEffect(() => {
    if (!doc) return;

    const broadcastsMap = doc.getMap<string>('media-broadcasts');

    const handleObserve = () => {
      const list: PeerBroadcast[] = [];
      broadcastsMap.forEach((rawJson) => {
        try {
          if (typeof rawJson === 'string') {
            const parsed = JSON.parse(rawJson) as PeerBroadcast;
            if (parsed && parsed.url) {
              list.push(parsed);
            }
          }
        } catch {
          // ignore corrupted entry
        }
      });

      // Sort most recently updated broadcasts first
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setBroadcasts(list);
    };

    broadcastsMap.observe(handleObserve);
    handleObserve();

    return () => {
      broadcastsMap.unobserve(handleObserve);
    };
  }, [doc]);

  // Mount time ref to prevent immediate cleanup before peer awareness states have arrived
  const mountedAtRef = useRef(Date.now());

  // When a host disconnects, clean up their orphaned broadcast after a grace period so peers stop seeing stale data
  useEffect(() => {
    if (!doc || broadcasts.length === 0) return;

    // Give WebRTC/awareness at least 5 seconds after mount to populate all peers
    const timeSinceMount = Date.now() - mountedAtRef.current;
    const delay = Math.max(1000, 5000 - timeSinceMount);

    const timer = setTimeout(() => {
      if (!doc || participants.length === 0) return;

      const broadcastsMap = doc.getMap<string>('media-broadcasts');
      const participantNames = new Set(participants.map(p => p.name));

      doc.transact(() => {
        broadcasts.forEach(b => {
          // Never delete our own broadcast via orphan cleanup
          if (b.hostName === actorName || b.hostActorId === String(doc.clientID)) {
            return;
          }
          if (!participantNames.has(b.hostName)) {
            // Host is genuinely gone after awareness has fully settled
            broadcastsMap.delete(b.hostName);
          }
        });
      }, 'host-cleanup');
    }, delay);

    return () => clearTimeout(timer);
  }, [doc, broadcasts, participants, actorName]);

  // Determine current active broadcast
  // 1. If user has a broadcast where they are host, show that.
  // 2. Otherwise if user is tuned into a host, show that.
  // 3. Otherwise if there is any active broadcast in the room, default to that.
  const myBroadcast = broadcasts.find(b => b.hostName === actorName);
  const tunedBroadcast = tunedInHost ? broadcasts.find(b => b.hostName === tunedInHost) : null;
  const currentBroadcast = myBroadcast || tunedBroadcast || (broadcasts.length > 0 ? broadcasts[0] : null);

  const isHost = currentBroadcast ? currentBroadcast.hostName === actorName : false;

  // Start or change a broadcast (makes local user the Host)
  const startBroadcast = useCallback(
    (url: string, title?: string) => {
      if (!doc || !url.trim()) return;
      const cleanUrl = url.trim();
      const ytId = extractYouTubeId(cleanUrl);
      const playlistId = extractYouTubePlaylistId(cleanUrl);
      const playlistIndex = playlistId ? (extractYouTubePlaylistIndex(cleanUrl) ?? 0) : (ytId ? 0 : undefined);
      const mediaType: MediaType = ytId ? 'youtube' : 'direct';

      const newBroadcast: PeerBroadcast = {
        id: `bc-${actorName}-${Date.now()}`,
        hostName: actorName,
        hostActorId: String(doc.clientID),
        mediaType,
        url: cleanUrl,
        title: title || (playlistId ? 'YouTube Playlist' : ytId ? 'YouTube Video' : 'Audio/Video Stream'),
        playlistId: playlistId || undefined,
        playlistIndex,
        videoId: ytId || undefined,
        playing: true,
        currentTime: 0,
        timestamp: Date.now(),
        loop: false,
        autoPlayNext: true,
        action: 'load',
        updatedAt: Date.now(),
      };

      const broadcastsMap = doc.getMap<string>('media-broadcasts');
      doc.transact(() => {
        broadcastsMap.set(actorName, JSON.stringify(newBroadcast));
      }, 'start-broadcast');

      setTunedInHost(actorName);
    },
    [doc, actorName]
  );

  // Tune into a specific peer's broadcast (if caller has their own broadcast, remove it first)
  const tuneIn = useCallback((hostName: string) => {
    if (doc) {
      const broadcastsMap = doc.getMap<string>('media-broadcasts');
      // If the caller has their own broadcast running, remove it so peers stop getting it
      if (broadcastsMap.has(actorName) && hostName !== actorName) {
        doc.transact(() => {
          broadcastsMap.delete(actorName);
        }, 'tune-in-stop-own');
      }
    }
    setTunedInHost(hostName);
  }, [doc, actorName]);

  // Update current broadcast (only allowed if isHost)
  const updateCurrentBroadcast = useCallback(
    (patch: Partial<PeerBroadcast>) => {
      if (!doc || !currentBroadcast || !isHost) return;

      const updated: PeerBroadcast = {
        ...currentBroadcast,
        ...patch,
        timestamp: Date.now(),
        updatedAt: Date.now(),
      };

      const broadcastsMap = doc.getMap<string>('media-broadcasts');
      doc.transact(() => {
        broadcastsMap.set(currentBroadcast.hostName, JSON.stringify(updated));
      }, 'update-broadcast');
    },
    [doc, currentBroadcast, isHost]
  );

  // Host Actions: Play, Pause, Seek for All
  const playAll = useCallback(
    (time?: number) => {
      if (!isHost || !currentBroadcast) return;
      const pos = time !== undefined ? time : calculateEffectiveTime(currentBroadcast);
      updateCurrentBroadcast({
        playing: true,
        currentTime: Math.max(0, pos),
        action: 'play',
      });
    },
    [isHost, currentBroadcast, updateCurrentBroadcast]
  );

  const pauseAll = useCallback(
    (time?: number) => {
      if (!isHost || !currentBroadcast) return;
      const pos = time !== undefined ? time : calculateEffectiveTime(currentBroadcast);
      updateCurrentBroadcast({
        playing: false,
        currentTime: Math.max(0, pos),
        action: 'pause',
      });
    },
    [isHost, currentBroadcast, updateCurrentBroadcast]
  );

  const seekAll = useCallback(
    (targetSeconds: number) => {
      if (!isHost || !currentBroadcast) return;
      updateCurrentBroadcast({
        currentTime: Math.max(0, targetSeconds),
        action: 'seek',
      });
    },
    [isHost, currentBroadcast, updateCurrentBroadcast]
  );

  const toggleLoop = useCallback(() => {
    if (!isHost || !currentBroadcast) return;
    updateCurrentBroadcast({ loop: !currentBroadcast.loop });
  }, [isHost, currentBroadcast, updateCurrentBroadcast]);

  const toggleAutoPlayNext = useCallback(() => {
    if (!isHost || !currentBroadcast) return;
    updateCurrentBroadcast({ autoPlayNext: !currentBroadcast.autoPlayNext });
  }, [isHost, currentBroadcast, updateCurrentBroadcast]);

  const stopBroadcast = useCallback(() => {
    if (!doc || !isHost || !currentBroadcast) return;
    const broadcastsMap = doc.getMap<string>('media-broadcasts');
    doc.transact(() => {
      broadcastsMap.delete(currentBroadcast.hostName);
    }, 'stop-broadcast');
    setTunedInHost(null);
  }, [doc, isHost, currentBroadcast]);

  const updateTrack = useCallback(
    (track: { videoId?: string; playlistIndex?: number; title?: string; currentTime?: number }) => {
      if (!isHost || !currentBroadcast) return;
      updateCurrentBroadcast({
        ...track,
        currentTime: track.currentTime !== undefined ? track.currentTime : 0,
        action: 'play',
      });
    },
    [isHost, currentBroadcast, updateCurrentBroadcast]
  );

  return {
    broadcasts,
    currentBroadcast,
    isHost,
    startBroadcast,
    tuneIn,
    playAll,
    pauseAll,
    seekAll,
    toggleLoop,
    toggleAutoPlayNext,
    updateTrack,
    stopBroadcast,
    calculateCurrentTime: () => (currentBroadcast ? calculateEffectiveTime(currentBroadcast) : 0),
  };
}
