import {
  type Shape,
  type Conflict,
  type AmbiguityLevel,
  ShapeKind,
  shapeBBox,
} from '@crdt-canvas/engine';

export interface CanvasControllerProps {
  shapes: Shape[];
  conflicts: Conflict[];
  remoteCursors: Map<string, { x: number; y: number; color: string; name: string }>;
  remoteLasers?: Map<string, { points: { x: number; y: number }[]; color: string }>;
  history: { playback: (step: number) => Shape[]; totalSteps: number } | null;
  historyStep: number;
  isPlaying: boolean;
  tool: string;
  activeColor: string;
  strokeWidth: number;
  scale: number;
  transform: { scale: number; offset: { x: number; y: number } };
  drawing: {
    active: boolean;
    kind: string | null;
    startPoint: { x: number; y: number } | null;
    currentPoints: { x: number; y: number }[];
  };
  selectedId: string | null;
  imageCache: Map<string, HTMLImageElement>;
  onImageLoad: () => void;
}

export class CanvasController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId: number | null = null;
  private props: CanvasControllerProps | null = null;

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
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const { scale: s, offset } = props.transform;

    // Background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 10, 10, 0.6)';
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(w, h, s, offset);

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
      const isSel = props.selectedId === shape.id;
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
        ctx.fillStyle = d.color + '22';
        ctx.strokeStyle = d.color;
        ctx.lineWidth = (isSel ? 2 : 1.5) / s;
        if (isConflict) ctx.setLineDash([4 / s, 4 / s]);
        ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.strokeRect(d.x, d.y, d.w, d.h);
        ctx.setLineDash([]);
      }

      if (d.kind === ShapeKind.Ellipse) {
        ctx.fillStyle = d.color + '22';
        ctx.strokeStyle = d.color;
        ctx.lineWidth = (isSel ? 2 : 1.5) / s;
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
        ctx.setLineDash([]);
      }

      if (d.kind === ShapeKind.Text) {
        ctx.fillStyle = d.color;
        ctx.font = `bold ${14 / s}px Inter, sans-serif`;
        ctx.fillText(d.text, d.x, d.y);
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
        ctx.lineWidth = 1.5 / s;
        ctx.setLineDash([4 / s, 4 / s]);
        ctx.strokeRect(b.minX - 4, b.minY - 4, b.maxX - b.minX + 8, b.maxY - b.minY + 8);
        ctx.setLineDash([]);
        const handles = [
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
      } else if (t === 'line' && draw.startPoint) {
        ctx.strokeStyle = c;
        ctx.lineWidth = sw / s;
        ctx.beginPath();
        ctx.moveTo(draw.startPoint.x, draw.startPoint.y);
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
      } else if ((t === 'rect' || t === 'ellipse') && draw.startPoint) {
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.5 / s;
        ctx.setLineDash([4 / s, 4 / s]);
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
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = this.ctx.measureText(currentLine + ' ' + word).width;
      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
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
}
