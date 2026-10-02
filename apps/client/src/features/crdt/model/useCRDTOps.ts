import { useState, useCallback, useRef, useEffect } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  type Shape,
  type Conflict,
  type MergeHistory,
  type ShapeData,
  ShapeKind,
  createShapeInCanvas,
  updateShapeInCanvas,
  deleteShapeInCanvas,
  getActiveShapes,
  buildMergeHistory,
  detectCanvasConflicts,
  resolveConflictInCanvas,
  computeChangeEvents,
  type EditOp,
} from '@crdt-canvas/engine';

export interface CRDTOps {
  shapes: Shape[];
  conflicts: Conflict[];
  history: MergeHistory | null;
  canUndo: boolean;
  canRedo: boolean;
  queuedOps: number;
  undo: () => void;
  redo: () => void;
  createStroke: (points: { x: number; y: number }[], color: string, width: number) => string | null;
  createRect: (x: number, y: number, w: number, h: number, color: string, fillOpacity?: number, strokeWidth?: number, cornerRadius?: number) => string | null;
  createEllipse: (cx: number, cy: number, rx: number, ry: number, color: string, fillOpacity?: number, strokeWidth?: number) => string | null;
  createLine: (x1: number, y1: number, x2: number, y2: number, color: string, width: number, arrowEnd?: boolean, startShapeId?: string, endShapeId?: string) => string | null;
  createText: (x: number, y: number, text: string, color: string) => string | null;
  createImage: (x: number, y: number, w: number, h: number, src: string) => string | null;
  createNote: (x: number, y: number, text: string, color: string, bgColor: string) => string | null;
  updateShape: (id: string, data: Partial<any>, op?: EditOp, skipHistory?: boolean) => void;
  deleteShape: (id: string) => void;
  resolveConflict: (shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => void;
  commitShapeHistory: (id: string, prevData: any) => void;
  commitShapeHistoryBatch: (entries: Array<{ id: string; prevData: any }>) => void;
  sendMessage: (text: string) => void;
  flushQueue: () => void;
}

export function useCRDTOps(
  doc: Y.Doc | null,
  awareness: Awareness | null,
  actorName: string,
  offlineMode: boolean
): CRDTOps {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [history, setHistory] = useState<MergeHistory | null>(null);
  const [queuedOps, setQueuedOps] = useState(0);

  const historyEventsRef = useRef<any[]>([]);
  const previousShapesRef = useRef<Shape[]>([]);

  // Undo / redo stacks
  const undoStackRef = useRef<any[]>([]);
  const redoStackRef = useRef<any[]>([]);
  const shapeSnapshotsRef = useRef<Map<string, Shape>>(new Map());

  // ── Engine integration logic ──

  useEffect(() => {
    if (!doc || !awareness) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const updateHandler = () => {
      if (offlineMode) setQueuedOps(count => count + 1);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const shapesArray = doc.getArray('shapes');
        const currentShapes = getActiveShapes(
          { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any
        );

        const detectedConflicts = detectCanvasConflicts(shapesArray as any, currentShapes);
        setConflicts(detectedConflicts);

        const finalShapes = getActiveShapes(
          { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any
        );

        const newEvents = computeChangeEvents(doc, shapesArray as any, previousShapesRef.current, actorName);
        if (newEvents.length > 0) {
          historyEventsRef.current = [...historyEventsRef.current, ...newEvents];
          setHistory(buildMergeHistory(historyEventsRef.current));
        }
        previousShapesRef.current = finalShapes;

        setShapes(finalShapes);
      }, 50);
    };

    doc.on('update', updateHandler);
    return () => {
      doc.off('update', updateHandler);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [doc, awareness, actorName, offlineMode]);


  // ── Offline sync status ──

  // Yjs already persists and retains local edits while disconnected. Replaying
  // duplicate shape commands here would create a second copy on reconnect.
  const flushQueue = useCallback(() => setQueuedOps(0), []);

  // ── Undo helpers ──

  const pushCreateUndo = useCallback((shapeId: string, shape: Shape) => {
    undoStackRef.current.push({ type: 'create', shapeId });
    redoStackRef.current = [];
    shapeSnapshotsRef.current.set(shapeId, shape);
  }, []);

  const recordCreate = useCallback((shapeId: string, shapesArray: Y.Array<any>) => {
    if (!doc || !awareness) return;
    const created = getActiveShapes({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any)
      .find(shape => shape.id === shapeId);
    if (created) pushCreateUndo(shapeId, created);
  }, [doc, awareness, pushCreateUndo]);

  const pushDeleteUndo = useCallback((shapeId: string, shape: Shape) => {
    undoStackRef.current.push({ type: 'delete', shapeId, snapshot: shape });
    redoStackRef.current = [];
  }, []);

  const pushUpdateUndo = useCallback((shapeId: string, prev: ShapeData, next: ShapeData) => {
    undoStackRef.current.push({ type: 'update', shapeId, prevData: prev, nextData: next });
    redoStackRef.current = [];
  }, []);

  // ── Shape creations ──

  const createStroke = useCallback((points: { x: number; y: number }[], color: string, width: number): string | null => {
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Stroke, { points, color, width }, actorName
    );
    recordCreate(id, shapesArray);
    return id;
  }, [doc, awareness, actorName, recordCreate]);

  const createRect = useCallback((x: number, y: number, w: number, h: number, color: string, fillOpacity = 0.13, strokeWidth = 1.5, cornerRadius = 0): string | null => {
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Rect, { x, y, w, h, color, fillOpacity, strokeWidth, cornerRadius }, actorName
    );
    recordCreate(id, shapesArray);
    return id;
  }, [doc, awareness, actorName, recordCreate]);

  const createEllipse = useCallback((cx: number, cy: number, rx: number, ry: number, color: string, fillOpacity = 0.13, strokeWidth = 1.5): string | null => {
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Ellipse, { cx, cy, rx, ry, color, fillOpacity, strokeWidth }, actorName
    );
    recordCreate(id, shapesArray);
    return id;
  }, [doc, awareness, actorName, recordCreate]);

  const createLine = useCallback((x1: number, y1: number, x2: number, y2: number, color: string, width: number, arrowEnd = false, startShapeId?: string, endShapeId?: string): string | null => {
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Line, { x1, y1, x2, y2, color, width, arrowEnd, startShapeId, endShapeId }, actorName
    );
    recordCreate(id, shapesArray);
    return id;
  }, [doc, awareness, actorName, recordCreate]);

