import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { CURRENT_BOARD_SCHEMA_VERSION, migrateBoardDocument } from '@crdt-canvas/engine';
import { deleteMigrationBackup, getMigrationBackup, saveMigrationBackup } from '../../canvas/migrationRecovery';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'offline';
export type PersistenceState = 'loading' | 'ready' | 'error' | 'migration-error';

export interface CRDTConnection {
  doc: Y.Doc | null;
  awareness: Awareness | null;
  provider: WebrtcProvider | null;
  connectionState: ConnectionState;
  persistenceState: PersistenceState;
  persistenceError: string | null;
  migrationSummary: string | null;
  migrationBackupAvailable: boolean;
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
  const [persistenceState, setPersistenceState] = useState<PersistenceState>('loading');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [migrationSummary, setMigrationSummary] = useState<string | null>(null);
  const [migrationBackupAvailable, setMigrationBackupAvailable] = useState(false);
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
    setPersistenceState('loading');

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

    let migrationTask: Promise<ReturnType<typeof migrateBoardDocument> | null> | null = null;
    const migrateSafely = () => {
      if (migrationTask) return migrationTask;
      migrationTask = (async () => {
        let backupAvailable = false;
        try {
          const preview = migrateBoardDocument(doc, { dryRun: true });
          const needsBackup = preview.changedShapes > 0 || preview.fromVersion !== CURRENT_BOARD_SCHEMA_VERSION;
          if (needsBackup) {
            backupAvailable = Boolean(await getMigrationBackup(roomId));
            setMigrationBackupAvailable(backupAvailable);
            if (!backupAvailable) {
              await saveMigrationBackup(roomId, Y.encodeStateAsUpdate(doc));
              backupAvailable = true;
              setMigrationBackupAvailable(true);
            }
          }
          const migration = migrateBoardDocument(doc);
          setPersistenceError(null);
          if (migration.changedShapes > 0 || migration.fromVersion !== migration.toVersion) setMigrationSummary(migration.summary);
          setPersistenceState(previous => previous === 'migration-error' ? 'ready' : previous);
          if (backupAvailable) {
            try {
              await deleteMigrationBackup(roomId);
              backupAvailable = false;
              setMigrationBackupAvailable(false);
            } catch {
              // Migration succeeded. Keep a downloadable recovery copy if cleanup fails.
            }
          }
          return migration;
        } catch (error) {
          if (!backupAvailable) {
            try {
              await saveMigrationBackup(roomId, Y.encodeStateAsUpdate(doc));
              backupAvailable = true;
              setMigrationBackupAvailable(true);
            } catch (backupError) {
              const reason = backupError instanceof Error ? backupError.message : 'Could not save a local recovery copy.';
              const message = error instanceof Error ? error.message : 'The board schema could not be migrated.';
              setPersistenceError(`${message} ${reason} The board was left unchanged.`);
              setPersistenceState('migration-error');
              return null;
            }
          }
          const message = error instanceof Error ? error.message : 'The board schema could not be migrated.';
          setPersistenceError(message);
          setPersistenceState('migration-error');
          return null;
        }
      })().finally(() => { migrationTask = null; });
      return migrationTask;
    };

    provider.on('synced', (state: any) => {
      const isSynced = typeof state === 'object' ? state?.synced : state;
      if (isSynced) {
        void migrateSafely().then(migration => {
          if (migration && !offlineModeRef.current) setTimeout(() => flushQueueRef.current?.(), 100);
        });
      }
    });

    try {
      const indexeddb = new IndexeddbPersistence(`crdt-canvas-${roomId}`, doc);
      indexeddbRef.current = indexeddb;
      indexeddb.whenSynced.then(() => {
        void migrateSafely().then(migration => { if (migration) setPersistenceState('ready'); });
      }).catch(() => setPersistenceState('error'));
    } catch {
      setPersistenceState('error');
    }

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
    persistenceState,
    persistenceError,
    migrationSummary,
    migrationBackupAvailable,
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
