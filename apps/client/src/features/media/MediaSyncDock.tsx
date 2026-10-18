import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Button,
  Slider,
  Tooltip,
  Chip,
} from '@mui/material';
import {
  PlayArrow,
  Pause,
  Sync as SyncIcon,
  Close,
  Remove,
  OpenInFull,
  VolumeUp,
  VolumeOff,
  MusicNote,
  FastForward,
  FastRewind,
  Link as LinkIcon,
  Repeat,
  QueueMusic,
  Headphones,
  Radio,
  DragIndicator,
  SkipNext,
  SkipPrevious,
  Fullscreen,
  FullscreenExit,
  AspectRatio,
} from '@mui/icons-material';
import {
  type PeerBroadcast,
  extractYouTubeId,
  extractYouTubePlaylistId,
  calculateEffectiveTime,
} from './types';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface MediaSyncDockProps {
  currentBroadcast: PeerBroadcast | null;
  broadcasts: PeerBroadcast[];
  isHost: boolean;
  actorName: string;
  onStartBroadcast: (url: string, title?: string) => void;
  onTuneIn: (hostName: string) => void;
  onPlayAll: (time?: number) => void;
  onPauseAll: (time?: number) => void;
  onSeekAll: (time: number) => void;
  onToggleLoop: () => void;
  onToggleAutoPlayNext: () => void;
  onUpdateTrack?: (track: { videoId?: string; playlistIndex?: number; title?: string; currentTime?: number }) => void;
  onStopBroadcast: () => void;
  onClose: () => void;
}