  const createText = useCallback((x: number, y: number, text: string, color: string): string | null => {
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Text, { x, y, text, color }, actorName
    );
    recordCreate(id, shapesArray);
    return id;
  }, [doc, awareness, actorName, recordCreate]);

  const createImage = useCallback((x: number, y: number, w: number, h: number, src: string): string | null => {
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Image, { x, y, w, h, src }, actorName
    );
    recordCreate(id, shapesArray);
    return id;
  }, [doc, awareness, actorName, recordCreate]);

  const createNote = useCallback((x: number, y: number, text: string, color: string, bgColor: string): string | null => {
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Note, { x, y, w: 160, h: 140, text, color, bgColor }, actorName
    );
    recordCreate(id, shapesArray);
    return id;
  }, [doc, awareness, actorName, recordCreate]);

  const updateShape = useCallback((id: string, data: Partial<any>, op: EditOp = 'update', skipHistory = false) => {
    if (!doc || !awareness) return;
    const shape = shapes.find(s => s.id === id);
    if (shape && !skipHistory) {
      pushUpdateUndo(id, shape.data, { ...shape.data, ...data });
    }
    updateShapeInCanvas(
      { doc, shapesArray: doc.getArray('shapes'), awareness, onChange: () => {}, dispose: () => {} } as any,
      id, data, actorName, op
    );
  }, [doc, awareness, actorName, shapes, pushUpdateUndo, offlineMode]);

  const deleteShape = useCallback((id: string) => {
    if (!doc || !awareness) return;
    const shape = shapes.find(s => s.id === id);
    if (shape) {
      pushDeleteUndo(id, shape);
      shapeSnapshotsRef.current.delete(id);
    }
    deleteShapeInCanvas(
      { doc, shapesArray: doc.getArray('shapes'), awareness, onChange: () => {}, dispose: () => {} } as any,
      id, actorName
    );
  }, [doc, awareness, actorName, shapes, pushDeleteUndo]);

  const commitShapeHistory = useCallback((id: string, prevData: any) => {
    const shape = shapes.find(s => s.id === id);
    if (shape) {
      pushUpdateUndo(id, prevData, shape.data);
    }
  }, [shapes, pushUpdateUndo]);

  const commitShapeHistoryBatch = useCallback((entries: Array<{ id: string; prevData: any; nextData?: any }>) => {
    const changes = entries.flatMap(entry => {
      const shape = shapes.find(item => item.id === entry.id);
      const nextData = entry.nextData ?? shape?.data;
      return nextData && JSON.stringify(nextData) !== JSON.stringify(entry.prevData)
        ? [{ id: entry.id, prevData: entry.prevData, nextData }]
        : [];
    });
    if (!changes.length) return;
    undoStackRef.current.push({ type: 'batch-update', changes });
    redoStackRef.current = [];
  }, [shapes]);

  const resolveConflict = useCallback((shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => {
    if (!doc || !awareness) return;
    resolveConflictInCanvas(
      { doc, shapesArray: doc.getArray('shapes'), awareness, onChange: () => {}, dispose: () => {} } as any,
      shapeId, action, actorName
    );
  }, [doc, awareness, actorName]);

  const sendMessage = useCallback((text: string) => {
    if (!doc || !text.trim()) return;
    const chatText = doc.getText('chat');
    const msgId = crypto.randomUUID().slice(0, 8);
    const entry = `${msgId}|${Date.now()}|${actorName}|${text}\n`;
    chatText.insert(chatText.length, entry);
  }, [doc, actorName]);

  const undo = useCallback(() => {
    const op = undoStackRef.current.pop();
    if (!op || !doc || !awareness) return;
    redoStackRef.current.push(op);
    const shapesArray = doc.getArray('shapes');

    if (op.type === 'create') {
      deleteShape(op.shapeId);
    } else if (op.type === 'delete') {
      const snap = shapeSnapshotsRef.current.get(op.shapeId);
      if (snap) {
        createShapeInCanvas(
          { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
          snap.kind, snap.data, actorName
        );
        shapeSnapshotsRef.current.set(op.shapeId, snap);
      }
    } else if (op.type === 'update') {
      updateShapeInCanvas(
        { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
        op.shapeId, op.prevData, actorName
      );
    } else if (op.type === 'batch-update') {
      doc.transact(() => op.changes.forEach((change: any) => updateShapeInCanvas(
        { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
        change.id, change.prevData, actorName
      )));
    }
  }, [deleteShape, actorName, doc, awareness]);

  const redo = useCallback(() => {
    const op = redoStackRef.current.pop();
    if (!op || !doc || !awareness) return;
    undoStackRef.current.push(op);
    const shapesArray = doc.getArray('shapes');

    if (op.type === 'create') {
      const snap = shapeSnapshotsRef.current.get(op.shapeId);
      if (snap) {
        createShapeInCanvas(
          { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
          snap.kind, snap.data, actorName
        );
      }
    } else if (op.type === 'delete') {
      deleteShape(op.shapeId);
    } else if (op.type === 'update') {
      updateShapeInCanvas(
        { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
        op.shapeId, op.nextData, actorName
      );
    } else if (op.type === 'batch-update') {
      doc.transact(() => op.changes.forEach((change: any) => updateShapeInCanvas(
        { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
        change.id, change.nextData, actorName
      )));
    }
  }, [deleteShape, actorName, doc, awareness]);

  return {
    shapes,
    conflicts,
    history,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    queuedOps,
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
    resolveConflict,
    commitShapeHistory,
    commitShapeHistoryBatch,
    sendMessage,
    flushQueue
  };
}
