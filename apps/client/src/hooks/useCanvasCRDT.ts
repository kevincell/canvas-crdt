import { useRef, useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import {
  type Shape,
  type Conflict,
  type MergeHistory,
  type EditOp,
} from '@crdt-canvas/engine';
import { useCRDTConnection, type ConnectionState, type PersistenceState } from '../features/crdt/model/useCRDTConnection';
import { useCRDTAwareness } from '../features/crdt/model/useCRDTAwareness';
import { useCRDTOps } from '../features/crdt/model/useCRDTOps';

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
  persistenceState: PersistenceState;
  persistenceError: string | null;
  migrationSummary: string | null;
  migrationBackupAvailable: boolean;
  queuedOps: number;

  // Awareness
  remoteCursors: Map<string, { x: number; y: number; color: string; name: string }>;
  remoteLasers: Map<string, { points: { x: number; y: number }[]; color: string }>;
  participants: Array<{ id: string; name: string; color: string }>;

  // Undo/redo
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // Shape operations
  createStroke: (points: { x: number; y: number }[], color: string, width: number) => string | null;
  createRect: (x: number, y: number, w: number, h: number, color: string, fillOpacity?: number, strokeWidth?: number, cornerRadius?: number) => string | null;
  createEllipse: (cx: number, cy: number, rx: number, ry: number, color: string, fillOpacity?: number, strokeWidth?: number) => string | null;
  createLine: (x1: number, y1: number, x2: number, y2: number, color: string, width: number, arrowEnd?: boolean, startShapeId?: string, endShapeId?: string) => string | null;
  createText: (x: number, y: number, text: string, color: string) => string | null;
  createImage: (x: number, y: number, w: number, h: number, src: string) => string | null;
  createNote: (x: number, y: number, text: string, color: string, bgColor: string) => string | null;
  updateShape: (id: string, data: Partial<any>, op?: EditOp, skipHistory?: boolean) => void;
  deleteShape: (id: string) => void;
  setCursor: (x: number, y: number) => void;
  setParticipantName: (name: string) => void;
  setLaserPoints: (points: { x: number; y: number }[] | null) => void;
  resolveConflict: (shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => void;

  // Chat
  sendMessage: (text: string) => void;

  // Doc access for chat panel
  doc: Y.Doc | null;

  // Simulation controls
  simulateOffline: () => void;
  simulateOnline: () => void;
  triggerReconnect: () => void;
  commitShapeHistory: (id: string, prevData: any) => void;
  commitShapeHistoryBatch: (entries: Array<{ id: string; prevData: any; nextData?: any }>) => void;
}

export function useCanvasCRDT(
  actorName: string,
  roomId: string,
  actorColor: string = '#7c3aed',
  isReadOnly: boolean = false
): CanvasHooks {
  // We need to pass flushQueue to connection so it can be called on reconnect
  // Since we have a circular dependency between useCRDTConnection and useCRDTOps,
  // we use a ref to pass the flushQueue function.
  const flushQueueRef = useRef<() => void>(() => {});
  
  const conn = useCRDTConnection(actorName, roomId, actorColor, () => flushQueueRef.current?.());
  const awareness = useCRDTAwareness(conn.doc, conn.awareness);
  const ops = useCRDTOps(conn.doc, conn.awareness, actorName, conn.offlineMode);

  useEffect(() => {
    flushQueueRef.current = ops.flushQueue;
  }, [ops.flushQueue]);

  if (isReadOnly) {
    return {
      ...conn,
      ...awareness,
      ...ops,
      canUndo: false,
      canRedo: false,
      undo: () => {},
      redo: () => {},
      createStroke: () => null,
      createRect: () => null,
      createEllipse: () => null,
      createLine: () => null,
      createText: () => null,
      createImage: () => null,
      createNote: () => null,
      updateShape: () => {},
      deleteShape: () => {},
      commitShapeHistory: () => {},
      commitShapeHistoryBatch: () => {},
      resolveConflict: () => {},
      doc: conn.doc,
    };
  }

  return {
    ...conn,
    ...awareness,
    ...ops,
    doc: conn.doc,
  };
}
