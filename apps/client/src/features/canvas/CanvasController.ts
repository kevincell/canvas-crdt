import {
  type Shape,
  type Conflict,
  type AmbiguityLevel,
  ShapeKind,
  shapeBBox,
  attachedLineEndpoints,
} from '@crdt-canvas/engine';

export interface CanvasControllerProps {
  shapes: Shape[];
  conflicts: Conflict[];
  remoteCursors: Map<string, { x: number; y: number; color: string; name: string }>;
  remoteLasers?: Map<string, { points: { x: number; y: number }[]; color: string }>;
  commentPins: Array<{ x: number; y: number }>;
  history: { playback: (step: number) => Shape[]; totalSteps: number } | null;
  historyStep: number;
  isPlaying: boolean;
  tool: string;
  activeColor: string;
  strokeWidth: number;
  fillOpacity: number;
  cornerRadius: number;
  showGrid: boolean;
  voteMode: boolean;
  voteCounts: Map<string, number>;
  scale: number;
  transform: { scale: number; offset: { x: number; y: number } };
  drawing: {
    active: boolean;
    kind: string | null;
    startPoint: { x: number; y: number } | null;
    currentPoints: { x: number; y: number }[];
  };
  selectedId: string | null;
  selectedIds: string[];
  highlightShapeId?: string | null;
  alignmentGuides: Array<{ x1: number; y1: number; x2: number; y2: number; kind: 'alignment' | 'spacing'; label?: string }>;
  imageCache: Map<string, HTMLImageElement>;
  onImageLoad: () => void;
}

