import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'offline';

export interface CRDTConnection {
  doc: Y.Doc | null;
  awareness: Awareness | null;
  provider: WebrtcProvider | null;
  connectionState: ConnectionState;
  connected: boolean;
  peerCount: number;
  roomId: string;
  localIP: string;
  offlineMode: boolean;
  simulateOffline: () => void;
  simulateOnline: () => void;
  triggerReconnect: () => void;
}

export function useCRDTConnection(
  actorName: string,
  roomId: string,
  actorColor: string,
  onFlushQueue?: () => void
): CRDTConnection {
  const [docState, setDocState] = useState<Y.Doc | null>(null);
  const [awarenessState, setAwarenessState] = useState<Awareness | null>(null);
  const [providerState, setProviderState] = useState<WebrtcProvider | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [connected, setConnected] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [localIP, setLocalIP] = useState('');
  const [roomID, setRoomID] = useState('');

  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebrtcProvider | null>(null);
  const indexeddbRef = useRef<any>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const offlineModeRef = useRef(false);

  const flushQueueRef = useRef(onFlushQueue);
  useEffect(() => {
    flushQueueRef.current = onFlushQueue;
  }, [onFlushQueue]);

  const simulateOffline = useCallback(() => {
    offlineModeRef.current = true;
    setConnectionState('offline');
    setConnected(false);
    providerRef.current?.disconnect();
    console.log('[crdt] Simulating offline mode');
  }, []);

  const simulateOnline = useCallback(() => {
    offlineModeRef.current = false;
    setConnectionState('connecting');
    providerRef.current?.connect();
    console.log('[crdt] Simulating online mode');
  }, []);

  const triggerReconnect = useCallback(() => {
    setConnectionState('connecting');
    providerRef.current?.connect();
  }, []);

  useEffect(() => {
    if (awarenessRef.current) {
      awarenessRef.current.setLocalStateField('color', actorColor);
    }
  }, [actorColor]);

  const initCanvas = useCallback(async () => {
    if (!actorName || !roomId) return;

    const doc = new Y.Doc();
    docRef.current = doc;
    setDocState(doc);

    const awareness = new Awareness(doc);
    awarenessRef.current = awareness;
    setAwarenessState(awareness);
    
    awareness.setLocalStateField('actor', actorName);
    awareness.setLocalStateField('color', actorColor);
    awareness.setLocalStateField('cursor', { x: 0, y: 0 });
    awareness.setLocalStateField('handId', crypto.randomUUID?.() || 'xxxx'.replace(/x/g, () => (Math.random()*16|0).toString(16)));

    doc.getText('chat');

    let signalingUrl = import.meta.env.VITE_SIGNALING_URL;
    let fetchedIP = '';
    try {
      const resp = await fetch('/api/ip');
      const data = await resp.json();
      fetchedIP = data.ip || data.localIP || '';
      setLocalIP(fetchedIP);
    } catch {
      setLocalIP('');
    }

    const host = window.location.hostname || 'localhost';
    const targetHost = (host && host !== 'localhost' && host !== '127.0.0.1') ? host : (fetchedIP || 'localhost');
    const query = actorName ? `?name=${encodeURIComponent(actorName)}` : '';
    let finalSignalingUrl = signalingUrl;
    if (finalSignalingUrl) {
      finalSignalingUrl = finalSignalingUrl.includes('?') ? `${finalSignalingUrl}&name=${encodeURIComponent(actorName)}` : `${finalSignalingUrl}${query}`;
    } else {
      finalSignalingUrl = `ws://${targetHost}:3001/ws${query}`;
    }

    const provider = new WebrtcProvider(roomId, doc, {
      signaling: [finalSignalingUrl],
      awareness,
    });
    providerRef.current = provider;
    setProviderState(provider);

    provider.on('synced', (state: any) => {
      const isSynced = typeof state === 'object' ? state?.synced : state;
      if (isSynced && !offlineModeRef.current) {
        setTimeout(() => flushQueueRef.current?.(), 100);
      }
    });

    const indexeddb = new IndexeddbPersistence(`crdt-canvas-${roomId}`, doc);
    indexeddbRef.current = indexeddb;

    provider.on('status', (status: any) => {
      const state = typeof status === 'object' ? status?.status : status;
      if (offlineModeRef.current) return;
      switch (state) {
        case 'connecting': setConnectionState('connecting'); break;
        case 'connected': setConnectionState('connected'); setConnected(true); break;
        case 'disconnected': setConnectionState('disconnected'); setConnected(false); break;
        case 'syncing': setConnectionState('syncing'); break;
      }
    });

    provider.on('peers', (data: any) => {
      const peerData = Array.isArray(data) ? data[0] : data;
      const webrtc = peerData?.webrtcPeers?.length ?? (providerRef.current?.room?.webrtcConns?.size ?? 0);
      const bc = peerData?.bcPeers?.length ?? (providerRef.current?.room?.bcConns?.size ?? 0);
      const count = webrtc + bc;
      setPeerCount(count);
      if (count > 0 && !offlineModeRef.current) {
        setConnected(true);
        setConnectionState(prev => prev === 'connecting' ? 'syncing' : 'connected');
        setTimeout(() => flushQueueRef.current?.(), 300);
      }
      setRoomID(roomId);
    });

  }, [actorName, roomId]);

  useEffect(() => {
    initCanvas();
    return () => {
      providerRef.current?.destroy();
      indexeddbRef.current?.destroy();
      awarenessRef.current?.destroy();
      docRef.current?.destroy();
    };
  }, [initCanvas]);

  return {
    doc: docState,
    awareness: awarenessState,
    provider: providerState,
    connectionState,
    connected,
    peerCount,
    roomId: roomID,
    localIP,
    offlineMode: offlineModeRef.current,
    simulateOffline,
    simulateOnline,
    triggerReconnect
  };
}
