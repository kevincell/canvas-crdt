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

type QueuedOp =
  | { type: 'stroke';  points: { x: number; y: number }[]; color: string; width: number }
  | { type: 'rect';    x: number; y: number; w: number; h: number; color: string }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: string }
  | { type: 'line';    x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { type: 'text';    x: number; y: number; text: string; color: string }
  | { type: 'image';   x: number; y: number; w: number; h: number; src: string }
  | { type: 'note';    x: number; y: number; text: string; color: string; bgColor: string }
  | { type: 'delete';  shapeId: string };

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
  createRect: (x: number, y: number, w: number, h: number, color: string) => string | null;
  createEllipse: (cx: number, cy: number, rx: number, ry: number, color: string) => string | null;
  createLine: (x1: number, y1: number, x2: number, y2: number, color: string, width: number) => string | null;
  createText: (x: number, y: number, text: string, color: string) => string | null;
  createImage: (x: number, y: number, w: number, h: number, src: string) => string | null;
  createNote: (x: number, y: number, text: string, color: string, bgColor: string) => string | null;
  updateShape: (id: string, data: Partial<any>, op?: EditOp, skipHistory?: boolean) => void;
  deleteShape: (id: string) => void;
  resolveConflict: (shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => void;
  commitShapeHistory: (id: string, prevData: any) => void;
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

  // Offline queue
  const pendingOpsRef = useRef<QueuedOp[]>([]);

  // ── Engine integration logic ──

  useEffect(() => {
    if (!doc || !awareness) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const updateHandler = () => {
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
  }, [doc, awareness, actorName]);


  // ── Offline Queueing ──

  const flushQueue = useCallback(() => {
    const ops = pendingOpsRef.current;
    if (ops.length === 0) return;
    pendingOpsRef.current = [];
    setQueuedOps(0);

    if (!doc || !awareness) return;
    const shapesArray = doc.getArray('shapes');

    for (const op of ops) {
      switch (op.type) {
        case 'stroke':
          createShapeInCanvas({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Stroke, { points: op.points, color: op.color, width: op.width }, actorName);
          break;
        case 'rect':
          createShapeInCanvas({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Rect, { x: op.x, y: op.y, w: op.w, h: op.h, color: op.color }, actorName);
          break;
        case 'ellipse':
          createShapeInCanvas({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Ellipse, { cx: op.cx, cy: op.cy, rx: op.rx, ry: op.ry, color: op.color }, actorName);
          break;
        case 'line':
          createShapeInCanvas({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Line, { x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2, color: op.color, width: op.width }, actorName);
          break;
        case 'text':
          createShapeInCanvas({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Text, { x: op.x, y: op.y, text: op.text, color: op.color }, actorName);
          break;
        case 'image':
          createShapeInCanvas({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Image, { x: op.x, y: op.y, w: op.w, h: op.h, src: op.src }, actorName);
          break;
        case 'note':
          createShapeInCanvas({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
            ShapeKind.Note, { x: op.x, y: op.y, text: op.text, color: op.color, bgColor: op.bgColor }, actorName);
          break;
        case 'delete':
          deleteShapeInCanvas({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
            op.shapeId, actorName);
          break;
      }
    }
  }, [doc, awareness, actorName]);

  const queueOp = useCallback((op: QueuedOp) => {
    pendingOpsRef.current.push(op);
    setQueuedOps(pendingOpsRef.current.length);
  }, []);

  // ── Undo helpers ──

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

  // ── Shape creations ──

  const createStroke = useCallback((points: { x: number; y: number }[], color: string, width: number): string | null => {
    if (offlineMode) queueOp({ type: 'stroke', points, color, width });
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Stroke, { points, color, width }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [doc, awareness, actorName, offlineMode, queueOp, pushCreateUndo]);

  const createRect = useCallback((x: number, y: number, w: number, h: number, color: string): string | null => {
    if (offlineMode) queueOp({ type: 'rect', x, y, w, h, color });
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Rect, { x, y, w, h, color }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [doc, awareness, actorName, offlineMode, queueOp, pushCreateUndo]);

  const createEllipse = useCallback((cx: number, cy: number, rx: number, ry: number, color: string): string | null => {
    if (offlineMode) queueOp({ type: 'ellipse', cx, cy, rx, ry, color });
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Ellipse, { cx, cy, rx, ry, color }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [doc, awareness, actorName, offlineMode, queueOp, pushCreateUndo]);

  const createLine = useCallback((x1: number, y1: number, x2: number, y2: number, color: string, width: number): string | null => {
    if (offlineMode) queueOp({ type: 'line', x1, y1, x2, y2, color, width });
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Line, { x1, y1, x2, y2, color, width }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [doc, awareness, actorName, offlineMode, queueOp, pushCreateUndo]);

  const createText = useCallback((x: number, y: number, text: string, color: string): string | null => {
    if (offlineMode) queueOp({ type: 'text', x, y, text, color });
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Text, { x, y, text, color }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [doc, awareness, actorName, offlineMode, queueOp, pushCreateUndo]);

  const createImage = useCallback((x: number, y: number, w: number, h: number, src: string): string | null => {
    if (offlineMode) queueOp({ type: 'image', x, y, w, h, src });
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Image, { x, y, w, h, src }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [doc, awareness, actorName, offlineMode, queueOp, pushCreateUndo]);

  const createNote = useCallback((x: number, y: number, text: string, color: string, bgColor: string): string | null => {
    if (offlineMode) queueOp({ type: 'note', x, y, text, color, bgColor });
    if (!doc || !awareness) return null;
    const shapesArray = doc.getArray('shapes');
    const id = createShapeInCanvas(
      { doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any,
      ShapeKind.Note, { x, y, w: 160, h: 140, text, color, bgColor }, actorName
    );
    setTimeout(() => {
      const all = getActiveShapes({ doc, shapesArray, awareness, onChange: () => {}, dispose: () => {} } as any);
      const shape = all.find(s => s.id === id);
      if (shape) pushCreateUndo(id, shape);
    }, 60);
    return id;
  }, [doc, awareness, actorName, offlineMode, queueOp, pushCreateUndo]);

  const updateShape = useCallback((id: string, data: Partial<any>, op: EditOp = 'update', skipHistory = false) => {
    if (!doc || !awareness) return;
    const shape = shapes.find(s => s.id === id);
    if (shape && !skipHistory) {
      pushUpdateUndo(id, shape.data, { ...shape.data, ...data });
    }
    if (offlineMode) setQueuedOps(q => q + 1);
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
    if (offlineMode) queueOp({ type: 'delete', shapeId: id });
    deleteShapeInCanvas(
      { doc, shapesArray: doc.getArray('shapes'), awareness, onChange: () => {}, dispose: () => {} } as any,
      id, actorName
    );
  }, [doc, awareness, actorName, shapes, pushDeleteUndo, offlineMode, queueOp]);

  const commitShapeHistory = useCallback((id: string, prevData: any) => {
    const shape = shapes.find(s => s.id === id);
    if (shape) {
      pushUpdateUndo(id, prevData, shape.data);
    }
  }, [shapes, pushUpdateUndo]);

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
    sendMessage,
    flushQueue
  };
}