export class CanvasController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId: number | null = null;
  private props: CanvasControllerProps | null = null;
  private cachedShapeSource: Shape[] | null = null;
  private cachedOrderedShapes: Shape[] = [];
  private boundsCache = new WeakMap<Shape, { minX: number; minY: number; maxX: number; maxY: number }>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2d context');
    this.ctx = ctx;
  }

  public setProps(props: CanvasControllerProps) {
    this.props = props;
  }

  public requestRender() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => this.render());
  }

  public render() {
    this.rafId = null;
    if (!this.props) return;
    const { props, ctx, canvas } = this;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const { scale: s, offset } = props.transform;

    // Background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 10, 10, 0.6)';
    ctx.fillRect(0, 0, w, h);

    if (props.showGrid) this.drawGrid(w, h, s, offset);

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(s, s);

    const conflictSet = new Set(props.conflicts.map(c => c.shapeId));
    const conflictLevelMap = new Map(props.conflicts.map(c => [c.shapeId, c.level]));
    const CONFLICT_COLORS: Record<AmbiguityLevel, string> = {
      none: 'transparent',
      low: 'rgba(245, 158, 11, 0.25)',
      medium: 'rgba(239, 68, 68, 0.25)',
      high: 'rgba(239, 68, 68, 0.5)',
    };

    const renderShapes = (props.history && (props.isPlaying || (props.historyStep > 0 && props.historyStep < props.history.totalSteps)))
      ? props.history.playback(props.historyStep)
      : props.shapes;
    let orderedShapes: Shape[];
    if (renderShapes === props.shapes) {
      if (this.cachedShapeSource !== renderShapes) {
        this.cachedShapeSource = renderShapes;
        this.cachedOrderedShapes = renderShapes.map((shape, index) => ({ shape, index }))
          .sort((a, b) => (a.shape.data.zIndex ?? a.index) - (b.shape.data.zIndex ?? b.index) || a.index - b.index)
          .map(({ shape }) => shape);
      }
      orderedShapes = this.cachedOrderedShapes;
    } else {
      orderedShapes = renderShapes.map((shape, index) => ({ shape, index }))
        .sort((a, b) => (a.shape.data.zIndex ?? a.index) - (b.shape.data.zIndex ?? b.index) || a.index - b.index)
        .map(({ shape }) => shape);
    }

    // Only paint objects touching the viewport. The small world-space margin
    // keeps stroke edges and selection borders from popping at the boundary.
    const margin = 64 / Math.max(s, 0.1);
    const viewport = {
      minX: -offset.x / s - margin,
      minY: -offset.y / s - margin,
      maxX: (w - offset.x) / s + margin,
      maxY: (h - offset.y) / s + margin,
    };
    const targetShapes = new Map(renderShapes.filter(shape => !shape.deleted).map(shape => [shape.id, shape]));
    const resolvedShapes = orderedShapes.map(shape => {
      if (shape.data.kind !== ShapeKind.Line || (!shape.data.startShapeId && !shape.data.endShapeId)) return shape;
      const endpoints = attachedLineEndpoints(shape.data, targetShapes);
      if (endpoints.start.x === shape.data.x1 && endpoints.start.y === shape.data.y1 && endpoints.end.x === shape.data.x2 && endpoints.end.y === shape.data.y2) return shape;
      return { ...shape, data: { ...shape.data, x1: endpoints.start.x, y1: endpoints.start.y, x2: endpoints.end.x, y2: endpoints.end.y } };
    });
    const visibleShapes = resolvedShapes.filter(shape => {
      if (shape.deleted) return false;
      let bounds = this.boundsCache.get(shape);
      if (!bounds) {
        bounds = shapeBBox(shape);
        this.boundsCache.set(shape, bounds);
      }
      return bounds.maxX >= viewport.minX && bounds.minX <= viewport.maxX
        && bounds.maxY >= viewport.minY && bounds.minY <= viewport.maxY;
    });

    // Conflict highlights
    for (const shape of visibleShapes) {
      const level = conflictLevelMap.get(shape.id);
      if (level && level !== 'none') {
        const bbox = shapeBBox(shape);
        ctx.fillStyle = CONFLICT_COLORS[level];
        ctx.fillRect(bbox.minX - 6, bbox.minY - 6, bbox.maxX - bbox.minX + 12, bbox.maxY - bbox.minY + 12);
      }
    }

    // Shapes
    for (const shape of visibleShapes) {
      const d = shape.data;
      const isSel = props.selectedIds.includes(shape.id) || props.selectedId === shape.id;
      const isConflict = conflictSet.has(shape.id);

      if (d.kind === ShapeKind.Stroke && d.points?.length >= 2) {
        ctx.strokeStyle = d.color;
        ctx.lineWidth = ((d.width as number) ?? props.strokeWidth) / s;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isConflict) ctx.setLineDash([4 / s, 4 / s]);
        ctx.beginPath();
        ctx.moveTo(d.points[0].x, d.points[0].y);
        for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (d.kind === ShapeKind.Rect) {
        ctx.fillStyle = this.withAlpha(d.color, d.fillOpacity ?? 0.13);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = (isSel ? 2 : (d.strokeWidth ?? props.strokeWidth)) / s;
        if (d.frameTitle) ctx.setLineDash([8 / s, 5 / s]);
        else if (isConflict) ctx.setLineDash([4 / s, 4 / s]);
        if ((d.cornerRadius ?? 0) > 0) {
          this.roundRect(d.x, d.y, d.w, d.h, (d.cornerRadius ?? 0) / s);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(d.x, d.y, d.w, d.h);
          ctx.strokeRect(d.x, d.y, d.w, d.h);
        }
        ctx.setLineDash([]);
        if (d.frameTitle) {
          ctx.fillStyle = d.color;
          ctx.font = `600 ${14 / s}px Inter, sans-serif`;
          ctx.textBaseline = 'bottom';
          ctx.fillText(d.frameTitle, d.x, d.y - 5 / s);
          ctx.textBaseline = 'alphabetic';
        }
      }

      if (d.kind === ShapeKind.Ellipse) {
        ctx.fillStyle = this.withAlpha(d.color, d.fillOpacity ?? 0.13);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = (isSel ? 2 : (d.strokeWidth ?? props.strokeWidth)) / s;
        if (isConflict) ctx.setLineDash([4 / s, 4 / s]);
        ctx.beginPath();
        ctx.ellipse(d.cx, d.cy, d.rx, d.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (d.kind === ShapeKind.Line) {
        ctx.strokeStyle = d.color;
        ctx.lineWidth = ((d.width as number) ?? props.strokeWidth) / s;
        ctx.lineCap = 'round';
        if (isConflict) ctx.setLineDash([4 / s, 4 / s]);
        ctx.beginPath();
        ctx.moveTo(d.x1, d.y1);
        ctx.lineTo(d.x2, d.y2);
        ctx.stroke();
        if (d.arrowEnd) this.drawArrowHead(d.x1, d.y1, d.x2, d.y2, 12 / s);
        ctx.setLineDash([]);
      }

      if (d.kind === ShapeKind.Text) {
        ctx.fillStyle = d.color;
        ctx.font = `500 16px Inter, sans-serif`;
        ctx.textBaseline = 'top';
        d.text.split('\n').forEach((line, index) => ctx.fillText(line, d.x, d.y - 16 + index * 20));
        ctx.textBaseline = 'alphabetic';
      }

      if (d.kind === ShapeKind.Image) {
        const img = props.imageCache.get(d.src);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, d.x, d.y, d.w, d.h);
        } else {
          ctx.fillStyle = '#1e1e2e';
          ctx.fillRect(d.x, d.y, d.w, d.h);
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1 / s;
          ctx.strokeRect(d.x, d.y, d.w, d.h);
          ctx.fillStyle = '#3b82f6';
          ctx.font = `${12 / s}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🖼 Image', d.x + d.w / 2, d.y + d.h / 2 + 4 / s);
          ctx.textAlign = 'left';
          
          if (!props.imageCache.has(d.src)) {
            const img2 = new Image();
            img2.crossOrigin = 'anonymous';
            img2.onload = () => {
              props.imageCache.set(d.src, img2);
              props.onImageLoad();
            };
            img2.src = d.src;
            props.imageCache.set(d.src, img2);
          }
        }
      }

      if (d.kind === ShapeKind.Note) {
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 8 / s;
        ctx.shadowOffsetY = 3 / s;
        ctx.fillStyle = d.bgColor || '#fef3c7';
        this.roundRect(d.x, d.y, d.w, d.h, 4 / s);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = this.shadeColor(d.bgColor || '#fef3c7', -30);
        ctx.fillRect(d.x, d.y, d.w, 4 / s);
        const fontSize = 13 / s;
        ctx.fillStyle = d.color || '#1e293b';
        ctx.font = `${fontSize}px Inter, sans-serif`;
        const lines = this.wrapText(d.text, d.w - 12 / s, fontSize);
        let lineY = d.y + 16 / s;
        for (const line of lines) {
          ctx.fillText(line, d.x + 6 / s, lineY);
          lineY += fontSize + 3 / s;
        }
      }

      if (isSel) {
        const b = shapeBBox(shape);
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = props.strokeWidth / s;
        ctx.setLineDash([4 / s, 4 / s]);
        ctx.strokeRect(b.minX - 4, b.minY - 4, b.maxX - b.minX + 8, b.maxY - b.minY + 8);
        ctx.setLineDash([]);
        const handles = props.selectedIds.length > 1 ? [] : [
          { x: b.minX, y: b.minY },
          { x: b.maxX, y: b.minY },
          { x: b.minX, y: b.maxY },
          { x: b.maxX, y: b.maxY },
        ];
        for (const h of handles) {
          ctx.fillStyle = '#7c3aed';
          ctx.beginPath();
          ctx.arc(h.x, h.y, 4 / s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (d.locked) {
        const bounds = shapeBBox(shape);
        ctx.fillStyle = 'rgba(15, 15, 22, 0.88)';
        ctx.beginPath();
        ctx.arc(bounds.maxX - 4 / s, bounds.minY + 4 / s, 8 / s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f8fafc';
        ctx.font = `${10 / s}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔒', bounds.maxX - 4 / s, bounds.minY + 4 / s);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
      const voteCount = props.voteCounts.get(shape.id) ?? 0;
      if (voteCount > 0) {
        const bounds = shapeBBox(shape);
        const badgeWidth = 30 / s;
        const badgeHeight = 19 / s;
        const badgeX = bounds.maxX - badgeWidth / 2;
        const badgeY = bounds.minY - badgeHeight / 2;
        ctx.fillStyle = props.voteMode ? '#7c3aed' : '#713f12';
        this.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 7 / s);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${10 / s}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`● ${voteCount}`, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }

      if (props.highlightShapeId === shape.id) {
        const bounds = shapeBBox(shape);
        const pad = 10 / s;
        ctx.save();
        ctx.shadowColor = '#ec4899';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 3 / s;
        this.roundRect(bounds.minX - pad, bounds.minY - pad, bounds.maxX - bounds.minX + pad * 2, bounds.maxY - bounds.minY + pad * 2, 8 / s);
        ctx.stroke();
        ctx.fillStyle = 'rgba(244, 63, 94, 0.12)';
        ctx.fill();
        ctx.restore();

        // Corner beacon accents
        ctx.save();
        ctx.strokeStyle = '#fda4af';
        ctx.lineWidth = 2.5 / s;
        const cornerLen = Math.min(16 / s, Math.max(6 / s, (bounds.maxX - bounds.minX) / 4));
        ctx.beginPath();
        ctx.moveTo(bounds.minX - pad, bounds.minY - pad + cornerLen);
        ctx.lineTo(bounds.minX - pad, bounds.minY - pad);
        ctx.lineTo(bounds.minX - pad + cornerLen, bounds.minY - pad);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bounds.maxX + pad - cornerLen, bounds.minY - pad);
        ctx.lineTo(bounds.maxX + pad, bounds.minY - pad);
        ctx.lineTo(bounds.maxX + pad, bounds.minY - pad + cornerLen);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bounds.minX - pad, bounds.maxY + pad - cornerLen);
        ctx.lineTo(bounds.minX - pad, bounds.maxY + pad);
        ctx.lineTo(bounds.minX - pad + cornerLen, bounds.maxY + pad);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bounds.maxX + pad - cornerLen, bounds.maxY + pad);
        ctx.lineTo(bounds.maxX + pad, bounds.maxY + pad);
        ctx.lineTo(bounds.maxX + pad, bounds.maxY + pad - cornerLen);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (props.alignmentGuides.length) {
      ctx.save();
      for (const guide of props.alignmentGuides) {
        ctx.strokeStyle = guide.kind === 'spacing' ? 'rgba(251, 191, 36, 0.95)' : 'rgba(52, 211, 153, 0.95)';
        ctx.fillStyle = guide.kind === 'spacing' ? '#fbbf24' : '#6ee7b7';
        ctx.lineWidth = (guide.kind === 'spacing' ? 1.5 : 1) / s;
        ctx.setLineDash(guide.kind === 'spacing' ? [] : [5 / s, 4 / s]);
        ctx.beginPath();
        ctx.moveTo(guide.x1, guide.y1);
        ctx.lineTo(guide.x2, guide.y2);
        if (guide.kind === 'spacing') {
          const horizontal = Math.abs(guide.y2 - guide.y1) < Math.abs(guide.x2 - guide.x1);
          const tick = 4 / s;
          if (horizontal) {
            ctx.moveTo(guide.x1, guide.y1 - tick); ctx.lineTo(guide.x1, guide.y1 + tick);
            ctx.moveTo(guide.x2, guide.y2 - tick); ctx.lineTo(guide.x2, guide.y2 + tick);
          } else {
            ctx.moveTo(guide.x1 - tick, guide.y1); ctx.lineTo(guide.x1 + tick, guide.y1);
            ctx.moveTo(guide.x2 - tick, guide.y2); ctx.lineTo(guide.x2 + tick, guide.y2);
          }
        }
        ctx.stroke();
        if (guide.label) {
          ctx.setLineDash([]);
          ctx.font = `600 ${10 / s}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(guide.label, (guide.x1 + guide.x2) / 2, (guide.y1 + guide.y2) / 2 - 8 / s);
        }
      }
      ctx.restore();
    }

    const draw = props.drawing;
    if (draw.active && draw.currentPoints.length >= 2) {
      const pts = draw.currentPoints;
      const t = props.tool;
      const c = props.activeColor;
      const sw = props.strokeWidth;

      if (t === 'stroke' || t === 'eraser' || t === 'laser') {
        ctx.strokeStyle = c;
        ctx.lineWidth = sw / s;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (t === 'laser') {
          ctx.shadowColor = c;
          ctx.shadowBlur = 10 / s;
        }
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        if (t === 'laser') {
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        }
      } else if ((t === 'line' || t === 'arrow') && draw.startPoint) {
        ctx.strokeStyle = c;
        ctx.lineWidth = sw / s;
        ctx.beginPath();
        ctx.moveTo(draw.startPoint.x, draw.startPoint.y);
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        if (t === 'arrow') this.drawArrowHead(draw.startPoint.x, draw.startPoint.y, pts[pts.length - 1].x, pts[pts.length - 1].y, 12 / s);
      } else if ((t === 'rect' || t === 'ellipse') && draw.startPoint) {
        ctx.strokeStyle = c;
        ctx.lineWidth = props.strokeWidth / s;
        ctx.setLineDash([4 / s, 4 / s]);
        ctx.fillStyle = this.withAlpha(c, props.fillOpacity);
        const sx = draw.startPoint.x, sy = draw.startPoint.y;
        const ex = pts[pts.length - 1].x, ey = pts[pts.length - 1].y;
        if (t === 'rect') {
          const x = Math.min(sx, ex), y = Math.min(sy, ey), w = Math.abs(ex - sx), h = Math.abs(ey - sy);
          if (props.cornerRadius > 0) {
            this.roundRect(x, y, w, h, props.cornerRadius / s);
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
          }
        } else {
          ctx.beginPath();
          ctx.ellipse((sx + ex) / 2, (sy + ey) / 2, Math.abs(ex - sx) / 2, Math.abs(ey - sy) / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse((sx + ex) / 2, (sy + ey) / 2, Math.abs(ex - sx) / 2, Math.abs(ey - sy) / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    if (props.remoteLasers) {
      for (const [clientID, laser] of props.remoteLasers) {
        if (!laser.points || laser.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(laser.points[0].x, laser.points[0].y);
        for (let i = 1; i < laser.points.length; i++) {
          ctx.lineTo(laser.points[i].x, laser.points[i].y);
        }
        ctx.strokeStyle = laser.color;
        ctx.lineWidth = 4 / s;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = laser.color;
        ctx.shadowBlur = 10 / s;
        ctx.stroke();
        ctx.shadowBlur = 0; // reset
      }
    }

    for (const [clientID, cursor] of props.remoteCursors) {
      this.drawCursor(cursor.x, cursor.y, cursor.color, cursor.name);
    }

    for (const pin of props.commentPins) {
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(pin.x, pin.y, 10 / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e1b15';
      ctx.font = `700 ${11 / s}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('C', pin.x, pin.y + 0.5 / s);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    ctx.restore();

    if (props.history) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(10, 10, 185, 26);
      ctx.fillStyle = '#c4b5fd';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(`📜 History: ${props.historyStep}/${props.history.totalSteps}`, 18, 28);
    }
  }

  private drawGrid(w: number, h: number, zoom: number, off: { x: number; y: number }) {
    const dotSpacing = 32;
    const dotRadius = Math.max(0.8 / zoom, 1.2);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    const startX = Math.floor(-off.x / dotSpacing / zoom) * dotSpacing;
    const startY = Math.floor(-off.y / dotSpacing / zoom) * dotSpacing;
    const endX = startX + w / zoom + dotSpacing * 2;
    const endY = startY + h / zoom + dotSpacing * 2;
    this.ctx.beginPath();
    for (let x = startX; x < endX; x += dotSpacing) {
      for (let y = startY; y < endY; y += dotSpacing) {
        this.ctx.rect(x - dotRadius / 2, y - dotRadius / 2, dotRadius, dotRadius);
      }
    }
    this.ctx.fill();
  }

  private drawCursor(x: number, y: number, color: string, name: string) {
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(0, 0);
    this.ctx.lineTo(0, 14);
    this.ctx.lineTo(4, 11);
    this.ctx.lineTo(9, 11);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    this.ctx.fillStyle = color;
    this.ctx.fillRect(10, 10, name.length * 7 + 10, 18);
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '10px Inter, sans-serif';
    this.ctx.fillText(name, 14, 23);
    this.ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.arcTo(x + w, y, x + w, y + h, r);
    this.ctx.arcTo(x + w, y + h, x, y + h, r);
    this.ctx.arcTo(x, y + h, x, y, r);
    this.ctx.arcTo(x, y, x + w, y, r);
    this.ctx.closePath();
  }

  private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      const words = paragraph.split(/\s+/);
      let currentLine = '';
      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (currentLine && this.ctx.measureText(candidate).width > maxWidth) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = candidate;
        }
      }
      lines.push(currentLine);
    }
    return lines;
  }

  private shadeColor(color: string, percent: number) {
    let R = parseInt(color.substring(1,3),16);
    let G = parseInt(color.substring(3,5),16);
    let B = parseInt(color.substring(5,7),16);
    R = Math.floor(R * (100 + percent) / 100);
    G = Math.floor(G * (100 + percent) / 100);
    B = Math.floor(B * (100 + percent) / 100);
    R = (R<255)?R:255;
    G = (G<255)?G:255;
    B = (B<255)?B:255;
    return `#${(R.toString(16).length==1?"0"+R.toString(16):R.toString(16))}${(G.toString(16).length==1?"0"+G.toString(16):G.toString(16))}${(B.toString(16).length==1?"0"+B.toString(16):B.toString(16))}`;
  }

  private withAlpha(color: string, alpha: number): string {
    const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
    if (!match) return color;
    const hex = match[1].length === 3
      ? match[1].split('').map(char => char + char).join('')
      : match[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private drawArrowHead(x1: number, y1: number, x2: number, y2: number, size: number) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    this.ctx.beginPath();
    this.ctx.moveTo(x2, y2);
    this.ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
    this.ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
    this.ctx.closePath();
    this.ctx.fillStyle = this.ctx.strokeStyle;
    this.ctx.fill();
  }
}
