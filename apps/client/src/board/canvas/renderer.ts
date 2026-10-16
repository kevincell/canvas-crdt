/**
 * Frame renderer. Pure function of a Scene; returns whether another animation
 * frame is needed (cursor easing, laser fades, replays).
 */
import {
  ShapeKind,
  shapeBBox,
  type Conflict,
  type Shape,
  type ShapeData,
} from '@crdt-canvas/engine';
import type { CatchUp } from '../session';
import { viewportBounds, type Bounds, type Camera, type Point } from './camera';
import { drawArrowHead, drawFrameTitle, drawShape, ellipsize, fontFor, ImageCache, strokeOutline, type DrawContext } from './draw';
import { displayColor, withAlpha } from './palette';
import { applyPreviewToData, handlePosition, HANDLES, isFrame, resolveConnector, type Guide, type Preview, type SpatialIndex } from './transform';
import { actorColor, actorLabel } from '../../app/identity';

export interface PeerView {
  clientId: number;
  name: string;
  color: string;
  cursor: Point | null;
  selection: string[];
  preview: Preview | null;
  laser: Array<Point & { t: number }>;
  editing: string | null;
}

export type Draft =
  | { kind: 'stroke'; points: Point[]; color: string; width: number; recognized: ShapeData | null }
  | { kind: 'shape'; data: ShapeData }
  | { kind: 'marquee'; bounds: Bounds }
  | { kind: 'eraser'; trail: Array<Point & { t: number }> }
  | null;

export interface CatchUpView { catchUp: CatchUp; mode: 'replay' | 'highlight'; startedAt: number }

export interface Scene {
  shapes: Shape[];
  byId: ReadonlyMap<string, Shape>;
  index: SpatialIndex;
  conflicts: Conflict[];
  camera: Camera;
  width: number;
  height: number;
  dark: boolean;
  sketch: boolean;
  showGrid: boolean;
  accent: string;
  canvasColor: string;
  dotColor: string;
  selection: ReadonlySet<string>;
  hoverId: string | null;
  editingId: string | null;
  fading: ReadonlySet<string>;
  localPreview: Preview | null;
  peers: PeerView[];
  draft: Draft;
  guides: Guide[];
  catchUp: CatchUpView | null;
  authorship: boolean;
  voteCounts: ReadonlyMap<string, number>;
  commentPins: Array<{ id: string; x: number; y: number; count: number }>;
  highlightId: string | null;
  localLaser: Array<Point & { t: number }>;
  hideHandles: boolean;
}

