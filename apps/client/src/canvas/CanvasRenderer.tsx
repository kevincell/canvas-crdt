/**
 * Canvas renderer — HTML5 Canvas with pan/zoom, shape drawing,
 * cursor awareness, selection handles, eraser, and merge history playback.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  type Shape,
  type Conflict,
  type AmbiguityLevel,
  ShapeKind,
  shapeCenter,
  shapeBBox,
} from '@crdt-canvas/engine';

export interface CanvasRenderProps {
  shapes: Shape[];
  conflicts: Conflict[];
  remoteCursors: Map<string, { x: number; y: number; color: string; name: string }>;
  history: { playback: (step: number) => Shape[]; totalSteps: number } | null;
  historyStep: number;
  isPlaying: boolean;
  tool: 'stroke' | 'rect' | 'ellipse' | 'line' | 'text' | 'image' | 'note' | 'select' | 'eraser';
  activeColor: string;
  strokeWidth: number;
  scale: number;
  // callbacks
  onStrokeEnd: (points: { x: number; y: number }[], color: string, width: number) => void;
  onRectEnd: (x: number, y: number, w: number, h: number, color: string) => void;
  onEllipseEnd: (cx: number, cy: number, rx: number, ry: number, color: string) => void;
  onLineEnd: (x1: number, y1: number, x2: number, y2: number, color: string, width: number) => void;
  onTextSubmit: (x: number, y: number, text: string, color: string) => void;
  onImageAdd: (x: number, y: number, w: number, h: number, src: string) => void;
  onNoteAdd: (x: number, y: number, text: string, color: string, bgColor: string) => void;
  onDelete?: (id: string) => void;
  onShapeMoved?: (id: string, dx: number, dy: number, skipHistory?: boolean) => void;
  onShapeResized?: (id: string, data: Partial<any>, op?: 'resize' | 'move' | 'update', skipHistory?: boolean) => void;
  onShapeHistoryCommit?: (id: string, prevData: any) => void;
  onZoomChange?: (scale: number) => void;
  onImageDrop: (x: number, y: number, w: number, h: number, src: string) => void;
  onCursorMove?: (x: number, y: number) => void;
}

export function CanvasRenderer({
  shapes,
  conflicts,
  remoteCursors,
  history,
  historyStep,
  isPlaying,
  tool,
  activeColor,
  strokeWidth,
  scale,
  onStrokeEnd,
  onRectEnd,
  onEllipseEnd,
  onLineEnd,
  onTextSubmit,
  onImageAdd,
  onNoteAdd,
  onDelete,
  onShapeMoved,
  onShapeResized,
  onShapeHistoryCommit,
  onZoomChange,
  onImageDrop,
  onCursorMove,
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
  const [dragHandle, setDragHandle] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; offX: number; offY: number } | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartDataRef = useRef<any>(null);

  // Text / note input overlay
  const [textOverlay, setTextOverlay] = useState<{
    mode: 'text' | 'note';
    x: number;
    y: number;
    color: string;
    bgColor: string;
    value: string;
  } | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Drag-and-drop image overlay
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragOverPos, setDragOverPos] = useState<{ x: number; y: number } | null>(null);

  // Keyboard shortcut help
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Refs for latest props (avoid stale closures)
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
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
  // Keep scale in sync with prop
  useEffect(() => {
    transformRef.current.scale = scale;
  }, [scale]);

  // ── Render ────────────────────────────────────────────────────────────────

  const rafIdRef = useRef<number | null>(null);

  const render = useCallback(() => {
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const { scale: s, offset } = transformRef.current;

    // Background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 10, 10, 0.6)';
    ctx.fillRect(0, 0, w, h);

    // Grid
    drawGrid(ctx, w, h, s, offset);

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(s, s);

    const conflictSet = new Set(conflicts.map(c => c.shapeId));
    const conflictLevelMap = new Map(conflicts.map(c => [c.shapeId, c.level]));
    const CONFLICT_COLORS: Record<AmbiguityLevel, string> = {
      none: 'transparent',
      low: 'rgba(245, 158, 11, 0.25)',
      medium: 'rgba(239, 68, 68, 0.25)',
      high: 'rgba(239, 68, 68, 0.5)',
    };

    const renderShapes = (history && (isPlaying || (historyStep > 0 && historyStep < history.totalSteps)))
      ? history.playback(historyStep)
      : shapes;

    // Conflict highlights
    for (const shape of renderShapes) {
      const level = conflictLevelMap.get(shape.id);
      if (level && level !== 'none') {
        const bbox = shapeBBox(shape);
        ctx.fillStyle = CONFLICT_COLORS[level];
        ctx.fillRect(bbox.minX - 6, bbox.minY - 6, bbox.maxX - bbox.minX + 12, bbox.maxY - bbox.minY + 12);
      }
    }

    // Shapes
    for (const shape of renderShapes) {
      if (shape.deleted) continue;
      const d = shape.data;
      const isSel = selectedIdRef.current === shape.id;
      const isConflict = conflictSet.has(shape.id);

      if (d.kind === ShapeKind.Stroke && d.points?.length >= 2) {
        ctx.strokeStyle = d.color;
        ctx.lineWidth = ((d.width as number) ?? strokeWidthRef.current) / scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isConflict) ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.beginPath();
        ctx.moveTo(d.points[0].x, d.points[0].y);
        for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (d.kind === ShapeKind.Rect) {
        ctx.fillStyle = d.color + '22';
        ctx.strokeStyle = d.color;
        ctx.lineWidth = (isSel ? 2 : 1.5) / scale;
        if (isConflict) ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.strokeRect(d.x, d.y, d.w, d.h);
        ctx.setLineDash([]);
      }

      if (d.kind === ShapeKind.Ellipse) {
        ctx.fillStyle = d.color + '22';
        ctx.strokeStyle = d.color;
        ctx.lineWidth = (isSel ? 2 : 1.5) / scale;
        if (isConflict) ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.beginPath();
        ctx.ellipse(d.cx, d.cy, d.rx, d.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (d.kind === ShapeKind.Line) {
        ctx.strokeStyle = d.color;
        ctx.lineWidth = ((d.width as number) ?? strokeWidthRef.current) / scale;
        ctx.lineCap = 'round';
        if (isConflict) ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.beginPath();
        ctx.moveTo(d.x1, d.y1);
        ctx.lineTo(d.x2, d.y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (d.kind === ShapeKind.Text) {
        ctx.fillStyle = d.color;
        ctx.font = `bold ${14 / scale}px Inter, sans-serif`;
        ctx.fillText(d.text, d.x, d.y);
      }

      if (d.kind === ShapeKind.Image) {
        const img = imageCacheRef.current.get(d.src);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, d.x, d.y, d.w, d.h);
        } else {
          // Draw placeholder while loading
          ctx.fillStyle = '#1e1e2e';
          ctx.fillRect(d.x, d.y, d.w, d.h);
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1 / scale;
          ctx.strokeRect(d.x, d.y, d.w, d.h);
          ctx.fillStyle = '#3b82f6';
          ctx.font = `${12 / scale}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🖼 Image', d.x + d.w / 2, d.y + d.h / 2 + 4 / scale);
          ctx.textAlign = 'left';
          // Load image
          const img2 = new Image();
          img2.crossOrigin = 'anonymous';
          img2.onload = () => {
            imageCacheRef.current.set(d.src, img2);
            render();
          };
          img2.src = d.src;
        }
      }

      if (d.kind === ShapeKind.Note) {
        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 8 / scale;
        ctx.shadowOffsetY = 3 / scale;

        // Note background
        ctx.fillStyle = d.bgColor || '#fef3c7';
        roundRect(ctx, d.x, d.y, d.w, d.h, 4 / scale);
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // Top accent bar
        ctx.fillStyle = shadeColor(d.bgColor || '#fef3c7', -30);
        ctx.fillRect(d.x, d.y, d.w, 4 / scale);

        // Text
        const fontSize = 13 / scale;
        ctx.fillStyle = d.color || '#1e293b';
        ctx.font = `${fontSize}px Inter, sans-serif`;
        const lines = wrapText(ctx, d.text, d.w - 12 / scale, fontSize);
        let lineY = d.y + 16 / scale;
        for (const line of lines) {
          ctx.fillText(line, d.x + 6 / scale, lineY);
          lineY += fontSize + 3 / scale;
        }
      }

      // Selection
      if (isSel) {
        const b = shapeBBox(shape);
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = 1.5 / scale;
        ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.strokeRect(b.minX - 4, b.minY - 4, b.maxX - b.minX + 8, b.maxY - b.minY + 8);
        ctx.setLineDash([]);
        // Handles
        const handles = [
          { x: b.minX, y: b.minY },
          { x: b.maxX, y: b.minY },
          { x: b.minX, y: b.maxY },
          { x: b.maxX, y: b.maxY },
        ];
        for (const h of handles) {
          ctx.fillStyle = '#7c3aed';
          ctx.beginPath();
          ctx.arc(h.x, h.y, 4 / scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Live drawing preview
    const draw = drawingRef.current;
    if (draw.active && draw.currentPoints.length >= 2) {
      const pts = draw.currentPoints;
      const t = toolRef.current;
      const c = activeColorRef.current;
      const sw = strokeWidthRef.current;

      if (t === 'stroke' || t === 'eraser') {
        ctx.strokeStyle = c;
        ctx.lineWidth = sw / scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      } else if (t === 'line' && draw.startPoint) {
        ctx.strokeStyle = c;
        ctx.lineWidth = sw / scale;
        ctx.beginPath();
        ctx.moveTo(draw.startPoint.x, draw.startPoint.y);
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
      } else if ((t === 'rect' || t === 'ellipse') && draw.startPoint) {
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.5 / scale;
        ctx.setLineDash([4 / scale, 4 / scale]);
        const sx = draw.startPoint.x, sy = draw.startPoint.y;
        const ex = pts[pts.length - 1].x, ey = pts[pts.length - 1].y;
        if (t === 'rect') {
          ctx.strokeRect(sx, sy, ex - sx, ey - sy);
        } else {
          ctx.beginPath();
          ctx.ellipse((sx + ex) / 2, (sy + ey) / 2, Math.abs(ex - sx) / 2, Math.abs(ey - sy) / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // Remote cursors
    for (const [clientID, cursor] of remoteCursors) {
      drawCursor(ctx, cursor.x, cursor.y, cursor.color, cursor.name);
    }

    ctx.restore();

    // History overlay
    if (history) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(10, 10, 185, 26);
      ctx.fillStyle = '#c4b5fd';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(`📜 History: ${historyStep}/${history.totalSteps}`, 18, 28);
    }
    });
  }, [shapes, conflicts, remoteCursors, history, historyStep, scale]);

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
        if (textOverlay.mode === 'note') {
          textareaRef.current?.focus();
        } else {
          textInputRef.current?.focus();
        }
      }, 50);
    }
  }, [textOverlay]);

  // ── Keyboard shortcut help ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShowShortcuts(v => !v);
      }
      if (e.key === 'Escape') setShowShortcuts(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

  const getWorldPos = useCallback((e: React.MouseEvent) => {
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
    if (!selectedIdRef.current) return null;
    const shape = shapesRef.current.find(s => s.id === selectedIdRef.current && !s.deleted);
    if (!shape) return null;
    const b = shapeBBox(shape);
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
  }, []);

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getWorldPos(e);

    // Middle mouse or Alt+left = pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, offX: transformRef.current.offset.x, offY: transformRef.current.offset.y });
      return;
    }

    if (e.button !== 0) return;

    const t = toolRef.current;

    if (t === 'select') {
      const handle = getHandleAt(pos);
      if (handle !== null) {
        setDragHandle(handle);
        const shape = shapesRef.current.find(s => s.id === selectedIdRef.current && !s.deleted);
        if (shape) {
          dragOffsetRef.current = { x: pos.x, y: pos.y };
          dragStartDataRef.current = { ...shape.data };
        }
        return;
      }
      let hit: Shape | null = null;
      for (let i = shapesRef.current.length - 1; i >= 0; i--) {
        const s = shapesRef.current[i];
        if (s.deleted) continue;
        const b = shapeBBox(s);
        if (pos.x >= b.minX - 8 && pos.x <= b.maxX + 8 && pos.y >= b.minY - 8 && pos.y <= b.maxY + 8) {
          hit = s;
          break;
        }
      }
      if (hit) {
        setSelectedId(hit.id);
        dragOffsetRef.current = { x: pos.x, y: pos.y };
        dragStartDataRef.current = { ...hit.data };
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (t === 'eraser') {
      for (let i = shapesRef.current.length - 1; i >= 0; i--) {
        const s = shapesRef.current[i];
        if (s.deleted) continue;
        const b = shapeBBox(s);
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
      const noteW = 200;
      const noteH = 150;
      setTextOverlay({ mode: 'note', x: pos.x, y: pos.y, color: '#1e293b', bgColor: '#fef3c7', value: '' });
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
  }, [getWorldPos, getHandleAt, onDelete]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
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
      const b = shapeBBox(shape);
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

      if (shape.kind === ShapeKind.Rect || shape.kind === ShapeKind.Image) {
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
        const isX1Left = shape.data.x1 <= shape.data.x2;
        const isY1Top = shape.data.y1 <= shape.data.y2;
        newData.x1 = isX1Left ? newBBox.minX : newBBox.maxX;
        newData.x2 = isX1Left ? newBBox.maxX : newBBox.minX;
        newData.y1 = isY1Top ? newBBox.minY : newBBox.maxY;
        newData.y2 = isY1Top ? newBBox.maxY : newBBox.minY;
      } else if (shape.kind === ShapeKind.Stroke) {
        newData.points = shape.data.points.map((p: any) => ({
          x: newBBox.minX + (p.x - b.minX) * scaleX,
          y: newBBox.minY + (p.y - b.minY) * scaleY
        }));
      } else if (shape.kind === ShapeKind.Text || shape.kind === ShapeKind.Note) {
        newData.x = newBBox.minX;
        newData.y = newBBox.minY;
      }

      onShapeResized?.(selectedIdRef.current, newData, 'resize', true);
      dragOffsetRef.current = { x: pos.x, y: pos.y };
      render();
      return;
    }

    // Drag shape
    if (selectedIdRef.current && (e.buttons & 1) && toolRef.current === 'select' && dragOffsetRef.current) {
      const dx = pos.x - dragOffsetRef.current.x;
      const dy = pos.y - dragOffsetRef.current.y;
      onShapeMoved?.(selectedIdRef.current, dx, dy, true);
      dragOffsetRef.current = { x: pos.x, y: pos.y };
      render();
      return;
    }

    // Live drawing
    if (drawingRef.current.active) {
      drawingRef.current.currentPoints.push(pos);
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
        const hit = shapesRef.current.some(s => {
          if (s.deleted) return false;
          const b = shapeBBox(s);
          return pos.x >= b.minX - 8 && pos.x <= b.maxX + 8 && pos.y >= b.minY - 8 && pos.y <= b.maxY + 8;
        });
        const cvs2 = canvasRef.current;
        if (cvs2) cvs2.style.cursor = hit ? 'move' : 'default';
      }
    } else {
      const cvs3 = canvasRef.current;
      if (cvs3) cvs3.style.cursor = toolRef.current === 'eraser' ? 'crosshair' : 'crosshair';
    }
  }, [isPanning, panStart, dragHandle, getWorldPos, getHandleAt, onShapeMoved, onShapeResized, render]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const pos = getWorldPos(e);

    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    if (dragHandle !== null) {
      if (selectedIdRef.current && dragStartDataRef.current) {
        onShapeHistoryCommit?.(selectedIdRef.current, dragStartDataRef.current);
      }
      setDragHandle(null);
      dragStartDataRef.current = null;
      return;
    }

    if (dragOffsetRef.current && selectedIdRef.current && toolRef.current === 'select') {
      if (dragStartDataRef.current) {
        onShapeHistoryCommit?.(selectedIdRef.current, dragStartDataRef.current);
      }
      dragOffsetRef.current = null;
      dragStartDataRef.current = null;
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
    } else if (t === 'line' && draw.startPoint) {
      const last = draw.currentPoints[draw.currentPoints.length - 1];
      if (last) onLineEnd(draw.startPoint.x, draw.startPoint.y, last.x, last.y, c, sw);
    } else if (t === 'rect' && draw.startPoint) {
      const last = draw.currentPoints[draw.currentPoints.length - 1];
      if (last) {
        const x = Math.min(draw.startPoint.x, last.x);
        const y = Math.min(draw.startPoint.y, last.y);
        const w = Math.abs(last.x - draw.startPoint.x);
        const h = Math.abs(last.y - draw.startPoint.y);
        if (w > 3 && h > 3) onRectEnd(x, y, w, h, c);
      }
    } else if (t === 'ellipse' && draw.startPoint) {
      const last = draw.currentPoints[draw.currentPoints.length - 1];
      if (last) {
        const cx = (draw.startPoint.x + last.x) / 2;
        const cy = (draw.startPoint.y + last.y) / 2;
        const rx = Math.abs(last.x - draw.startPoint.x) / 2;
        const ry = Math.abs(last.y - draw.startPoint.y) / 2;
        if (rx > 3 && ry > 3) onEllipseEnd(cx, cy, rx, ry, c);
      }
    }

    drawingRef.current = { active: false, kind: null, startPoint: null, currentPoints: [] };
    render();
  }, [getWorldPos, isPanning, dragHandle, onStrokeEnd, onLineEnd, onRectEnd, onEllipseEnd, render]);

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
    const val = textInputRef.current?.value.trim();
    if (val && textOverlay && textOverlay.mode === 'text') {
      onTextSubmit(textOverlay.x, textOverlay.y, val, textOverlay.color);
    }
    setTextOverlay(null);
  }, [textOverlay, onTextSubmit]);

  const handleNoteSubmit = useCallback(() => {
    const val = textareaRef.current?.value.trim() || textOverlay?.value.trim();
    if (val && textOverlay && textOverlay.mode === 'note') {
      onNoteAdd(textOverlay.x, textOverlay.y, val, textOverlay.color, textOverlay.bgColor);
    }
    setTextOverlay(null);
  }, [textOverlay, onNoteAdd]);

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
        if (!file.type.startsWith('image/')) return;
        const pos = getWorldPosForDrag(e);
        const reader = new FileReader();
        reader.onload = ev => {
          const src = ev.target?.result as string;
          if (!src) return;
          const img = new Image();
          img.onload = () => {
            let w = img.naturalWidth;
            let h = img.naturalHeight;
            const maxW = 600, maxH = 400;
            if (w > maxW || h > maxH) {
              const ratio = Math.min(maxW / w, maxH / h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            onImageDrop(pos.x - w / 2, pos.y - h / 2, w, h, src);
          };
          img.src = src;
        };
        reader.readAsDataURL(file);
      }}
    >
      {/* Tool hint label */}
      <div style={{
        position: 'absolute',
        top: 12,
        left: 16,
        padding: '4px 10px',
        background: 'rgba(15, 15, 22, 0.85)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        fontSize: 11,
        color: '#8888a8',
        zIndex: 90,
        backdropFilter: 'blur(8px)',
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
        <span style={{ fontWeight: 600, color: '#c4b5fd', textTransform: 'capitalize' }}>{tool}</span>
        <span style={{ color: '#555570' }}>·</span>
        <span>{Math.round(scale * 100)}%</span>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Text / Note input overlay */}
      {textOverlay && textOverlay.mode === 'text' && (
        <input
          ref={textInputRef}
          type="text"
          value={textOverlay.value}
          onChange={e => setTextOverlay({ ...textOverlay, value: e.target.value })}
          onBlur={handleTextSubmit}
          onKeyDown={e => { if (e.key === 'Enter') handleTextSubmit(); if (e.key === 'Escape') setTextOverlay(null); }}
          placeholder="Type text…"
          style={{
            position: 'absolute',
            left: textOverlay.x * transformRef.current.scale + transformRef.current.offset.x,
            top: textOverlay.y * transformRef.current.scale + transformRef.current.offset.y,
            padding: '4px 8px',
            background: 'rgba(30, 30, 46, 0.97)',
            border: '1px solid rgba(124, 58, 237, 0.6)',
            borderRadius: 6,
            color: textOverlay.color,
            fontSize: 14,
            outline: 'none',
            minWidth: 120,
            zIndex: 50,
            fontFamily: 'Inter, sans-serif',
            boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}
        />
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
            onBlur={handleNoteSubmit}
            onKeyDown={e => {
              if (e.key === 'Escape') setTextOverlay(null);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleNoteSubmit();
            }}
            placeholder="Write a note…"
            style={{
              width: Math.round(200 * transformRef.current.scale),
              minHeight: Math.round(100 * transformRef.current.scale),
              padding: '8px 10px',
              background: 'rgba(30, 30, 46, 0.97)',
              border: '1px solid rgba(124, 58, 237, 0.6)',
              borderRadius: '0 0 8px 8px',
              color: '#e2e2f0',
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
                onClick={() => setTextOverlay({ ...textOverlay, bgColor: c })}
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
        <button
          onClick={() => {
            const s = transformRef.current.scale;
            const newScale = Math.min(10, s * 1.25);
            transformRef.current.scale = newScale;
            onZoomChange(newScale);
            render();
          }}
          title="Zoom in"
          style={zoomBtnStyle as any}
        >+</button>
        <button
          onClick={() => {
            transformRef.current.scale = 1;
            onZoomChange(1);
            render();
          }}
          title="Reset zoom"
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
          title="Zoom out"
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
              ['T', 'Text'],
              ['I', 'Upload Image'],
              ['N', 'Sticky Note'],
              ['X', 'Eraser'],
              ['C', 'Toggle Chat'],
              ['⌘/Ctrl+Z', 'Undo'],
              ['⌘/Ctrl+Y', 'Redo'],
              ['Esc', 'Close overlay'],
              ['? / /', 'Toggle this help'],
              ['Alt+Drag', 'Pan canvas'],
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
              ['Text'],
              ['Upload Image'],
              ['Sticky Note'],
              ['Eraser'],
              ['Toggle Chat'],
              ['Undo'],
              ['Redo'],
              ['Close overlay'],
              ['Toggle this help'],
              ['Pan canvas'],
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
