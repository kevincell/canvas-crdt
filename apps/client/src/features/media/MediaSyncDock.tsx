import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Button,
  Slider,
  Tooltip,
  Chip,
  Menu,
  MenuItem,
  ListItemText,
  ListItemIcon,
  Divider,
  LinearProgress,
  CircularProgress,
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
  ClosedCaption,
  ClosedCaptionDisabled,
  Speed,
  ScreenShare,
  StopScreenShare,
  UploadFile,
  FiberManualRecord,
  Subtitles,
  Check,
  Keyboard,
} from '@mui/icons-material';
import {
  type PeerBroadcast,
  extractYouTubeId,
  extractYouTubePlaylistId,
  calculateEffectiveTime,
  resolveMediaUrl,
  getMediaServerOrigin,
  srtToVtt,
  PLAYBACK_SPEEDS,
} from './types';

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** Upload a file's raw bytes to the local media server, reporting progress (0–1). */
function uploadToMediaServer(
  file: Blob,
  filename: string,
  onProgress: (fraction: number) => void
): Promise<{ id: string; path: string; url: string; filename: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getMediaServerOrigin()}/api/media/upload`);
    // Header values must be ASCII — encode names like "gaana_ಕನ್ನಡ.mp3"
    xhr.setRequestHeader('X-Filename', encodeURIComponent(filename));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: any = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.path) resolve(data);
      else reject(new Error(data?.error || `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => {
      const endpoint = getMediaServerOrigin() || 'this page';
      reject(new Error(`Could not upload to the media server at ${endpoint}. Check that the host is reachable on the same network and that port 3001 is allowed.`));
    };
    xhr.ontimeout = () => reject(new Error('Upload timed out. Check the network connection and try again.'));
    xhr.timeout = 10 * 60 * 1000;
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(file);
  });
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    // Sliders, checkboxes and buttons are not "typing" — shortcuts still apply there
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(type);
  }
  return false;
}

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
  onStartBroadcast: (url: string, title?: string, options?: { subtitleUrl?: string }) => void;
  onTuneIn: (hostName: string) => void;
  onPlayAll: (time?: number) => void;
  onPauseAll: (time?: number) => void;
  onSeekAll: (time: number) => void;
  onToggleLoop: () => void;
  onToggleAutoPlayNext: () => void;
  onUpdateTrack?: (track: { videoId?: string; playlistIndex?: number; title?: string; currentTime?: number }) => void;
  onSetPlaybackRate?: (rate: number) => void;
  onSetSubtitleUrl?: (url: string | undefined) => void;
  /** Host heartbeat: publish the host player's real position so peers follow it exactly */
  onReanchor?: (time: number) => void;
  onStopBroadcast: () => void;
  onClose: () => void;
  // Screen share
  isScreenSharing?: boolean;
  localScreenStream?: MediaStream | null;
  incomingScreenStream?: MediaStream | null;
  screenShareHostName?: string | null;
  screenShareError?: string | null;
  onStartScreenShare?: (options?: { preferCurrentTab?: boolean; cropTo?: HTMLElement | null }) => Promise<MediaStream | null>;
  onStopScreenShare?: () => void;
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
  onSetPlaybackRate,
  onSetSubtitleUrl,
  onReanchor,
  onStopBroadcast,
  onClose,
  isScreenSharing = false,
  localScreenStream = null,
  incomingScreenStream = null,
  screenShareHostName = null,
  screenShareError = null,
  onStartScreenShare,
  onStopScreenShare,
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

  // Feature 3: Captions & Speed (per-peer / local)
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  // Listeners follow the host's speed; a listener may override it locally (which pauses auto-sync)
  const [speedOverride, setSpeedOverride] = useState<number | null>(null);
  // Listener skipped ahead/back on their own — auto-sync stays off until they press Sync to Host
  const [peerSkipped, setPeerSkipped] = useState(false);
  // Listener's measured offset from the host in seconds (+ ahead / - behind), for the readout
  const [syncDrift, setSyncDrift] = useState<number | null>(null);
  const [speedMenuAnchor, setSpeedMenuAnchor] = useState<HTMLElement | null>(null);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // Feature 1: Local file upload
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState('');
  const [isAudioOnly, setIsAudioOnly] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Feature 2: Screen share video element
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenPreviewRef = useRef<HTMLVideoElement | null>(null);
  const [screenNeedsClick, setScreenNeedsClick] = useState(false);
  const [isStartingShare, setIsStartingShare] = useState(false);
  // "Relay to peers": host streams its own player (this tab, cropped to the player) over WebRTC
  const [isRelaying, setIsRelaying] = useState(false);
  const playerAreaRef = useRef<HTMLDivElement | null>(null);
  const isViewingScreen = !!incomingScreenStream && !isScreenSharing;
  const screenActive = isViewingScreen || isScreenSharing;

  // Small transient toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, ms = 2600) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // Shortcut scope: only while the user is "in" the dock, so canvas Space-pan / arrow-nudge keep working
  const dockHoverRef = useRef(false);
  const dockFocusRef = useRef(false);

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
  // React owns only this wrapper. The YouTube API REPLACES its target element with an iframe, so
  // the target is created imperatively inside the wrapper — otherwise React later tries to remove
  // a node YouTube already swapped out, which crashed the player area (black screen) when
  // switching from a YouTube broadcast to an uploaded file.
  const ytHostRef = useRef<HTMLDivElement | null>(null);
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

  // ---- Playback speed / captions / quality (applied to whichever player is active) ----
  const hostRate = currentBroadcast?.playbackRate && currentBroadcast.playbackRate > 0 ? currentBroadcast.playbackRate : 1;
  const effectiveRate = isHost ? hostRate : (speedOverride ?? hostRate);
  // A listener who picked their own speed has deliberately left sync — don't fight them
  const isDesyncedByChoice = !isHost && (peerSkipped || (speedOverride !== null && Math.abs(speedOverride - hostRate) > 0.001));
  const isDirectMedia = currentBroadcast?.mediaType === 'direct';
  const isServerMedia = !!currentBroadcast?.url?.startsWith('/api/media/');
  const directSrc = isDirectMedia ? resolveMediaUrl(currentBroadcast?.url) : '';
  const subtitleSrc = currentBroadcast?.subtitleUrl ? resolveMediaUrl(currentBroadcast.subtitleUrl) : '';

  const effectiveRateRef = useRef(effectiveRate);
  effectiveRateRef.current = effectiveRate;
  const captionsEnabledRef = useRef(captionsEnabled);
  captionsEnabledRef.current = captionsEnabled;
  const isDesyncedRef = useRef(isDesyncedByChoice);
  isDesyncedRef.current = isDesyncedByChoice;

  const applyYtRate = useCallback((player: any, rate: number) => {
    try {
      if (!player?.setPlaybackRate) return;
      if (typeof player.getPlaybackRate === 'function' && Math.abs(player.getPlaybackRate() - rate) < 0.001) return;
      player.setPlaybackRate(rate);
    } catch { /* player transitioning */ }
  }, []);


  const ytCaptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyYtCaptions = useCallback((player: any, enabled: boolean) => {
    if (ytCaptionTimerRef.current) clearTimeout(ytCaptionTimerRef.current);
    if (!player) return;
    try {
      if (!enabled) {
        player.setOption?.('captions', 'track', {});
        player.unloadModule?.('captions');
        return;
      }
      player.loadModule?.('captions');
    } catch { /* ignore */ }
    // The captions module loads asynchronously — retry until its track list shows up
    let attempts = 0;
    const pickTrack = () => {
      attempts += 1;
      try {
        const tracks: any[] = player.getOption?.('captions', 'tracklist') || [];
        if (tracks.length > 0) {
          const preferred = tracks.find(t => t.languageCode?.startsWith('en')) || tracks[0];
          player.setOption('captions', 'track', { languageCode: preferred.languageCode });
          return;
        }
      } catch { /* ignore */ }
      if (attempts < 8) ytCaptionTimerRef.current = setTimeout(pickTrack, 600);
      else {
        try { player.setOption?.('captions', 'track', { languageCode: 'en' }); } catch { /* ignore */ }
      }
    };
    ytCaptionTimerRef.current = setTimeout(pickTrack, 300);
  }, []);
  useEffect(() => () => { if (ytCaptionTimerRef.current) clearTimeout(ytCaptionTimerRef.current); }, []);

  // ---- Listener: make sure we're on the SAME SONG as the host ----
  // Match by video ID, not playlist index. For a single video the player queues a YouTube Mix
  // (list=RD<id>), and Mixes are personalised per viewer — "song 5" in the host's Mix is a
  // different video from "song 5" in a peer's Mix. Index is only trusted for real playlists,
  // and only after checking that index actually holds the host's video in our copy.
  const pendingTrackRef = useRef<{ id: string; at: number } | null>(null);
  // Bumped to force a fresh YouTube player (e.g. Sync pressed while the player never became ready)
  const [playerNonce, setPlayerNonce] = useState(0);

  // ---- Precise listener sync ----
  // A seek isn't instant: the player buffers for a moment, during which the host keeps playing,
  // so a naive seek lands behind. We seek slightly AHEAD by a learned "lead", then verify ~2s
  // later and adjust the lead from the measured error (repeat up to 3x). The learned lead is
  // remembered per media type, so later corrections are accurate on the first try.
  // Starting leads measured on a real YouTube embed (~0.1s seek delay); refined per device as it plays
  const seekLeadRef = useRef<{ direct: number; youtube: number }>({ direct: 0.05, youtube: 0.12 });
  const lastCorrectionAtRef = useRef(0);
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReanchorAtRef = useRef(0);
  const isLocallyPausedRef = useRef(isLocallyPaused);
  isLocallyPausedRef.current = isLocallyPaused;
  useEffect(() => () => { if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current); }, []);

  /** Where the host is right now (shared clock, loop-aware) */
  const hostTargetNow = useCallback((): number | null => {
    const bc = currentBroadcastRef.current;
    if (!bc) return null;
    const raw = calculateEffectiveTime(bc);
    const vidDur = videoRef.current?.duration;
    const ytDur = ytPlayerRef.current?.getDuration?.();
    const dur = bc.mediaType === 'direct' ? vidDur : ytDur;
    return bc.loop && dur && Number.isFinite(dur) && dur > 0 ? raw % dur : raw;
  }, []);

  const readPlayerTime = useCallback((kind: 'direct' | 'youtube'): number | null => {
    try {
      if (kind === 'direct') return videoRef.current ? videoRef.current.currentTime : null;
      const t = ytPlayerRef.current?.getCurrentTime?.();
      return typeof t === 'number' && !Number.isNaN(t) ? t : null;
    } catch {
      return null;
    }
  }, []);

  const listenerSeek = useCallback((kind: 'direct' | 'youtube', attempt = 0) => {
    const bc = currentBroadcastRef.current;
    const target = hostTargetNow();
    if (!bc || target === null) return;
    const playing = bc.playing && !isLocallyPausedRef.current;
    const lead = playing ? seekLeadRef.current[kind] : 0;
    const dest = Math.max(0, target + lead);
    try {
      if (kind === 'direct' && videoRef.current) videoRef.current.currentTime = dest;
      else if (kind === 'youtube') ytPlayerRef.current?.seekTo?.(dest, true);
    } catch { /* player transitioning */ }
    lastCorrectionAtRef.current = Date.now();
    if (!playing) return;

    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
    verifyTimerRef.current = setTimeout(() => {
      const bcNow = currentBroadcastRef.current;
      if (!bcNow || !bcNow.playing || isLocallyPausedRef.current || isDesyncedRef.current) return;
      const actual = readPlayerTime(kind);
      const expected = hostTargetNow();
      if (actual === null || expected === null) return;
      const error = actual - expected; // + ahead, - behind
      // Learn: if we landed behind, lead more next time (and vice versa)
      const learned = seekLeadRef.current[kind] - error * 0.8;
      seekLeadRef.current[kind] = Math.min(3, Math.max(0, learned));
      if (Math.abs(error) > 0.3 && attempt < 2) listenerSeek(kind, attempt + 1);
    }, kind === 'youtube' ? 2200 : 1500);
  }, [hostTargetNow, readPlayerTime]);
  const syncToHostTrack = useCallback((yt: any, bc: PeerBroadcast | null, startSeconds: number, shouldPlay: boolean): boolean => {
    if (!yt || !bc || bc.mediaType !== 'youtube') return false;
    try {
      const targetId = bc.videoId;
      if (targetId) {
        const curId: string | undefined = yt.getVideoData?.()?.video_id;
        if (curId === targetId) {
          pendingTrackRef.current = null;
          return false;
        }
        // A switch to this video is already in flight — don't hammer the player every tick
        const pending = pendingTrackRef.current;
        if (pending && pending.id === targetId && Date.now() - pending.at < 5000) return true;
        pendingTrackRef.current = { id: targetId, at: Date.now() };

        const isStablePlaylist = !!bc.playlistId && !bc.playlistId.startsWith('RD');
        const queue: string[] | undefined = yt.getPlaylist?.();
        const idx = bc.playlistIndex;
        if (isStablePlaylist && queue && idx !== undefined && idx >= 0 && queue[idx] === targetId && typeof yt.playVideoAt === 'function') {
          // Same position in a shared playlist — keeps next/prev queue intact for this peer
          yt.playVideoAt(idx);
        } else if (shouldPlay && typeof yt.loadVideoById === 'function') {
          yt.loadVideoById({ videoId: targetId, startSeconds: Math.max(0, startSeconds) });
        } else if (typeof yt.cueVideoById === 'function') {
          yt.cueVideoById({ videoId: targetId, startSeconds: Math.max(0, startSeconds) });
        }
        return true;
      }
      // Host hasn't reported a video ID yet (e.g. playlist link without v=) — fall back to index
      const idx = bc.playlistIndex;
      if (idx !== undefined && idx >= 0 && typeof yt.getPlaylistIndex === 'function') {
        const curIdx = yt.getPlaylistIndex();
        if (curIdx >= 0 && curIdx !== idx && typeof yt.playVideoAt === 'function') {
          yt.playVideoAt(idx);
          return true;
        }
      }
    } catch {
      /* player transitioning */
    }
    return false;
  }, []);

  const isYouTubeBroadcast = currentBroadcast?.mediaType === 'youtube';
  const youtubeVideoId = !isYouTubeBroadcast ? null
    : currentBroadcast?.url ? extractYouTubeId(currentBroadcast.url) : (currentBroadcast?.videoId || null);
  const youtubePlaylistId = !isYouTubeBroadcast ? null
    : currentBroadcast?.url ? (extractYouTubePlaylistId(currentBroadcast.url) || currentBroadcast?.playlistId || null) : (currentBroadcast?.playlistId || null);
  const showYouTube = !!(youtubeVideoId || youtubePlaylistId);

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
      const host = ytHostRef.current;
      if (!host) return;

      try {
        if (ytPlayerRef.current?.destroy) {
          ytPlayerRef.current.destroy();
        }
      } catch {
        // ignore
      }
      ytPlayerRef.current = null;
      // Fresh, non-React target for YouTube to replace with its iframe
      host.replaceChildren();
      const targetEl = document.createElement('div');
      host.appendChild(targetEl);

      const playerVars: any = {
        autoplay: currentBroadcast?.playing && !isLocallyPaused ? 1 : 0,
        controls: 0,
        disablekb: 1,
        enablejsapi: 1,
        modestbranding: 1,
        rel: 0,
        origin: window.location.origin,
        // Captions: start with them on if this peer has CC enabled
        cc_load_policy: captionsEnabledRef.current ? 1 : 0,
        cc_lang_pref: 'en',
      };

      // LISTENERS NEVER GET A PLAYLIST OF THEIR OWN. They load exactly the host's current video
      // and switch only when the host does (see syncToHostTrack). Otherwise YouTube's personalised
      // Mix / autoplay would wander off to songs the host never played.
      const amHost = isHostRef.current;
      const listenerVideoId = !amHost ? (currentBroadcastRef.current?.videoId || currentBroadcast?.videoId || youtubeVideoId) : null;

      if (listenerVideoId) {
        // single video, no queue
      } else if (youtubePlaylistId) {
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

      ytPlayerRef.current = new window.YT.Player(targetEl, {
        videoId: listenerVideoId || youtubeVideoId || undefined,
        playerVars,
        events: {
          onReady: (event: any) => {
            if (destroyed) return;
            isPlayerReadyRef.current = true;
            const bcNow = currentBroadcastRef.current || currentBroadcast;
            if (bcNow) {
              const effectiveTime = calculateEffectiveTime(bcNow);
              // Late joiner: jump straight to the host's current song (by video ID)
              if (!isHostRef.current) {
                syncToHostTrack(event.target, bcNow, effectiveTime, bcNow.playing && !isLocallyPaused);
              }
              event.target.seekTo(effectiveTime, true);
              if (bcNow.playing && !isLocallyPaused) {
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
            applyYtRate(event.target, effectiveRateRef.current);
            if (captionsEnabledRef.current) applyYtCaptions(event.target, true);
          },
          onStateChange: (event: any) => {
            const bc = currentBroadcastRef.current;

            // A new playlist track can reset speed — re-apply this peer's choice
            if (event.data === 1) {
              applyYtRate(event.target, effectiveRateRef.current);
            }

            // Detect playlist track change on host
            if (isHostRef.current && onUpdateTrackRef.current && typeof event.target.getPlaylistIndex === 'function') {
              const curIndex = event.target.getPlaylistIndex();
              const videoData = typeof event.target.getVideoData === 'function' ? event.target.getVideoData() : null;
              const curVideoId = videoData?.video_id || null;
              const curTitle = videoData?.title || null;

              // Video ID is the source of truth; index can be -1 once YouTube leaves the queue
              if ((curVideoId && curVideoId !== bc?.videoId) || (curIndex >= 0 && curIndex !== bc?.playlistIndex)) {
                onUpdateTrackRef.current({
                  playlistIndex: curIndex >= 0 ? curIndex : bc?.playlistIndex,
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
        }
      } catch {
        // ignore
      }
      ytPlayerRef.current = null;
      // Remove YouTube's iframe ourselves (React never knew about it)
      ytHostRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeVideoId, youtubePlaylistId, currentBroadcast?.id, isHost, playerNonce]);

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
        // The host's own player is the source of truth — never pull it toward the computed anchor
        if (!isHost) {
          const timeDiff = Math.abs(vid.currentTime - effectiveTime);
          const explicitJump = isNewAction && (currentBroadcast.action === 'seek' || currentBroadcast.action === 'load');
          if (explicitJump || (timeDiff > 0.6 && !isDesyncedByChoice)) listenerSeek('direct');
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

        // Host changed song → switch this listener to the same video, starting at the host's time.
        // Skip the seek/play logic below while the new video loads (its times belong to the old one).
        if (!isHost && syncToHostTrack(yt, currentBroadcast, effectiveTime, currentBroadcast.playing && !isLocallyPaused)) {
          return;
        }

        // Don't force restart if video ended naturally (state 0) and loop is off
        if (playerState === 0 && !currentBroadcast.loop) {
          // Video ended — don't restart
        } else {
          // Listener: jump on an explicit host seek, or when clearly off (heartbeats land here too)
          if (!isHost) {
            const explicitJump = isNewAction && (currentBroadcast.action === 'seek' || currentBroadcast.action === 'load');
            if (explicitJump || (Math.abs(curYtTime - effectiveTime) > 1.0 && !isDesyncedByChoice)) {
              listenerSeek('youtube');
            }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBroadcast, isLocallyPaused, duration, isDesyncedByChoice, isHost]);

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
          } else if (isHost) {
            if (vid.paused) vid.play().catch(() => {});
            // Heartbeat: publish where the host REALLY is if it drifted from the anchor (buffering)
            if (onReanchor && !vid.paused && vid.readyState >= 3
                && Math.abs(vid.currentTime - targetTime) > 0.4
                && Date.now() - lastReanchorAtRef.current > 3000) {
              lastReanchorAtRef.current = Date.now();
              onReanchor(vid.currentTime);
            }
          } else {
            if (vid.paused) vid.play().catch(() => {});
            const diff = vid.currentTime - targetTime; // + ahead, - behind
            setSyncDrift(diff);
            if (!isDesyncedByChoice) {
              if (Math.abs(diff) > 0.6 && Date.now() - lastCorrectionAtRef.current > 3000) {
                listenerSeek('direct');
              } else if (Math.abs(diff) > 0.05) {
                // Small drift: glide back by nudging speed ±8% (inaudible) instead of a jarring seek
                const nudge = Math.max(-0.08, Math.min(0.08, diff * 0.4));
                vid.playbackRate = effectiveRateRef.current * (1 - nudge);
              } else if (Math.abs(vid.playbackRate - effectiveRateRef.current) > 0.001) {
                vid.playbackRate = effectiveRateRef.current;
              }
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

            if ((curVideoId && curVideoId !== currentBroadcast.videoId) || (curIndex >= 0 && curIndex !== currentBroadcast.playlistIndex)) {
              onUpdateTrack({
                playlistIndex: curIndex >= 0 ? curIndex : currentBroadcast.playlistIndex,
                videoId: curVideoId || undefined,
                title: curTitle || currentBroadcast.title,
                currentTime: cur || 0,
              });
            }
          }

          // If Peer (Listener): verify we are playing the host's song (by video ID)
          if (!isHost && syncToHostTrack(yt, currentBroadcast, targetTime, currentBroadcast.playing && !isLocallyPaused)) {
            return;
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
              if (isHost) {
                // Heartbeat: re-anchor to the host's real position after buffering stalls
                if (onReanchor && playerState === 1 && !isAtEnd && cur !== undefined
                    && Math.abs(cur - targetTime) > 0.5
                    && Date.now() - lastReanchorAtRef.current > 3000) {
                  lastReanchorAtRef.current = Date.now();
                  onReanchor(cur);
                }
              } else if (cur !== undefined && playerState === 1 && !isAtEnd) {
                const diff = cur - targetTime; // + ahead, - behind
                setSyncDrift(diff);
                if (!isDesyncedByChoice) {
                  const baseRate = effectiveRateRef.current;
                  let wantRate = baseRate;
                  if (Math.abs(diff) > 0.8 && Date.now() - lastCorrectionAtRef.current > 4000) {
                    listenerSeek('youtube');
                  } else if (Math.abs(diff) > 0.06) {
                    // Small drift: glide back with a ±8% speed nudge (YouTube accepts fine rates like 1.05)
                    wantRate = baseRate * (1 - Math.max(-0.08, Math.min(0.08, diff * 0.4)));
                  }
                  try {
                    const curRate = yt.getPlaybackRate?.() ?? baseRate;
                    if (Math.abs(curRate - wantRate) > 0.01) yt.setPlaybackRate(Math.round(wantRate * 100) / 100);
                  } catch { /* ignore */ }
                }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBroadcast, isLocallyPaused, duration, isHost, onPlayAll, onUpdateTrack, isDesyncedByChoice, onReanchor]);

  // Volume control. While watching someone's screen share, the broadcast player underneath is
  // silenced so the relayed audio isn't doubled up with (possibly unreachable) YouTube audio.
  useEffect(() => {
    const underlyingMuted = isMuted || isViewingScreen;
    if (videoRef.current) {
      videoRef.current.volume = underlyingMuted ? 0 : volume;
    }
    if (isPlayerReadyRef.current && ytPlayerRef.current?.setVolume) {
      try {
        if (underlyingMuted) ytPlayerRef.current.mute();
        else {
          ytPlayerRef.current.unMute();
          ytPlayerRef.current.setVolume(volume * 100);
        }
      } catch {
        // ignore
      }
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.muted = isMuted;
      screenVideoRef.current.volume = volume;
    }
  }, [volume, isMuted, isViewingScreen]);

  // ---- Apply playback speed (local player follows host rate or this peer's override) ----
  useEffect(() => {
    if (videoRef.current && Math.abs(videoRef.current.playbackRate - effectiveRate) > 0.001) {
      videoRef.current.playbackRate = effectiveRate;
    }
    if (isPlayerReadyRef.current) applyYtRate(ytPlayerRef.current, effectiveRate);
  }, [effectiveRate, applyYtRate, currentBroadcast?.id]);

  // Reset local overrides when a different stream is loaded
  useEffect(() => {
    setSpeedOverride(null);
    setPeerSkipped(false);
    setSyncDrift(null);
    setIsAudioOnly(false);
    setMediaError(null);
  }, [currentBroadcast?.id, currentBroadcast?.url]);


  // ---- Apply captions (YouTube module or HTML5 text tracks) ----
  const applyHtmlCaptions = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    for (let i = 0; i < vid.textTracks.length; i++) {
      vid.textTracks[i].mode = captionsEnabledRef.current ? 'showing' : 'disabled';
    }
  }, []);

  useEffect(() => {
    if (currentBroadcast?.mediaType === 'youtube' && isPlayerReadyRef.current) {
      applyYtCaptions(ytPlayerRef.current, captionsEnabled);
    }
    applyHtmlCaptions();
  }, [captionsEnabled, applyYtCaptions, applyHtmlCaptions, currentBroadcast?.mediaType, subtitleSrc]);

  // ---- Attach screen-share streams to their <video> elements ----
  useEffect(() => {
    const el = screenVideoRef.current;
    if (!el) return;
    if (isViewingScreen && incomingScreenStream) {
      if (el.srcObject !== incomingScreenStream) el.srcObject = incomingScreenStream;
      el.muted = isMuted;
      el.volume = volume;
      el.play()
        .then(() => setScreenNeedsClick(false))
        // Autoplay with sound can be blocked until the user interacts — offer a click-to-play
        .catch(() => setScreenNeedsClick(true));
    } else {
      el.srcObject = null;
      setScreenNeedsClick(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingScreenStream, isViewingScreen]);

  useEffect(() => {
    const el = screenPreviewRef.current;
    if (!el) return;
    if (isScreenSharing && localScreenStream) {
      if (el.srcObject !== localScreenStream) el.srcObject = localScreenStream;
      el.muted = true; // never play your own capture back (echo)
      el.play().catch(() => { /* preview only */ });
    } else {
      el.srcObject = null;
    }
  }, [isScreenSharing, localScreenStream, isMinimized]);

  useEffect(() => {
    if (screenShareError) showToast(screenShareError, 5000);
  }, [screenShareError, showToast]);

  const handleScreenClickToPlay = useCallback(() => {
    const el = screenVideoRef.current;
    if (!el) return;
    el.muted = isMuted;
    el.play().then(() => setScreenNeedsClick(false)).catch(() => {
      // Last resort: start muted so at least the picture shows
      el.muted = true;
      el.play().catch(() => {});
      setScreenNeedsClick(false);
      showToast('Browser blocked sound — unmute with the volume button');
    });
  }, [isMuted, showToast]);

  const handleToggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      onStopScreenShare?.();
      return;
    }
    if (!onStartScreenShare) return;
    setIsStartingShare(true);
    try {
      const stream = await onStartScreenShare();
      if (stream) {
        setIsRelaying(false);
        showToast('🖥️ Sharing your screen with the room');
      }
    } finally {
      setIsStartingShare(false);
    }
  }, [isScreenSharing, onStartScreenShare, onStopScreenShare, showToast]);

  // Host relays exactly what its player shows + plays to every peer (they don't touch YouTube at all)
  const handleRelayToPeers = useCallback(async () => {
    if (!onStartScreenShare) return;
    setIsStartingShare(true);
    showToast('In the picker choose "This tab" and keep "Share tab audio" ON', 6000);
    try {
      const stream = await onStartScreenShare({ preferCurrentTab: true, cropTo: playerAreaRef.current });
      if (stream) {
        setIsRelaying(true);
        showToast('📡 Relaying your player to everyone — peers now see & hear exactly what you play');
      }
    } finally {
      setIsStartingShare(false);
    }
  }, [onStartScreenShare, showToast]);

  useEffect(() => {
    if (!isScreenSharing) setIsRelaying(false);
  }, [isScreenSharing]);

  // ---- Speed / quality / captions handlers ----
  const handleSelectSpeed = useCallback((rate: number) => {
    setSpeedMenuAnchor(null);
    if (isHost) {
      onSetPlaybackRate?.(rate);
      setSpeedOverride(null);
      showToast(`Speed ${rate}× for everyone`);
    } else if (Math.abs(rate - hostRate) < 0.001) {
      setSpeedOverride(null);
      showToast(`Following host speed (${rate}×)`);
    } else {
      setSpeedOverride(rate);
      showToast(`Speed ${rate}× just for you — auto-sync paused (press Sync to rejoin)`, 3500);
    }
  }, [isHost, onSetPlaybackRate, hostRate, showToast]);


  const handleToggleCaptions = useCallback(() => {
    setCaptionsEnabled(prev => {
      const next = !prev;
      if (next && isDirectMedia && !subtitleSrc) {
        showToast(isHost ? 'No subtitles loaded — use "Add subtitles" to attach a .srt/.vtt file' : 'This stream has no subtitle track yet');
      } else {
        showToast(next ? 'Captions on' : 'Captions off', 1500);
      }
      return next;
    });
  }, [isDirectMedia, subtitleSrc, isHost, showToast]);

  // Listener-only skip: moves just this peer's player; Sync to Host brings them back
  const handlePeerSkip = useCallback((delta: number) => {
    if (!currentBroadcast || isHost) return;
    try {
      if (currentBroadcast.mediaType === 'direct' && videoRef.current) {
        const vid = videoRef.current;
        const max = Number.isFinite(vid.duration) ? vid.duration : Number.MAX_SAFE_INTEGER;
        vid.currentTime = Math.min(max, Math.max(0, vid.currentTime + delta));
        vid.playbackRate = effectiveRateRef.current;
        setLocalProgress(vid.currentTime);
      } else if (ytPlayerRef.current?.seekTo) {
        const yt = ytPlayerRef.current;
        const cur = yt.getCurrentTime?.() ?? 0;
        const dur = yt.getDuration?.() || Number.MAX_SAFE_INTEGER;
        const next = Math.min(dur, Math.max(0, cur + delta));
        yt.seekTo(next, true);
        setLocalProgress(next);
      }
    } catch { /* player transitioning */ }
    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
    isDesyncedRef.current = true;
    setPeerSkipped(true);
    showToast(`${delta > 0 ? '⏩' : '⏪'} ${Math.abs(delta)}s just for you — press Sync to Host to rejoin`, 2600);
  }, [currentBroadcast, isHost, showToast]);

  // Instant Manual Re-sync button
  const handleManualSync = useCallback(() => {
    if (!currentBroadcast) return;
    setIsLocallyPaused(false);
    setSpeedOverride(null);
    setPeerSkipped(false);
    isDesyncedRef.current = false;
    const target = calculateEffectiveTime(currentBroadcast);
    setLocalProgress(target);

    if (currentBroadcast.mediaType === 'direct' && videoRef.current) {
      videoRef.current.playbackRate = hostRate;
      if (currentBroadcast.playing) videoRef.current.play().catch(() => {});
      else videoRef.current.pause();
      isLocallyPausedRef.current = false;
      listenerSeek('direct'); // seek with learned lead + verify & refine
    } else if (currentBroadcast.mediaType === 'youtube' && !isPlayerReadyRef.current) {
      // Player never initialised properly — rebuild it on the host's exact video
      pendingTrackRef.current = null;
      setPlayerNonce(n => n + 1);
    } else if (ytPlayerRef.current?.seekTo) {
      const yt = ytPlayerRef.current;
      // Wrong song? Load the host's exact video at the host's time (forces a fresh attempt)
      pendingTrackRef.current = null;
      const switching = !isHost && syncToHostTrack(yt, currentBroadcast, target, currentBroadcast.playing);
      if (!switching) {
        if (currentBroadcast.playing) yt.playVideo();
        else yt.pauseVideo();
        isLocallyPausedRef.current = false;
        listenerSeek('youtube'); // seek with learned lead + verify & refine
      }
    }
    setSyncNotice(`Synced with ${currentBroadcast.hostName}!`);
    setTimeout(() => setSyncNotice(null), 2000);
  }, [currentBroadcast, isHost, syncToHostTrack, listenerSeek, hostRate]);

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

  // ---- Feature 1: pick a local audio/video file → upload to the LAN media server → broadcast ----
  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again later
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('File is larger than 500 MB — pick a smaller file', 4000);
      return;
    }
    setIsUploading(true);
    setUploadProgress(0);
    setUploadLabel(file.name);
    try {
      const data = await uploadToMediaServer(file, file.name, setUploadProgress);
      setIsLocallyPaused(false);
      const title = file.name.replace(/\.[^.]+$/, '');
      onStartBroadcast(data.path, title);
      showToast(`📁 Streaming "${title}" to everyone on the network`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 5000);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [onStartBroadcast, showToast]);

  // Host attaches a subtitle file (.srt is converted to .vtt in the browser) to the current upload
  const handleSubtitleSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onSetSubtitleUrl) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.srt') && !lower.endsWith('.vtt')) {
      showToast('Subtitles must be a .srt or .vtt file', 3500);
      return;
    }
    try {
      setIsUploading(true);
      setUploadLabel(file.name);
      const text = await file.text();
      const vtt = lower.endsWith('.srt') ? srtToVtt(text) : text;
      const blob = new Blob([vtt], { type: 'text/vtt' });
      const name = file.name.replace(/\.[^.]+$/, '') + '.vtt';
      const data = await uploadToMediaServer(blob, name, setUploadProgress);
      onSetSubtitleUrl(data.path);
      setCaptionsEnabled(true);
      showToast('💬 Subtitles added for everyone (each peer can toggle CC)');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Subtitle upload failed', 5000);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [onSetSubtitleUrl, showToast]);

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

  // ---- Feature 3: keyboard shortcuts ----
  // Track whether the user is "in" the dock: hovering it, or their last click was inside it.
  // Shortcuts only fire then (or in wide/full screen), so Space-to-pan and arrow-key nudging on
  // the canvas keep working the rest of the time.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      dockFocusRef.current = !!dockContainerRef.current?.contains(e.target as Node);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const shortcutStateRef = useRef({
    isHost,
    hasBroadcast: !!currentBroadcast,
    screenActive,
    isImmersive,
    localProgress,
    duration,
    handleTogglePlay,
    handleLocalToggle,
    handleSeekCommit,
    handlePeerSkip,
    showToast,
  });
  shortcutStateRef.current = {
    isHost,
    hasBroadcast: !!currentBroadcast,
    screenActive,
    isImmersive,
    localProgress,
    duration,
    handleTogglePlay,
    handleLocalToggle,
    handleSeekCommit,
    handlePeerSkip,
    showToast,
  };

  useEffect(() => {
    const SHORTCUT_CODES = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

    const shouldHandle = (e: KeyboardEvent) => {
      if (!SHORTCUT_CODES.has(e.code)) return false;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (isTypingTarget(e.target)) return false; // never steal keys while typing
      const st = shortcutStateRef.current;
      if (!st.hasBroadcast && !st.screenActive) return false;
      return st.isImmersive || dockHoverRef.current || dockFocusRef.current;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!shouldHandle(e)) return;
      const st = shortcutStateRef.current;
      // Capture phase + stopPropagation keeps the canvas from also panning / nudging shapes
      e.preventDefault();
      e.stopPropagation();

      switch (e.code) {
        case 'Space':
          if (e.repeat || !st.hasBroadcast) return;
          if (st.isHost) st.handleTogglePlay();
          else st.handleLocalToggle();
          break;
        case 'ArrowUp':
          setVolume(prev => Math.min(1, Math.round((prev + 0.1) * 10) / 10));
          setIsMuted(false);
          break;
        case 'ArrowDown':
          setVolume(prev => Math.max(0, Math.round((prev - 0.1) * 10) / 10));
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!st.hasBroadcast) return;
          if (!st.isHost) {
            st.handlePeerSkip(e.code === 'ArrowLeft' ? -10 : 10);
            return;
          }
          const delta = e.code === 'ArrowLeft' ? -10 : 10;
          const max = st.duration > 0 ? st.duration : Number.MAX_SAFE_INTEGER;
          st.handleSeekCommit(null, Math.min(max, Math.max(0, st.localProgress + delta)));
          break;
        }
      }
    };

    // Stop Space's keyup from "clicking" whichever dock button still has focus
    const handleKeyUp = (e: KeyboardEvent) => {
      // (no stopPropagation — the canvas must still see keyup to release its Space-pan state)
      if (e.code === 'Space' && shouldHandle(e)) e.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, []);

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

  // ---- RENDER: CC / Speed / Subtitles buttons (shared by dock + overlay) ----
  // Tooltips/menus portal to <body>, which is hidden behind the fullscreen element — so the
  // overlay uses plain title attributes and the menus mount inside the dock container.
  const renderMediaExtras = (variant: 'dock' | 'overlay') => {
    if (!currentBroadcast) return null;
    const isOverlay = variant === 'overlay';
    const iconSize = isOverlay ? 19 : 16;
    const baseColor = isOverlay ? '#cbd5e1' : '#94a3b8';
    const btnSx = (active: boolean, activeColor = 'var(--c-primary-strong)') => ({
      p: 0.5,
      borderRadius: 1.5,
      color: active ? activeColor : baseColor,
      bgcolor: active ? 'var(--c-primary-soft)' : 'transparent',
      border: active ? '1px solid rgba(168,85,247,0.4)' : '1px solid transparent',
      '&:hover': { color: isOverlay ? '#f8fafc' : 'var(--c-text)', bgcolor: 'var(--c-primary-soft)' },
    });
    const speedLabel = `${effectiveRate}×`;

    return (
      <>
        <IconButton
          size="small"
          onClick={handleToggleCaptions}
          title={captionsEnabled ? 'Captions: ON (just for you)' : 'Captions: OFF'}
          aria-pressed={captionsEnabled}
          sx={btnSx(captionsEnabled)}
        >
          {captionsEnabled ? <ClosedCaption sx={{ fontSize: iconSize }} /> : <ClosedCaptionDisabled sx={{ fontSize: iconSize }} />}
        </IconButton>

        {isHost && isDirectMedia && isServerMedia && onSetSubtitleUrl && (
          <IconButton
            size="small"
            onClick={() => subtitleInputRef.current?.click()}
            disabled={isUploading}
            title={currentBroadcast.subtitleUrl ? 'Replace subtitles (.srt / .vtt)' : 'Add subtitles (.srt / .vtt)'}
            sx={btnSx(!!currentBroadcast.subtitleUrl, '#4ade80')}
          >
            <Subtitles sx={{ fontSize: iconSize }} />
          </IconButton>
        )}

        <Button
          size="small"
          onClick={(e) => setSpeedMenuAnchor(e.currentTarget)}
          title={isHost ? 'Playback speed (for everyone)' : isDesyncedByChoice ? 'Your own speed — press Sync to follow the host again' : 'Playback speed'}
          startIcon={<Speed sx={{ fontSize: `${iconSize - 2}px !important` }} />}
          sx={{
            ...btnSx(effectiveRate !== 1, isDesyncedByChoice ? '#fbbf24' : 'var(--c-primary-strong)'),
            minWidth: 0,
            px: 0.75,
            py: 0.25,
            fontSize: isOverlay ? 11 : 10,
            fontWeight: 700,
            textTransform: 'none',
            '& .MuiButton-startIcon': { mr: 0.4 },
          }}
        >
          {speedLabel}
        </Button>

      </>
    );
  };

  const renderMenus = () => (
    <>
      <Menu
        anchorEl={speedMenuAnchor}
        open={!!speedMenuAnchor}
        onClose={() => setSpeedMenuAnchor(null)}
        container={dockContainerRef.current}
        disableScrollLock
        slotProps={{ paper: { sx: { bgcolor: 'var(--c-surface)', color: 'var(--c-text)', border: '1px solid var(--c-border-strong)', minWidth: 150 } } }}
      >
        <Box sx={{ px: 2, py: 0.5, fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
          {isHost ? 'Speed for everyone' : 'Speed (just you)'}
        </Box>
        {PLAYBACK_SPEEDS.map(rate => {
          const selected = Math.abs(rate - effectiveRate) < 0.001;
          return (
            <MenuItem key={rate} dense selected={selected} onClick={() => handleSelectSpeed(rate)}>
              <ListItemIcon sx={{ minWidth: 26, color: 'var(--c-primary-strong)' }}>
                {selected ? <Check sx={{ fontSize: 16 }} /> : null}
              </ListItemIcon>
              <ListItemText
                primary={rate === 1 ? 'Normal (1×)' : `${rate}×`}
                secondary={!isHost && Math.abs(rate - hostRate) < 0.001 ? 'Host speed' : undefined}
                slotProps={{
                  primary: { sx: { fontSize: 12 } },
                  secondary: { sx: { fontSize: 9, color: 'var(--c-primary)' } },
                }}
              />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );

  // ---- RENDER: overlay for wide/full screen when only a screen share is showing ----
  const renderScreenOverlay = () => (
    <Box
      sx={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        background: 'linear-gradient(0deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)',
        opacity: showOverlayControls ? 1 : 0,
        transition: 'opacity 0.35s ease',
        pointerEvents: showOverlayControls ? 'auto' : 'none',
        px: { xs: 2, sm: 4 },
        pt: 6,
        pb: 2.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
      onMouseMove={resetOverlayTimer}
    >
      <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
        🖥️ {isScreenSharing ? 'You are sharing your screen' : `${screenShareHostName || 'A peer'} is sharing their screen`}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {isViewingScreen && (
          <>
            <IconButton size="small" onClick={() => setIsMuted(!isMuted)} sx={{ color: isMuted ? '#ef4444' : '#cbd5e1' }}>
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
              sx={{ width: 90, color: 'var(--c-primary)', height: 3, '& .MuiSlider-thumb': { width: 10, height: 10 } }}
            />
          </>
        )}
        <IconButton
          size="small"
          onClick={() => { setIsFullScreen(false); setIsWideScreen(false); }}
          title="Exit (Esc)"
          sx={{ color: '#cbd5e1', '&:hover': { color: '#f8fafc' } }}
        >
          <FullscreenExit sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>
    </Box>
  );

  // ---- RENDER: OVERLAY CONTROLS (used in wide/full screen modes) ----
  const renderOverlayControls = () => {
    if (!isImmersive) return null;
    // Watching someone's screen takes over the player, so show the screen-share overlay then
    if (isViewingScreen || (!currentBroadcast && screenActive)) return renderScreenOverlay();
    if (!currentBroadcast) return null;

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
          {isHost && <span style={{ color: 'var(--c-primary-strong)', marginLeft: 8, fontSize: 11 }}>👑 Host</span>}
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
              color: 'var(--c-primary)',
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
                color: 'var(--c-primary)',
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
                sx={{ color: 'var(--c-primary-strong)', p: 0.5, '&:hover': { color: 'var(--c-accent)' } }}
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
                bgcolor: 'var(--c-primary)',
                p: 1.25,
                '&:hover': { bgcolor: 'var(--c-primary)' },
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
                sx={{ color: 'var(--c-primary-strong)', p: 0.5, '&:hover': { color: 'var(--c-accent)' } }}
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
              <>
                <IconButton
                  size="small"
                  onClick={() => handlePeerSkip(-10)}
                  title="Back 10s (just you)"
                  sx={{ color: '#cbd5e1', p: 0.5, '&:hover': { color: '#f8fafc' } }}
                >
                  <FastRewind sx={{ fontSize: 20 }} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={handleManualSync}
                  title="Sync to host"
                  sx={{ color: peerSkipped ? '#fbbf24' : 'var(--c-primary-strong)', p: 0.5, '&:hover': { color: 'var(--c-accent)', bgcolor: 'var(--c-primary-soft)' } }}
                >
                  <SyncIcon sx={{ fontSize: 20 }} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => handlePeerSkip(10)}
                  title="Forward 10s (just you)"
                  sx={{ color: '#cbd5e1', p: 0.5, '&:hover': { color: '#f8fafc' } }}
                >
                  <FastForward sx={{ fontSize: 20 }} />
                </IconButton>
              </>
            )}
          </Box>

          {/* Right: CC, Speed, Loop, AutoPlay, View mode toggles */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 120, justifyContent: 'flex-end' }}>
            {renderMediaExtras('overlay')}
            {isHost && (
              <IconButton
                size="small"
                onClick={onToggleLoop}
                sx={{
                  p: 0.5,
                  color: currentBroadcast.loop ? 'var(--c-primary-strong)' : '#64748b',
                  bgcolor: currentBroadcast.loop ? 'var(--c-primary-soft)' : 'transparent',
                  borderRadius: 1.5,
                  '&:hover': { color: 'var(--c-primary-strong)', bgcolor: 'var(--c-primary-soft)' },
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
          ? { left: minimizedPos.x, top: minimizedPos.y, right: 'auto', bottom: 'auto', zIndex: 1250 }
          : isFullScreen
          ? { inset: 0, width: '100vw', height: '100vh', zIndex: 99999, bgcolor: '#000' }
          : isWideScreen
          ? { inset: 0, width: '100vw', height: '100vh', zIndex: 99999, bgcolor: '#000' }
          : { bottom: 20, right: 20, width: 380, maxWidth: 'calc(100vw - 32px)', zIndex: 1250 }),
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, sans-serif',
        userSelect: isDragging ? 'none' : 'auto',
        transition: isImmersive ? 'none' : 'width 0.25s ease, height 0.25s ease',
        cursor: isImmersive && !showOverlayControls ? 'none' : 'auto',
      }}
      onMouseEnter={() => { dockHoverRef.current = true; }}
      onMouseLeave={() => { dockHoverRef.current = false; }}
    >
      {/* Hidden pickers for local media + subtitle files */}
      <input
        type="file"
        ref={fileInputRef}
        accept="audio/*,video/*,.mkv,.mp3,.mp4,.webm,.m4a,.flac,.ogg,.wav,.opus,.mov"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
      <input
        type="file"
        ref={subtitleInputRef}
        accept=".srt,.vtt,text/vtt"
        style={{ display: 'none' }}
        onChange={handleSubtitleSelected}
      />

      {/* 
        CRITICAL: Video / YouTube player elements stay PERMANENTLY mounted in DOM so audio never stops when minimized!
      */}
      <Box
        ref={playerAreaRef}
        sx={{
          position: isMinimized ? 'fixed' : 'relative',
          top: isMinimized ? -9999 : 0,
          left: isMinimized ? -9999 : 0,
          width: isMinimized ? 1 : '100%',
          height: isMinimized
            ? 1
            : isImmersive
            ? '100%'
            : (currentBroadcast || screenActive ? 165 : 0),
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
        {/* Always mounted; only shown for YouTube broadcasts (see ytHostRef note) */}
        <Box
          ref={ytHostRef}
          sx={{
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            display: showYouTube ? 'block' : 'none',
            '& iframe': {
              width: '100% !important',
              height: '100% !important',
            },
          }}
        />
        {!showYouTube && currentBroadcast?.mediaType === 'direct' ? (
          <video
            key={directSrc}
            ref={videoRef}
            src={directSrc}
            // Needed for <track> subtitles from the media server (different port = different origin).
            // Only for our own server: arbitrary internet URLs usually don't send CORS headers.
            crossOrigin={isServerMedia ? 'anonymous' : undefined}
            preload="auto"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            playsInline
            onLoadedMetadata={(e) => {
              const vid = e.currentTarget;
              if (vid.duration && Number.isFinite(vid.duration)) setDuration(vid.duration);
              setIsAudioOnly(vid.videoWidth === 0);
              setMediaError(null);
              vid.playbackRate = effectiveRateRef.current;
              applyHtmlCaptions();
            }}
            onError={() => {
              setMediaError(
                isServerMedia
                  ? 'Could not load this file from the media server. It may have been cleaned up, or this format (e.g. some MKV codecs) is not playable in your browser.'
                  : 'Could not load this media URL.'
              );
            }}
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
          >
            {subtitleSrc && (
              <track key={subtitleSrc} kind="subtitles" src={subtitleSrc} srcLang="en" label="Subtitles" onLoad={applyHtmlCaptions} />
            )}
          </video>
        ) : null}

        {/* Audio-only upload (mp3, flac, …): show artwork instead of a black box */}
        {isDirectMedia && isAudioOnly && !mediaError && !isViewingScreen && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              pointerEvents: 'none',
              background: 'radial-gradient(circle at 50% 40%, rgba(168,85,247,0.35) 0%, rgba(15,20,32,1) 70%)',
            }}
          >
            <MusicNote
              sx={{
                fontSize: isImmersive ? 120 : 54,
                color: 'var(--c-primary-strong)',
                animation: currentBroadcast?.playing && !isLocallyPaused ? 'mediaPulse 1.6s ease-in-out infinite' : 'none',
                '@keyframes mediaPulse': {
                  '0%, 100%': { transform: 'scale(1)', opacity: 0.85 },
                  '50%': { transform: 'scale(1.08)', opacity: 1 },
                },
              }}
            />
            <Typography sx={{ fontSize: isImmersive ? 18 : 11, color: '#e9d5ff', fontWeight: 600, px: 2, textAlign: 'center' }}>
              {currentBroadcast?.title}
            </Typography>
          </Box>
        )}

        {mediaError && !isViewingScreen && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              p: 2,
              bgcolor: 'rgba(15,20,32,0.92)',
            }}
          >
            <Typography sx={{ fontSize: 11, color: '#fca5a5', textAlign: 'center' }}>{mediaError}</Typography>
          </Box>
        )}

        {/* Feature 2: incoming screen share takes over the player (kept mounted for a stable ref) */}
        <video
          ref={screenVideoRef}
          autoPlay
          playsInline
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
            display: isViewingScreen ? 'block' : 'none',
            zIndex: 5,
          }}
        />
        {isViewingScreen && (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1,
              py: 0.25,
              borderRadius: 1,
              bgcolor: 'rgba(0,0,0,0.6)',
              color: '#f8fafc',
              fontSize: 10,
              fontWeight: 700,
              pointerEvents: 'none',
            }}
          >
            <FiberManualRecord sx={{ fontSize: 10, color: '#ef4444' }} />
            LIVE · {screenShareHostName || 'Peer'}'s screen
          </Box>
        )}
        {isViewingScreen && screenNeedsClick && (
          <Box
            onClick={handleScreenClickToPlay}
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 7,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(0,0,0,0.55)',
              cursor: 'pointer',
            }}
          >
            <Button variant="contained" startIcon={<PlayArrow />} sx={{ textTransform: 'none', fontWeight: 700, bgcolor: 'var(--c-primary)' }}>
              Click to watch & listen
            </Button>
          </Box>
        )}

        {/* Sharer's own small preview (muted) — corner only, so it never hides what's being shared */}
        <video
          ref={screenPreviewRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            right: 8,
            top: 8,
            width: isImmersive ? 240 : 110,
            aspectRatio: '16 / 9',
            objectFit: 'cover',
            borderRadius: 6,
            border: '2px solid #ef4444',
            boxShadow: '0 4px 14px rgba(0,0,0,0.6)',
            background: '#000',
            display: isScreenSharing && !isMinimized && !isRelaying ? 'block' : 'none',
            zIndex: 6,
            pointerEvents: 'none',
          }}
        />
        {isRelaying && !isMinimized && (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 6,
              px: 1,
              py: 0.25,
              borderRadius: 1,
              bgcolor: 'rgba(220,38,38,0.85)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              pointerEvents: 'none',
            }}
          >
            📡 RELAYING TO PEERS
          </Box>
        )}
        {isScreenSharing && !currentBroadcast && !isMinimized && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fca5a5',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            🔴 You are live — peers see your shared screen
          </Box>
        )}

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
            background: 'var(--c-surface)',
            backdropFilter: 'blur(20px)',
            border: isDragging ? '1px solid var(--c-border-strong)' : '1px solid var(--c-border-strong)',
            boxShadow: isDragging
              ? '0 16px 40px rgba(0,0,0,0.7), 0 0 24px var(--c-primary-soft)'
              : 'var(--c-shadow)',
            color: 'var(--c-text)',
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
                color: isDragging ? 'var(--c-primary-strong)' : 'var(--c-text-muted)',
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
              bgcolor: 'var(--c-primary-soft)',
              color: 'var(--c-primary-strong)',
              '&:hover': { bgcolor: 'var(--c-primary)' },
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
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text)' }}>
              {currentBroadcast ? currentBroadcast.title : 'Watch Party'}
            </Typography>
            <Typography sx={{ fontSize: 9, color: isLocallyPaused ? '#fca5a5' : 'var(--c-primary)' }}>
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
            sx={{ color: 'var(--c-text-muted)' }}
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
            borderRadius: currentBroadcast || screenActive ? '0 0 16px 16px' : '16px',
            background: 'var(--c-surface)',
            backdropFilter: 'blur(24px)',
            border: '1px solid var(--c-border-strong)',
            borderTop: currentBroadcast || screenActive ? 'none' : '1px solid var(--c-border-strong)',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 30px var(--c-primary-soft)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            color: 'var(--c-text)',
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
              borderBottom: '1px solid var(--c-border)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MusicNote sx={{ fontSize: 17, color: 'var(--c-primary-strong)' }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
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
                    bgcolor: isHost ? 'var(--c-primary-soft)' : 'rgba(59, 130, 246, 0.2)',
                    color: isHost ? 'var(--c-primary-strong)' : 'var(--c-info)',
                    border: '1px solid var(--c-border)',
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
                    color: isWideScreen ? 'var(--c-primary-strong)' : 'var(--c-text-muted)',
                    bgcolor: isWideScreen ? 'var(--c-primary-soft)' : 'transparent',
                    p: 0.5,
                    borderRadius: 1.5,
                    border: isWideScreen ? '1px solid var(--c-border-strong)' : '1px solid transparent',
                    '&:hover': { color: 'var(--c-text)', bgcolor: 'var(--c-primary-soft)' },
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
                    color: isFullScreen ? 'var(--c-info)' : 'var(--c-text-muted)',
                    bgcolor: isFullScreen ? 'rgba(59,130,246,0.2)' : 'transparent',
                    p: 0.5,
                    borderRadius: 1.5,
                    border: isFullScreen ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                    '&:hover': { color: 'var(--c-text)', bgcolor: 'rgba(59,130,246,0.15)' },
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
                sx={{ color: 'var(--c-text-muted)', p: 0.5, '&:hover': { color: 'var(--c-text)' } }}
              >
                <Remove sx={{ fontSize: 16 }} />
              </IconButton>
              <IconButton
                size="small"
                onClick={handleClose}
                title={isHost ? "Stop Broadcast & Close Watch Party (stay on canvas)" : "Close Watch Party (stay on canvas)"}
                sx={{ color: 'var(--c-text-muted)', p: 0.5, '&:hover': { color: '#ef4444' } }}
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
                bgcolor: 'var(--c-surface2)',
                borderBottom: '1px solid var(--c-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Radio sx={{ fontSize: 13, color: 'var(--c-primary)' }} />
                <Typography sx={{ fontSize: 10, color: 'var(--c-text)' }}>
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
                    color: 'var(--c-primary-strong)',
                  }}
                >
                  {showPeerList ? 'Hide Streams' : 'Switch Stream ▾'}
                </Button>
              )}
            </Box>
          )}

          {/* Dropdown list of other peer streams */}
          {showPeerList && otherBroadcasts.length > 0 && (
            <Box sx={{ p: 1, bgcolor: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)' }}>
              <Typography sx={{ fontSize: 9, color: 'var(--c-text-muted)', mb: 0.5, px: 1, fontWeight: 700, textTransform: 'uppercase' }}>
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
                    '&:hover': { bgcolor: 'var(--c-primary-soft)' },
                  }}
                >
                  <Box sx={{ overflow: 'hidden' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.title}
                    </Typography>
                    <Typography sx={{ fontSize: 9, color: 'var(--c-primary)' }}>
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
                      color: 'var(--c-primary-strong)',
                      bgcolor: 'var(--c-primary-soft)',
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
                    color: 'var(--c-text)',
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
                    <Chip size="small" label="Loop" sx={{ height: 16, fontSize: 8, bgcolor: 'var(--c-primary-soft)', color: 'var(--c-primary-strong)' }} />
                  )}
                  {currentBroadcast.autoPlayNext && (
                    <Chip size="small" label="AutoPlay" sx={{ height: 16, fontSize: 8, bgcolor: 'rgba(59,130,246,0.2)', color: 'var(--c-info)' }} />
                  )}
                </Box>
              </Box>

              {/* Progress Slider (Zero-lag) */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: 10, color: 'var(--c-text-muted)', minWidth: 30, fontVariantNumeric: 'tabular-nums' }}>
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
                    color: 'var(--c-primary)',
                    height: 4,
                    '& .MuiSlider-thumb': { width: 10, height: 10 },
                  }}
                />
                <Typography sx={{ fontSize: 10, color: 'var(--c-text-muted)', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
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
                        sx={{ color: 'var(--c-text-muted)', p: 0.75, '&:hover': { color: 'var(--c-text)' } }}
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
                            color: 'var(--c-primary-strong)',
                            p: 0.75,
                            '&:hover': { color: 'var(--c-accent)', bgcolor: 'var(--c-primary-soft)' },
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
                          background: 'linear-gradient(135deg, var(--c-primary) 0%, var(--c-accent) 100%)',
                          boxShadow: '0 4px 14px var(--c-primary-soft)',
                          '&:hover': {
                            background: 'linear-gradient(135deg, var(--c-primary-strong) 0%, var(--c-accent) 100%)',
                            boxShadow: '0 6px 18px var(--c-primary-soft)',
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
                            color: 'var(--c-primary-strong)',
                            p: 0.75,
                            '&:hover': { color: 'var(--c-accent)', bgcolor: 'var(--c-primary-soft)' },
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
                        sx={{ color: 'var(--c-text-muted)', p: 0.75, '&:hover': { color: 'var(--c-text)' } }}
                      >
                        <FastForward sx={{ fontSize: 19 }} />
                      </IconButton>
                    </Tooltip>
                  </>
                ) : (
                  // Listener Playback Bar
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                    <Tooltip title="Back 10s (just you — Sync to Host rejoins)">
                      <IconButton
                        size="small"
                        onClick={() => handlePeerSkip(-10)}
                        sx={{ color: 'var(--c-text-muted)', p: 0.6, '&:hover': { color: 'var(--c-text)' } }}
                      >
                        <FastRewind sx={{ fontSize: 19 }} />
                      </IconButton>
                    </Tooltip>
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
                          color: 'var(--c-primary-strong)',
                          borderColor: 'var(--c-primary)',
                          bgcolor: 'var(--c-primary-soft)',
                          '&:hover': { bgcolor: 'var(--c-primary-soft)', borderColor: 'var(--c-primary-strong)' },
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
                    <Tooltip title="Forward 10s (just you — Sync to Host rejoins)">
                      <IconButton
                        size="small"
                        onClick={() => handlePeerSkip(10)}
                        sx={{ color: 'var(--c-text-muted)', p: 0.6, '&:hover': { color: 'var(--c-text)' } }}
                      >
                        <FastForward sx={{ fontSize: 19 }} />
                      </IconButton>
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
                          color: isLocallyPaused ? 'var(--c-success)' : '#f87171',
                          borderColor: isLocallyPaused ? 'rgba(74, 222, 128, 0.4)' : 'rgba(248, 113, 113, 0.4)',
                          bgcolor: isLocallyPaused ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.08)',
                          '&:hover': {
                            borderColor: isLocallyPaused ? 'var(--c-success)' : '#f87171',
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
                      icon={<Headphones sx={{ fontSize: 12, color: 'var(--c-primary-strong) !important' }} />}
                      label={`Tuned into ${currentBroadcast.hostName}`}
                      sx={{
                        height: 20,
                        fontSize: 9,
                        fontWeight: 600,
                        bgcolor: 'var(--c-primary-soft)',
                        color: 'var(--c-text)',
                        border: '1px solid var(--c-border-strong)',
                      }}
                    />
                  )}
                  {/* Live drift readout: how far this peer is from the host */}
                  {!isHost && currentBroadcast.playing && !isLocallyPaused && (
                    <Tooltip title={
                      isDesyncedByChoice
                        ? 'You moved away on purpose — press Sync to Host to rejoin'
                        : 'Offset from the host (+ ahead / − behind). Green = in sync.'
                    }>
                      <Chip
                        size="small"
                        label={
                          isDesyncedByChoice
                            ? 'Own position'
                            : syncDrift === null
                            ? 'Δ …'
                            : `Δ ${syncDrift >= 0 ? '+' : '−'}${Math.abs(syncDrift).toFixed(2)}s`
                        }
                        sx={{
                          height: 20,
                          fontSize: 9,
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          bgcolor: 'var(--c-surface2)',
                          border: '1px solid var(--c-border)',
                          color: isDesyncedByChoice || syncDrift === null
                            ? 'var(--c-warning)'
                            : Math.abs(syncDrift) < 0.15 ? 'var(--c-success)' : Math.abs(syncDrift) < 0.5 ? 'var(--c-warning)' : '#f87171',
                        }}
                      />
                    </Tooltip>
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
                          color: currentBroadcast.loop ? 'var(--c-primary-strong)' : 'var(--c-text-faint)',
                          bgcolor: currentBroadcast.loop ? 'var(--c-primary-soft)' : 'transparent',
                          borderRadius: 1.5,
                          border: currentBroadcast.loop ? '1px solid var(--c-border-strong)' : '1px solid transparent',
                          '&:hover': { color: 'var(--c-primary-strong)', bgcolor: 'var(--c-primary-soft)' },
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
                          color: currentBroadcast.autoPlayNext ? 'var(--c-info)' : 'var(--c-text-faint)',
                          bgcolor: currentBroadcast.autoPlayNext ? 'rgba(59,130,246,0.2)' : 'transparent',
                          borderRadius: 1.5,
                          border: currentBroadcast.autoPlayNext ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                          '&:hover': { color: 'var(--c-info)', bgcolor: 'rgba(59,130,246,0.15)' },
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
                      bgcolor: 'var(--c-surface2)',
                      px: 0.75,
                      py: 0.25,
                      borderRadius: 1.75,
                      border: '1px solid var(--c-border)',
                    }}
                  >
                    <Tooltip title={isMuted ? 'Unmute' : 'Mute'}>
                      <IconButton
                        size="small"
                        onClick={() => setIsMuted(!isMuted)}
                        sx={{ color: isMuted ? '#ef4444' : 'var(--c-text-muted)', p: 0.25, '&:hover': { color: 'var(--c-text)' } }}
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
                        color: 'var(--c-primary)',
                        height: 3,
                        '& .MuiSlider-thumb': { width: 8, height: 8 },
                      }}
                    />
                  </Box>
                </Box>
              </Box>
            </Box>
          ) : screenActive ? (
            // Screen share only (no synced media broadcast)
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 12, color: 'var(--c-text)', fontWeight: 700 }}>
                  {isScreenSharing ? '🔴 You are sharing your screen' : `🖥️ ${screenShareHostName || 'A peer'} is sharing`}
                </Typography>
                <Typography sx={{ fontSize: 10, color: 'var(--c-text-muted)' }}>
                  {isScreenSharing ? 'Video + audio relayed peer-to-peer over the local network' : 'Live over the local network — no internet needed'}
                </Typography>
              </Box>
              {isViewingScreen && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <IconButton
                    size="small"
                    onClick={() => setIsMuted(!isMuted)}
                    sx={{ color: isMuted ? '#ef4444' : 'var(--c-text-muted)', p: 0.25 }}
                  >
                    {isMuted || volume === 0 ? <VolumeOff sx={{ fontSize: 15 }} /> : <VolumeUp sx={{ fontSize: 15 }} />}
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
                    sx={{ width: 60, color: 'var(--c-primary)', height: 3, '& .MuiSlider-thumb': { width: 8, height: 8 } }}
                  />
                </Box>
              )}
            </Box>
          ) : (
            // No stream playing state
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 12, color: 'var(--c-text)', fontWeight: 600, mb: 0.5 }}>
                No active stream in room
              </Typography>
              <Typography sx={{ fontSize: 10, color: 'var(--c-text-faint)' }}>
                Paste a YouTube link, pick a local music/video file, or share your screen — local files and screen share work without internet.
              </Typography>
            </Box>
          )}

          {/* TOOLS ROW: captions / speed / quality (per-peer) + screen share */}
          <Box
            sx={{
              px: 2,
              py: 0.75,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              borderTop: '1px solid var(--c-border)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              {renderMediaExtras('dock')}
              <Tooltip
                open={showShortcutHelp}
                onOpen={() => setShowShortcutHelp(true)}
                onClose={() => setShowShortcutHelp(false)}
                title={
                  <Box sx={{ fontSize: 11, lineHeight: 1.6 }}>
                    <b>Shortcuts</b> (hover or click the dock first)<br />
                    Space — play / pause<br />
                    ↑ / ↓ — volume ±10%<br />
                    ← / → — skip ∓10s (host: everyone · peer: just you)<br />
                    Esc — exit wide / full screen
                  </Box>
                }
              >
                <IconButton size="small" sx={{ p: 0.5, color: 'var(--c-text-faint)', '&:hover': { color: 'var(--c-text)' } }}>
                  <Keyboard sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {onStartScreenShare && !isScreenSharing && isHost && currentBroadcast?.mediaType === 'youtube' && (
              <Tooltip title="Stream exactly what your player shows & plays to every peer over the local network — peers don't need YouTube or internet">
                <span>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={handleRelayToPeers}
                    disabled={isStartingShare}
                    sx={{
                      px: 1.25,
                      py: 0.35,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'none',
                      borderRadius: 1.75,
                      whiteSpace: 'nowrap',
                      background: 'linear-gradient(135deg, var(--c-primary) 0%, var(--c-accent) 100%)',
                      mr: 0.5,
                    }}
                  >
                    📡 Relay to peers
                  </Button>
                </span>
              </Tooltip>
            )}
            {onStartScreenShare && (
              isScreenSharing ? (
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleToggleScreenShare}
                  startIcon={<StopScreenShare sx={{ fontSize: 15 }} />}
                  sx={{
                    px: 1.25,
                    py: 0.35,
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'none',
                    borderRadius: 1.75,
                    whiteSpace: 'nowrap',
                    bgcolor: '#dc2626',
                    animation: 'stopSharePulse 1.6s ease-in-out infinite',
                    '@keyframes stopSharePulse': {
                      '0%, 100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0.6)' },
                      '50%': { boxShadow: '0 0 0 6px rgba(239,68,68,0)' },
                    },
                    '&:hover': { bgcolor: '#b91c1c' },
                  }}
                >
                  {isRelaying ? 'Stop Relay' : 'Stop Sharing'}
                </Button>
              ) : (
                <Tooltip title={isViewingScreen ? `${screenShareHostName || 'A peer'} is already sharing — starting yours replaces it` : 'Share a tab/screen with audio (YouTube, Spotify, anything) to everyone on the network'}>
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleToggleScreenShare}
                      disabled={isStartingShare}
                      startIcon={isStartingShare ? <CircularProgress size={12} sx={{ color: 'var(--c-primary-strong)' }} /> : <ScreenShare sx={{ fontSize: 15 }} />}
                      sx={{
                        px: 1.25,
                        py: 0.35,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'none',
                        borderRadius: 1.75,
                        whiteSpace: 'nowrap',
                        color: 'var(--c-primary-strong)',
                        borderColor: 'var(--c-primary)',
                        '&:hover': { borderColor: 'var(--c-primary-strong)', bgcolor: 'var(--c-primary-soft)' },
                      }}
                    >
                      {isHost && currentBroadcast?.mediaType === 'youtube' ? 'Screen' : '🖥️ Share Screen'}
                    </Button>
                  </span>
                </Tooltip>
              )
            )}
            </Box>
          </Box>

          {/* CLEAN UNCLUTTERED URL BROADCAST INPUT (No default songs) */}
          <Box sx={{ px: 2, pb: 2, pt: 0.5, borderTop: '1px solid var(--c-border)' }}>
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
                    bgcolor: 'var(--c-surface2)',
                    border: '1px solid var(--c-border)',
                    '&:focus-within': {
                      borderColor: 'var(--c-primary)',
                      boxShadow: '0 0 0 1px var(--c-primary)',
                    },
                  }}
                >
                  <LinkIcon sx={{ fontSize: 14, color: 'var(--c-text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Paste YouTube / media link…"
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'var(--c-text)',
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
                    bgcolor: 'var(--c-primary)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 10,
                    textTransform: 'none',
                    borderRadius: 1.5,
                    py: 0.6,
                    px: 1.25,
                    whiteSpace: 'nowrap',
                    '&:hover': { bgcolor: 'var(--c-primary-strong)' },
                  }}
                >
                  Broadcast
                </Button>
                <Tooltip title="Stream a music/video file from this computer (mp3, mp4, webm, mkv…) — works offline">
                  <span>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      startIcon={isUploading ? <CircularProgress size={11} sx={{ color: 'var(--c-primary-strong)' }} /> : <UploadFile sx={{ fontSize: 14 }} />}
                      sx={{
                        color: 'var(--c-primary-strong)',
                        borderColor: 'var(--c-primary)',
                        fontWeight: 700,
                        fontSize: 10,
                        textTransform: 'none',
                        borderRadius: 1.5,
                        py: 0.5,
                        px: 1,
                        whiteSpace: 'nowrap',
                        '& .MuiButton-startIcon': { mr: 0.5 },
                        '&:hover': { borderColor: 'var(--c-primary-strong)', bgcolor: 'var(--c-primary-soft)' },
                      }}
                    >
                      📁 File
                    </Button>
                  </span>
                </Tooltip>
              </Box>
            </form>
            {isUploading && (
              <Box sx={{ mt: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                  <Typography sx={{ fontSize: 9, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                    Uploading {uploadLabel} to the local server…
                  </Typography>
                  <Typography sx={{ fontSize: 9, color: 'var(--c-primary-strong)', fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(uploadProgress * 100)}%
                  </Typography>
                </Box>
                <LinearProgress
                  variant={uploadProgress > 0 ? 'determinate' : 'indeterminate'}
                  value={uploadProgress * 100}
                  sx={{ height: 4, borderRadius: 2, bgcolor: 'var(--c-surface2)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--c-primary)' } }}
                />
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Transient toast (inside the dock so it also shows in native fullscreen) */}
      {toast && (
        <Box
          role="status"
          sx={{
            position: isImmersive ? 'fixed' : 'absolute',
            top: isImmersive ? 24 : -44,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100000,
            maxWidth: 'min(420px, calc(100vw - 32px))',
            px: 1.5,
            py: 0.75,
            borderRadius: 2,
            bgcolor: 'var(--c-surface)',
            border: '1px solid var(--c-border-strong)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            color: 'var(--c-text)',
            fontSize: 11,
            fontWeight: 600,
            textAlign: 'center',
            pointerEvents: 'none',
            whiteSpace: 'normal',
          }}
        >
          {toast}
        </Box>
      )}

      {renderMenus()}
    </Box>
  );
}