const REPLAY_MS = 1800;
const LASER_MS = 1100;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  readonly images: ImageCache;
  private cursorPositions = new Map<number, Point>();

  constructor(private canvas: HTMLCanvasElement, onImageLoad: () => void) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
    this.images = new ImageCache(onImageLoad);
  }

  render(scene: Scene, now: number): boolean {
    const { ctx, canvas } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pw = Math.max(1, Math.round(scene.width * dpr));
    const ph = Math.max(1, Math.round(scene.height * dpr));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    let animate = false;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = scene.canvasColor;
    ctx.fillRect(0, 0, scene.width, scene.height);
    if (scene.showGrid) this.drawGrid(scene);

    const { camera } = scene;
    const z = camera.z;
    const view = viewportBounds(camera, scene.width, scene.height);
    const margin = 80 / z;
    const visible = scene.index.query({ minX: view.minX - margin, minY: view.minY - margin, maxX: view.maxX + margin, maxY: view.maxY + margin });

    // ── Previews (local drag, peers' drags, replay animation) ──
    const overrides = new Map<string, ShapeData>();
    for (const peer of scene.peers) {
      if (!peer.preview) continue;
      for (const id of peer.preview.ids) {
        const shape = scene.byId.get(id);
        if (shape) overrides.set(id, applyPreviewToData(shape.data, peer.preview));
      }
    }
    if (scene.localPreview) {
      for (const id of scene.localPreview.ids) {
        const shape = scene.byId.get(id);
        if (shape) overrides.set(id, applyPreviewToData(shape.data, scene.localPreview));
      }
    }
    let replayT = 1;
    const catchUp = scene.catchUp;
    if (catchUp?.mode === 'replay') {
      replayT = Math.min(1, (now - catchUp.startedAt) / REPLAY_MS);
      if (replayT < 1) animate = true;
      const e = easeInOut(replayT);
      for (const change of catchUp.catchUp.diff.changed) {
        if (!change.aspects.includes('moved') && !change.aspects.includes('resized')) continue;
        const current = scene.byId.get(change.id);
        if (!current || overrides.has(change.id)) continue;
        const from = shapeBBox(change.before), to = shapeBBox(current);
        const lerp = (a: number, b: number) => a + (b - a) * e;
        overrides.set(change.id, applyPreviewToData(current.data, {
          kind: 'scale', ids: [change.id], scaleText: false, from: to,
          to: { minX: lerp(from.minX, to.minX), minY: lerp(from.minY, to.minY), maxX: lerp(from.maxX, to.maxX), maxY: lerp(from.maxY, to.maxY) },
        }));
      }
    }
    const effective = overrides.size ? new OverlayMap(scene.byId, overrides) : scene.byId;
    const resolve = (shape: Shape): Shape => {
      const data = overrides.get(shape.id);
      const base = data ? { ...shape, data } : shape;
      return base.data.kind === ShapeKind.Line ? resolveConnector(base, effective) : base;
    };
    // Connectors whose targets are moving may lie outside the culled set.
    let drawList = visible;
    if (overrides.size) {
      const ids = new Set(visible.map(s => s.id));
      const extra = scene.shapes.filter(s => !ids.has(s.id) && (overrides.has(s.id) || (s.data.kind === ShapeKind.Line && ((s.data.startShapeId && overrides.has(s.data.startShapeId)) || (s.data.endShapeId && overrides.has(s.data.endShapeId))))));
      if (extra.length) drawList = [...visible, ...extra];
    }

    ctx.save();
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * camera.x, dpr * camera.y);
    const dc: DrawContext = { ctx, zoom: z, dark: scene.dark, sketch: scene.sketch, images: this.images, seed: '' };

    const addedIds = catchUp ? new Set(catchUp.catchUp.diff.added.map(s => s.id)) : null;
    const resolvedById = new Map<string, Shape>();
    for (const shape of drawList) {
      const drawn = resolve(shape);
      resolvedById.set(shape.id, drawn);
      if (shape.id === scene.editingId && shape.data.kind !== ShapeKind.Rect && shape.data.kind !== ShapeKind.Ellipse) continue;
      let alpha = 1;
      if (scene.fading.has(shape.id)) alpha = 0.22;
      if (addedIds?.has(shape.id) && catchUp?.mode === 'replay') alpha *= easeInOut(replayT);
      ctx.globalAlpha = alpha;
      dc.seed = shape.id;
      const data = shape.id === scene.editingId ? { ...drawn.data, label: '' } as ShapeData : drawn.data;
      drawShape(dc, data);
    }
    ctx.globalAlpha = 1;

    // ── Catch-up overlays ──
    if (catchUp) this.drawCatchUp(scene, catchUp, replayT, now, resolvedById);

    // ── Authorship lens ──
    if (scene.authorship) this.drawAuthorship(scene, drawList, resolvedById);

    // ── Conflicts ──
    for (const conflict of scene.conflicts) {
      const shape = resolvedById.get(conflict.shapeId) ?? scene.byId.get(conflict.shapeId);
      if (!shape || shape.deleted) continue;
      const b = shapeBBox(shape);
      const pad = 8 / z;
      const color = conflict.level === 'high' || conflict.type === 'delete_vs_edit' ? '#e5484d' : '#f59f00';
      const pulse = 0.55 + 0.45 * Math.sin(now / 260);
      animate = true;
      ctx.strokeStyle = withAlpha(color, 0.5 + 0.5 * pulse);
      ctx.lineWidth = 2.5 / z;
      ctx.setLineDash([7 / z, 5 / z]);
      ctx.beginPath();
      ctx.roundRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2, 8 / z);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = withAlpha(color, 0.07);
      ctx.fill();
    }

    // ── Peers: selections, live moves, conflict forecast ──
    for (const peer of scene.peers) {
      const ids = new Set([...peer.selection, ...(peer.preview?.ids ?? [])]);
      for (const id of ids) {
        const shape = resolvedById.get(id) ?? scene.byId.get(id);
        if (!shape || shape.deleted) continue;
        const b = shapeBBox(shape);
        const pad = 5 / z;
        const contested = scene.selection.has(id) && Boolean(peer.preview || scene.localPreview);
        ctx.strokeStyle = contested ? '#f59f00' : peer.color;
        ctx.lineWidth = (contested ? 2.5 : 1.5) / z;
        ctx.setLineDash(peer.preview ? [] : [4 / z, 3 / z]);
        ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2);
        ctx.setLineDash([]);
      }
    }

    // ── Hover & search highlight ──
    if (scene.hoverId && !scene.selection.has(scene.hoverId)) {
      const shape = resolvedById.get(scene.hoverId);
      if (shape) {
        const b = shapeBBox(shape);
        ctx.strokeStyle = withAlpha(scene.accent, 0.55);
        ctx.lineWidth = 1.5 / z;
        ctx.strokeRect(b.minX - 3 / z, b.minY - 3 / z, b.maxX - b.minX + 6 / z, b.maxY - b.minY + 6 / z);
      }
    }
    if (scene.highlightId) {
      const shape = resolvedById.get(scene.highlightId) ?? scene.byId.get(scene.highlightId);
      if (shape) {
        const b = shapeBBox(shape);
        const pad = 10 / z;
        const pulse = 0.5 + 0.5 * Math.sin(now / 180);
        animate = true;
        ctx.strokeStyle = withAlpha('#f59f00', 0.5 + 0.5 * pulse);
        ctx.lineWidth = 3 / z;
        ctx.beginPath();
        ctx.roundRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2, 10 / z);
        ctx.stroke();
      }
    }

    // ── Guides ──
    for (const guide of scene.guides) {
      ctx.strokeStyle = guide.kind === 'gap' ? '#e8590c' : '#e64980';
      ctx.lineWidth = 1 / z;
      ctx.setLineDash(guide.kind === 'gap' ? [] : [4 / z, 3 / z]);
      ctx.beginPath();
      ctx.moveTo(guide.x1, guide.y1);
      ctx.lineTo(guide.x2, guide.y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Draft ──
    this.drawDraft(scene, dc);

    // ── Lasers ──
    const lasers = [{ color: '#ff3b3b', points: scene.localLaser }, ...scene.peers.map(peer => ({ color: peer.color, points: peer.laser }))];
    for (const laser of lasers) {
      const pts = laser.points.filter(p => now - p.t < LASER_MS);
      if (pts.length < 2) continue;
      animate = true;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const age = (now - pts[i].t) / LASER_MS;
        ctx.strokeStyle = withAlpha(laser.color, Math.max(0, 1 - age));
        ctx.lineWidth = (5 * (1 - age * 0.6)) / z;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      const head = pts[pts.length - 1];
      ctx.fillStyle = laser.color;
      ctx.shadowColor = laser.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 4.5 / z, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // ── Screen-space overlays ──
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawFrameTitles(scene, drawList, resolvedById);
    if (!scene.hideHandles) this.drawSelection(scene, resolvedById);
    this.drawBadges(scene, resolvedById);
    if (this.drawPeerLabels(scene, resolvedById)) animate = true;
    if (this.drawCursors(scene)) animate = true;
    return animate;
  }

  // ── Pieces ────────────────────────────────────────────────────────────────

  private drawGrid(scene: Scene) {
    const { ctx } = this;
    const z = scene.camera.z;
    let spacing = 24;
    while (spacing * z < 14) spacing *= 4;
    const step = spacing * z;
    const ox = ((scene.camera.x % step) + step) % step;
    const oy = ((scene.camera.y % step) + step) % step;
    const size = Math.max(1, Math.min(2, step / 14));
    ctx.fillStyle = scene.dotColor;
    ctx.beginPath();
    for (let x = ox; x < scene.width; x += step) {
      for (let y = oy; y < scene.height; y += step) ctx.rect(x - size / 2, y - size / 2, size, size);
    }
    ctx.fill();
  }

  private drawCatchUp(scene: Scene, view: CatchUpView, replayT: number, now: number, resolved: Map<string, Shape>) {
    const { ctx } = this;
    const z = scene.camera.z;
    const { diff } = view.catchUp;
    const fade = view.mode === 'replay' ? replayT : 1;
    const glow = 0.6 + 0.4 * Math.sin(now / 400);
    const outline = (b: Bounds, color: string, dashed: boolean, alpha = 1) => {
      const pad = 6 / z;
      ctx.strokeStyle = withAlpha(color, alpha);
      ctx.lineWidth = 2 / z;
      ctx.setLineDash(dashed ? [6 / z, 4 / z] : []);
      ctx.beginPath();
      ctx.roundRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2, 6 / z);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // Removed: translucent ghost of what was there.
    for (const shape of diff.removed) {
      ctx.globalAlpha = view.mode === 'replay' ? 0.5 * (1 - replayT) + 0.18 : 0.18;
      const dc: DrawContext = { ctx, zoom: z, dark: scene.dark, sketch: scene.sketch, images: this.images, seed: shape.id };
      drawShape(dc, shape.data);
      ctx.globalAlpha = 1;
      outline(shapeBBox(shape), '#e5484d', true, 0.8);
    }
    // Moved/resized: ghost at the old place and a path to the new one.
    for (const change of diff.changed) {
      const now_ = resolved.get(change.id) ?? scene.byId.get(change.id);
      if (!now_) continue;
      const after = shapeBBox(now_);
      if (change.aspects.includes('moved') || change.aspects.includes('resized')) {
        const before = shapeBBox(change.before);
        outline(before, '#868e96', true, 0.6 * fade);
        const a = { x: (before.minX + before.maxX) / 2, y: (before.minY + before.maxY) / 2 };
        const b = { x: (after.minX + after.maxX) / 2, y: (after.minY + after.maxY) / 2 };
        if (Math.hypot(b.x - a.x, b.y - a.y) > 20 / z) {
          ctx.strokeStyle = withAlpha(scene.accent, 0.7 * fade);
          ctx.lineWidth = 1.5 / z;
          ctx.setLineDash([5 / z, 4 / z]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
          drawArrowHead(ctx, a.x, a.y, b.x, b.y, 9 / z, withAlpha(scene.accent, 0.7 * fade));
        }
      }
      outline(after, change.aspects.includes('text') ? '#f59f00' : scene.accent, false, glow * fade);
    }
    for (const shape of diff.added) {
      const current = resolved.get(shape.id) ?? scene.byId.get(shape.id);
      if (current) outline(shapeBBox(current), '#12a150', false, glow * fade);
    }
  }

  private drawAuthorship(scene: Scene, list: Shape[], resolved: Map<string, Shape>) {
    const { ctx } = this;
    const z = scene.camera.z;
    const view = viewportBounds(scene.camera, scene.width, scene.height);
    ctx.fillStyle = withAlpha(scene.canvasColor, 0.6);
    ctx.fillRect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY);
    for (const shape of list) {
      const s = resolved.get(shape.id) ?? shape;
      if (isFrame(s)) continue;
      const b = shapeBBox(s);
      const color = this.colorForActor(scene, shape.actor);
      const pad = 4 / z;
      ctx.fillStyle = withAlpha(color, 0.18);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / z;
      ctx.beginPath();
      ctx.roundRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2, 5 / z);
      ctx.fill();
      ctx.stroke();
    }
  }

  colorForActor(scene: Scene, actor: string): string {
    const label = actorLabel(actor);
    const live = scene.peers.find(peer => peer.name === label);
    return live?.color ?? actorColor(actor);
  }

  private drawDraft(scene: Scene, dc: DrawContext) {
    const { ctx } = this;
    const z = scene.camera.z;
    const draft = scene.draft;
    if (!draft) return;
    if (draft.kind === 'stroke') {
      if (draft.recognized) {
        ctx.save();
        ctx.shadowColor = scene.accent;
        ctx.shadowBlur = 14;
        dc.seed = 'draft';
        drawShape(dc, draft.recognized);
        ctx.restore();
      } else if (draft.points.length) {
        ctx.fillStyle = displayColor(draft.color, scene.dark);
        ctx.fill(strokeOutline(draft.points, draft.width, false));
      }
    } else if (draft.kind === 'shape') {
      dc.seed = 'draft';
      drawShape(dc, draft.data);
    } else if (draft.kind === 'marquee') {
      const b = draft.bounds;
      ctx.fillStyle = withAlpha(scene.accent, 0.08);
      ctx.strokeStyle = scene.accent;
      ctx.lineWidth = 1 / z;
      ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    } else if (draft.kind === 'eraser') {
      const now = performance.now();
      const pts = draft.trail.filter(p => now - p.t < 300);
      if (pts.length > 1) {
        ctx.strokeStyle = withAlpha(scene.dark ? '#ffffff' : '#000000', 0.18);
        ctx.lineWidth = 10 / z;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }

  private drawFrameTitles(scene: Scene, list: Shape[], resolved: Map<string, Shape>) {
    const { ctx } = this;
    const { camera } = scene;
    for (const shape of list) {
      const s = resolved.get(shape.id) ?? shape;
      if (s.data.kind !== ShapeKind.Rect || !s.data.frameTitle || shape.id === scene.editingId) continue;
      const x = s.data.x * camera.z + camera.x;
      const y = s.data.y * camera.z + camera.y;
      const w = s.data.w * camera.z;
      drawFrameTitle(ctx, s.data.frameTitle, x, y, w, scene.dark, scene.selection.has(shape.id), scene.accent);
      // Overview labels: when zoomed far out, name the frame across its body.
      if (camera.z < 0.3 && w > 80) {
        const h = s.data.h * camera.z;
        const size = Math.max(12, Math.min(28, w / 10));
        ctx.font = fontFor(size, false, 700);
        ctx.fillStyle = scene.dark ? 'rgba(236,237,241,0.55)' : 'rgba(22,24,29,0.45)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ellipsize(ctx, s.data.frameTitle, w - 16), x + w / 2, y + h / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  private drawSelection(scene: Scene, resolved: Map<string, Shape>) {
    const { ctx } = this;
    const { camera } = scene;
    if (!scene.selection.size) return;
    const shapes = [...scene.selection].map(id => resolved.get(id) ?? scene.byId.get(id)).filter((s): s is Shape => Boolean(s && !s.deleted));
    if (!shapes.length) return;
    const toScreen = (p: Point) => ({ x: p.x * camera.z + camera.x, y: p.y * camera.z + camera.y });
    ctx.strokeStyle = scene.accent;
    ctx.lineWidth = 1.5;
    // Individual outlines for multi-selection.
    if (shapes.length > 1) {
      ctx.lineWidth = 1;
      for (const s of shapes) {
        const b = shapeBBox(s);
        const a = toScreen({ x: b.minX, y: b.minY }), c = toScreen({ x: b.maxX, y: b.maxY });
        ctx.strokeRect(a.x - 2, a.y - 2, c.x - a.x + 4, c.y - a.y + 4);
      }
      ctx.lineWidth = 1.5;
    }
    const single = shapes.length === 1 ? shapes[0] : null;
    if (single?.data.kind === ShapeKind.Line) {
      const a = toScreen({ x: single.data.x1, y: single.data.y1 });
      const b = toScreen({ x: single.data.x2, y: single.data.y2 });
      for (const [p, attached] of [[a, single.data.startShapeId], [b, single.data.endShapeId]] as const) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = attached ? scene.accent : scene.canvasColor;
        ctx.fill();
        ctx.stroke();
      }
      return;
    }
    const all = shapes.map(s => shapeBBox(s));
    const b = all.reduce((acc, x) => ({ minX: Math.min(acc.minX, x.minX), minY: Math.min(acc.minY, x.minY), maxX: Math.max(acc.maxX, x.maxX), maxY: Math.max(acc.maxY, x.maxY) }));
    const tl = toScreen({ x: b.minX, y: b.minY }), br = toScreen({ x: b.maxX, y: b.maxY });
    const pad = single?.data.kind === ShapeKind.Text ? 4 : 0;
    ctx.strokeRect(tl.x - pad, tl.y - pad, br.x - tl.x + pad * 2, br.y - tl.y + pad * 2);
    const locked = shapes.every(s => s.data.locked);
    if (locked || scene.editingId) return;
    const sb = { minX: tl.x - pad, minY: tl.y - pad, maxX: br.x + pad, maxY: br.y + pad };
    const small = sb.maxX - sb.minX < 28 || sb.maxY - sb.minY < 28;
    for (const handle of HANDLES) {
      if (small && handle.length === 1) continue;
      const p = handlePosition(sb, handle);
      ctx.beginPath();
      ctx.roundRect(p.x - 4.5, p.y - 4.5, 9, 9, 2);
      ctx.fillStyle = scene.canvasColor;
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawBadges(scene: Scene, resolved: Map<string, Shape>) {
    const { ctx } = this;
    const { camera } = scene;
    for (const [id, count] of scene.voteCounts) {
      if (!count) continue;
      const shape = resolved.get(id) ?? scene.byId.get(id);
      if (!shape || shape.deleted) continue;
      const b = shapeBBox(shape);
      const x = b.maxX * camera.z + camera.x, y = b.minY * camera.z + camera.y;
      ctx.beginPath();
      ctx.roundRect(x - 14, y - 10, 28, 20, 10);
      ctx.fillStyle = scene.accent;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = fontFor(11, false, 700);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`● ${count}`, x, y + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    for (const pin of scene.commentPins) {
      const x = pin.x * camera.z + camera.x, y = pin.y * camera.z + camera.y;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x + 11, y - 11, 11, Math.PI * 0.5, Math.PI * 2.0);
      ctx.closePath();
      ctx.fillStyle = '#f59f00';
      ctx.fill();
      ctx.fillStyle = '#1e1e1e';
      ctx.font = fontFor(11, false, 700);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pin.count), x + 11, y - 11);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  private drawPeerLabels(scene: Scene, resolved: Map<string, Shape>): boolean {
    const { ctx } = this;
    const { camera } = scene;
    let contestedAny = false;
    for (const peer of scene.peers) {
      const ids = peer.preview?.ids.length ? peer.preview.ids : peer.selection;
      if (!ids.length) continue;
      const boxes = ids.map(id => resolved.get(id) ?? scene.byId.get(id)).filter((s): s is Shape => Boolean(s && !s.deleted)).map(s => shapeBBox(s));
      if (!boxes.length) continue;
      const minX = Math.min(...boxes.map(b => b.minX)), minY = Math.min(...boxes.map(b => b.minY));
      const x = minX * camera.z + camera.x, y = minY * camera.z + camera.y - 8;
      const contested = ids.some(id => scene.selection.has(id)) && Boolean(peer.preview || scene.localPreview);
      contestedAny ||= contested;
      const text = contested ? `${peer.name} is also moving this` : peer.preview ? `${peer.name} is moving` : peer.editing ? `${peer.name} is typing…` : peer.name;
      ctx.font = fontFor(11, false, 600);
      const w = ctx.measureText(text).width + 12;
      ctx.beginPath();
      ctx.roundRect(x, y - 18, w, 18, 5);
      ctx.fillStyle = contested ? '#f59f00' : peer.color;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x + 6, y - 5);
    }
    return contestedAny;
  }

  private drawCursors(scene: Scene): boolean {
    const { ctx } = this;
    const { camera } = scene;
    let moving = false;
    const alive = new Set<number>();
    for (const peer of scene.peers) {
      if (!peer.cursor) continue;
      alive.add(peer.clientId);
      const target = { x: peer.cursor.x * camera.z + camera.x, y: peer.cursor.y * camera.z + camera.y };
      // Ease toward the latest reported position (awareness is ~30 Hz; screens are 60–120 Hz).
      const world = this.cursorPositions.get(peer.clientId) ?? peer.cursor;
      const next = { x: world.x + (peer.cursor.x - world.x) * 0.4, y: world.y + (peer.cursor.y - world.y) * 0.4 };
      if (Math.hypot(next.x - peer.cursor.x, next.y - peer.cursor.y) * camera.z > 0.5) moving = true;
      else { next.x = peer.cursor.x; next.y = peer.cursor.y; }
      this.cursorPositions.set(peer.clientId, next);
      const p = { x: next.x * camera.z + camera.x, y: next.y * camera.z + camera.y };
      void target;
      if (p.x < -40 || p.y < -40 || p.x > scene.width + 40 || p.y > scene.height + 40) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 16);
      ctx.lineTo(4.4, 12.2);
      ctx.lineTo(7.4, 18.6);
      ctx.lineTo(10.2, 17.4);
      ctx.lineTo(7.3, 11.1);
      ctx.lineTo(12.6, 11.1);
      ctx.closePath();
      ctx.fillStyle = peer.color;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.font = fontFor(11.5, false, 600);
      const w = ctx.measureText(peer.name).width + 14;
      ctx.beginPath();
      ctx.roundRect(12, 17, w, 20, 10);
      ctx.fillStyle = peer.color;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(peer.name, 19, 31);
      ctx.restore();
    }
    for (const id of [...this.cursorPositions.keys()]) if (!alive.has(id)) this.cursorPositions.delete(id);
    return moving;
  }
}

class OverlayMap implements ReadonlyMap<string, Shape> {
  constructor(private base: ReadonlyMap<string, Shape>, private overrides: Map<string, ShapeData>) {}
  get(id: string) {
    const shape = this.base.get(id);
    const data = this.overrides.get(id);
    return shape && data ? { ...shape, data } : shape;
  }
  has(id: string) { return this.base.has(id); }
  get size() { return this.base.size; }
  forEach(cb: (value: Shape, key: string, map: ReadonlyMap<string, Shape>) => void) { this.base.forEach((_, key) => cb(this.get(key)!, key, this)); }
  entries() { return [...this.base.keys()].map(key => [key, this.get(key)!] as [string, Shape])[Symbol.iterator](); }
  keys() { return this.base.keys(); }
  values() { return [...this.base.keys()].map(key => this.get(key)!)[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
