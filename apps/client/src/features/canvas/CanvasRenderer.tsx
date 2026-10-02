/**
 * Canvas renderer — HTML5 Canvas with pan/zoom, shape drawing,
 * cursor awareness, selection handles, eraser, and merge history playback.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  type Shape,
  type Conflict,
  type AmbiguityLevel,
  type ShapeData,
  ShapeKind,
  shapeCenter,
  shapeBBox,
  attachedLineEndpoints,
  frameDescendants,
  scaleFrameMember,
  resolveTextOverlap,
} from '@crdt-canvas/engine';
import { CanvasController } from './CanvasController';
import { FloatingConflictWidget } from '../crdt/ui/FloatingConflictWidget';
import { type BoardComment } from '../comments/useBoardComments';
import { prepareBoardImage, calculateBoardImageBytes } from './prepareImage';

const EMPTY_VOTE_COUNTS = new Map<string, number>();

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type VisualGuide = { x1: number; y1: number; x2: number; y2: number; kind: 'alignment' | 'spacing'; label?: string };


export interface CanvasRenderProps {
  shapes: Shape[];
  conflicts: Conflict[];
  remoteCursors: Map<string, { x: number; y: number; color: string; name: string }>;
  remoteLasers?: Map<string, { points: { x: number; y: number }[]; color: string }>;
  history: { playback: (step: number) => Shape[]; totalSteps: number } | null;
  historyStep: number;
  isPlaying: boolean;
  tool: 'stroke' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'frame' | 'text' | 'image' | 'note' | 'laser' | 'select' | 'eraser';
  activeColor: string;
  strokeWidth: number;
  fillOpacity: number;
  cornerRadius: number;
  showGrid: boolean;
  snapToGrid: boolean;
  comments?: BoardComment[];
  voteMode?: boolean;
  voteCounts?: Map<string, number>;
  onVoteAt?: (shapeId: string) => void;
  scale: number;
  selectedIdsExternal?: string[];
  selectedIdExternal?: string | null;
  focusShapeIds?: string[];
  highlightShapeId?: string | null;
  editShapeRequest?: { id: string; token: number } | null;
  // callbacks
  onStrokeEnd: (points: { x: number; y: number }[], color: string, width: number) => void;
  onRectEnd: (x: number, y: number, w: number, h: number, color: string, fillOpacity: number, strokeWidth: number, cornerRadius: number, frameTitle?: string) => void;
  onEllipseEnd: (cx: number, cy: number, rx: number, ry: number, color: string, fillOpacity: number, strokeWidth: number) => void;
  onLineEnd: (x1: number, y1: number, x2: number, y2: number, color: string, width: number, arrowEnd: boolean) => void;
  onTextSubmit: (x: number, y: number, text: string, color: string) => void;
  onImageAdd: (x: number, y: number, w: number, h: number, src: string) => void;
  onNoteAdd: (x: number, y: number, text: string, color: string, bgColor: string) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => string | null;
  onDuplicateSelection?: () => void;
  onGroupSelection?: () => void;
  onUngroupSelection?: () => void;
  onSelectionChange?: (ids: string[], primaryId: string | null) => void;
  onShapeMoved?: (id: string, dx: number, dy: number, skipHistory?: boolean) => void;
  onShapeResized?: (id: string, data: Partial<any>, op?: 'resize' | 'move' | 'update', skipHistory?: boolean) => void;
  onShapeHistoryCommit?: (id: string, prevData: any) => void;
  onShapeHistoryCommitBatch?: (entries: Array<{ id: string; prevData: any; nextData?: any }>) => void;
  onZoomChange: (scale: number) => void;
  onImageDrop: (x: number, y: number, w: number, h: number, src: string) => void;
  onCursorMove?: (x: number, y: number) => void;
  onLaserUpdate?: (points: { x: number; y: number }[] | null) => void;
  onResolveConflict?: (shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => void;
}

export function CanvasRenderer({
  shapes,
  conflicts,
  remoteCursors,
  remoteLasers,
  history,
  historyStep,
  isPlaying,
  tool,
  activeColor,
  strokeWidth,
  fillOpacity,
  cornerRadius,
  showGrid,
  snapToGrid,
  comments = [],
  voteMode = false,
  voteCounts = EMPTY_VOTE_COUNTS,
  onVoteAt,
  scale,
  selectedIdsExternal,
  selectedIdExternal,
  focusShapeIds,
  highlightShapeId,
  editShapeRequest,
  onStrokeEnd,
  onRectEnd,
  onEllipseEnd,
  onLineEnd,
  onTextSubmit,
  onImageAdd,
  onNoteAdd,
  onDelete,
  onDuplicate,
  onDuplicateSelection,
  onGroupSelection,
  onUngroupSelection,
  onSelectionChange,
  onShapeMoved,
  onShapeResized,
  onShapeHistoryCommit,
  onShapeHistoryCommitBatch,
  onZoomChange,
  onImageDrop,
  onCursorMove,
  onLaserUpdate,
  onResolveConflict,
}: CanvasRenderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Transform — synced from parent props
  const transformRef = useRef({ scale: 1, offset: { x: 0, y: 0 } });

  // Image cache for loaded image sources
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Drawing state
  const drawingRef = useRef<{
    active: boolean;
    kind: string | null;
    startPoint: { x: number; y: number } | null;
    currentPoints: { x: number; y: number }[];
  }>({ active: false, kind: null, startPoint: null, currentPoints: [] });

  // Selection & drag
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dragHandle, setDragHandle] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; offX: number; offY: number } | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartDataRef = useRef<any>(null);
  const dragSelectionSnapshotsRef = useRef<Map<string, any>>(new Map());
  const draggedShapeIdsRef = useRef<string[]>([]);
  const alignmentGuidesRef = useRef<VisualGuide[]>([]);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const spaceDownRef = useRef(false);
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{ distance: number; scale: number; worldX: number; worldY: number } | null>(null);

  // Text / note input overlay
  const [textOverlay, setTextOverlay] = useState<{
    mode: 'text' | 'note';
    x: number;
    y: number;
    color: string;
    bgColor: string;
    value: string;
    shapeId?: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const consumedEditTokenRef = useRef(0);

  // Drag-and-drop image overlay
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragOverPos, setDragOverPos] = useState<{ x: number; y: number } | null>(null);

  // Keyboard shortcut help
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Refs for latest props (avoid stale closures)
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const hitBoundsById = useMemo(() => {
    const targets = new Map(shapes.filter(shape => !shape.deleted).map(shape => [shape.id, shape]));
    return new Map(shapes.map(shape => {
      if (shape.data.kind !== ShapeKind.Line || (!shape.data.startShapeId && !shape.data.endShapeId)) return [shape.id, shapeBBox(shape)] as const;
      const endpoints = attachedLineEndpoints(shape.data, targets);
      return [shape.id, shapeBBox({ ...shape, data: { ...shape.data, x1: endpoints.start.x, y1: endpoints.start.y, x2: endpoints.end.x, y2: endpoints.end.y } })] as const;
    }));
  }, [shapes]);
  const hitTestCandidates = useMemo(() => buildHitTestIndex(shapes, hitBoundsById), [shapes, hitBoundsById]);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const activeColorRef = useRef(activeColor);
  activeColorRef.current = activeColor;
  const strokeWidthRef = useRef(strokeWidth);
  strokeWidthRef.current = strokeWidth;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const historyStepRef = useRef(historyStep);
  historyStepRef.current = historyStep;
  const historyRef = useRef(history);
  historyRef.current = history;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  useEffect(() => onSelectionChange?.(selectedIds, selectedId), [selectedIds, selectedId, onSelectionChange]);
  useEffect(() => {
    if (selectedIdsExternal) setSelectedIds(selectedIdsExternal);
    if (selectedIdExternal !== undefined) setSelectedId(selectedIdExternal);
  }, [selectedIdsExternal, selectedIdExternal]);
  const triggerInlineEdit = useCallback((shape: Shape) => {
    let mode: 'text' | 'note';
    let x: number, y: number, color: string, bgColor = '#fef3c7', value: string;
    if (shape.data.kind === ShapeKind.Text) {
      mode = 'text'; x = shape.data.x; y = shape.data.y - 18; color = shape.data.color; value = shape.data.text;
    } else if (shape.data.kind === ShapeKind.Note) {
      mode = 'note'; x = shape.data.x; y = shape.data.y; color = shape.data.color; bgColor = shape.data.bgColor; value = shape.data.text;
    } else if (shape.data.kind === ShapeKind.Rect && shape.data.frameTitle) {
      mode = 'text'; x = shape.data.x; y = shape.data.y - 32; color = '#f8fafc'; value = shape.data.frameTitle;
    } else return;
    setSelectedId(shape.id);
    selectedIdRef.current = shape.id;
    selectedIdsRef.current = [shape.id];
    setSelectedIds([shape.id]);
    onSelectionChange?.([shape.id], shape.id);
    setTextOverlay({ mode, x, y, color, bgColor, value, shapeId: shape.id });
  }, [onSelectionChange]);

  useEffect(() => {
    if (!editShapeRequest || editShapeRequest.token <= consumedEditTokenRef.current) return;
    consumedEditTokenRef.current = editShapeRequest.token;
    const shape = shapes.find(item => item.id === editShapeRequest.id && !item.deleted);
    if (shape) triggerInlineEdit(shape);
  }, [editShapeRequest, shapes, triggerInlineEdit]);
  // Keep scale in sync with prop
  useEffect(() => {
    transformRef.current.scale = scale;
  }, [scale]);

  // ── Render ────────────────────────────────────────────────────────────────

  // ── Render ────────────────────────────────────────────────────────────────

  const controllerRef = useRef<CanvasController | null>(null);

  useEffect(() => {
    if (canvasRef.current && !controllerRef.current) {
      controllerRef.current = new CanvasController(canvasRef.current);
    }
  }, []);

  const render = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.setProps({
        shapes,
        conflicts,
        remoteCursors,
        remoteLasers,
        commentPins: comments.flatMap(comment => {
          if (comment.resolved) return [];
          const anchorShape = comment.shapeId ? shapes.find(shape => shape.id === comment.shapeId && !shape.deleted) : null;
          const anchor = anchorShape ? shapeCenter(anchorShape) : comment.anchor;
          return anchor ? [anchor] : [];
        }),
        history,
        historyStep,
        isPlaying,
        tool,
        activeColor,
        strokeWidth,
        fillOpacity,
        cornerRadius,
        showGrid,
        voteMode,
        voteCounts,
        scale,
        transform: transformRef.current,
        drawing: drawingRef.current,
        selectedId,
        selectedIds,
        highlightShapeId,
        alignmentGuides: alignmentGuidesRef.current,
        imageCache: imageCacheRef.current,
        onImageLoad: () => render(),
      });
      controllerRef.current.requestRender();
    }
  }, [shapes, conflicts, remoteCursors, comments, history, historyStep, isPlaying, tool, activeColor, strokeWidth, fillOpacity, cornerRadius, showGrid, voteMode, voteCounts, scale, selectedId, selectedIds, highlightShapeId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => render());
    observer.observe(canvas);
    render();
    return () => observer.disconnect();
  }, [render]);

  // Focus text input when it appears
  useEffect(() => {
    if (textOverlay) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [textOverlay]);

  // ── Keyboard shortcut help ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceDownRef.current = true;
        e.preventDefault();
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable)) return;
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShowShortcuts(v => !v);
      }
      if (e.key === 'Escape') {
        setShowShortcuts(false);
        setTextOverlay(null);
        setSelectedId(null);
        setSelectedIds([]);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const ids = shapesRef.current.filter(shape => !shape.deleted).map(shape => shape.id);
        setSelectedIds(ids);
        setSelectedId(ids[ids.length - 1] ?? null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedIdsRef.current.length) {
        e.preventDefault();
        if (onDuplicateSelection) onDuplicateSelection();
        else {
          const copies = selectedIdsRef.current.map(id => onDuplicate?.(id)).filter((id): id is string => Boolean(id));
          if (copies.length) { setSelectedIds(copies); setSelectedId(copies[copies.length - 1]); }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && selectedIdsRef.current.length) {
        e.preventDefault();
        if (e.shiftKey) onUngroupSelection?.();
        else if (selectedIdsRef.current.length > 1) onGroupSelection?.();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.length) {
        e.preventDefault();
        selectedIdsRef.current.forEach(id => onDelete?.(id));
        setSelectedIds([]);
        setSelectedId(null);
      }
      if (e.key === 'Tab') {
        const active = shapesRef.current.filter(shape => !shape.deleted);
        if (active.length > 0) {
          e.preventDefault();
          const currId = selectedIdRef.current;
          const currIdx = currId ? active.findIndex(s => s.id === currId) : -1;
          const nextIdx = e.shiftKey
            ? (currIdx <= 0 ? active.length - 1 : currIdx - 1)
            : (currIdx === -1 || currIdx >= active.length - 1 ? 0 : currIdx + 1);
          const nextShape = active[nextIdx];
          setSelectedId(nextShape.id);
          selectedIdRef.current = nextShape.id;
          setSelectedIds([nextShape.id]);
          selectedIdsRef.current = [nextShape.id];
          onSelectionChange?.([nextShape.id], nextShape.id);
        }
      }
      if (e.key === 'Enter' || e.key === 'F2') {
        if (selectedIdRef.current) {
          const target = shapesRef.current.find(s => s.id === selectedIdRef.current && !s.deleted);
          if (target && (target.data.kind === ShapeKind.Text || target.data.kind === ShapeKind.Note || (target.data.kind === ShapeKind.Rect && target.data.frameTitle))) {
            e.preventDefault();
            triggerInlineEdit(target);
          }
        }
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedIdsRef.current.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        for (const id of selectedIdsRef.current) {
          onShapeMoved?.(id, dx, dy, false);
        }
      }
    };
    const releaseSpace = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false;
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', releaseSpace);
    window.addEventListener('blur', releaseSpace as EventListener);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', releaseSpace);
      window.removeEventListener('blur', releaseSpace as EventListener);
    };
  }, [onDuplicate, onDuplicateSelection, onGroupSelection, onUngroupSelection, onDelete, onSelectionChange, onShapeMoved, triggerInlineEdit]);

  // ── Drag-over coordinate helper ───────────────────────────────────────────

  const getWorldPosForDrag = useCallback((e: React.DragEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { scale: s, offset } = transformRef.current;
    return {
      x: (e.clientX - rect.left - offset.x) / s,
      y: (e.clientY - rect.top - offset.y) / s,
    };
  }, []);

  // ── Coordinate helpers ────────────────────────────────────────────────────

  const getWorldPos = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { scale: s, offset } = transformRef.current;
    return {
      x: (e.clientX - rect.left - offset.x) / s,
      y: (e.clientY - rect.top - offset.y) / s,
    };
  }, []);

  const getHandleAt = useCallback((worldPos: { x: number; y: number }) => {
    if (selectedIdsRef.current.length > 1) return null;
    if (!selectedIdRef.current) return null;
    const shape = shapesRef.current.find(s => s.id === selectedIdRef.current && !s.deleted);
    if (!shape) return null;
    const b = hitBoundsById.get(shape.id) ?? shapeBBox(shape);
    const handles = [
      { idx: 0, x: b.minX, y: b.minY },
      { idx: 1, x: b.maxX, y: b.minY },
      { idx: 2, x: b.minX, y: b.maxY },
      { idx: 3, x: b.maxX, y: b.maxY },
    ];
    const threshold = 8 / transformRef.current.scale;
    for (const h of handles) {
      if (Math.abs(worldPos.x - h.x) < threshold && Math.abs(worldPos.y - h.y) < threshold) {
        return h.idx;
      }
    }
    return null;
  }, [hitBoundsById]);

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId) === false) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer may already be cancelled */ }
    }
    if (e.pointerType === 'touch') {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointersRef.current.size >= 2) {
        const [first, second] = [...touchPointersRef.current.values()];
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const midX = (first.x + second.x) / 2 - rect.left;
          const midY = (first.y + second.y) / 2 - rect.top;
          const { scale: currentScale, offset } = transformRef.current;
          pinchStartRef.current = {
            distance: Math.hypot(second.x - first.x, second.y - first.y),
            scale: currentScale,
            worldX: (midX - offset.x) / currentScale,
            worldY: (midY - offset.y) / currentScale,
          };
        }
        drawingRef.current = { active: false, kind: null, startPoint: null, currentPoints: [] };
        dragOffsetRef.current = null;
        setIsPanning(false);
        setPanStart(null);
        return;
      }
    }
    let pos = getWorldPos(e);

    // Middle mouse, right mouse, Alt+left, or Space+left = pan
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || spaceDownRef.current))) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, offX: transformRef.current.offset.x, offY: transformRef.current.offset.y });
      return;
    }

    if (e.button !== 0) return;

    if (voteMode) {
      const candidates = hitTestCandidates(pos.x, pos.y, 8);
      for (let index = candidates.length - 1; index >= 0; index--) {
        const shape = candidates[index];
        const bounds = hitBoundsById.get(shape.id) ?? shapeBBox(shape);
        if (pos.x >= bounds.minX - 8 && pos.x <= bounds.maxX + 8 && pos.y >= bounds.minY - 8 && pos.y <= bounds.maxY + 8) {
          onVoteAt?.(shape.id);
          return;
        }
      }
      return;
    }

    const t = toolRef.current;
    if (snapToGrid && t !== 'select' && t !== 'eraser' && t !== 'laser') pos = snapWorldPoint(pos);

    if (t === 'select') {
      const handle = getHandleAt(pos);
      if (handle !== null) {
        if (selectedIdsRef.current.length > 1) return;
        setDragHandle(handle);
        const shape = shapesRef.current.find(s => s.id === selectedIdRef.current && !s.deleted);
        if (shape) {
          dragOffsetRef.current = { x: pos.x, y: pos.y };
          dragStartDataRef.current = { ...shape.data };
          const members = shape.data.kind === ShapeKind.Rect && shape.data.frameTitle ? frameDescendants(shapesRef.current, shape.id) : [];
          draggedShapeIdsRef.current = [shape.id, ...members.map(member => member.id)];
          dragSelectionSnapshotsRef.current = new Map(draggedShapeIdsRef.current.map(id => {
            const item = shapesRef.current.find(candidate => candidate.id === id);
            return [id, item ? { ...item.data } : null];
          }).filter((entry): entry is [string, any] => entry[1] !== null));
        }
        return;
      }
      let hit: Shape | null = null;
      const orderedShapes = hitTestCandidates(pos.x, pos.y, 8);
      for (let i = orderedShapes.length - 1; i >= 0; i--) {
        const s = orderedShapes[i];
        if (s.deleted) continue;
        const b = hitBoundsById.get(s.id) ?? shapeBBox(s);
        if (pos.x >= b.minX - 8 && pos.x <= b.maxX + 8 && pos.y >= b.minY - 8 && pos.y <= b.maxY + 8) {
          hit = s;
          break;
        }
      }
      if (hit) {
        const groupId = (hit.data as typeof hit.data & { groupId?: string }).groupId;
        const hitIds = groupId
          ? shapesRef.current.filter(shape => !shape.deleted && (shape.data as typeof shape.data & { groupId?: string }).groupId === groupId).map(shape => shape.id)
          : [hit.id];
        if (e.shiftKey) {
          const current = selectedIdsRef.current;
          const remove = hitIds.every(id => current.includes(id));
          const next = remove ? current.filter(id => !hitIds.includes(id)) : [...new Set([...current, ...hitIds])];
          selectedIdsRef.current = next;
          setSelectedIds(next);
          selectedIdRef.current = next[next.length - 1] ?? null;
          setSelectedId(next[next.length - 1] ?? null);
          dragOffsetRef.current = null;
          draggedShapeIdsRef.current = [];
          return;
        } else {
          selectedIdsRef.current = hitIds;
          selectedIdRef.current = hit.id;
          setSelectedId(hit.id);
          setSelectedIds(hitIds);
        }
        dragOffsetRef.current = { x: pos.x, y: pos.y };
        dragStartDataRef.current = { ...hit.data };
        const dragged = new Set(hitIds);
        for (const id of hitIds) {
          const item = shapesRef.current.find(shape => shape.id === id);
          if (item?.data.kind === ShapeKind.Rect && item.data.frameTitle) {
            frameDescendants(shapesRef.current, id).forEach(member => dragged.add(member.id));
          }
        }
        draggedShapeIdsRef.current = Array.from(dragged);
        dragSelectionSnapshotsRef.current = new Map(
          draggedShapeIdsRef.current.map(id => {
            const selectedShape = shapesRef.current.find(shape => shape.id === id);
            return [id, selectedShape ? { ...selectedShape.data } : null];
          }).filter((entry): entry is [string, any] => entry[1] !== null)
        );
      } else {
        if (!e.shiftKey) {
          setSelectedId(null);
          setSelectedIds([]);
        }
      }
      return;
    }

    if (t === 'eraser') {
      const orderedShapes = hitTestCandidates(pos.x, pos.y, 12);
      for (let i = orderedShapes.length - 1; i >= 0; i--) {
        const s = orderedShapes[i];
        if (s.deleted) continue;
        const b = hitBoundsById.get(s.id) ?? shapeBBox(s);
        if (pos.x >= b.minX - 12 && pos.x <= b.maxX + 12 && pos.y >= b.minY - 12 && pos.y <= b.maxY + 12) {
          onDelete?.(s.id);
          return;
        }
      }
      return;
    }

    if (t === 'text') {
      setTextOverlay({ mode: 'text', x: pos.x, y: pos.y - 10, color: activeColorRef.current, bgColor: '#fef3c7', value: '' });
      drawingRef.current = { active: false, kind: null, startPoint: null, currentPoints: [] };
      return;
    }

    if (t === 'note') {
      const noteColor = activeColorRef.current;
      setTextOverlay({ mode: 'note', x: pos.x, y: pos.y, color: contrastColor(noteColor), bgColor: noteColor, value: '' });
      drawingRef.current = { active: false, kind: null, startPoint: null, currentPoints: [] };
      return;
    }

    // Drawing tools
    drawingRef.current = {
      active: true,
      kind: t,
      startPoint: pos,
      currentPoints: [pos],
    };
  }, [getWorldPos, getHandleAt, onDelete, snapToGrid, hitTestCandidates, voteMode, onVoteAt]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const pos = getWorldPos(e);
    const orderedShapes = hitTestCandidates(pos.x, pos.y, 6);
    for (let i = orderedShapes.length - 1; i >= 0; i--) {
      const shape = orderedShapes[i];
      if (shape.deleted) continue;
      const b = hitBoundsById.get(shape.id) ?? shapeBBox(shape);
      if (pos.x < b.minX - 6 || pos.x > b.maxX + 6 || pos.y < b.minY - 6 || pos.y > b.maxY + 6) continue;
      const data = shape.data;
      let mode: 'text' | 'note';
      let overlayX: number;
      let overlayY: number;
      let color: string;
      let bgColor = '#fef3c7';
      let value: string;
      if (data.kind === ShapeKind.Text) {
        mode = 'text'; overlayX = data.x; overlayY = data.y - 18; color = data.color; value = data.text;
      } else if (data.kind === ShapeKind.Note) {
        mode = 'note'; overlayX = data.x; overlayY = data.y; color = data.color; bgColor = data.bgColor; value = data.text;
      } else if (data.kind === ShapeKind.Rect && data.frameTitle) {
        mode = 'text'; overlayX = data.x; overlayY = data.y - 32; color = '#f8fafc'; value = data.frameTitle;
      } else {
        continue;
      }
      setSelectedId(shape.id);
      selectedIdRef.current = shape.id;
      selectedIdsRef.current = [shape.id];
      setSelectedIds([shape.id]);
      setTextOverlay({
        mode,
        x: overlayX,
        y: overlayY,
        color,
        bgColor,
        value,
        shapeId: shape.id,
      });
      return;
    }
  }, [getWorldPos, hitTestCandidates]);

  const handleMouseMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pointers = [...touchPointersRef.current.values()];
      const pinch = pinchStartRef.current;
      const canvas = canvasRef.current;
      if (pointers.length >= 2 && pinch && canvas) {
        const rect = canvas.getBoundingClientRect();
        const [first, second] = pointers;
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        const scale = Math.max(0.1, Math.min(10, pinch.scale * distance / Math.max(1, pinch.distance)));
        const midX = (first.x + second.x) / 2 - rect.left;
        const midY = (first.y + second.y) / 2 - rect.top;
        transformRef.current = { scale, offset: { x: midX - pinch.worldX * scale, y: midY - pinch.worldY * scale } };
        onZoomChange(scale);
        render();
      }
      return;
    }
    const pos = getWorldPos(e);
    onCursorMove?.(pos.x, pos.y);

    // Pan
    if (isPanning && panStart) {
      transformRef.current = {
        ...transformRef.current,
        offset: {
          x: panStart.offX + (e.clientX - panStart.x),
          y: panStart.offY + (e.clientY - panStart.y),
        },
      };
      render();
      return;
    }

    // Drag handle (resize)
    if (dragHandle !== null && selectedIdRef.current) {
      const shape = shapesRef.current.find(s => s.id === selectedIdRef.current && !s.deleted);
      if (!shape) return;
      const b = hitBoundsById.get(shape.id) ?? shapeBBox(shape);
      const dx = pos.x - (dragOffsetRef.current?.x ?? pos.x);
      const dy = pos.y - (dragOffsetRef.current?.y ?? pos.y);
      let newData: any = { ...shape.data };
      let newBBox = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
      
      if (dragHandle === 0) {
        newBBox.minX += dx; newBBox.minY += dy;
      } else if (dragHandle === 1) {
        newBBox.maxX += dx; newBBox.minY += dy;
      } else if (dragHandle === 2) {
        newBBox.minX += dx; newBBox.maxY += dy;
      } else if (dragHandle === 3) {
        newBBox.maxX += dx; newBBox.maxY += dy;
      }

      // Enforce minimum size of 10x10
      if (newBBox.maxX - newBBox.minX < 10) {
        if (dragHandle === 0 || dragHandle === 2) newBBox.minX = newBBox.maxX - 10;
        else newBBox.maxX = newBBox.minX + 10;
      }
      if (newBBox.maxY - newBBox.minY < 10) {
        if (dragHandle === 0 || dragHandle === 1) newBBox.minY = newBBox.maxY - 10;
        else newBBox.maxY = newBBox.minY + 10;
      }

      const scaleX = (b.maxX - b.minX) === 0 ? 1 : (newBBox.maxX - newBBox.minX) / (b.maxX - b.minX);
      const scaleY = (b.maxY - b.minY) === 0 ? 1 : (newBBox.maxY - newBBox.minY) / (b.maxY - b.minY);

      if (shape.kind === ShapeKind.Rect || shape.kind === ShapeKind.Image || shape.kind === ShapeKind.Note) {
        newData.x = newBBox.minX;
        newData.y = newBBox.minY;
        newData.w = newBBox.maxX - newBBox.minX;
        newData.h = newBBox.maxY - newBBox.minY;
      } else if (shape.kind === ShapeKind.Ellipse) {
        newData.cx = (newBBox.minX + newBBox.maxX) / 2;
        newData.cy = (newBBox.minY + newBBox.maxY) / 2;
        newData.rx = (newBBox.maxX - newBBox.minX) / 2;
        newData.ry = (newBBox.maxY - newBBox.minY) / 2;
      } else if (shape.kind === ShapeKind.Line) {
        const lineData = shape.data as import('@crdt-canvas/engine').LineShape;
        const isX1Left = lineData.x1 <= lineData.x2;
        const isY1Top = lineData.y1 <= lineData.y2;
        newData.x1 = isX1Left ? newBBox.minX : newBBox.maxX;
        newData.x2 = isX1Left ? newBBox.maxX : newBBox.minX;
        newData.y1 = isY1Top ? newBBox.minY : newBBox.maxY;
        newData.y2 = isY1Top ? newBBox.maxY : newBBox.minY;
      } else if (shape.kind === ShapeKind.Stroke) {
        const strokeData = shape.data as import('@crdt-canvas/engine').StrokeShape;
        newData.points = strokeData.points.map((p: any) => ({
          x: newBBox.minX + (p.x - b.minX) * scaleX,
          y: newBBox.minY + (p.y - b.minY) * scaleY
        }));
      } else if (shape.kind === ShapeKind.Text || shape.kind === ShapeKind.Note) {
        newData.x = newBBox.minX;
        newData.y = newBBox.minY;
      }

      onShapeResized?.(selectedIdRef.current, newData, 'resize', true);
      const initialFrame = dragStartDataRef.current as ShapeData | null;
      if (initialFrame?.kind === ShapeKind.Rect && initialFrame.frameTitle && shape.data.kind === ShapeKind.Rect) {
        const initialBounds = shapeBBox({ ...shape, data: initialFrame });
        for (const [id, memberData] of dragSelectionSnapshotsRef.current) {
          if (id === shape.id || memberData.locked) continue;
          onShapeResized?.(id, scaleFrameMember(memberData as ShapeData, initialBounds, newBBox), 'resize', true);
        }
      }
      dragOffsetRef.current = { x: pos.x, y: pos.y };
      render();
      return;
    }

    // Drag shape
    if (selectedIdRef.current && (e.buttons & 1) && toolRef.current === 'select' && dragOffsetRef.current) {
      const dx = pos.x - dragOffsetRef.current.x;
      const dy = pos.y - dragOffsetRef.current.y;
      const selectedIds = draggedShapeIdsRef.current.length ? draggedShapeIdsRef.current : (selectedIdsRef.current.length ? selectedIdsRef.current : [selectedIdRef.current]);
      const selectedSet = new Set(selectedIds);
      const moving = shapesRef.current.filter(shape => selectedSet.has(shape.id) && !shape.deleted);
      const targets = shapesRef.current.filter(shape => !shape.deleted && !selectedSet.has(shape.id));
      const movingBounds = moving.map(shape => hitBoundsById.get(shape.id) ?? shapeBBox(shape));
      let group = movingBounds.length ? {
        minX: Math.min(...movingBounds.map(bounds => bounds.minX)), minY: Math.min(...movingBounds.map(bounds => bounds.minY)),
        maxX: Math.max(...movingBounds.map(bounds => bounds.maxX)), maxY: Math.max(...movingBounds.map(bounds => bounds.maxY)),
      } : null;
      const targetBounds = targets.map(shape => ({ shape, bounds: hitBoundsById.get(shape.id) ?? shapeBBox(shape) }));
      const threshold = 7 / transformRef.current.scale;
      let snapX = 0;
      let snapY = 0;
      let bestX = threshold + 1;
      let bestY = threshold + 1;
      let alignmentX: VisualGuide | null = null;
      let alignmentY: VisualGuide | null = null;
      let spacingX: VisualGuide[] | null = null;
      let spacingY: VisualGuide[] | null = null;
      if (group) {
        const movingX = [group.minX, (group.minX + group.maxX) / 2, group.maxX];
        const movingY = [group.minY, (group.minY + group.maxY) / 2, group.maxY];
        for (const target of targetBounds) {
          const { bounds } = target;
          const targetX = [bounds.minX, (bounds.minX + bounds.maxX) / 2, bounds.maxX];
          const targetY = [bounds.minY, (bounds.minY + bounds.maxY) / 2, bounds.maxY];
          for (const movingEdge of movingX) for (const targetEdge of targetX) {
            const correction = targetEdge - (movingEdge + dx);
            if (Math.abs(correction) <= threshold && Math.abs(correction) < bestX) {
              bestX = Math.abs(correction);
              snapX = correction;
              alignmentX = { x1: targetEdge, y1: Math.min(group.minY + dy, bounds.minY) - 12, x2: targetEdge, y2: Math.max(group.maxY + dy, bounds.maxY) + 12, kind: 'alignment' };
            }
          }
          for (const movingEdge of movingY) for (const targetEdge of targetY) {
            const correction = targetEdge - (movingEdge + dy);
            if (Math.abs(correction) <= threshold && Math.abs(correction) < bestY) {
              bestY = Math.abs(correction);
              snapY = correction;
              alignmentY = { x1: Math.min(group.minX + dx, bounds.minX) - 12, y1: targetEdge, x2: Math.max(group.maxX + dx, bounds.maxX) + 12, y2: targetEdge, kind: 'alignment' };
            }
          }
        }

        const proposed = { minX: group.minX + dx, maxX: group.maxX + dx, minY: group.minY + dy, maxY: group.maxY + dy };
        const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(a0, b0) <= Math.min(a1, b1);
        let left: typeof targetBounds[number] | undefined;
        let right: typeof targetBounds[number] | undefined;
        let above: typeof targetBounds[number] | undefined;
        let below: typeof targetBounds[number] | undefined;
        for (const item of targetBounds) {
          const b = item.bounds;
          if (overlap(b.minY, b.maxY, proposed.minY, proposed.maxY)) {
            if (b.maxX <= proposed.minX && (!left || b.maxX > left.bounds.maxX)) left = item;
            if (b.minX >= proposed.maxX && (!right || b.minX < right.bounds.minX)) right = item;
          }
          if (overlap(b.minX, b.maxX, proposed.minX, proposed.maxX)) {
            if (b.maxY <= proposed.minY && (!above || b.maxY > above.bounds.maxY)) above = item;
            if (b.minY >= proposed.maxY && (!below || b.minY < below.bounds.minY)) below = item;
          }
        }
        if (left && right) {
          const width = group.maxX - group.minX;
          const available = right.bounds.minX - left.bounds.maxX;
          const gap = (available - width) / 2;
          if (gap > 0) {
            const correction = left.bounds.maxX + gap - proposed.minX;
            if (Math.abs(correction) <= threshold && Math.abs(correction) < bestX) {
              bestX = Math.abs(correction);
              snapX = correction;
              const y = Math.max(proposed.maxY, left.bounds.maxY, right.bounds.maxY) + 14;
              const firstEnd = proposed.minX + correction;
              const secondStart = firstEnd + width;
              spacingX = [
                { x1: left.bounds.maxX, y1: y, x2: firstEnd, y2: y, kind: 'spacing', label: `${Math.round(gap)} px` },
                { x1: secondStart, y1: y, x2: right.bounds.minX, y2: y, kind: 'spacing', label: `${Math.round(gap)} px` },
              ];
            }
          }
        }

        if (above && below) {
          const height = group.maxY - group.minY;
          const available = below.bounds.minY - above.bounds.maxY;
          const gap = (available - height) / 2;
          if (gap > 0) {
            const correction = above.bounds.maxY + gap - proposed.minY;
            if (Math.abs(correction) <= threshold && Math.abs(correction) < bestY) {
              bestY = Math.abs(correction);
              snapY = correction;
              const x = Math.max(proposed.maxX, above.bounds.maxX, below.bounds.maxX) + 14;
              const firstEnd = proposed.minY + correction;
              const secondStart = firstEnd + height;
              spacingY = [
                { x1: x, y1: above.bounds.maxY, x2: x, y2: firstEnd, kind: 'spacing', label: `${Math.round(gap)} px` },
                { x1: x, y1: secondStart, x2: x, y2: below.bounds.minY, kind: 'spacing', label: `${Math.round(gap)} px` },
              ];
            }
          }
        }
      }
      alignmentGuidesRef.current = [
        ...(spacingX ?? (alignmentX ? [alignmentX] : [])),
        ...(spacingY ?? (alignmentY ? [alignmentY] : [])),
      ];
      for (const id of selectedIds) {
        onShapeMoved?.(id, dx + snapX, dy + snapY, true);
      }
      dragOffsetRef.current = { x: pos.x + snapX, y: pos.y + snapY };
      render();
      return;
    }

    // Live drawing
    if (drawingRef.current.active) {
      if (toolRef.current === 'laser') {
        // Keep only the last 30 points to create an ephemeral tail
        if (drawingRef.current.currentPoints.length > 30) {
          drawingRef.current.currentPoints.shift();
        }
      }
      const drawingPos = snapToGrid && toolRef.current !== 'laser' ? snapWorldPoint(pos) : pos;
      drawingRef.current.currentPoints.push(drawingPos);
      if (toolRef.current === 'laser') {
        onLaserUpdate?.(drawingRef.current.currentPoints);
      }
      render();
    }

    // Cursor style
    if (toolRef.current === 'select') {
      const handle = getHandleAt(pos);
      if (handle !== null) {
        const cursors = ['nwse-resize', 'nesw-resize', 'nesw-resize', 'nwse-resize'];
        const cvs = canvasRef.current;
        if (cvs) cvs.style.cursor = cursors[handle];
      } else {
        const hit = hitTestCandidates(pos.x, pos.y, 8).some(s => {
          const b = hitBoundsById.get(s.id) ?? shapeBBox(s);
          return pos.x >= b.minX - 8 && pos.x <= b.maxX + 8 && pos.y >= b.minY - 8 && pos.y <= b.maxY + 8;
        });
        const cvs2 = canvasRef.current;
        if (cvs2) cvs2.style.cursor = hit ? 'move' : 'default';
      }
    } else {
      const cvs3 = canvasRef.current;
      if (cvs3) cvs3.style.cursor = toolRef.current === 'eraser' ? 'crosshair' : 'crosshair';
    }
  }, [isPanning, panStart, dragHandle, getWorldPos, getHandleAt, onShapeMoved, onShapeResized, render, snapToGrid, onZoomChange, hitTestCandidates]);

  const handleMouseUp = useCallback((e: React.PointerEvent) => {
    alignmentGuidesRef.current = [];
    if (e.pointerType === 'touch' && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.delete(e.pointerId);
      pinchStartRef.current = null;
      drawingRef.current = { active: false, kind: null, startPoint: null, currentPoints: [] };
      dragOffsetRef.current = null;
      setIsPanning(false);
      setPanStart(null);
      render();
      return;
    }
    const pos = getWorldPos(e);

    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      render();
      return;
    }

    if (dragHandle !== null) {
      if (selectedIdRef.current && dragStartDataRef.current) {
        if (dragSelectionSnapshotsRef.current.size > 1) {
          const entries = [...dragSelectionSnapshotsRef.current].map(([id, prevData]) => ({ id, prevData }));
          onShapeHistoryCommitBatch?.(entries);
        } else {
          for (const [id, data] of dragSelectionSnapshotsRef.current) onShapeHistoryCommit?.(id, data);
        }
      }
      setDragHandle(null);
      dragStartDataRef.current = null;
      dragSelectionSnapshotsRef.current.clear();
      draggedShapeIdsRef.current = [];
      render();
      return;
    }

    if (dragOffsetRef.current && selectedIdRef.current && toolRef.current === 'select') {
      const entries = [...dragSelectionSnapshotsRef.current].map(([id, prevData]) => ({ id, prevData }));
      if (entries.length > 1) onShapeHistoryCommitBatch?.(entries);
      else entries.forEach(({ id, prevData }) => onShapeHistoryCommit?.(id, prevData));
      dragOffsetRef.current = null;
      dragStartDataRef.current = null;
      dragSelectionSnapshotsRef.current.clear();
      draggedShapeIdsRef.current = [];
      render();
      return;
    }

    const draw = drawingRef.current;
    if (!draw.active) return;

    const t = toolRef.current;
    const c = activeColorRef.current;
    const sw = strokeWidthRef.current;

    if (t === 'stroke') {
      if (draw.currentPoints.length >= 2) {
        onStrokeEnd(draw.currentPoints, c, sw);
      }
    } else if ((t === 'line' || t === 'arrow') && draw.startPoint) {
      const last = draw.currentPoints[draw.currentPoints.length - 1];
      if (last) onLineEnd(draw.startPoint.x, draw.startPoint.y, last.x, last.y, c, sw, t === 'arrow');
    } else if ((t === 'rect' || t === 'frame') && draw.startPoint) {
      const last = draw.currentPoints[draw.currentPoints.length - 1];
      if (last) {
        const x = Math.min(draw.startPoint.x, last.x);
        const y = Math.min(draw.startPoint.y, last.y);
        const w = Math.abs(last.x - draw.startPoint.x);
        const h = Math.abs(last.y - draw.startPoint.y);
        if (w > 3 && h > 3) onRectEnd(x, y, w, h, c, t === 'frame' ? 0 : fillOpacity, sw, t === 'frame' ? 0 : cornerRadius, t === 'frame' ? 'Frame' : undefined);
      }
    } else if (t === 'ellipse' && draw.startPoint) {
      const last = draw.currentPoints[draw.currentPoints.length - 1];
      if (last) {
        const cx = (draw.startPoint.x + last.x) / 2;
        const cy = (draw.startPoint.y + last.y) / 2;
        const rx = Math.abs(last.x - draw.startPoint.x) / 2;
        const ry = Math.abs(last.y - draw.startPoint.y) / 2;
        if (rx > 3 && ry > 3) onEllipseEnd(cx, cy, rx, ry, c, fillOpacity, sw);
      }
    } else if (t === 'laser') {
      onLaserUpdate?.(null);
    }

    drawingRef.current = { active: false, kind: null, startPoint: null, currentPoints: [] };
    render();
  }, [getWorldPos, isPanning, dragHandle, onStrokeEnd, onLineEnd, onRectEnd, onEllipseEnd, onShapeHistoryCommit, onShapeHistoryCommitBatch, fillOpacity, strokeWidth, cornerRadius, render]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
    const { scale: s, offset } = transformRef.current;
    const newScale = Math.max(0.1, Math.min(10, s * zoomFactor));
    const newOffsetX = mouseX - (mouseX - offset.x) * (newScale / s);
    const newOffsetY = mouseY - (mouseY - offset.y) * (newScale / s);

    transformRef.current = { scale: newScale, offset: { x: newOffsetX, y: newOffsetY } };
    onZoomChange(newScale);
    render();
  }, [render, onZoomChange]);

  // ── Text / Note input handlers ────────────────────────────────────────────

  const handleTextSubmit = useCallback(() => {
    const val = textareaRef.current?.value.trim() ?? '';
    if (textOverlay?.mode === 'text') {
      if (textOverlay.shapeId) {
        const shape = shapesRef.current.find(item => item.id === textOverlay.shapeId);
        if (shape?.data.kind === ShapeKind.Rect && shape.data.frameTitle) onShapeResized?.(textOverlay.shapeId, { frameTitle: val || 'Frame' }, 'update');
        else if (val) {
          const resolved = resolveTextOverlap({ x: textOverlay.x, y: textOverlay.y + 18, text: val, id: textOverlay.shapeId }, shapesRef.current);
          onShapeResized?.(textOverlay.shapeId, { text: val, color: textOverlay.color, y: resolved.y }, 'update');
        }
        else onDelete?.(textOverlay.shapeId);
      } else if (val) {
        const resolved = resolveTextOverlap({ x: textOverlay.x, y: textOverlay.y + 18, text: val }, shapesRef.current);
        onTextSubmit(resolved.x, resolved.y, val, textOverlay.color);
      }
    }
    setTextOverlay(null);
  }, [textOverlay, onTextSubmit, onShapeResized, onDelete]);

  const handleNoteSubmit = useCallback(() => {
    const val = textareaRef.current?.value.trim() ?? '';
    if (textOverlay?.mode === 'note') {
      if (textOverlay.shapeId) {
        if (val) onShapeResized?.(textOverlay.shapeId, { text: val, color: textOverlay.color, bgColor: textOverlay.bgColor }, 'update');
        else onDelete?.(textOverlay.shapeId);
      } else if (val) {
        onNoteAdd(textOverlay.x, textOverlay.y, val, textOverlay.color, textOverlay.bgColor);
      }
    }
    setTextOverlay(null);
  }, [textOverlay, onNoteAdd, onShapeResized, onDelete]);

  const fitToBounds = useCallback((ids?: string[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const candidates = shapesRef.current.filter(shape => !shape.deleted && (!ids || ids.includes(shape.id)));
    if (!candidates.length) return;
    const bounds = candidates.map(shape => hitBoundsById.get(shape.id) ?? shapeBBox(shape)).reduce((acc, box) => ({
      minX: Math.min(acc.minX, box.minX), minY: Math.min(acc.minY, box.minY),
      maxX: Math.max(acc.maxX, box.maxX), maxY: Math.max(acc.maxY, box.maxY),
    }));
    const rect = canvas.getBoundingClientRect();
    const worldW = Math.max(1, bounds.maxX - bounds.minX);
    const worldH = Math.max(1, bounds.maxY - bounds.minY);
    const nextScale = Math.max(0.1, Math.min(5, (rect.width - 96) / worldW, (rect.height - 96) / worldH));
    transformRef.current = {
      scale: nextScale,
      offset: {
        x: (rect.width - worldW * nextScale) / 2 - bounds.minX * nextScale,
        y: (rect.height - worldH * nextScale) / 2 - bounds.minY * nextScale,
      },
    };
    onZoomChange(nextScale);
    render();
  }, [onZoomChange, render, hitBoundsById]);

  useEffect(() => {
    if (focusShapeIds?.length) fitToBounds(focusShapeIds);
    else if (highlightShapeId) fitToBounds([highlightShapeId]);
  }, [focusShapeIds, highlightShapeId, fitToBounds]);

  // ── Draw helpers ──────────────────────────────────────────────────────────

  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number, off: { x: number; y: number }) {
    const dotSpacing = 32;
    const dotRadius = Math.max(0.8 / zoom, 1.2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    const startX = Math.floor(-off.x / dotSpacing / zoom) * dotSpacing;
    const startY = Math.floor(-off.y / dotSpacing / zoom) * dotSpacing;
    const endX = startX + w / zoom + dotSpacing * 2;
    const endY = startY + h / zoom + dotSpacing * 2;
    ctx.beginPath();
    for (let x = startX; x < endX; x += dotSpacing) {
      for (let y = startY; y < endY; y += dotSpacing) {
        ctx.rect(x - dotRadius / 2, y - dotRadius / 2, dotRadius, dotRadius);
      }
    }
    ctx.fill();
  }

  function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, name: string) {
    ctx.save();
    ctx.translate(x, y);

    // Drop shadow for pointer
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;

    // Sleek pointer arrow
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4.5, 12);
    ctx.lineTo(9, 18);
    ctx.lineTo(12, 16.5);
    ctx.lineTo(7.5, 10.5);
    ctx.lineTo(13, 10.5);
    ctx.closePath();
    ctx.fill();

    // Name badge pill
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.font = '600 11px Inter, sans-serif';
    const textWidth = ctx.measureText(name).width;
    const pillW = textWidth + 14;
    const pillH = 18;
    const pillX = 14;
    const pillY = 12;

    ctx.fillStyle = color;
    roundRect(ctx, pillX, pillY, pillW, pillH, 9);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, pillX + 7, pillY + 13);

    ctx.restore();
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, fontSize: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  function shadeColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, Math.max(0, (num >> 16) + amt));
    const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
    const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: '#0d0d14' }}
      onDragOver={e => {
        e.preventDefault();
        e.stopPropagation();
        if (toolRef.current === 'image') {
          const pos = getWorldPosForDrag(e);
          setIsDragOver(true);
          setDragOverPos(pos);
        }
      }}
      onDragLeave={e => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        setDragOverPos(null);
      }}
      onDrop={e => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        setDragOverPos(null);
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        const pos = getWorldPosForDrag(e);
        const currentBytes = calculateBoardImageBytes(shapes);
        void prepareBoardImage(file, currentBytes).then(({ src, width, height }) => {
          onImageDrop(pos.x - width / 2, pos.y - height / 2, width, height, src);
        }).catch(error => window.alert(error instanceof Error ? error.message : 'Could not add this image.'));
      }}
    >
      {/* Tool hint label */}
      <div style={{
        position: 'absolute',
        top: 12,
        left: 16,
        padding: '4px 10px',
        background: 'rgba(255, 255, 255, 0.92)',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        borderRadius: 6,
        fontSize: 11,
        color: '#475569',
        zIndex: 90,
        backdropFilter: 'blur(8px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'Inter, sans-serif',
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: tool === 'select' ? '#10b981' : tool === 'eraser' ? '#ef4444' : '#7c3aed',
          display: 'inline-block',
        }} />
        <span style={{ fontWeight: 600, color: voteMode ? '#d97706' : '#7c3aed', textTransform: 'capitalize' }}>{voteMode ? 'vote on objects' : tool}</span>
        <span style={{ color: '#94a3b8' }}>·</span>
        <span>{Math.round(scale * 100)}%</span>
      </div>
      <canvas
        ref={canvasRef}
        role="application"
        tabIndex={0}
        aria-label="Collaborative whiteboard. Select objects, draw, and move around the board with Space and drag."
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
        }}
        onContextMenu={e => e.preventDefault()}
        onPointerDown={handleMouseDown}
        onPointerMove={handleMouseMove}
        onPointerUp={handleMouseUp}
        onPointerCancel={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      />

      {textOverlay && textOverlay.mode === 'text' && (
        <textarea
          ref={textareaRef}
          rows={Math.max(1, textOverlay.value.split('\n').length)}
          value={textOverlay.value}
          onChange={e => setTextOverlay({ ...textOverlay, value: e.target.value })}
          onBlur={handleTextSubmit}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleTextSubmit(); } if (e.key === 'Escape') setTextOverlay(null); }}
          placeholder="Type text…"
          style={{
            position: 'absolute',
            left: textOverlay.x * transformRef.current.scale + transformRef.current.offset.x,
            top: textOverlay.y * transformRef.current.scale + transformRef.current.offset.y,
            padding: '6px 10px',
            background: '#ffffff',
            border: '2px solid #7c3aed',
            borderRadius: 6,
            color: (textOverlay.color === '#ffffff' || textOverlay.color === '#fff') ? '#0f172a' : textOverlay.color,
            fontSize: Math.max(13, 15 * transformRef.current.scale),
            outline: 'none',
            minWidth: Math.max(180, 180 * transformRef.current.scale),
            zIndex: 50,
            fontFamily: 'Inter, sans-serif',
            lineHeight: 1.4,
            resize: 'both',
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          }}
        />
      )}

      {/* Empty State Overlay */}
      {shapes.filter(s => !s.deleted).length === 0 && !history && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          zIndex: 10,
          animation: 'fadeIn 0.6s ease',
        }}>
          <div style={{
            width: 64, height: 64,
            borderRadius: '50%',
            background: 'rgba(124, 58, 237, 0.1)',
            border: '1px solid rgba(124, 58, 237, 0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28,
            boxShadow: '0 0 40px rgba(124, 58, 237, 0.2)',
          }}>
            ✨
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>Canvas is empty</div>
            <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
              Pick a tool to start drawing, drop an image, <br />
              or press <kbd style={{ background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: 4, color: '#7c3aed', fontFamily: 'monospace' }}>?</kbd> for shortcuts
            </div>
          </div>
        </div>
      )}

      {textOverlay && textOverlay.mode === 'note' && (
        <div style={{
          position: 'absolute',
          left: textOverlay.x * transformRef.current.scale + transformRef.current.offset.x,
          top: textOverlay.y * transformRef.current.scale + transformRef.current.offset.y,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <div style={{
            padding: '2px 8px',
            fontSize: 10,
            color: '#8888a8',
            background: 'rgba(15,15,22,0.8)',
            borderRadius: '4px 4px 0 0',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>Sticky Note</div>
          <textarea
            ref={textareaRef}
            rows={4}
            value={textOverlay.value}
            onChange={e => setTextOverlay({ ...textOverlay, value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Escape') setTextOverlay(null);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleNoteSubmit(); }
            }}
            placeholder="Write a note…"
            style={{
              width: Math.round(200 * transformRef.current.scale),
              minHeight: Math.round(100 * transformRef.current.scale),
              padding: '8px 10px',
              background: textOverlay.bgColor,
              border: '1px solid rgba(124, 58, 237, 0.6)',
              borderRadius: '0 0 8px 8px',
              color: textOverlay.color,
              fontSize: 13,
              outline: 'none',
              resize: 'none',
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.5,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
          />
          <div style={{ display: 'flex', gap: 4, padding: '4px 2px' }}>
            {NOTE_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setTextOverlay({ ...textOverlay, bgColor: c, color: contrastColor(c) })}
                style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: c,
                  border: textOverlay.bgColor === c ? '2px solid #a78bfa' : '2px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  transition: 'border 0.1s',
                  padding: 0,
                }}
              />
            ))}
            <label title="Custom note colour" style={{ width: 16, height: 16, borderRadius: '50%', overflow: 'hidden', cursor: 'pointer', border: '1px solid rgba(255,255,255,.35)' }}>
              <input aria-label="Custom note colour" type="color" value={textOverlay.bgColor} onChange={e => setTextOverlay({ ...textOverlay, bgColor: e.target.value, color: contrastColor(e.target.value) })} style={{ width: 24, height: 24, padding: 0, margin: -4, border: 0, cursor: 'pointer' }} />
            </label>
            <div style={{ flex: 1 }} />
            <button onClick={handleNoteSubmit} style={{
              padding: '2px 10px', borderRadius: 4, fontSize: 11,
              background: 'rgba(124, 58, 237, 0.7)', color: '#fff', border: 'none', cursor: 'pointer',
            }}>Submit (⌘Enter)</button>
            <button onClick={() => setTextOverlay(null)} style={{
              padding: '2px 10px', borderRadius: 4, fontSize: 11,
              background: 'rgba(255,255,255,0.1)', color: '#8888a8', border: 'none', cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Zoom controls */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        zIndex: 100,
      }}>
        <button onClick={() => fitToBounds(selectedIds.length ? selectedIds : undefined)} title={selectedIds.length ? 'Zoom to selection' : 'Fit board to view'} aria-label={selectedIds.length ? 'Zoom to selection' : 'Fit board to view'} style={zoomBtnStyle as any}>⌗</button>
        <button
          onClick={() => {
            const s = transformRef.current.scale;
            const newScale = Math.min(10, s * 1.25);
            transformRef.current.scale = newScale;
            onZoomChange(newScale);
            render();
          }}
          title="Zoom in" aria-label="Zoom in"
          style={zoomBtnStyle as any}
        >+</button>
        <button
          onClick={() => {
            transformRef.current.scale = 1;
            onZoomChange(1);
            render();
          }}
          title="Reset zoom" aria-label="Reset zoom"
          style={zoomBtnStyle as any}
        >1:1</button>
        <button
          onClick={() => {
            const s = transformRef.current.scale;
            const newScale = Math.max(0.1, s * 0.8);
            transformRef.current.scale = newScale;
            onZoomChange(newScale);
            render();
          }}
          title="Zoom out" aria-label="Zoom out"
          style={zoomBtnStyle as any}
        >−</button>
      </div>

      {/* Drag-and-drop image overlay */}
      {isDragOver && dragOverPos && (
        <div style={{
          position: 'absolute',
          left: dragOverPos.x * transformRef.current.scale + transformRef.current.offset.x,
          top: dragOverPos.y * transformRef.current.scale + transformRef.current.offset.y,
          transform: 'translate(-50%, -50%)',
          width: 200,
          height: 140,
          border: '2px dashed rgba(124, 58, 237, 0.8)',
          borderRadius: 12,
          background: 'rgba(124, 58, 237, 0.12)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          zIndex: 100,
          pointerEvents: 'none',
          animation: 'fadeIn 0.15s ease',
        }}>
          <span style={{ fontSize: 32 }}>🖼️</span>
          <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>Drop image here</span>
          <span style={{ fontSize: 10, color: '#555570' }}>Image will be centered</span>
        </div>
      )}

      {/* Floating Conflict Resolution Widgets */}
      {onResolveConflict && conflicts.map(conflict => {
        const shape = shapes.find(s => s.id === conflict.shapeId && !s.deleted);
        if (!shape) return null;
        return (
          <FloatingConflictWidget
            key={conflict.shapeId}
            conflict={conflict}
            shape={shape}
            scale={transformRef.current.scale}
            offset={transformRef.current.offset}
            onResolve={onResolveConflict}
          />
        );
      })}

      {/* Keyboard shortcuts overlay */}
      {showShortcuts && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(15, 15, 22, 0.96)',
          border: '1px solid rgba(124, 58, 237, 0.4)',
          borderRadius: 16,
          padding: '24px 28px',
          zIndex: 200,
          backdropFilter: 'blur(20px)',
          boxShadow: '0 16px 64px rgba(0,0,0,0.6)',
          minWidth: 320,
          animation: 'fadeIn 0.15s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#c4b5fd' }}>⌨️ Keyboard Shortcuts</span>
            <button
              onClick={() => setShowShortcuts(false)}
              style={{ color: '#8888a8', fontSize: 16, background: 'none', padding: 4 }}
              title="Close"
            >✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 13 }}>
            {[
              ['V', 'Select tool'],
              ['S', 'Draw (Stroke)'],
              ['R', 'Rectangle'],
              ['E', 'Ellipse'],
              ['L', 'Line'],
              ['A', 'Arrow connector'],
              ['F', 'Frame'],
              ['T', 'Text'],
              ['I', 'Upload Image'],
              ['N', 'Sticky Note'],
              ['X', 'Eraser'],
              ['C', 'Toggle Chat'],
              ['⌘/Ctrl+Z', 'Undo'],
              ['⌘/Ctrl+Y', 'Redo'],
              ['⌘/Ctrl+D', 'Duplicate selection'],
              ['⌘/Ctrl+G', 'Group selection'],
              ['Shift+⌘/Ctrl+G', 'Ungroup selection'],
              ['Delete', 'Delete selection'],
              ['Esc', 'Close overlay'],
              ['? / /', 'Toggle this help'],
              ['Alt+Drag', 'Pan canvas'],
              ['Space+Drag', 'Pan canvas'],
              ['Shift+Click', 'Add/remove selection'],
              ['Scroll', 'Zoom in/out'],
            ].map(([key, desc]) => (
              <div key={key} style={{
                fontFamily: 'monospace',
                fontSize: 11,
                color: '#a78bfa',
                background: 'rgba(124, 58, 237, 0.15)',
                border: '1px solid rgba(124, 58, 237, 0.3)',
                borderRadius: 4,
                padding: '2px 6px',
                textAlign: 'center',
                alignSelf: 'center',
              }}>{key}</div>
              )
            )}
            {[
              ['Select tool'],
              ['Draw (Stroke)'],
              ['Rectangle'],
              ['Ellipse'],
              ['Line'],
              ['Arrow connector'],
              ['Frame'],
              ['Text'],
              ['Upload Image'],
              ['Sticky Note'],
              ['Eraser'],
              ['Toggle Chat'],
              ['Undo'],
              ['Redo'],
              ['Duplicate selection'],
              ['Group selection'],
              ['Ungroup selection'],
              ['Delete selection'],
              ['Close overlay'],
              ['Toggle this help'],
              ['Pan canvas'],
              ['Pan canvas'],
              ['Add/remove selection'],
              ['Zoom in/out'],
            ].map((desc, i) => (
              <div key={i} style={{ color: '#8888a8', padding: '2px 0', alignSelf: 'center' }}>{desc}</div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: '#555570', textAlign: 'center' }}>
            Press <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: 3, color: '#a78bfa' }}>Esc</kbd> or <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: 3, color: '#a78bfa' }}>?</kbd> to close
          </div>
        </div>
      )}
    </div>
  );
}

