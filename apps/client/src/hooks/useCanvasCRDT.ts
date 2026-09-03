import { useEffect, useRef, useState, useCallback } from 'react';

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import {
  type Shape,
  type Conflict,
  type MergeHistory,
  type ShapeData,
  ShapeKind,
  type YjsCanvasState,
  createYjsCanvas,
  createShapeInCanvas,
  updateShapeInCanvas,
  deleteShapeInCanvas,
  getActiveShapes,
  buildMergeHistory,
  detectConflicts,
} from '@crdt-canvas/engine';

// ── Connection states ────────────────────────────────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'offline';

// ── Queued operations (replayed on reconnect) ────────────────────────────────

type QueuedOp =
  | { type: 'stroke';  points: { x: number; y: number }[]; color: string; width: number }
  | { type: 'rect';    x: number; y: number; w: number; h: number; color: string }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: string }
  | { type: 'line';    x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { type: 'text';    x: number; y: number; text: string; color: string }
  | { type: 'image';   x: number; y: number; w: number; h: number; src: string }
  | { type: 'note';    x: number; y: number; text: string; color: string; bgColor: string }
  | { type: 'delete';  shapeId: string };

export interface CanvasHooks {
  // Core state
  shapes: Shape[];
  conflicts: Conflict[];
  history: MergeHistory | null;

  // Connection
  connected: boolean;
  peerCount: number;
  roomId: string;
  localIP: string;
  connectionState: ConnectionState;
  queuedOps: number;

  // Awareness
  remoteCursors: Map<string, { x: number; y: number; color: string; name: string }>;
  participants: Array<{ id: string; name: string; color: string }>;

  // Undo/redo
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // Shape operations
  createStroke: (points: { x: number; y: number }[], color: string, width: number) => string | null;
  createRect: (x: number, y: number, w: number, h: number, color: string) => string | null;
  createEllipse: (cx: number, cy: number, rx: number, ry: number, color: string) => string | null;
  createLine: (x1: number, y1: number, x2: number, y2: number, color: string, width: number) => string | null;
  createText: (x: number, y: number, text: string, color: string) => string | null;
  createImage: (x: number, y: number, w: number, h: number, src: string) => string | null;
  createNote: (x: number, y: number, text: string, color: string, bgColor: string) => string | null;
  updateShape: (id: string, data: Partial<any>) => void;
  deleteShape: (id: string) => void;
  setCursor: (x: number, y: number) => void;
  setParticipantName: (name: string) => void;

  // Chat
  sendMessage: (text: string) => void;

  // Doc access for chat panel
  doc: Y.Doc | null;

  // Simulation controls
  simulateOffline: () => void;
  simulateOnline: () => void;
  triggerReconnect: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCanvasCRDT(actorName: string, roomId: string): CanvasHooks {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [history, setHistory] = useState<MergeHistory | null>(null);
  const [connected, setConnected] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [roomID, setRoomID] = useState('');
  const [localIP, setLocalIP] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [queuedOps, setQueuedOps] = useState(0);
  const [remoteCursors, setRemoteCursors] = useState(new Map<string, { x: number; y: number; color: string; name: string }>());
  const [participants, setParticipants] = useState<Array<{ id: string; name: string; color: string }>>([]);

  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebrtcProvider | null>(null);
  const indexeddbRef = useRef<any>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const historyEventsRef = useRef<any[]>([]);
  const lastShapeCountRef = useRef(0);

  // Undo / redo stacks
  const undoStackRef = useRef<any[]>([]);
  const redoStackRef = useRef<any[]>([]);
  const shapeSnapshotsRef = useRef<Map<string, Shape>>(new Map());

  // ── Offline simulation ──────────────────────────────────────────────────
  const offlineModeRef = useRef(false);
  const pendingOpsRef = useRef<QueuedOp[]>([]);

  // ── Operation queue ─────────────────────────────────────────────────────

  const flushQueue = useCallback(() => {
    const ops = pendingOpsRef.current;
    if (ops.length === 0) return;
    pendingOpsRef.current = [];
    setQueuedOps(0);

    const doc = docRef.current;
    if (!doc) return;
    const shapesArray = doc.getArray('shapes');
    const aw = awarenessRef.current;

    for (const op of ops) {
      switch (op.type) {
        case 'stroke':
          createShapeInCanvas({ doc, shapesArray, awareness: aw!, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Stroke, { points: op.points, color: op.color, width: op.width }, actorName);
          break;
        case 'rect':
          createShapeInCanvas({ doc, shapesArray, awareness: aw!, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Rect, { x: op.x, y: op.y, w: op.w, h: op.h, color: op.color }, actorName);
          break;
        case 'ellipse':
          createShapeInCanvas({ doc, shapesArray, awareness: aw!, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Rect, { x: op.cx - op.rx, y: op.cy - op.ry, w: op.rx * 2, h: op.ry * 2, color: op.color }, actorName);
          break;
        case 'line':
          createShapeInCanvas({ doc, shapesArray, awareness: aw!, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Stroke, { points: [{ x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 }], color: op.color, width: op.width }, actorName);
          break;
        case 'text':
          createShapeInCanvas({ doc, shapesArray, awareness: aw!, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Text, { x: op.x, y: op.y, text: op.text, color: op.color }, actorName);
          break;
        case 'image':
          createShapeInCanvas({ doc, shapesArray, awareness: aw!, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Image, { x: op.x, y: op.y, w: op.w, h: op.h, src: op.src }, actorName);
          break;
        case 'note':
          createShapeInCanvas({ doc, shapesArray, awareness: aw!, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Note, { x: op.x, y: op.y, text: op.text, color: op.color, bgColor: op.bgColor }, actorName);
          break;
        case 'delete':
          deleteShapeInCanvas({ doc, shapesArray: doc.getArray('shapes'), awareness: aw!, onChange: () => {}, dispose: () => {} } as any,
            op.shapeId, actorName);
          break;
      }
    }
    console.log(`[canvas] Flushed ${ops.length} queued operation(s) on reconnect`);
  }, [actorName]);

  const queueOp = useCallback((op: QueuedOp) => {
    pendingOpsRef.current.push(op);
    setQueuedOps(pendingOpsRef.current.length);
  }, []);

  // ── Shape creation helpers (queue if offline) ───────────────────────────

  const pushCreateUndo = useCallback((shapeId: string, shape: Shape) => {
    undoStackRef.current.push({ type: 'create', shapeId });
    redoStackRef.current = [];
    shapeSnapshotsRef.current.set(shapeId, shape);
  }, []);

  const pushDeleteUndo = useCallback((shapeId: string, shape: Shape) => {
    undoStackRef.current.push({ type: 'delete', shapeId, snapshot: shape });
    redoStackRef.current = [];
  }, []);

  const pushUpdateUndo = useCallback((shapeId: string, prev: ShapeData, next: ShapeData) => {
    undoStackRef.current.push({ type: 'update', shapeId, prevData: prev, nextData: next });
    redoStackRef.current = [];
  }, []);

  const isOnline = useCallback(() => !offlineModeRef.current && providerRef.current?.room?.webrtcConns?.size ? true : !offlineModeRef.current, []);

  const createStroke = useCallback((points: { x: number; y: number }[], color: string, width: number): string | null => {
    if (offlineModeRef.current) {
      queueOp({ type: 'stroke', points, color, width });
      return null;
    }
    const doc = docRef.current;
    if (!doc || !roomId) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Stroke, { points, color, width }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [actorName, roomId, pushCreateUndo, queueOp]);

  const createRect = useCallback((x: number, y: number, w: number, h: number, color: string): string | null => {
    if (offlineModeRef.current) {
      queueOp({ type: 'rect', x, y, w, h, color });
      return null;
    }
    const doc = docRef.current;
    if (!doc || !roomId) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Rect, { x, y, w, h, color }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [actorName, roomId, pushCreateUndo, queueOp]);

  const createEllipse = useCallback((cx: number, cy: number, rx: number, ry: number, color: string): string | null => {
    if (offlineModeRef.current) {
      queueOp({ type: 'ellipse', cx, cy, rx, ry, color });
      return null;
    }
    const doc = docRef.current;
    if (!doc || !roomId) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Rect, { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2, color }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [actorName, roomId, pushCreateUndo, queueOp]);

  const createLine = useCallback((x1: number, y1: number, x2: number, y2: number, color: string, width: number = 2): string | null => {
    if (offlineModeRef.current) {
      queueOp({ type: 'line', x1, y1, x2, y2, color, width });
      return null;
    }
    const doc = docRef.current;
    if (!doc || !roomId) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Stroke, { points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], color, width }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [actorName, roomId, pushCreateUndo, queueOp]);

  const createText = useCallback((x: number, y: number, text: string, color: string): string | null => {
    if (offlineModeRef.current) {
      queueOp({ type: 'text', x, y, text, color });
      return null;
    }
    const doc = docRef.current;
    if (!doc || !roomId) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Text, { x, y, text, color }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [actorName, roomId, pushCreateUndo, queueOp]);

  const createImage = useCallback((x: number, y: number, w: number, h: number, src: string): string | null => {
    if (offlineModeRef.current) {
      queueOp({ type: 'image', x, y, w, h, src });
      return null;
    }
    const doc = docRef.current;
    if (!doc || !roomId) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Image, { x, y, w, h, src }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [actorName, roomId, pushCreateUndo, queueOp]);

  const createNote = useCallback((x: number, y: number, text: string, color: string, bgColor: string): string | null => {
    if (offlineModeRef.current) {
      queueOp({ type: 'note', x, y, text, color, bgColor });
      return null;
    }
    const doc = docRef.current;
    if (!doc || !roomId) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Note, { x, y, text, color, bgColor }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [actorName, roomId, pushCreateUndo, queueOp]);

  const updateShape = useCallback((id: string, data: Partial<any>) => {
    const doc = docRef.current;
    if (!doc) return;
    const shapesArray = doc.getArray('shapes');
    const current = shapes.find(s => s.id === id);
    if (current) {
      pushUpdateUndo(id, current.data, { ...current.data, ...data } as ShapeData);
    }
    updateShapeInCanvas(
      { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
      id, data, actorName
    );
  }, [actorName, shapes, pushUpdateUndo]);

  const deleteShape = useCallback((id: string) => {
    const doc = docRef.current;
    if (!doc) return;
    const shape = shapes.find(s => s.id === id);
    if (shape) {
      pushDeleteUndo(id, shape);
      shapeSnapshotsRef.current.delete(id);
    }
    if (offlineModeRef.current) {
      queueOp({ type: 'delete', shapeId: id });
      return;
    }
    deleteShapeInCanvas(
      { doc, shapesArray: doc.getArray('shapes'), awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
      id, actorName
    );
  }, [actorName, shapes, pushDeleteUndo, queueOp]);

  const setCursor = useCallback((x: number, y: number) => {
    awarenessRef.current?.setLocalStateField('cursor', { x, y });
  }, []);

  const setParticipantName = useCallback((name: string) => {
    awarenessRef.current?.setLocalStateField('actor', name);
  }, []);

  // ── Chat ────────────────────────────────────────────────────────────────

  const sendMessage = useCallback((text: string) => {
    const doc = docRef.current;
    if (!doc || !text.trim()) return;
    const chatText = doc.getText('chat');
    const msgId = crypto.randomUUID().slice(0, 8);
    const entry = `${msgId}|${Date.now()}|${actorName}|${text}\n`;
    chatText.insert(chatText.length, entry);
  }, [actorName]);

  // ── Undo / Redo ─────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    const op = undoStackRef.current.pop();
    if (!op) return;
    redoStackRef.current.push(op);
    if (op.type === 'create') {
      deleteShape(op.shapeId);
    } else if (op.type === 'delete') {
      const snap = shapeSnapshotsRef.current.get(op.shapeId);
      if (snap) {
        const doc = docRef.current;
        if (doc) {
          const shapesArray = doc.getArray('shapes');
          createShapeInCanvas(
            { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
            snap.kind, snap.data, actorName
          );
          shapeSnapshotsRef.current.set(op.shapeId, snap);
        }
      }
    } else if (op.type === 'update') {
      const doc = docRef.current;
      if (doc) {
        const shapesArray = doc.getArray('shapes');
        updateShapeInCanvas(
          { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
          op.shapeId, op.prevData, actorName
        );
      }
    }
  }, [deleteShape, actorName, updateShape]);

  const redo = useCallback(() => {
    const op = redoStackRef.current.pop();
    if (!op) return;
    undoStackRef.current.push(op);
    if (op.type === 'create') {
      const snap = shapeSnapshotsRef.current.get(op.shapeId);
      if (snap) {
        const doc = docRef.current;
        if (doc) {
          const shapesArray = doc.getArray('shapes');
          createShapeInCanvas(
            { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
            snap.kind, snap.data, actorName
          );
        }
      }
    } else if (op.type === 'delete') {
      deleteShape(op.shapeId);
    } else if (op.type === 'update') {
      const doc = docRef.current;
      if (doc) {
        const shapesArray = doc.getArray('shapes');
        updateShapeInCanvas(
          { doc, shapesArray, awareness: awarenessRef.current!, onChange: () => {}, dispose: () => {} } as any,
          op.shapeId, op.nextData, actorName
        );
      }
    }
  }, [deleteShape, actorName]);

  // ── Simulation controls ─────────────────────────────────────────────────

  const simulateOffline = useCallback(() => {
    offlineModeRef.current = true;
    setConnectionState('offline');
    console.log('[canvas] Simulating offline mode — operations will be queued');
  }, []);

  const simulateOnline = useCallback(() => {
    offlineModeRef.current = false;
    if (providerRef.current?.room?.webrtcConns?.size) {
      setConnectionState('syncing');
      setTimeout(() => flushQueue(), 200);
    } else {
      setConnectionState('disconnected');
      setQueuedOps(pendingOpsRef.current.length);
    }
    console.log('[canvas] Simulating online mode — flushing queue');
  }, [flushQueue]);

  const triggerReconnect = useCallback(() => {
    console.log('[canvas] Manual reconnect triggered');
    setConnectionState('connecting');
  }, []);

  // ── Init ────────────────────────────────────────────────────────────────

  const initCanvas = useCallback(async () => {
    if (!actorName || !roomId) return;

    const doc = new Y.Doc();
    docRef.current = doc;

    const awareness = new Awareness(doc);
    awarenessRef.current = awareness;
    awareness.setLocalStateField('actor', actorName);
    awareness.setLocalStateField('cursor', { x: 0, y: 0 });
    awareness.setLocalStateField('handId', (typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        })
    ));

    // Initialize chat text type if not exists
    doc.getText('chat');

    // Fetch local IP and build signaling URL
    let signalingUrl = import.meta.env.VITE_SIGNALING_URL;
    try {
      const resp = await fetch('/api/ip');
      const data = await resp.json();
      const fetchedIP = data.ip || data.localIP || '';
      setLocalIP(fetchedIP);
      if (!signalingUrl) {
        signalingUrl = `ws://${fetchedIP || 'localhost'}:3001/ws`;
      }
    } catch {
      setLocalIP('');
      if (!signalingUrl) {
        signalingUrl = `ws://localhost:3001/ws`;
      }
    }

    const provider = new WebrtcProvider(roomId, doc, {
      signaling: [signalingUrl!],
    });
    providerRef.current = provider;

    const indexeddb = new IndexeddbPersistence(`crdt-canvas-${roomId}`, doc);
    indexeddbRef.current = indexeddb;

    // ── Connection state machine ─────────────────────────────────────────
    provider.on('status', (status: any) => {
      const state = typeof status === 'object' ? status?.status : status;
      switch (state) {
        case 'connecting':
          setConnectionState('connecting');
          break;
        case 'connected':
          setConnectionState('connected');
          setConnected(true);
          break;
        case 'disconnected':
          setConnectionState('disconnected');
          setConnected(false);
          break;
        case 'syncing':
          setConnectionState('syncing');
          break;
      }
    });

    provider.on('peers', (peersList: any) => {
      const count = Array.isArray(peersList) ? peersList.length : (peersList?.size ?? 0);
      setPeerCount(count);
      if (count > 0 && !offlineModeRef.current) {
        setConnected(true);
        setConnectionState(prev => prev === 'connecting' ? 'syncing' : 'connected');
        setTimeout(() => flushQueue(), 500);
      } else if (count === 0 && !offlineModeRef.current) {
        setConnected(false);
        setConnectionState('disconnected');
        if (pendingOpsRef.current.length > 0) {
          setQueuedOps(pendingOpsRef.current.length);
        }
      }
      setRoomID(roomId);
    });

    // ── Awareness ────────────────────────────────────────────────────────
    awareness.on('update', (updated: any) => {
      setRemoteCursors(prev => {
        const next = new Map(prev);
        for (const clientID of updated.added) {
          const state = awareness.getStates().get(clientID);
          if (state?.cursor) {
            next.set(clientID, {
              x: state.cursor.x ?? 0,
              y: state.cursor.y ?? 0,
              color: state.color ?? '#7c3aed',
              name: state.actor ?? 'Anonymous',
            });
          }
        }
        for (const clientID of updated.updated) {
          const state = awareness.getStates().get(clientID);
          if (state?.cursor) {
            next.set(clientID, {
              x: state.cursor.x ?? 0,
              y: state.cursor.y ?? 0,
              color: state.color ?? '#7c3aed',
              name: state.actor ?? 'Anonymous',
            });
          }
        }
        for (const clientID of updated.removed) {
          next.delete(clientID);
        }
        return next;
      });

      setParticipants(Array.from(awareness.getStates().entries() as Iterable<[number, any]>).map(([id, state]) => ({
        id: String(id),
        name: (state as any)?.actor ?? 'Anonymous',
        color: (state as any)?.color ?? '#7c3aed',
      })));
    });

    // ── Yjs changes → shapes + conflict detection ────────────────────────
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    doc.on('update', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const currentShapes = getActiveShapes(
          { doc, shapesArray: doc.getArray('shapes'), awareness, onChange: () => {}, dispose: () => {} } as any
        );

        const detectedConflicts = detectConflicts(currentShapes);
        setConflicts(detectedConflicts);

        const newEvents: any[] = [];
        const currentCount = currentShapes.length;

        if (currentCount > lastShapeCountRef.current) {
          for (const s of currentShapes) {
            const prev = historyEventsRef.current.find((e: any) => e.shapeId === s.id);
            if (!prev) {
              newEvents.push({ type: 'create', shapeId: s.id, actor: s.actor, ts: s.createdAt });
              shapeSnapshotsRef.current.set(s.id, s);
            }
          }
        }
        lastShapeCountRef.current = currentCount;

        if (newEvents.length > 0) {
          historyEventsRef.current = [...historyEventsRef.current, ...newEvents];
          setHistory(buildMergeHistory(historyEventsRef.current));
        }

        setShapes(currentShapes);
      }, 50);
    });

    // ── IndexedDB sync completion ────────────────────────────────────────
    indexeddb.on('synced', () => {
      console.log('[canvas] IndexedDB sync complete');
    });
  }, [actorName, roomId, flushQueue]);

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
    shapes,
    conflicts,
    history,
    connected,
    peerCount,
    roomId: roomID,
    localIP,
    connectionState,
    queuedOps,
    remoteCursors,
    participants,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    undo,
    redo,
    createStroke,
    createRect,
    createEllipse,
    createLine,
    createText,
    createImage,
    createNote,
    updateShape,
    deleteShape,
    setCursor,
    setParticipantName,
    sendMessage,
    simulateOffline,
    simulateOnline,
    triggerReconnect,
    doc: docRef.current,
  };
}