export function MediaSyncDock({
  currentBroadcast,
  broadcasts,
  isHost,
  actorName,
  onStartBroadcast,
  onTuneIn,
  onPlayAll,
  onPauseAll,
  onSeekAll,
  onToggleLoop,
  onToggleAutoPlayNext,
  onUpdateTrack,
  onStopBroadcast,
  onClose,
}: MediaSyncDockProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLocallyPaused, setIsLocallyPaused] = useState(false);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [localProgress, setLocalProgress] = useState<number>(0);
  const [duration, setDuration] = useState<number>(180);
  const [showPeerList, setShowPeerList] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [isWideScreen, setIsWideScreen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showOverlayControls, setShowOverlayControls] = useState(true);

  // Ref for the entire dock container (used for native fullscreen API)
  const dockContainerRef = useRef<HTMLDivElement | null>(null);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Whether we are in an "immersive" mode (wide or full) that needs overlay controls
  const isImmersive = isWideScreen || isFullScreen;

  // ---- AUTO-HIDE OVERLAY CONTROLS (5s inactivity) ----
  const resetOverlayTimer = useCallback(() => {
    setShowOverlayControls(true);
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = setTimeout(() => {
      setShowOverlayControls(false);
    }, 5000);
  }, []);

  useEffect(() => {
    if (!isImmersive) {
      // Not immersive, always show controls
      setShowOverlayControls(true);
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      return;
    }
    // Start timer when entering immersive
    resetOverlayTimer();
    const handleMouseMove = () => resetOverlayTimer();
    const target = dockContainerRef.current || window;
    target.addEventListener('mousemove', handleMouseMove);
    return () => {
      target.removeEventListener('mousemove', handleMouseMove);
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, [isImmersive, resetOverlayTimer]);

  // ---- NATIVE FULLSCREEN API ----
  const enterNativeFullscreen = useCallback(async () => {
    const el = dockContainerRef.current;
    if (!el) return;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if ((el as any).webkitRequestFullscreen) await (el as any).webkitRequestFullscreen();
      else if ((el as any).msRequestFullscreen) await (el as any).msRequestFullscreen();
    } catch {
      // Fullscreen not supported or denied
    }
  }, []);

  const exitNativeFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ((document as any).webkitExitFullscreen) await (document as any).webkitExitFullscreen();
      else if ((document as any).msExitFullscreen) await (document as any).msExitFullscreen();
    } catch {
      // ignore
    }
  }, []);

  // Sync native fullscreen state with our isFullScreen flag
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        setIsFullScreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, []);

  // When isFullScreen changes, trigger native fullscreen
  useEffect(() => {
    if (isFullScreen) {
      enterNativeFullscreen();
    } else {
      if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
        exitNativeFullscreen();
      }
    }
  }, [isFullScreen, enterNativeFullscreen, exitNativeFullscreen]);

  // Escape key exits Wide Screen mode (native fullscreen handles its own Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isWideScreen) {
          setIsWideScreen(false);
          e.stopPropagation();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isWideScreen]);

  // Dragging state for minimized floating pill
  const [minimizedPos, setMinimizedPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
    hasMoved: boolean;
  } | null>(null);
  const hasDraggedRef = useRef(false);
  const pillRef = useRef<HTMLDivElement | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytContainerId = useRef<string>(`yt-player-${Math.random().toString(36).substring(2, 8)}`);
  const isInternalUpdate = useRef(false);
  const isPlayerReadyRef = useRef(false);
  const lastBroadcastTimestamp = useRef(0);

  // Refs for values needed inside stale YouTube player closures
  const currentBroadcastRef = useRef(currentBroadcast);
  currentBroadcastRef.current = currentBroadcast;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const onPauseAllRef = useRef(onPauseAll);
  onPauseAllRef.current = onPauseAll;
  const onPlayAllRef = useRef(onPlayAll);
  onPlayAllRef.current = onPlayAll;
  const onUpdateTrackRef = useRef(onUpdateTrack);
  onUpdateTrackRef.current = onUpdateTrack;

  const youtubeVideoId = currentBroadcast?.url ? extractYouTubeId(currentBroadcast.url) : (currentBroadcast?.videoId || null);
  const youtubePlaylistId = currentBroadcast?.url ? (extractYouTubePlaylistId(currentBroadcast.url) || currentBroadcast?.playlistId || null) : (currentBroadcast?.playlistId || null);

  // Load YouTube IFrame API script once
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // Initialize or re-init YouTube player when video/playlist changes
  useEffect(() => {
    if (!youtubeVideoId && !youtubePlaylistId) return;

    let destroyed = false;
    isPlayerReadyRef.current = false;

    const initYT = () => {
      if (destroyed || !window.YT || !window.YT.Player) return;
      const targetEl = document.getElementById(ytContainerId.current);
      if (!targetEl) return;

      try {
        if (ytPlayerRef.current?.destroy) {
          ytPlayerRef.current.destroy();
        }
      } catch {
        // ignore
      }

      const playerVars: any = {
        autoplay: currentBroadcast?.playing && !isLocallyPaused ? 1 : 0,
        controls: 0,
        disablekb: 1,
        enablejsapi: 1,
        modestbranding: 1,
        rel: 0,
        origin: window.location.origin,
      };

      if (youtubePlaylistId) {
        playerVars.listType = 'playlist';
        playerVars.list = youtubePlaylistId;
        if (currentBroadcast?.playlistIndex !== undefined && currentBroadcast.playlistIndex >= 0) {
          playerVars.index = currentBroadcast.playlistIndex;
        }
      } else if (youtubeVideoId) {
        // Provide YouTube automated Mix queue so nextVideo() and previousVideo() work for ANY track!
        playerVars.listType = 'playlist';
        playerVars.list = `RD${youtubeVideoId}`;
      }

      ytPlayerRef.current = new window.YT.Player(ytContainerId.current, {
        videoId: youtubeVideoId || undefined,
        playerVars,
        events: {
          onReady: (event: any) => {
            if (destroyed) return;
            isPlayerReadyRef.current = true;
            if (currentBroadcast) {
              if (currentBroadcast.playlistIndex !== undefined && currentBroadcast.playlistIndex >= 0 && typeof event.target.getPlaylistIndex === 'function') {
                const curIdx = event.target.getPlaylistIndex();
                if (curIdx !== currentBroadcast.playlistIndex && typeof event.target.playVideoAt === 'function') {
                  event.target.playVideoAt(currentBroadcast.playlistIndex);
                }
              }
              const effectiveTime = calculateEffectiveTime(currentBroadcast);
              event.target.seekTo(effectiveTime, true);
              if (currentBroadcast.playing && !isLocallyPaused) {
                event.target.playVideo();
              } else {
                event.target.pauseVideo();
              }
            }
            if (isMuted) event.target.mute();
            else {
              event.target.unMute();
              event.target.setVolume(volume * 100);
            }
          },
          onStateChange: (event: any) => {
            const bc = currentBroadcastRef.current;

            // Detect playlist track change on host
            if (isHostRef.current && onUpdateTrackRef.current && typeof event.target.getPlaylistIndex === 'function') {
              const curIndex = event.target.getPlaylistIndex();
              const videoData = typeof event.target.getVideoData === 'function' ? event.target.getVideoData() : null;
              const curVideoId = videoData?.video_id || null;
              const curTitle = videoData?.title || null;

              if (curIndex >= 0 && (curIndex !== bc?.playlistIndex || (curVideoId && curVideoId !== bc?.videoId))) {
                onUpdateTrackRef.current({
                  playlistIndex: curIndex,
                  videoId: curVideoId || undefined,
                  title: curTitle || bc?.title || 'YouTube Track',
                  currentTime: 0,
                });
              }
            }

            // State 0 = ENDED
            if (event.data === 0) {
              if (bc?.loop) {
                event.target.seekTo(0, true);
                event.target.playVideo();
                if (isHostRef.current) {
                  onPlayAllRef.current(0);
                }
              } else if (isHostRef.current) {
                // Video/song ended naturally — host signals pause for all peers
                onPauseAllRef.current(0);
              }
            }
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      initYT();
    } else {
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevCallback) prevCallback();
        initYT();
      };
    }

    return () => {
      destroyed = true;
      isPlayerReadyRef.current = false;
      try {
        if (ytPlayerRef.current?.destroy) {
          ytPlayerRef.current.destroy();
          ytPlayerRef.current = null;
        }
      } catch {
        // ignore
      }
    };
  }, [youtubeVideoId, youtubePlaylistId, currentBroadcast?.id]);

  // Synchronize player immediately on incoming CRDT updates (ZERO LAG SEEKING)
  useEffect(() => {
    if (!currentBroadcast) return;

    const isNewAction = currentBroadcast.timestamp !== lastBroadcastTimestamp.current;
    lastBroadcastTimestamp.current = currentBroadcast.timestamp;

    const rawEffectiveTime = calculateEffectiveTime(currentBroadcast);
    const effectiveTime = (currentBroadcast.loop && duration > 0)
      ? (rawEffectiveTime % duration)
      : rawEffectiveTime;
    setLocalProgress(effectiveTime);

    // Direct Video Sync
    if (currentBroadcast.mediaType === 'direct' && videoRef.current) {
      const vid = videoRef.current;

      // Don't force restart if video ended naturally and loop is off
      if (vid.ended && !currentBroadcast.loop) {
        // Video ended — don't restart
      } else {
        if (currentBroadcast.action === 'seek' || isNewAction) {
          vid.currentTime = effectiveTime;
        } else {
          const timeDiff = Math.abs(vid.currentTime - effectiveTime);
          if (timeDiff > 1.2) vid.currentTime = effectiveTime;
        }

        if (currentBroadcast.playing && !isLocallyPaused && vid.paused) {
          vid.play().catch(() => {});
        } else if ((!currentBroadcast.playing || isLocallyPaused) && !vid.paused) {
          vid.pause();
        }
      }
    }
    // YouTube Player Sync (Immediate seek execution for 0 lag)
    else if (currentBroadcast.mediaType === 'youtube' && isPlayerReadyRef.current && ytPlayerRef.current?.seekTo) {
      try {
        const yt = ytPlayerRef.current;
        const playerState = yt.getPlayerState?.();
        const curYtTime = yt.getCurrentTime ? yt.getCurrentTime() : 0;

        // Sync playlist track if host changed it
        if (!isHost && currentBroadcast.playlistIndex !== undefined && typeof yt.getPlaylistIndex === 'function') {
          const curIndex = yt.getPlaylistIndex();
          if (curIndex >= 0 && curIndex !== currentBroadcast.playlistIndex && typeof yt.playVideoAt === 'function') {
            yt.playVideoAt(currentBroadcast.playlistIndex);
          }
        }

        // Don't force restart if video ended naturally (state 0) and loop is off
        if (playerState === 0 && !currentBroadcast.loop) {
          // Video ended — don't restart
        } else {
          // If seek action was received from host, jump immediately with allowSeekAhead = true
          if (currentBroadcast.action === 'seek' || Math.abs(curYtTime - effectiveTime) > 1.5) {
            yt.seekTo(effectiveTime, true);
          }

          if (currentBroadcast.playing && !isLocallyPaused) {
            yt.playVideo();
          } else {
            yt.pauseVideo();
          }
        }
      } catch {
        // player transitioning
      }
    }
  }, [currentBroadcast, isLocallyPaused, duration]);

  // Continuous Auto-Sync ticker (Keeps peers synchronized without manual intervention)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!currentBroadcast) return;
      const rawTarget = calculateEffectiveTime(currentBroadcast);
      const targetTime = (currentBroadcast.loop && duration > 0)
        ? (rawTarget % duration)
        : rawTarget;

      if (currentBroadcast.mediaType === 'direct' && videoRef.current) {
        const vid = videoRef.current;
        setLocalProgress(vid.currentTime);
        if (vid.duration) setDuration(vid.duration);

        if (currentBroadcast.loop && isHost && vid.duration > 0 && vid.currentTime >= vid.duration - 0.5) {
          vid.currentTime = 0;
          vid.play().catch(() => {});
          onPlayAll(0);
          return;
        }

        if (currentBroadcast.playing && !isLocallyPaused) {
          // Don't force restart if video ended naturally and loop is off
          if (vid.ended && !currentBroadcast.loop) {
            // Video ended — skip forcing play
          } else {
            if (vid.paused) vid.play().catch(() => {});
            if (Math.abs(vid.currentTime - targetTime) > 1.8) {
              vid.currentTime = targetTime;
            }
          }
        }
      } else if (currentBroadcast.mediaType === 'youtube' && isPlayerReadyRef.current && ytPlayerRef.current?.getCurrentTime) {
        try {
          const yt = ytPlayerRef.current;
          const cur = yt.getCurrentTime();
          const dur = yt.getDuration();
          if (cur !== undefined && !Number.isNaN(cur)) setLocalProgress(cur);
          if (dur && !Number.isNaN(dur) && dur > 0) setDuration(dur);

          // If Host: check if track index or video ID changed and broadcast it
          if (isHost && onUpdateTrack && typeof yt.getPlaylistIndex === 'function') {
            const curIndex = yt.getPlaylistIndex();
            const videoData = typeof yt.getVideoData === 'function' ? yt.getVideoData() : null;
            const curVideoId = videoData?.video_id || null;
            const curTitle = videoData?.title || null;

            if (curIndex >= 0 && (curIndex !== currentBroadcast.playlistIndex || (curVideoId && curVideoId !== currentBroadcast.videoId))) {
              onUpdateTrack({
                playlistIndex: curIndex,
                videoId: curVideoId || undefined,
                title: curTitle || currentBroadcast.title,
                currentTime: cur || 0,
              });
            }
          }

          // If Peer (Listener): verify we are playing the host's playlist track
          if (!isHost && currentBroadcast.playlistIndex !== undefined && typeof yt.getPlaylistIndex === 'function') {
            const curIndex = yt.getPlaylistIndex();
            if (curIndex >= 0 && curIndex !== currentBroadcast.playlistIndex && typeof yt.playVideoAt === 'function') {
              yt.playVideoAt(currentBroadcast.playlistIndex);
            }
          }

          // If loop is on, and the video ended or is within 0.5s of the end on host
          if (currentBroadcast.loop && isHost && dur > 0 && cur >= dur - 0.5) {
            yt.seekTo(0, true);
            yt.playVideo();
            onPlayAll(0);
            return;
          }

          if (currentBroadcast.playing && !isLocallyPaused) {
            const playerState = yt.getPlayerState?.();
            // Don't force restart if video ended (state 0) and loop is off
            if (playerState === 0 && !currentBroadcast.loop) {
              // Video ended — skip forcing play
            } else {
              if (playerState !== 1 && playerState !== 3) {
                yt.playVideo();
              }
              const isAtEnd = dur > 0 && (dur - cur < 1.0);
              if (cur !== undefined && Math.abs(cur - targetTime) > 1.8 && !isAtEnd) {
                yt.seekTo(targetTime, true);
              }
            }
          }
        } catch {
          // ignore
        }
      } else {
        setLocalProgress(targetTime);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentBroadcast, isLocallyPaused, duration, isHost, onPlayAll, onUpdateTrack]);

  // Volume control
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume;
    }
    if (isPlayerReadyRef.current && ytPlayerRef.current?.setVolume) {
      try {
        if (isMuted) ytPlayerRef.current.mute();
        else {
          ytPlayerRef.current.unMute();
          ytPlayerRef.current.setVolume(volume * 100);
        }
      } catch {
        // ignore
      }
    }
  }, [volume, isMuted]);

  // Instant Manual Re-sync button
  const handleManualSync = useCallback(() => {
    if (!currentBroadcast) return;
    setIsLocallyPaused(false);
    const target = calculateEffectiveTime(currentBroadcast);
    setLocalProgress(target);

    if (currentBroadcast.mediaType === 'direct' && videoRef.current) {
      videoRef.current.currentTime = target;
      if (currentBroadcast.playing) videoRef.current.play().catch(() => {});
      else videoRef.current.pause();
    } else if (ytPlayerRef.current?.seekTo) {
      const yt = ytPlayerRef.current;
      // If playlist index differs, jump to the correct song first!
      if (currentBroadcast.playlistIndex !== undefined && typeof yt.getPlaylistIndex === 'function') {
        const curIdx = yt.getPlaylistIndex();
        if (curIdx >= 0 && curIdx !== currentBroadcast.playlistIndex && typeof yt.playVideoAt === 'function') {
          yt.playVideoAt(currentBroadcast.playlistIndex);
        }
      }
      yt.seekTo(target, true);
      if (currentBroadcast.playing) yt.playVideo();
      else yt.pauseVideo();
    }
    setSyncNotice(`Synced with ${currentBroadcast.hostName}!`);
    setTimeout(() => setSyncNotice(null), 2000);
  }, [currentBroadcast]);

  // Play / Pause handler
  const handleTogglePlay = useCallback(() => {
    if (isHost) {
      // Host plays/pauses for all peers
      if (currentBroadcast?.playing) {
        onPauseAll(localProgress);
      } else {
        onPlayAll(localProgress);
      }
    } else {
      // Listener pauses/resumes only for themselves
      if (isLocallyPaused) {
        setIsLocallyPaused(false);
        if (currentBroadcast) {
          const target = calculateEffectiveTime(currentBroadcast);
          if (ytPlayerRef.current?.seekTo) {
            ytPlayerRef.current.seekTo(target, true);
            ytPlayerRef.current.playVideo();
          }
        }
      } else {
        setIsLocallyPaused(true);
        if (ytPlayerRef.current?.pauseVideo) {
          ytPlayerRef.current.pauseVideo();
        }
        if (videoRef.current) {
          videoRef.current.pause();
        }
      }
    }
  }, [isHost, currentBroadcast, isLocallyPaused, localProgress, onPauseAll, onPlayAll]);

  // Seek handler (Zero lag commit)
  const handleSeekCommit = useCallback(
    (_: any, val: number | number[]) => {
      const target = typeof val === 'number' ? val : val[0];
      setLocalProgress(target);

      if (isHost) {
        onSeekAll(target);
      }

      if (videoRef.current) {
        videoRef.current.currentTime = target;
      } else if (ytPlayerRef.current?.seekTo) {
        ytPlayerRef.current.seekTo(target, true);
      }
    },
    [isHost, onSeekAll]
  );

  const handleStartNewStream = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setIsLocallyPaused(false);
    onStartBroadcast(urlInput.trim());
    setUrlInput('');
  };

  // Close handler: if host, stop broadcast first so all peers lose it
  const handleClose = useCallback(() => {
    if (isHost) {
      onStopBroadcast();
    }
    onClose();
  }, [isHost, onStopBroadcast, onClose]);

  // Local-only pause/resume (for host's personal mute AND non-host's pause)
  const handleLocalToggle = useCallback(() => {
    if (isLocallyPaused) {
      setIsLocallyPaused(false);
      if (currentBroadcast) {
        const target = calculateEffectiveTime(currentBroadcast);
        if (ytPlayerRef.current?.seekTo) {
          ytPlayerRef.current.seekTo(target, true);
          ytPlayerRef.current.playVideo();
        }
        if (videoRef.current) {
          videoRef.current.currentTime = target;
          videoRef.current.play().catch(() => {});
        }
      }
    } else {
      setIsLocallyPaused(true);
      if (ytPlayerRef.current?.pauseVideo) {
        ytPlayerRef.current.pauseVideo();
      }
      if (videoRef.current) {
        videoRef.current.pause();
      }
    }
  }, [currentBroadcast, isLocallyPaused]);

  // Dragging event handlers for the minimized floating dock
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // If clicking an interactive button, let the button handle it
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    e.preventDefault();

    const rect = pillRef.current?.getBoundingClientRect();
    const currentX = rect ? rect.left : (minimizedPos?.x ?? (window.innerWidth - 300));
    const currentY = rect ? rect.top : (minimizedPos?.y ?? (window.innerHeight - 80));

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: currentX,
      startPosY: currentY,
      hasMoved: false,
    };
    hasDraggedRef.current = false;
  }, [minimizedPos]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;

      if (!dragRef.current.hasMoved && Math.hypot(deltaX, deltaY) > 3) {
        dragRef.current.hasMoved = true;
        hasDraggedRef.current = true;
        setIsDragging(true);
      }

      if (dragRef.current.hasMoved) {
        const pillWidth = pillRef.current?.offsetWidth || 280;
        const pillHeight = pillRef.current?.offsetHeight || 50;

        const targetX = dragRef.current.startPosX + deltaX;
        const targetY = dragRef.current.startPosY + deltaY;

        const clampedX = Math.max(8, Math.min(window.innerWidth - pillWidth - 8, targetX));
        const clampedY = Math.max(8, Math.min(window.innerHeight - pillHeight - 8, targetY));

        setMinimizedPos({ x: clampedX, y: clampedY });
      }
    };

    const handlePointerUp = () => {
      if (dragRef.current) {
        if (dragRef.current.hasMoved) {
          setTimeout(() => {
            hasDraggedRef.current = false;
          }, 80);
        } else {
          hasDraggedRef.current = false;
        }
        dragRef.current = null;
        setIsDragging(false);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setMinimizedPos(prev => {
        if (!prev) return null;
        const pillWidth = pillRef.current?.offsetWidth || 280;
        const pillHeight = pillRef.current?.offsetHeight || 50;
        const clampedX = Math.max(8, Math.min(window.innerWidth - pillWidth - 8, prev.x));
        const clampedY = Math.max(8, Math.min(window.innerHeight - pillHeight - 8, prev.y));
        return { x: clampedX, y: clampedY };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const formatTime = (secs: number) => {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const remainder = s % 60;
    return `${m}:${remainder < 10 ? '0' : ''}${remainder}`;
  };

  const otherBroadcasts = broadcasts.filter(b => b.hostName !== currentBroadcast?.hostName);

  // ---- RENDER: OVERLAY CONTROLS (used in wide/full screen modes) ----
  const renderOverlayControls = () => {
    if (!currentBroadcast || !isImmersive) return null;

    return (
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          background: 'linear-gradient(0deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 60%, transparent 100%)',
          opacity: showOverlayControls ? 1 : 0,
          transform: showOverlayControls ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.35s ease, transform 0.35s ease',
          pointerEvents: showOverlayControls ? 'auto' : 'none',
          px: { xs: 2, sm: 4 },
          pt: 6,
          pb: 2.5,
        }}
        onMouseMove={resetOverlayTimer}
      >
        {/* Title */}
        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 700,
            color: '#f8fafc',
            mb: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {currentBroadcast.title}
          {isHost && <span style={{ color: '#c084fc', marginLeft: 8, fontSize: 11 }}>👑 Host</span>}
          {!isHost && <span style={{ color: '#60a5fa', marginLeft: 8, fontSize: 11 }}>🎧 {currentBroadcast.hostName}</span>}
        </Typography>

        {/* Progress Slider */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Typography sx={{ fontSize: 11, color: '#cbd5e1', minWidth: 38, fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(localProgress)}
          </Typography>
          <Slider
            size="small"
            min={0}
            max={duration || 100}
            value={Math.min(localProgress, duration || 100)}
            onChange={(_, val) => setLocalProgress(typeof val === 'number' ? val : val[0])}
            onChangeCommitted={handleSeekCommit}
            disabled={!isHost}
            sx={{
              color: '#a855f7',
              height: 5,
              '& .MuiSlider-thumb': { width: 12, height: 12 },
              '& .MuiSlider-rail': { bgcolor: 'rgba(255,255,255,0.18)' },
            }}
          />
          <Typography sx={{ fontSize: 11, color: '#cbd5e1', minWidth: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(duration)}
          </Typography>
        </Box>

        {/* Controls Row */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Left: Volume */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 120 }}>
            <IconButton
              size="small"
              onClick={() => setIsMuted(!isMuted)}
              sx={{ color: isMuted ? '#ef4444' : '#cbd5e1', p: 0.5, '&:hover': { color: '#f8fafc' } }}
            >
              {isMuted || volume === 0 ? <VolumeOff sx={{ fontSize: 18 }} /> : <VolumeUp sx={{ fontSize: 18 }} />}
            </IconButton>
            <Slider
              size="small"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(_, val) => {
                const nextVal = typeof val === 'number' ? val : val[0];
                setVolume(nextVal);
                if (isMuted && nextVal > 0) setIsMuted(false);
              }}
              sx={{
                width: 70,
                color: '#a855f7',
                height: 3,
                '& .MuiSlider-thumb': { width: 10, height: 10 },
              }}
            />
          </Box>

          {/* Center: Primary playback controls */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {isHost && (
              <IconButton
                size="small"
                onClick={() => handleSeekCommit(null, Math.max(0, localProgress - 10))}
                sx={{ color: '#cbd5e1', p: 0.5, '&:hover': { color: '#f8fafc' } }}
              >
                <FastRewind sx={{ fontSize: 20 }} />
              </IconButton>
            )}

            {isHost && currentBroadcast.mediaType === 'youtube' && (
              <IconButton
                size="small"
                onClick={() => { if (ytPlayerRef.current?.previousVideo) ytPlayerRef.current.previousVideo(); }}
                sx={{ color: '#c084fc', p: 0.5, '&:hover': { color: '#e879f9' } }}
              >
                <SkipPrevious sx={{ fontSize: 24 }} />
              </IconButton>
            )}

            {/* Hero play/pause */}
            <IconButton
              size="medium"
              onClick={isHost ? handleTogglePlay : handleLocalToggle}
              sx={{
                color: '#fff',
                bgcolor: 'rgba(168, 85, 247, 0.6)',
                p: 1.25,
                '&:hover': { bgcolor: 'rgba(168, 85, 247, 0.85)' },
                transition: 'background 0.2s ease',
              }}
            >
              {(isHost ? currentBroadcast.playing : !isLocallyPaused && currentBroadcast.playing) ? (
                <Pause sx={{ fontSize: 28 }} />
              ) : (
                <PlayArrow sx={{ fontSize: 28 }} />
              )}
            </IconButton>

            {isHost && currentBroadcast.mediaType === 'youtube' && (
              <IconButton
                size="small"
                onClick={() => { if (ytPlayerRef.current?.nextVideo) ytPlayerRef.current.nextVideo(); }}
                sx={{ color: '#c084fc', p: 0.5, '&:hover': { color: '#e879f9' } }}
              >
                <SkipNext sx={{ fontSize: 24 }} />
              </IconButton>
            )}

            {isHost && (
              <IconButton
                size="small"
                onClick={() => handleSeekCommit(null, localProgress + 10)}
                sx={{ color: '#cbd5e1', p: 0.5, '&:hover': { color: '#f8fafc' } }}
              >
                <FastForward sx={{ fontSize: 20 }} />
              </IconButton>
            )}

            {!isHost && (
              <Tooltip title="Re-sync to host">
                <IconButton
                  size="small"
                  onClick={handleManualSync}
                  sx={{ color: '#c084fc', p: 0.5, '&:hover': { color: '#e879f9', bgcolor: 'rgba(168,85,247,0.2)' } }}
                >
                  <SyncIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>

          {/* Right: Loop, AutoPlay, View mode toggles */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 120, justifyContent: 'flex-end' }}>
            {isHost && (
              <IconButton
                size="small"
                onClick={onToggleLoop}
                sx={{
                  p: 0.5,
                  color: currentBroadcast.loop ? '#c084fc' : '#64748b',
                  bgcolor: currentBroadcast.loop ? 'rgba(168,85,247,0.25)' : 'transparent',
                  borderRadius: 1.5,
                  '&:hover': { color: '#c084fc', bgcolor: 'rgba(168,85,247,0.2)' },
                }}
              >
                <Repeat sx={{ fontSize: 18 }} />
              </IconButton>
            )}
            {isHost && (
              <IconButton
                size="small"
                onClick={onToggleAutoPlayNext}
                sx={{
                  p: 0.5,
                  color: currentBroadcast.autoPlayNext ? '#60a5fa' : '#64748b',
                  bgcolor: currentBroadcast.autoPlayNext ? 'rgba(59,130,246,0.25)' : 'transparent',
                  borderRadius: 1.5,
                  '&:hover': { color: '#60a5fa', bgcolor: 'rgba(59,130,246,0.2)' },
                }}
              >
                <QueueMusic sx={{ fontSize: 18 }} />
              </IconButton>
            )}

            {/* Toggle wide / full from overlay */}
            <IconButton
              size="small"
              onClick={() => {
                if (isFullScreen) {
                  setIsFullScreen(false);
                } else if (isWideScreen) {
                  setIsWideScreen(false);
                }
              }}
              sx={{ color: '#cbd5e1', p: 0.5, '&:hover': { color: '#f8fafc' } }}
            >
              <FullscreenExit sx={{ fontSize: 20 }} />
            </IconButton>
          </Box>
        </Box>
      </Box>
    );
  };

  return (
    <Box
      ref={dockContainerRef}
      sx={{
        position: 'fixed',
        ...(isMinimized && minimizedPos
          ? { left: minimizedPos.x, top: minimizedPos.y, right: 'auto', bottom: 'auto' }
          : isFullScreen
          ? { inset: 0, width: '100vw', height: '100vh', zIndex: 99999, bgcolor: '#000' }
          : isWideScreen
          ? { inset: 0, width: '100vw', height: '100vh', zIndex: 99999, bgcolor: '#000' }
          : { bottom: 20, right: 20, width: 380, maxWidth: 'calc(100vw - 32px)', zIndex: 1000 }),
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, sans-serif',
        userSelect: isDragging ? 'none' : 'auto',
        transition: isImmersive ? 'none' : 'width 0.25s ease, height 0.25s ease',
        cursor: isImmersive && !showOverlayControls ? 'none' : 'auto',
      }}
    >
      {/* 
        CRITICAL: Video / YouTube player elements stay PERMANENTLY mounted in DOM so audio never stops when minimized!
      */}
      <Box
        sx={{
          position: isMinimized ? 'fixed' : 'relative',
          top: isMinimized ? -9999 : 0,
          left: isMinimized ? -9999 : 0,
          width: isMinimized ? 1 : '100%',
          height: isMinimized
            ? 1
            : isImmersive
            ? '100%'
            : (currentBroadcast ? 165 : 0),
          flex: isImmersive ? 1 : undefined,
          opacity: isMinimized ? 0 : 1,
          pointerEvents: isMinimized ? 'none' : 'auto',
          bgcolor: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: isMinimized || isImmersive ? 0 : '16px 16px 0 0',
          transition: isImmersive ? 'none' : 'height 0.25s ease',
        }}
      >
        {youtubeVideoId || youtubePlaylistId ? (
          <Box
            id={ytContainerId.current}
            sx={{
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              '& iframe': {
                width: '100% !important',
                height: '100% !important',
              },
            }}
          />
        ) : currentBroadcast?.mediaType === 'direct' ? (
          <video
            ref={videoRef}
            src={currentBroadcast.url}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            playsInline
            onEnded={() => {
              if (currentBroadcast?.loop) {
                if (videoRef.current) {
                  videoRef.current.currentTime = 0;
                  videoRef.current.play().catch(() => {});
                }
                if (isHost) {
                  onPlayAll(0);
                }
              } else if (isHost) {
                // Video ended naturally — host signals pause for all
                onPauseAll(0);
              }
            }}
          />
        ) : null}

        {/* IMMERSIVE OVERLAY CONTROLS (auto-hide on inactivity) */}
        {renderOverlayControls()}
      </Box>

      {/* MINIMIZED FLOATING PILL */}
      {isMinimized && (
        <Box
          ref={pillRef}
          onPointerDown={handlePointerDown}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            px: 1.5,
            py: 0.85,
            borderRadius: '40px',
            background: 'rgba(13, 17, 23, 0.96)',
            backdropFilter: 'blur(20px)',
            border: isDragging ? '1px solid rgba(168, 85, 247, 0.8)' : '1px solid rgba(168, 85, 247, 0.35)',
            boxShadow: isDragging
              ? '0 16px 40px rgba(0,0,0,0.7), 0 0 24px rgba(168, 85, 247, 0.45)'
              : '0 12px 32px rgba(0,0,0,0.5), 0 0 16px rgba(168, 85, 247, 0.2)',
            color: '#f8fafc',
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
            transition: isDragging ? 'none' : 'box-shadow 0.2s ease, border-color 0.2s ease',
          }}
        >
          {/* Visual Drag Grip Handle */}
          <Tooltip title="Drag to move anywhere" arrow>
            <DragIndicator
              sx={{
                fontSize: 16,
                color: isDragging ? '#c084fc' : '#94a3b8',
                opacity: 0.8,
                cursor: isDragging ? 'grabbing' : 'grab',
                mr: -0.5,
              }}
            />
          </Tooltip>

          <IconButton
            size="small"
            onClick={handleTogglePlay}
            sx={{
              bgcolor: 'rgba(168, 85, 247, 0.25)',
              color: '#c084fc',
              '&:hover': { bgcolor: 'rgba(168, 85, 247, 0.4)' },
            }}
          >
            {(isHost ? currentBroadcast?.playing : !isLocallyPaused && currentBroadcast?.playing) ? (
              <Pause sx={{ fontSize: 16 }} />
            ) : (
              <PlayArrow sx={{ fontSize: 16 }} />
            )}
          </IconButton>

          <Box
            onClick={() => {
              if (!hasDraggedRef.current) {
                setIsMinimized(false);
              }
            }}
            sx={{
              maxWidth: 160,
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#f3e8ff' }}>
              {currentBroadcast ? currentBroadcast.title : 'Watch Party'}
            </Typography>
            <Typography sx={{ fontSize: 9, color: isLocallyPaused ? '#fca5a5' : '#a855f7' }}>
              {isHost ? '👑 Host' : `🎧 ${currentBroadcast?.hostName || 'Room'}`} · {formatTime(localProgress)}
            </Typography>
          </Box>

          <IconButton
            size="small"
            onClick={() => {
              if (!hasDraggedRef.current) {
                setIsMinimized(false);
              }
            }}
            title="Expand Watch Party"
            sx={{ color: '#94a3b8' }}
          >
            <OpenInFull sx={{ fontSize: 14 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={handleClose}
            title={isHost ? "Stop Broadcast & Close Watch Party" : "Close Watch Party (stay on canvas)"}
            sx={{ color: '#ef4444', p: 0.5 }}
          >
            <Close sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      )}

      {/* FULL UNCLUTTERED DOCK — hidden in immersive (wide/full) modes */}
      {!isMinimized && !isImmersive && (
        <Box
          sx={{
            width: '100%',
            borderRadius: currentBroadcast ? '0 0 16px 16px' : '16px',
            background: 'rgba(15, 20, 32, 0.95)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(168, 85, 247, 0.22)',
            borderTop: currentBroadcast ? 'none' : '1px solid rgba(168, 85, 247, 0.22)',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 30px rgba(168, 85, 247, 0.14)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            color: '#f8fafc',
          }}
        >
          {/* Header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              py: 1.25,
              background: 'linear-gradient(90deg, rgba(124,58,237,0.18) 0%, rgba(59,130,246,0.1) 100%)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MusicNote sx={{ fontSize: 17, color: '#c084fc' }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                Watch Party
              </Typography>
              {currentBroadcast && (
                <Chip
                  size="small"
                  label={isHost ? '👑 Host (You)' : `🎧 ${currentBroadcast.hostName}`}
                  sx={{
                    height: 18,
                    fontSize: 9,
                    fontWeight: 700,
                    bgcolor: isHost ? 'rgba(168, 85, 247, 0.25)' : 'rgba(59, 130, 246, 0.2)',
                    color: isHost ? '#c084fc' : '#60a5fa',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                />
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {/* Wide Screen / Theater View Button */}
              <Tooltip title={isWideScreen ? "Standard view (Esc)" : "Wide screen / Theater view"}>
                <IconButton
                  size="small"
                  onClick={() => {
                    setIsWideScreen(prev => !prev);
                    if (isFullScreen) setIsFullScreen(false);
                  }}
                  sx={{
                    color: isWideScreen ? '#c084fc' : '#94a3b8',
                    bgcolor: isWideScreen ? 'rgba(168,85,247,0.2)' : 'transparent',
                    p: 0.5,
                    borderRadius: 1.5,
                    border: isWideScreen ? '1px solid rgba(168,85,247,0.4)' : '1px solid transparent',
                    '&:hover': { color: '#f8fafc', bgcolor: 'rgba(168,85,247,0.15)' },
                  }}
                >
                  <AspectRatio sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>

              {/* Full Screen Mode Button */}
              <Tooltip title={isFullScreen ? "Exit Fullscreen (Esc)" : "Full screen mode"}>
                <IconButton
                  size="small"
                  onClick={() => {
                    setIsFullScreen(prev => !prev);
                    if (!isFullScreen) setIsWideScreen(false);
                  }}
                  sx={{
                    color: isFullScreen ? '#60a5fa' : '#94a3b8',
                    bgcolor: isFullScreen ? 'rgba(59,130,246,0.2)' : 'transparent',
                    p: 0.5,
                    borderRadius: 1.5,
                    border: isFullScreen ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                    '&:hover': { color: '#f8fafc', bgcolor: 'rgba(59,130,246,0.15)' },
                  }}
                >
                  {isFullScreen ? <FullscreenExit sx={{ fontSize: 18 }} /> : <Fullscreen sx={{ fontSize: 18 }} />}
                </IconButton>
              </Tooltip>

              <IconButton
                size="small"
                onClick={() => {
                  if (isFullScreen) setIsFullScreen(false);
                  if (isWideScreen) setIsWideScreen(false);
                  setIsMinimized(true);
                }}
                title="Minimize (music continues playing!)"
                sx={{ color: '#94a3b8', p: 0.5, '&:hover': { color: '#f8fafc' } }}
              >
                <Remove sx={{ fontSize: 16 }} />
              </IconButton>
              <IconButton
                size="small"
                onClick={handleClose}
                title={isHost ? "Stop Broadcast & Close Watch Party (stay on canvas)" : "Close Watch Party (stay on canvas)"}
                sx={{ color: '#94a3b8', p: 0.5, '&:hover': { color: '#ef4444' } }}
              >
                <Close sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          </Box>

          {/* ACTIVE PEER BROADCASTS SELECTOR (When other peers are broadcasting) */}
          {broadcasts.length > 0 && (
            <Box
              sx={{
                px: 2,
                py: 0.75,
                bgcolor: 'rgba(255, 255, 255, 0.03)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Radio sx={{ fontSize: 13, color: '#a855f7' }} />
                <Typography sx={{ fontSize: 10, color: '#cbd5e1' }}>
                  {otherBroadcasts.length > 0
                    ? `${broadcasts.length} streams in room`
                    : syncNotice || (isHost ? 'Broadcasting live to peers' : `Synced with ${currentBroadcast?.hostName}`)}
                </Typography>
              </Box>

              {otherBroadcasts.length > 0 && (
                <Button
                  size="small"
                  onClick={() => setShowPeerList(prev => !prev)}
                  sx={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'none',
                    py: 0.2,
                    px: 0.75,
                    color: '#c084fc',
                  }}
                >
                  {showPeerList ? 'Hide Streams' : 'Switch Stream ▾'}
                </Button>
              )}
            </Box>
          )}

          {/* Dropdown list of other peer streams */}
          {showPeerList && otherBroadcasts.length > 0 && (
            <Box sx={{ p: 1, bgcolor: 'rgba(15, 23, 42, 0.98)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <Typography sx={{ fontSize: 9, color: '#94a3b8', mb: 0.5, px: 1, fontWeight: 700, textTransform: 'uppercase' }}>
                Tune into peer stream:
              </Typography>
              {otherBroadcasts.map(b => (
                <Box
                  key={b.hostName}
                  onClick={() => {
                    onTuneIn(b.hostName);
                    setShowPeerList(false);
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 0.75,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(168, 85, 247, 0.15)' },
                  }}
                >
                  <Box sx={{ overflow: 'hidden' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.title}
                    </Typography>
                    <Typography sx={{ fontSize: 9, color: '#a855f7' }}>
                      Host: {b.hostName} · {b.playing ? '▶ Live' : '⏸ Paused'}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    startIcon={<Headphones sx={{ fontSize: 11 }} />}
                    sx={{
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: 'none',
                      color: '#c084fc',
                      bgcolor: 'rgba(168, 85, 247, 0.15)',
                      py: 0.25,
                      px: 1,
                    }}
                  >
                    Tune In
                  </Button>
                </Box>
              ))}
            </Box>
          )}

          {/* If there is an active broadcast */}
          {currentBroadcast ? (
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {/* Title & Loop/Autoplay tags */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#f8fafc',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 220,
                  }}
                >
                  {currentBroadcast.title}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {currentBroadcast.loop && (
                    <Chip size="small" label="Loop" sx={{ height: 16, fontSize: 8, bgcolor: 'rgba(168,85,247,0.2)', color: '#c084fc' }} />
                  )}
                  {currentBroadcast.autoPlayNext && (
                    <Chip size="small" label="AutoPlay" sx={{ height: 16, fontSize: 8, bgcolor: 'rgba(59,130,246,0.2)', color: '#60a5fa' }} />
                  )}
                </Box>
              </Box>

              {/* Progress Slider (Zero-lag) */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: 10, color: '#94a3b8', minWidth: 30, fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(localProgress)}
                </Typography>
                <Slider
                  size="small"
                  min={0}
                  max={duration || 100}
                  value={Math.min(localProgress, duration || 100)}
                  onChange={(_, val) => setLocalProgress(typeof val === 'number' ? val : val[0])}
                  onChangeCommitted={handleSeekCommit}
                  disabled={!isHost} // Only host seeks for everyone
                  sx={{
                    color: '#a855f7',
                    height: 4,
                    '& .MuiSlider-thumb': { width: 10, height: 10 },
                  }}
                />
                <Typography sx={{ fontSize: 10, color: '#94a3b8', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(duration)}
                </Typography>
              </Box>

              {/* ROW 1: PRIMARY PLAYBACK BAR (Centered & Perfectly Spaced) */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                {isHost ? (
                  <>
                    {/* Seek Backward 10s */}
                    <Tooltip title="Seek backward 10s">
                      <IconButton
                        size="small"
                        onClick={() => handleSeekCommit(null, Math.max(0, localProgress - 10))}
                        sx={{ color: '#94a3b8', p: 0.75, '&:hover': { color: '#f8fafc' } }}
                      >
                        <FastRewind sx={{ fontSize: 19 }} />
                      </IconButton>
                    </Tooltip>

                    {/* Previous Track in YouTube (Available to ANY host) */}
                    {currentBroadcast.mediaType === 'youtube' && (
                      <Tooltip title="Previous track">
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (ytPlayerRef.current?.previousVideo) {
                              ytPlayerRef.current.previousVideo();
                            }
                          }}
                          sx={{
                            color: '#c084fc',
                            p: 0.75,
                            '&:hover': { color: '#e879f9', bgcolor: 'rgba(168,85,247,0.15)' },
                          }}
                        >
                          <SkipPrevious sx={{ fontSize: 21 }} />
                        </IconButton>
                      </Tooltip>
                    )}

                    {/* HERO PLAY ALL / PAUSE ALL BUTTON */}
                    <Tooltip title={currentBroadcast.playing ? 'Pause for ALL peers' : 'Play for ALL peers'}>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={handleTogglePlay}
                        startIcon={currentBroadcast.playing ? <Pause sx={{ fontSize: 16 }} /> : <PlayArrow sx={{ fontSize: 16 }} />}
                        sx={{
                          px: 2,
                          py: 0.5,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'none',
                          borderRadius: 2.5,
                          background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
                          boxShadow: '0 4px 14px rgba(168,85,247,0.4)',
                          '&:hover': {
                            background: 'linear-gradient(135deg, #9333ea 0%, #4f46e5 100%)',
                            boxShadow: '0 6px 18px rgba(168,85,247,0.55)',
                          },
                        }}
                      >
                        {currentBroadcast.playing ? 'Pause All' : 'Play All'}
                      </Button>
                    </Tooltip>

                    {/* Next Track in YouTube (Available to ANY host) */}
                    {currentBroadcast.mediaType === 'youtube' && (
                      <Tooltip title="Next track">
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (ytPlayerRef.current?.nextVideo) {
                              ytPlayerRef.current.nextVideo();
                            }
                          }}
                          sx={{
                            color: '#c084fc',
                            p: 0.75,
                            '&:hover': { color: '#e879f9', bgcolor: 'rgba(168,85,247,0.15)' },
                          }}
                        >
                          <SkipNext sx={{ fontSize: 21 }} />
                        </IconButton>
                      </Tooltip>
                    )}

                    {/* Seek Forward 10s */}
                    <Tooltip title="Seek forward 10s">
                      <IconButton
                        size="small"
                        onClick={() => handleSeekCommit(null, localProgress + 10)}
                        sx={{ color: '#94a3b8', p: 0.75, '&:hover': { color: '#f8fafc' } }}
                      >
                        <FastForward sx={{ fontSize: 19 }} />
                      </IconButton>
                    </Tooltip>
                  </>
                ) : (
                  // Listener Playback Bar
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                    <Tooltip title="Re-sync audio to host in real-time">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleManualSync}
                        startIcon={<SyncIcon sx={{ fontSize: 15 }} />}
                        sx={{
                          px: 1.5,
                          py: 0.45,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'none',
                          borderRadius: 2,
                          color: '#c084fc',
                          borderColor: 'rgba(168,85,247,0.4)',
                          bgcolor: 'rgba(168,85,247,0.08)',
                          '&:hover': { bgcolor: 'rgba(168,85,247,0.2)', borderColor: '#c084fc' },
                        }}
                      >
                        Sync to Host
                      </Button>
                    </Tooltip>

                    <Tooltip title={isLocallyPaused ? 'Resume sound for you' : 'Pause sound for you only'}>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={handleLocalToggle}
                        startIcon={isLocallyPaused ? <PlayArrow sx={{ fontSize: 15 }} /> : <Pause sx={{ fontSize: 15 }} />}
                        sx={{
                          px: 1.5,
                          py: 0.45,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'none',
                          borderRadius: 2,
                          bgcolor: isLocallyPaused ? '#22c55e' : '#f43f5e',
                          '&:hover': { bgcolor: isLocallyPaused ? '#16a34a' : '#e11d48' },
                        }}
                      >
                        {isLocallyPaused ? 'Resume (Me)' : 'Pause (Me)'}
                      </Button>
                    </Tooltip>
                  </Box>
                )}
              </Box>

              {/* ROW 2: SECONDARY CONTROLS (Host Personal Mute, Loop, AutoPlay, Volume) */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  pt: 0.5,
                  px: 0.5,
                }}
              >
                {/* Left: Host Personal Mute / Listener Badge */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {isHost ? (
                    <Tooltip title={isLocallyPaused ? 'Resume sound for you (peers still hear)' : 'Mute/Pause sound for you only (peers keep listening!)'}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleLocalToggle}
                        startIcon={isLocallyPaused ? <PlayArrow sx={{ fontSize: 13 }} /> : <Pause sx={{ fontSize: 13 }} />}
                        sx={{
                          px: 1.1,
                          py: 0.25,
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'none',
                          borderRadius: 1.75,
                          color: isLocallyPaused ? '#4ade80' : '#f87171',
                          borderColor: isLocallyPaused ? 'rgba(74, 222, 128, 0.4)' : 'rgba(248, 113, 113, 0.4)',
                          bgcolor: isLocallyPaused ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.08)',
                          '&:hover': {
                            borderColor: isLocallyPaused ? '#4ade80' : '#f87171',
                            bgcolor: isLocallyPaused ? 'rgba(74, 222, 128, 0.18)' : 'rgba(248, 113, 113, 0.15)',
                          },
                        }}
                      >
                        {isLocallyPaused ? 'Resume (Me)' : 'Pause (Me)'}
                      </Button>
                    </Tooltip>
                  ) : (
                    <Chip
                      size="small"
                      icon={<Headphones sx={{ fontSize: 12, color: '#c084fc !important' }} />}
                      label={`Tuned into ${currentBroadcast.hostName}`}
                      sx={{
                        height: 20,
                        fontSize: 9,
                        fontWeight: 600,
                        bgcolor: 'rgba(168,85,247,0.1)',
                        color: '#cbd5e1',
                        border: '1px solid rgba(168,85,247,0.2)',
                      }}
                    />
                  )}
                </Box>

                {/* Right: Loop, AutoPlay Playlist & Volume Control */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {/* Loop Track Button (Host Only) */}
                  {isHost && (
                    <Tooltip title={currentBroadcast.loop ? 'Loop Track: ON' : 'Loop Track: OFF'}>
                      <IconButton
                        size="small"
                        onClick={onToggleLoop}
                        sx={{
                          p: 0.5,
                          color: currentBroadcast.loop ? '#c084fc' : '#64748b',
                          bgcolor: currentBroadcast.loop ? 'rgba(168,85,247,0.2)' : 'transparent',
                          borderRadius: 1.5,
                          border: currentBroadcast.loop ? '1px solid rgba(168,85,247,0.4)' : '1px solid transparent',
                          '&:hover': { color: '#c084fc', bgcolor: 'rgba(168,85,247,0.15)' },
                        }}
                      >
                        <Repeat sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  )}

                  {/* AutoPlay / Next Playlist Button (Host Only) */}
                  {isHost && (
                    <Tooltip title={currentBroadcast.autoPlayNext ? 'AutoPlay / Next Track: ON' : 'AutoPlay / Next Track: OFF'}>
                      <IconButton
                        size="small"
                        onClick={onToggleAutoPlayNext}
                        sx={{
                          p: 0.5,
                          color: currentBroadcast.autoPlayNext ? '#60a5fa' : '#64748b',
                          bgcolor: currentBroadcast.autoPlayNext ? 'rgba(59,130,246,0.2)' : 'transparent',
                          borderRadius: 1.5,
                          border: currentBroadcast.autoPlayNext ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                          '&:hover': { color: '#60a5fa', bgcolor: 'rgba(59,130,246,0.15)' },
                        }}
                      >
                        <QueueMusic sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  )}

                  {/* Local Volume Slider (Available for ALL peers: host & listeners) */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      bgcolor: 'rgba(255,255,255,0.03)',
                      px: 0.75,
                      py: 0.25,
                      borderRadius: 1.75,
                      border: '1px solid rgba(255,255,255,0.07)',
                    }}
                  >
                    <Tooltip title={isMuted ? 'Unmute' : 'Mute'}>
                      <IconButton
                        size="small"
                        onClick={() => setIsMuted(!isMuted)}
                        sx={{ color: isMuted ? '#ef4444' : '#94a3b8', p: 0.25, '&:hover': { color: '#f8fafc' } }}
                      >
                        {isMuted || volume === 0 ? <VolumeOff sx={{ fontSize: 15 }} /> : <VolumeUp sx={{ fontSize: 15 }} />}
                      </IconButton>
                    </Tooltip>
                    <Slider
                      size="small"
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={(_, val) => {
                        const nextVal = typeof val === 'number' ? val : val[0];
                        setVolume(nextVal);
                        if (isMuted && nextVal > 0) setIsMuted(false);
                      }}
                      sx={{
                        width: 55,
                        color: '#a855f7',
                        height: 3,
                        '& .MuiSlider-thumb': { width: 8, height: 8 },
                      }}
                    />
                  </Box>
                </Box>
              </Box>
            </Box>
          ) : (
            // No stream playing state
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 12, color: '#cbd5e1', fontWeight: 600, mb: 0.5 }}>
                No active stream in room
              </Typography>
              <Typography sx={{ fontSize: 10, color: '#64748b' }}>
                Paste a YouTube video or playlist link below to start broadcasting!
              </Typography>
            </Box>
          )}

          {/* CLEAN UNCLUTTERED URL BROADCAST INPUT (No default songs) */}
          <Box sx={{ px: 2, pb: 2, pt: 0.5, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <form onSubmit={handleStartNewStream}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Box
                  sx={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                    px: 1.25,
                    py: 0.6,
                    borderRadius: 1.5,
                    bgcolor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    '&:focus-within': {
                      borderColor: '#a855f7',
                      boxShadow: '0 0 0 1px #a855f7',
                    },
                  }}
                >
                  <LinkIcon sx={{ fontSize: 14, color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Paste YouTube or playlist link…"
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#f8fafc',
                      fontSize: 11,
                      fontFamily: 'inherit',
                    }}
                  />
                </Box>
                <Button
                  type="submit"
                  variant="contained"
                  size="small"
                  disabled={!urlInput.trim()}
                  sx={{
                    bgcolor: '#a855f7',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 10,
                    textTransform: 'none',
                    borderRadius: 1.5,
                    py: 0.6,
                    px: 1.25,
                    whiteSpace: 'nowrap',
                    '&:hover': { bgcolor: '#9333ea' },
                  }}
                >
                  Broadcast
                </Button>
              </Box>
            </form>
          </Box>
        </Box>
      )}
    </Box>
  );
}
