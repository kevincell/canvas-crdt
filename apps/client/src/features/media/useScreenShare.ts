import { useState, useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';

/**
 * useScreenShare — WebRTC screen/tab (+ audio) relay over a Yjs signaling channel.
 *
 * The sharer captures their screen/tab with getDisplayMedia and opens one RTCPeerConnection
 * per peer in the room (a small mesh — fine for a LAN / hotspot watch party). SDP offers and
 * answers are exchanged through the Yjs map "screen-share-signals", so no extra server is needed
 * and it keeps working with no internet.
 *
 * ICE is gathered fully *before* an offer/answer is published ("non-trickle"). On an offline
 * hotspot the STUN servers are unreachable anyway, and bundling the candidates into the SDP
 * avoids the race where candidates arrive before the remote description is set and get dropped.
 *
 * Signal map layout (all values are JSON strings):
 *   host                         { peerId, sessionId, active, timestamp }
 *   offer:<sessionId>:<peerId>   { id, sdp, type }   — written by the sharer, one per viewer
 *   answer:<sessionId>:<peerId>  { offerId, sdp, type } — written by that viewer
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

/** How long to wait for ICE gathering before sending whatever candidates we have. */
const ICE_GATHER_TIMEOUT_MS = 1500;
/** Upper bound for the video bitrate sent to each viewer (LAN can take it; keeps hotspots happy). */
const MAX_VIDEO_BITRATE = 3_000_000;

interface OutgoingPeer {
  pc: RTCPeerConnection;
  peerId: string;
  offerId: string;
  answerApplied: boolean;
}

interface HostSignal {
  peerId: string;
  sessionId: string;
  active: boolean;
  timestamp: number;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

/**
 * Ask the sender for stereo, high-bitrate Opus. Applied to the *answer* (receiver side) —
 * that is how a receiver tells the sender it wants stereo, which matters for music.
 */
function preferHighQualityOpus(sdp: string): string {
  const match = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!match) return sdp;
  const pt = match[1];
  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const extra = 'stereo=1;sprop-stereo=1;maxaveragebitrate=256000';
  if (fmtpRe.test(sdp)) {
    return sdp.replace(fmtpRe, (_line, params: string) => {
      const cleaned = params
        .split(';')
        .filter(p => p && !/^(stereo|sprop-stereo|maxaveragebitrate)=/.test(p.trim()))
        .join(';');
      return `a=fmtp:${pt} ${cleaned ? cleaned + ';' : ''}${extra}`;
    });
  }
  return sdp.replace(match[0], `${match[0]}\r\na=fmtp:${pt} ${extra}`);
}

function parse<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function useScreenShare(
  doc: Y.Doc | null,
  localPeerId: string,
  participants: Array<{ id: string; name: string }>
) {
  const [isSharing, setIsSharing] = useState(false);
  const [incomingStream, setIncomingStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hostPeerId, setHostPeerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const outgoingPeers = useRef<Map<string, OutgoingPeer>>(new Map());

  const incomingPC = useRef<RTCPeerConnection | null>(null);
  const incomingOfferId = useRef<string | null>(null);

  const viewerCheckRef = useRef<(() => void) | null>(null);
  const participantsRef = useRef(participants);
  participantsRef.current = participants;

  const getSignalMap = useCallback(() => doc?.getMap<string>('screen-share-signals') ?? null, [doc]);

  // ------- SHARER: stop -------
  const stopSharing = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => {
        t.onended = null;
        t.stop();
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setIsSharing(false);

    outgoingPeers.current.forEach(({ pc }) => {
      try { pc.close(); } catch { /* ignore */ }
    });
    outgoingPeers.current.clear();

    const signalMap = getSignalMap();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (doc && signalMap) {
      doc.transact(() => {
        const host = parse<HostSignal>(signalMap.get('host'));
        // Only clear the "host" slot if it is still ours (someone else may have taken over)
        if (host && host.peerId === localPeerId) signalMap.delete('host');
        Array.from(signalMap.keys()).forEach(k => {
          if (sessionId && k.includes(`:${sessionId}:`)) signalMap.delete(k);
        });
      }, 'screen-share-stop');
    }
  }, [doc, getSignalMap, localPeerId]);

  // ------- SHARER: start -------
  /**
   * options.preferCurrentTab — offer THIS tab first in Chrome's picker (used by "Relay to peers").
   * options.cropTo — crop the captured tab to this element (Chrome Region Capture), so peers get
   *                  just the host's player instead of the whole canvas UI.
   */
  const startSharing = useCallback(async (
    options?: { preferCurrentTab?: boolean; cropTo?: HTMLElement | null }
  ): Promise<MediaStream | null> => {
    const signalMap = getSignalMap();
    if (!doc || !signalMap) return null;
    setError(null);

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen sharing needs a desktop browser (Chrome/Edge) on http://localhost or https.');
      return null;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        // Raw audio: echo cancellation / noise suppression ruin music
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
        // Chrome hints: offer "share tab audio"/"share system audio" by default
        ...({
          systemAudio: 'include',
          selfBrowserSurface: 'include',
          surfaceSwitching: 'include',
          ...(options?.preferCurrentTab ? { preferCurrentTab: true } : {}),
        } as object),
      } as DisplayMediaStreamOptions);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') return null; // user cancelled
      setError('Could not start screen share.');
      return null;
    }

    // Stop any previous session cleanly first
    if (localStreamRef.current) stopSharing();

    // Region Capture: when the host relays this very tab, crop to the player element
    const cropEl = options?.cropTo;
    const CropTargetCtor = (window as any).CropTarget;
    const videoTrack = stream.getVideoTracks()[0] as any;
    if (cropEl && CropTargetCtor?.fromElement && typeof videoTrack?.cropTo === 'function') {
      try {
        const target = await CropTargetCtor.fromElement(cropEl);
        await videoTrack.cropTo(target);
      } catch {
        /* user picked another tab/screen — cropping only applies to this tab; send uncropped */
      }
    }

    stream.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch { /* ignore */ } });
    stream.getAudioTracks().forEach(t => { try { t.contentHint = 'music'; } catch { /* ignore */ } });
    if (stream.getAudioTracks().length === 0) {
      setError('Sharing without audio — tick "Share tab audio" / "Share system audio" in the picker to send sound.');
    }

    const sessionId = randomId();
    sessionIdRef.current = sessionId;
    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsSharing(true);

    // Browser's native "Stop sharing" bar ends the video track
    stream.getVideoTracks().forEach(track => {
      track.onended = () => stopSharing();
    });

    doc.transact(() => {
      // Drop stale signals from earlier sessions (they can persist in IndexedDB)
      Array.from(signalMap.keys()).forEach(k => signalMap.delete(k));
      signalMap.set('host', JSON.stringify({
        peerId: localPeerId,
        sessionId,
        active: true,
        timestamp: Date.now(),
      } satisfies HostSignal));
    }, 'screen-share-start');

    return stream;
  }, [doc, getSignalMap, localPeerId, stopSharing]);

  // ------- SHARER: one connection per viewer -------
  useEffect(() => {
    const signalMap = getSignalMap();
    const stream = localStreamRef.current;
    const sessionId = sessionIdRef.current;
    if (!isSharing || !doc || !signalMap || !stream || !sessionId) return;

    const presentIds = new Set(participants.map(p => p.id));

    // Close connections to peers that left (or failed so they get a fresh offer)
    outgoingPeers.current.forEach((entry, peerId) => {
      const state = entry.pc.connectionState;
      if (!presentIds.has(peerId) || state === 'failed' || state === 'closed') {
        try { entry.pc.close(); } catch { /* ignore */ }
        outgoingPeers.current.delete(peerId);
        doc.transact(() => {
          signalMap.delete(`offer:${sessionId}:${peerId}`);
          signalMap.delete(`answer:${sessionId}:${peerId}`);
        }, 'ss-peer-left');
      }
    });

    for (const participant of participants) {
      if (participant.id === localPeerId) continue;
      if (outgoingPeers.current.has(participant.id)) continue;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const offerId = randomId();
      const entry: OutgoingPeer = { pc, peerId: participant.id, offerId, answerApplied: false };
      outgoingPeers.current.set(participant.id, entry);

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const tuneVideoSender = () => {
        pc.getSenders().forEach(sender => {
          if (sender.track?.kind !== 'video') return;
          try {
            const params = sender.getParameters();
            if (!params.encodings?.length) return;
            params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE;
            // Keep motion smooth rather than sharp when bandwidth dips
            (params as any).degradationPreference = 'maintain-framerate';
            sender.setParameters(params).catch(() => { /* ignore */ });
          } catch { /* ignore */ }
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') tuneVideoSender();
        if (pc.connectionState === 'failed') {
          // Drop it; the next participants update will create a fresh connection
          try { pc.close(); } catch { /* ignore */ }
          if (outgoingPeers.current.get(participant.id) === entry) {
            outgoingPeers.current.delete(participant.id);
          }
        }
      };

      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await waitForIceGathering(pc);
          if (outgoingPeers.current.get(participant.id) !== entry || sessionIdRef.current !== sessionId) return;
          const local = pc.localDescription;
          if (!local) return;
          doc.transact(() => {
            signalMap.set(`offer:${sessionId}:${participant.id}`, JSON.stringify({
              id: offerId,
              type: local.type,
              sdp: local.sdp,
            }));
          }, 'ss-offer');
        } catch {
          /* ignore — retried on next participants change */
        }
      })();
    }
  }, [isSharing, participants, doc, getSignalMap, localPeerId]);

  // ------- SHARER: apply answers -------
  useEffect(() => {
    const signalMap = getSignalMap();
    if (!isSharing || !doc || !signalMap) return;

    const handleSignals = () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      outgoingPeers.current.forEach(entry => {
        if (entry.answerApplied) return;
        const answer = parse<{ offerId: string; type: RTCSdpType; sdp: string }>(
          signalMap.get(`answer:${sessionId}:${entry.peerId}`)
        );
        if (!answer || answer.offerId !== entry.offerId) return;
        if (entry.pc.signalingState !== 'have-local-offer') return;
        entry.answerApplied = true;
        entry.pc
          .setRemoteDescription({ type: answer.type, sdp: preferHighQualityOpus(answer.sdp) })
          .catch(() => { entry.answerApplied = false; });
      });
    };

    signalMap.observe(handleSignals);
    handleSignals();
    return () => signalMap.unobserve(handleSignals);
  }, [isSharing, doc, getSignalMap]);

  // ------- VIEWER: watch for a sharer and answer its offer -------
  useEffect(() => {
    const signalMap = getSignalMap();
    if (!doc || !signalMap || isSharing) return;

    const teardown = () => {
      if (incomingPC.current) {
        try { incomingPC.current.close(); } catch { /* ignore */ }
        incomingPC.current = null;
      }
      incomingOfferId.current = null;
      setIncomingStream(null);
      setHostPeerId(null);
    };

    const handleSignals = () => {
      const host = parse<HostSignal>(signalMap.get('host'));
      const roster = participantsRef.current;
      // Ignore a stale "host" entry left behind by a sharer who is no longer in the room
      const hostOnline = !!host && (roster.length === 0 || roster.some(p => p.id === host.peerId));
      if (!host || !host.active || host.peerId === localPeerId || !hostOnline) {
        teardown();
        return;
      }
      setHostPeerId(host.peerId);

      const offer = parse<{ id: string; type: RTCSdpType; sdp: string }>(
        signalMap.get(`offer:${host.sessionId}:${localPeerId}`)
      );
      if (!offer || offer.id === incomingOfferId.current) return;

      // New (or renegotiated) offer → fresh connection
      if (incomingPC.current) {
        try { incomingPC.current.close(); } catch { /* ignore */ }
      }
      incomingOfferId.current = offer.id;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      incomingPC.current = pc;
      const remoteStream = new MediaStream();

      pc.ontrack = (e) => {
        const source = e.streams[0];
        const tracks = source ? source.getTracks() : [e.track];
        tracks.forEach(t => {
          if (!remoteStream.getTracks().includes(t)) remoteStream.addTrack(t);
        });
        // New MediaStream object so React consumers re-attach srcObject with every track
        setIncomingStream(new MediaStream(remoteStream.getTracks()));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && incomingPC.current === pc) {
          setIncomingStream(null);
        }
      };

      const sessionId = host.sessionId;
      (async () => {
        try {
          await pc.setRemoteDescription({ type: offer.type, sdp: offer.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await waitForIceGathering(pc);
          if (incomingPC.current !== pc) return;
          const local = pc.localDescription;
          if (!local) return;
          doc.transact(() => {
            signalMap.set(`answer:${sessionId}:${localPeerId}`, JSON.stringify({
              offerId: offer.id,
              type: local.type,
              sdp: local.sdp,
            }));
          }, 'ss-answer');
        } catch {
          /* ignore — sharer will re-offer if the connection fails */
        }
      })();
    };

    viewerCheckRef.current = handleSignals;
    signalMap.observe(handleSignals);
    handleSignals();
    return () => {
      viewerCheckRef.current = null;
      signalMap.unobserve(handleSignals);
      teardown();
    };
  }, [doc, getSignalMap, isSharing, localPeerId]);

  // Re-evaluate when the roster changes: picks up a sharer whose presence arrived after their
  // signal, and drops a sharer who left (e.g. closed their laptop) without cleaning up.
  useEffect(() => {
    viewerCheckRef.current?.();
  }, [participants]);

  // Cleanup on unmount
  const stopSharingRef = useRef(stopSharing);
  stopSharingRef.current = stopSharing;
  useEffect(() => {
    return () => {
      if (localStreamRef.current) stopSharingRef.current();
      if (incomingPC.current) {
        try { incomingPC.current.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  const hostName = hostPeerId ? (participants.find(p => p.id === hostPeerId)?.name ?? null) : null;

  return {
    isSharing,
    incomingStream,
    hostPeerId,
    hostName,
    localStream,
    error,
    clearError: () => setError(null),
    startSharing,
    stopSharing,
  };
}