// ── Zoom button style ────────────────────────────────────────────────────────

const NOTE_COLORS = ['#fef3c7', '#fce7f3', '#dbeafe', '#d1fae5', '#fee2e2', '#f3e8ff'];

function contrastColor(hex: string): string {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return '#1e293b';
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#1e293b' : '#ffffff';
}

function sortByLayer(shapes: Shape[]): Shape[] {
  return shapes.map((shape, index) => ({ shape, index }))
    .sort((a, b) => (a.shape.data.zIndex ?? a.index) - (b.shape.data.zIndex ?? b.index) || a.index - b.index)
    .map(({ shape }) => shape);
}

function buildHitTestIndex(shapes: Shape[], boundsById: Map<string, { minX: number; minY: number; maxX: number; maxY: number }>) {
  const cellSize = 256;
  const ordered = sortByLayer(shapes.filter(shape => !shape.deleted));
  const rank = new Map(ordered.map((shape, index) => [shape, index]));
  const cells = new Map<string, Shape[]>();
  const oversized: Shape[] = [];
  for (const shape of ordered) {
    const bounds = boundsById.get(shape.id) ?? shapeBBox(shape);
    const minX = Math.floor(bounds.minX / cellSize);
    const maxX = Math.floor(bounds.maxX / cellSize);
    const minY = Math.floor(bounds.minY / cellSize);
    const maxY = Math.floor(bounds.maxY / cellSize);
    if ((maxX - minX + 1) * (maxY - minY + 1) > 64) {
      oversized.push(shape);
      continue;
    }
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${x}:${y}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(shape);
        else cells.set(key, [shape]);
      }
    }
  }

  return (x: number, y: number, radius: number): Shape[] => {
    const minX = Math.floor((x - radius) / cellSize);
    const maxX = Math.floor((x + radius) / cellSize);
    const minY = Math.floor((y - radius) / cellSize);
    const maxY = Math.floor((y + radius) / cellSize);
    const candidates = new Set<Shape>(oversized);
    for (let cellX = minX; cellX <= maxX; cellX++) {
      for (let cellY = minY; cellY <= maxY; cellY++) {
        for (const shape of cells.get(`${cellX}:${cellY}`) ?? []) candidates.add(shape);
      }
    }
    return [...candidates].sort((a, b) => rank.get(a)! - rank.get(b)!);
  };
}

function snapWorldPoint(point: { x: number; y: number }, gridSize = 32) {
  return { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize };
}

const zoomBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  background: 'rgba(15, 15, 22, 0.9)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#c4b5fd',
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backdropFilter: 'blur(8px)',
  transition: 'all 0.15s',
};

// Separate component for zoom — intentionally removed; toolbar zoom buttons
// call onZoomChange directly and the canvas wheel handler updates transformRef.
