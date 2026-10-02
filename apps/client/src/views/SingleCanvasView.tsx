import { useState, useCallback, useRef, useEffect } from 'react';
import { useCanvasCRDT } from '../hooks/useCanvasCRDT';
import { CanvasRenderer } from '../features/canvas/CanvasRenderer';
import { exportBoardPdf, exportBoardPng } from '../features/canvas/exportBoard';
import { downloadBoardSnapshot, readBoardSnapshot, offsetSnapshotShapes, type ImportedBoardSnapshot } from '../features/canvas/boardSnapshot';
import { downloadMigrationBackup } from '../features/canvas/migrationRecovery';
import { prepareBoardImage, calculateBoardImageBytes } from '../features/canvas/prepareImage';
import { Toolbar } from '../features/canvas/Toolbar';
import { StatusPanel } from '../features/crdt/StatusPanel';
import { ConnectionBanner } from '../features/crdt/ui/ConnectionBanner';
import { PartitionSimulator } from '../features/crdt/PartitionSimulator';
import { ChatPanel } from '../features/chat/ChatPanel';
import { DemoTip } from '../features/demo/DemoTip';
import { DemoShowcaseBar } from '../features/demo/DemoShowcaseBar';
import { TimeTravelScrubber } from '../features/crdt/ui/TimeTravelScrubber';
import { MergeLens, type MergeLensScenario } from '../features/crdt/ui/MergeLens';
import { Box, Button, Typography, Avatar, Divider } from '@mui/material';
import { type Conflict, type Shape, type ShapeData, ShapeKind, shapeBBox, shapeCenter, attachedLineEndpoints, frameDescendants, resolveTextOverlap, tidyTextOverlaps } from '@crdt-canvas/engine';
import { CommentsPanel } from '../features/comments/CommentsPanel';
import { useBoardComments } from '../features/comments/useBoardComments';
import { useFacilitation } from '../features/facilitation/useFacilitation';
import { FacilitationPanel } from '../features/facilitation/FacilitationPanel';
import { CheckpointsPanel } from '../features/checkpoints/CheckpointsPanel';
import { useBoardCheckpoints } from '../features/checkpoints/useBoardCheckpoints';
import { StencilsPanel } from '../features/stencils/StencilsPanel';
import { useStencils } from '../features/stencils/useStencils';
import { duplicateBoard, consumeInitialBoardSnapshot, generateRoomId } from '../features/canvas/boardDuplication';
import { TemplatesModal } from '../features/templates/TemplatesModal';
import { CURATED_TEMPLATES, instantiateTemplate } from '../features/templates/curatedTemplates';
import { TaskTrackerHandoffModal } from '../features/integrations/TaskTrackerHandoffModal';
import { ShareBoardModal } from '../features/sharing/ShareBoardModal';
import { sound } from '../utils/audio';

type ToolType = 'stroke' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'frame' | 'text' | 'image' | 'note' | 'laser' | 'select' | 'eraser';
type LocalBoardMetadata = { description: string; folder: string; tags: string[] };

interface SingleCanvasViewProps {
  actorName: string;
  roomId: string;
  initialColor?: string;
  isCompact?: boolean;
  isReadOnly?: boolean;
  onLeave?: () => void;
  onSwitchRoom?: (newRoomId: string) => void;
  onToggleSplitScreen?: () => void;
  isSplitScreen?: boolean;
  hideShowcase?: boolean;
}

const DEFAULT_NOTE_BG = '#fef3c7';

function contrastColor(hex: string): string {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return '#1e293b';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#1e293b' : '#ffffff';
}

export function SingleCanvasView({
  actorName,
  roomId,
  initialColor = '#7c3aed',
  isCompact = false,
  isReadOnly = false,
  onLeave,
  onSwitchRoom,
  onToggleSplitScreen,
  isSplitScreen = false,
  hideShowcase = false,
}: SingleCanvasViewProps) {
  const [tool, setTool] = useState<ToolType>('stroke');
  const [activeColor, setActiveColor] = useState(initialColor);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fillOpacity, setFillOpacity] = useState(0.13);
  const [cornerRadius, setCornerRadius] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showObjects, setShowObjects] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showFacilitation, setShowFacilitation] = useState(false);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [showStencils, setShowStencils] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showTaskHandoff, setShowTaskHandoff] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [objectSearch, setObjectSearch] = useState('');
  const [focusObjectId, setFocusObjectId] = useState<string | null>(null);
  const [highlightShapeId, setHighlightShapeId] = useState<string | null>(null);
  const [showFindBar, setShowFindBar] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findActiveIndex, setFindActiveIndex] = useState(0);
  const [searchAnnouncement, setSearchAnnouncement] = useState('');
  const [editShapeRequest, setEditShapeRequest] = useState<{ id: string; token: number } | null>(null);
  const [historyStep, setHistoryStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showConflicts, setShowConflicts] = useState(true);
  const [showScrubber, setShowScrubber] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [mergeLens, setMergeLens] = useState<MergeLensScenario | null>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDemoTip, setShowDemoTip] = useState(() => !localStorage.getItem('demoTipShown'));
  const [boardTitle, setBoardTitle] = useState(() => localStorage.getItem(`crdt-canvas-title-${roomId}`) || roomId);
  const [renamingBoard, setRenamingBoard] = useState(false);
  const [showBoardDetails, setShowBoardDetails] = useState(false);
  const [boardMetadata, setBoardMetadata] = useState<LocalBoardMetadata>(() => readLocalBoardMetadata(roomId));
  const [presentationMode, setPresentationMode] = useState(false);
  const [presentationIndex, setPresentationIndex] = useState(0);

  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const historyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const snapshotInputRef = useRef<HTMLInputElement>(null);
  const editRequestSequenceRef = useRef(0);

  useEffect(() => {
    setBoardTitle(localStorage.getItem(`crdt-canvas-title-${roomId}`) || roomId);
    setBoardMetadata(readLocalBoardMetadata(roomId));
    setRenamingBoard(false);
  }, [roomId]);

  const updateBoardMetadata = (patch: Partial<LocalBoardMetadata>) => {
    const next = { ...boardMetadata, ...patch };
    setBoardMetadata(next);
    localStorage.setItem(`crdt-canvas-meta-${roomId}`, JSON.stringify(next));
  };

  const {
    shapes,
    conflicts,
    history,
    connected,
    peerCount,
    roomId: canvasRoomId,
    localIP,
    connectionState,
    persistenceState,
    persistenceError,
    migrationSummary,
    migrationBackupAvailable,
    queuedOps,
    remoteCursors,
    remoteLasers,
    participants,
    canUndo,
    canRedo,
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
    setLaserPoints,
    resolveConflict,
    sendMessage,
    simulateOffline,
    simulateOnline,
    triggerReconnect,
    commitShapeHistory,
    commitShapeHistoryBatch,
    doc,
  } = useCanvasCRDT(actorName, roomId, activeColor, isReadOnly);
  const commentActorId = String(doc?.clientID ?? actorName);
  const { comments, addComment, resolveComment, toggleReaction } = useBoardComments(doc, actorName, commentActorId);
  const facilitation = useFacilitation(doc, actorName);
  const { checkpoints, createCheckpoint, deleteCheckpoint } = useBoardCheckpoints(doc);
  const stencilLibrary = useStencils();
  const frames = shapes.filter(shape => !shape.deleted && shape.data.kind === ShapeKind.Rect && !!shape.data.frameTitle);
  const activePresentationFrame = frames[presentationIndex] ?? frames[0];
  let presentationFocusIds: string[] = [];
  if (activePresentationFrame?.data.kind === ShapeKind.Rect) {
    const frame = activePresentationFrame.data;
    presentationFocusIds = shapes.filter(shape => {
      if (shape.deleted) return false;
      const bounds = shapeBBox(shape);
      return shape.id === activePresentationFrame.id || shape.data.frameId === activePresentationFrame.id
        || (bounds.minX >= frame.x && bounds.minY >= frame.y && bounds.maxX <= frame.x + frame.w && bounds.maxY <= frame.y + frame.h);
    }).map(shape => shape.id);
  }

  useEffect(() => {
    if (!presentationMode) return;
    const onPresentationKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresentationMode(false);
      if (event.key === 'ArrowRight') setPresentationIndex(index => Math.min(frames.length - 1, index + 1));
      if (event.key === 'ArrowLeft') setPresentationIndex(index => Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onPresentationKey);
    return () => window.removeEventListener('keydown', onPresentationKey);
  }, [presentationMode, frames.length]);
  const selectedShape = shapes.find(shape => shape.id === selectedId && !shape.deleted) ?? null;
  const handleAddComment = useCallback((text: string, shape: Shape | null) => {
    addComment({ text, actor: actorName, shapeId: shape?.id ?? null, anchor: shape ? shapeCenter(shape) : null });
  }, [addComment, actorName]);

  const restoreSnapshotAsCopy = useCallback((snapshot: ImportedBoardSnapshot, announce = true) => {
    let imported = 0;
    const existingMaxLayer = shapes.filter(shape => !shape.deleted).reduce((max, shape, index) => Math.max(max, shape.data.zIndex ?? index), -1);
    const importedLayers = snapshot.shapes.map((shape, index) => shape.data.zIndex ?? index);
    const layerOffset = importedLayers.length ? existingMaxLayer + 1 - Math.min(...importedLayers) : 0;
    const groupIds = new Map<string, string>();
    const importedIds = new Map<string, string>();
    const pendingReferences: Array<{ id: string; data: ShapeData }> = [];
    for (const { id: sourceId, data } of snapshot.shapes) {
      let id: string | null = null;
      if (data.kind === ShapeKind.Stroke) id = createStroke(data.points, data.color, data.width);
      else if (data.kind === ShapeKind.Rect) id = createRect(data.x, data.y, data.w, data.h, data.color, data.fillOpacity, data.strokeWidth, data.cornerRadius);
      else if (data.kind === ShapeKind.Ellipse) id = createEllipse(data.cx, data.cy, data.rx, data.ry, data.color, data.fillOpacity, data.strokeWidth);
      else if (data.kind === ShapeKind.Line) id = createLine(data.x1, data.y1, data.x2, data.y2, data.color, data.width, data.arrowEnd);
      else if (data.kind === ShapeKind.Text) id = createText(data.x, data.y, data.text, data.color);
      else if (data.kind === ShapeKind.Image) id = createImage(data.x, data.y, data.w, data.h, data.src);
      else if (data.kind === ShapeKind.Note) id = createNote(data.x, data.y, data.text, data.color, data.bgColor);
      if (!id) continue;
      importedIds.set(sourceId, id);
      let groupId: string | undefined;
      if (data.groupId) {
        groupId = groupIds.get(data.groupId);
        if (!groupId) { groupId = crypto.randomUUID(); groupIds.set(data.groupId, groupId); }
      }
      const metadata = {
        ...(data.zIndex !== undefined ? { zIndex: data.zIndex + layerOffset } : {}),
        ...(groupId ? { groupId } : {}),
        ...(data.locked ? { locked: data.locked } : {}),
        ...(data.kind === ShapeKind.Rect && data.frameTitle ? { frameTitle: data.frameTitle } : {}),
      };
      if (Object.keys(metadata).length) updateShape(id, metadata, 'update');
      pendingReferences.push({ id, data });
      imported++;
    }
    for (const { id, data } of pendingReferences) {
      const refs = {
        ...(data.frameId && importedIds.has(data.frameId) ? { frameId: importedIds.get(data.frameId) } : {}),
        ...(data.kind === ShapeKind.Line && data.startShapeId && importedIds.has(data.startShapeId) ? { startShapeId: importedIds.get(data.startShapeId) } : {}),
        ...(data.kind === ShapeKind.Line && data.endShapeId && importedIds.has(data.endShapeId) ? { endShapeId: importedIds.get(data.endShapeId) } : {}),
      };
      if (Object.keys(refs).length) updateShape(id, refs, 'update');
    }
    sound.playSuccess();
    if (announce) window.alert([`Restored ${imported} editable objects from “${snapshot.title}” as a copy.`, ...(snapshot.warnings ?? [])].join('\n\n'));
  }, [shapes, createStroke, createRect, createEllipse, createLine, createText, createImage, createNote, updateShape]);

  const handleImportSnapshot = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { restoreSnapshotAsCopy(await readBoardSnapshot(file)); }
    catch (error) { window.alert(error instanceof Error ? error.message : 'Could not import this board snapshot.'); }
  }, [restoreSnapshotAsCopy]);

  useEffect(() => {
    if (!doc) return;
    const initialSnapshot = consumeInitialBoardSnapshot(roomId);
    if (initialSnapshot) {
      doc.transact(() => {
        restoreSnapshotAsCopy(initialSnapshot, false);
      }, 'initial-board-hydration');
      sound.playSuccess();
    }
  }, [roomId, doc, restoreSnapshotAsCopy]);

  const handleDuplicateBoard = useCallback(async () => {
    try {
      const activeShapes = shapes.filter(s => !s.deleted).map(s => ({ id: s.id, data: structuredClone(s.data) }));
      const { newRoomId, newTitle, shapeCount } = await duplicateBoard({
        sourceRoomId: roomId,
        sourceTitle: boardTitle,
        shapes: activeShapes,
      });
      sound.playSuccess();
      if (onSwitchRoom) {
        onSwitchRoom(newRoomId);
      } else {
        window.alert(`Board duplicated as “${newTitle}” (Room: ${newRoomId}) with ${shapeCount} objects.`);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not duplicate this board.');
    }
  }, [shapes, roomId, boardTitle, onSwitchRoom]);

  const triggerTemporaryHighlight = useCallback((shapeId: string) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightShapeId(shapeId);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightShapeId(null);
    }, 2400);
  }, []);

  const searchMatches = shapes.filter(shape => {
    if (shape.deleted || !findQuery.trim()) return false;
    const q = findQuery.trim().toLowerCase();
    const data = shape.data;
    if (data.kind === ShapeKind.Text || data.kind === ShapeKind.Note) {
      return data.text.toLowerCase().includes(q);
    }
    if (data.kind === ShapeKind.Rect && data.frameTitle) {
      return data.frameTitle.toLowerCase().includes(q);
    }
    return false;
  });

  const navigateToSearchMatch = useCallback((index: number) => {
    if (!searchMatches.length) return;
    const validIndex = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;
    setFindActiveIndex(validIndex);
    const target = searchMatches[validIndex];
    if (target) {
      setSelectedIds([target.id]);
      setSelectedId(target.id);
      setTool('select');
      setFocusObjectId(target.id);
      triggerTemporaryHighlight(target.id);
      const label = target.data.kind === ShapeKind.Text || target.data.kind === ShapeKind.Note
        ? target.data.text.replace(/\s+/g, ' ').slice(0, 32)
        : target.data.kind === ShapeKind.Rect && target.data.frameTitle
        ? target.data.frameTitle
        : target.data.kind;
      setSearchAnnouncement(`Match ${validIndex + 1} of ${searchMatches.length}: ${label}`);
    }
  }, [searchMatches, triggerTemporaryHighlight]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target !== findInputRef.current) {
          return;
        }
        e.preventDefault();
        setShowFindBar(prev => {
          if (!prev) setTimeout(() => findInputRef.current?.select(), 50);
          return true;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!showFindBar || !findQuery.trim()) {
      setHighlightShapeId(null);
      setFindActiveIndex(0);
      return;
    }
    if (searchMatches.length > 0) {
      navigateToSearchMatch(0);
    } else {
      setHighlightShapeId(null);
      setSearchAnnouncement('No matching objects found');
    }
  }, [findQuery, showFindBar]);

  const frameForData = useCallback((data: ShapeData, excludeId?: string) => {
    if (data.kind === ShapeKind.Rect && data.frameTitle) return data.frameId;
    const bounds = shapeBBox({ data } as Shape);
    const containers = shapes.filter(shape => {
      if (shape.id === excludeId || shape.deleted || shape.data.kind !== ShapeKind.Rect || !shape.data.frameTitle) return false;
      return bounds.minX >= shape.data.x && bounds.minY >= shape.data.y
        && bounds.maxX <= shape.data.x + shape.data.w && bounds.maxY <= shape.data.y + shape.data.h;
    }).sort((a, b) => {
      if (a.data.kind !== ShapeKind.Rect || b.data.kind !== ShapeKind.Rect) return 0;
      const areaA = a.data.w * a.data.h, areaB = b.data.w * b.data.h;
      return areaA - areaB || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    return containers[0]?.id;
  }, [shapes]);

  const assignCreatedShapeToFrame = useCallback((id: string | null, data: ShapeData) => {
    if (!id) return;
    const frameId = frameForData(data);
    if (frameId) updateShape(id, { frameId }, 'update');
  }, [frameForData, updateShape]);

  const findConnectorTarget = useCallback((point: { x: number; y: number }) => {
    return shapes.flatMap(shape => {
      if (shape.deleted || ![ShapeKind.Rect, ShapeKind.Ellipse, ShapeKind.Text, ShapeKind.Note, ShapeKind.Image].includes(shape.data.kind)) return [];
      const bounds = shapeBBox(shape);
      const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
      const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY);
      const distance = Math.hypot(dx, dy);
      const snapRadius = 18 / Math.max(0.2, canvasScale);
      return distance <= snapRadius ? [{ shape, distance, area: (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) }] : [];
    }).sort((a, b) => a.distance - b.distance || a.area - b.area || (a.shape.id < b.shape.id ? -1 : 1))[0]?.shape.id;
  }, [shapes, canvasScale]);

  const toggleConnectorEndpoint = useCallback((endpoint: 'start' | 'end') => {
    if (selectedShape?.data.kind !== ShapeKind.Line || selectedShape.data.locked) return;
    const line = selectedShape.data;
    const currentTargetId = endpoint === 'start' ? line.startShapeId : line.endShapeId;
    const endpoints = attachedLineEndpoints(line, shapes);
    if (currentTargetId) {
      const point = endpoint === 'start' ? endpoints.start : endpoints.end;
      updateShape(selectedShape.id, endpoint === 'start'
        ? { x1: point.x, y1: point.y, startShapeId: undefined }
        : { x2: point.x, y2: point.y, endShapeId: undefined }, 'update');
      return;
    }
    const point = endpoint === 'start' ? endpoints.start : endpoints.end;
    const targetId = findConnectorTarget(point);
    if (!targetId || targetId === selectedShape.id) return;
    updateShape(selectedShape.id, endpoint === 'start' ? { startShapeId: targetId } : { endShapeId: targetId }, 'update');
  }, [selectedShape, shapes, findConnectorTarget, updateShape]);

  const handleShapeMoved = useCallback((id: string, dx: number, dy: number, skipHistory = false) => {
    const shape = shapes.find(s => s.id === id);
    if (shape && !shape.data.locked) {
      const data = shape.data;
      let moved: ShapeData;
      if (data.kind === ShapeKind.Ellipse) moved = { ...data, cx: data.cx + dx, cy: data.cy + dy };
      else if (data.kind === ShapeKind.Line) moved = { ...data, x1: data.x1 + dx, y1: data.y1 + dy, x2: data.x2 + dx, y2: data.y2 + dy };
      else if (data.kind === ShapeKind.Stroke) moved = { ...data, points: data.points.map(point => ({ x: point.x + dx, y: point.y + dy })) };
      else moved = { ...data, x: data.x + dx, y: data.y + dy };

      // Resolve text overlap after a final drop
      if (!skipHistory && moved.kind === ShapeKind.Text) {
        const resolved = resolveTextOverlap(
          { x: moved.x, y: moved.y, text: moved.text, id },
          shapes
        );
        moved = { ...moved, y: resolved.y };
      }

      const frameId = frameForData(moved, id);
      updateShape(id, { ...moved, frameId }, 'move', skipHistory);
    }
  }, [shapes, updateShape, frameForData]);

  const handleShapeResized = useCallback((id: string, data: Partial<any>, op: 'resize' | 'move' | 'update' = 'resize', skipHistory = false) => {
    const shape = shapes.find(item => item.id === id);
    if (shape && !shape.data.locked) {
      const nextData = { ...shape.data, ...data } as ShapeData;
      updateShape(id, { ...data, frameId: frameForData(nextData, id) }, op, skipHistory);
    }
  }, [shapes, updateShape, frameForData]);

  const deleteUnlockedShape = useCallback((id: string) => {
    const shape = shapes.find(item => item.id === id);
    if (shape && !shape.data.locked) deleteShape(id);
  }, [shapes, deleteShape]);

  const handleSelectionChange = useCallback((ids: string[], primaryId: string | null) => {
    setSelectedIds(ids);
    setSelectedId(primaryId);
    const shape = shapes.find(item => item.id === primaryId);
    if (!shape) return;
    if (shape.data.kind === ShapeKind.Rect || shape.data.kind === ShapeKind.Ellipse) {
      setFillOpacity(shape.data.fillOpacity ?? 0.13);
      setStrokeWidth(shape.data.strokeWidth ?? 1.5);
      if (shape.data.kind === ShapeKind.Rect) setCornerRadius(shape.data.cornerRadius ?? 0);
    } else if (shape.data.kind === ShapeKind.Stroke || shape.data.kind === ShapeKind.Line) {
      setStrokeWidth(shape.data.width);
    }
  }, [shapes]);

  const handleApplyColor = useCallback((color: string) => {
    for (const id of selectedIds) {
      const shape = shapes.find(item => item.id === id && !item.deleted);
      if (!shape || shape.data.locked) continue;
      if (shape.data.kind === ShapeKind.Note) {
        updateShape(id, { bgColor: color, color: contrastColor(color) }, 'update');
      } else if ('color' in shape.data) {
        updateShape(id, { color }, 'update');
      }
    }
  }, [selectedIds, shapes, updateShape]);

  const handleStrokeWidthChange = useCallback((width: number) => {
    setStrokeWidth(width);
  }, []);

  const commitStrokeWidthChange = useCallback((width: number) => {
    selectedIds.forEach(id => {
      const shape = shapes.find(item => item.id === id && !item.data.locked);
      if (!shape) return;
      if (shape.data.kind === ShapeKind.Stroke || shape.data.kind === ShapeKind.Line) updateShape(id, { width }, 'update');
      else if (shape.data.kind === ShapeKind.Rect || shape.data.kind === ShapeKind.Ellipse) updateShape(id, { strokeWidth: width }, 'update');
    });
  }, [selectedIds, shapes, updateShape]);

  const handleFillOpacityChange = useCallback((opacity: number) => {
    setFillOpacity(opacity);
  }, []);

  const commitFillOpacityChange = useCallback((opacity: number) => {
    selectedIds.forEach(id => {
      const shape = shapes.find(item => item.id === id && !item.data.locked);
      if (shape?.data.kind === ShapeKind.Rect || shape?.data.kind === ShapeKind.Ellipse) updateShape(id, { fillOpacity: opacity }, 'update');
    });
  }, [selectedIds, shapes, updateShape]);

  const handleCornerRadiusChange = useCallback((radius: number) => {
    setCornerRadius(radius);
  }, []);

  const commitCornerRadiusChange = useCallback((radius: number) => {
    selectedIds.forEach(id => {
      const shape = shapes.find(item => item.id === id && item.data.kind === ShapeKind.Rect && !item.data.locked);
      if (shape) updateShape(id, { cornerRadius: radius }, 'update');
    });
  }, [selectedIds, shapes, updateShape]);

  const duplicateShape = useCallback((id: string): string | null => {
    const shape = shapes.find(item => item.id === id && !item.deleted);
    if (!shape) return null;
    const d = shape.data;
    if (d.kind === ShapeKind.Stroke) return createStroke(d.points.map(point => ({ x: point.x + 24, y: point.y + 24 })), d.color, d.width);
    if (d.kind === ShapeKind.Rect) return createRect(d.x + 24, d.y + 24, d.w, d.h, d.color, d.fillOpacity, d.strokeWidth, d.cornerRadius);
    if (d.kind === ShapeKind.Ellipse) return createEllipse(d.cx + 24, d.cy + 24, d.rx, d.ry, d.color, d.fillOpacity, d.strokeWidth);
    if (d.kind === ShapeKind.Line) return createLine(d.x1 + 24, d.y1 + 24, d.x2 + 24, d.y2 + 24, d.color, d.width, d.arrowEnd);
    if (d.kind === ShapeKind.Text) return createText(d.x + 24, d.y + 24, d.text, d.color);
    if (d.kind === ShapeKind.Image) return createImage(d.x + 24, d.y + 24, d.w, d.h, d.src);
    return createNote(d.x + 24, d.y + 24, d.text, d.color, d.bgColor);
  }, [shapes, createStroke, createRect, createEllipse, createLine, createText, createImage, createNote]);

  const duplicateSelection = useCallback(() => {
    const copies = selectedIds.map(id => duplicateShape(id)).filter((id): id is string => Boolean(id));
    if (copies.length) {
      if (copies.length > 1) {
        const groupId = crypto.randomUUID();
        copies.forEach(id => updateShape(id, { groupId }, 'update'));
      }
      setSelectedIds(copies);
      setSelectedId(copies[copies.length - 1]);
    }
  }, [selectedIds, duplicateShape, updateShape]);

  const deleteSelection = useCallback(() => {
    selectedIds.forEach(deleteUnlockedShape);
    setSelectedIds([]);
    setSelectedId(null);
  }, [selectedIds, deleteUnlockedShape]);

  const selectedNotes = shapes.filter(shape => selectedIds.includes(shape.id) && !shape.deleted && !shape.data.locked && shape.data.kind === ShapeKind.Note);
  const tidySelectedNotes = useCallback(() => {
    if (!doc) return;
    const notes = shapes.filter(shape => selectedIds.includes(shape.id) && !shape.deleted && !shape.data.locked && shape.data.kind === ShapeKind.Note)
      .sort((a, b) => {
        const aText = a.data.kind === ShapeKind.Note ? a.data.text.trim().toLocaleLowerCase() : '';
        const bText = b.data.kind === ShapeKind.Note ? b.data.text.trim().toLocaleLowerCase() : '';
        return (aText < bText ? -1 : aText > bText ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
    if (notes.length >= 2) {
      const columns = Math.ceil(Math.sqrt(notes.length));
      const rows = Math.ceil(notes.length / columns);
      const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(...notes.filter((_, index) => index % columns === column).map(note => note.data.kind === ShapeKind.Note ? note.data.w : 0)));
      const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...notes.slice(row * columns, (row + 1) * columns).map(note => note.data.kind === ShapeKind.Note ? note.data.h : 0)));
      const originX = Math.min(...notes.map(note => note.data.kind === ShapeKind.Note ? note.data.x : 0));
      const originY = Math.min(...notes.map(note => note.data.kind === ShapeKind.Note ? note.data.y : 0));
      const entries = notes.map((note, index) => {
        if (note.data.kind !== ShapeKind.Note) return null;
        const row = Math.floor(index / columns);
        const column = index % columns;
        const x = originX + columnWidths.slice(0, column).reduce((sum, width) => sum + width + 24, 0);
        const y = originY + rowHeights.slice(0, row).reduce((sum, height) => sum + height + 24, 0);
        const nextData = { ...note.data, x, y };
        return { id: note.id, prevData: note.data, nextData };
      }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      commitShapeHistoryBatch(entries);
      doc.transact(() => entries.forEach(entry => updateShape(entry.id, entry.nextData, 'move', true)), 'tidy-sticky-notes');
    }

    // Also tidy all text overlaps across the board
    const textUpdates = tidyTextOverlaps(shapes);
    if (textUpdates.size > 0) {
      const textEntries = Array.from(textUpdates.entries()).map(([id, pos]) => {
        const shape = shapes.find(s => s.id === id);
        if (!shape) return null;
        const nextData = { ...shape.data, ...pos };
        return { id, prevData: shape.data, nextData };
      }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      commitShapeHistoryBatch(textEntries);
      doc.transact(() => textEntries.forEach(entry => updateShape(entry.id, entry.nextData as ShapeData, 'move', true)), 'tidy-text-overlaps');
    }

    sound.playSuccess();
  }, [shapes, selectedIds, commitShapeHistoryBatch, doc, updateShape]);

  const groupSelection = useCallback(() => {
    if (selectedIds.length < 2) return;
    const groupId = crypto.randomUUID();
    const memberIds = new Set(selectedIds);
    selectedIds.forEach(id => {
      const selected = shapes.find(shape => shape.id === id && !shape.deleted);
      if (selected?.data.kind === ShapeKind.Rect && selected.data.frameTitle) frameDescendants(shapes, id).forEach(member => memberIds.add(member.id));
    });
    memberIds.forEach(id => {
      if (!shapes.find(shape => shape.id === id)?.data.locked) updateShape(id, { groupId }, 'update');
    });
  }, [selectedIds, shapes, updateShape]);

  const ungroupSelection = useCallback(() => {
    const memberIds = new Set(selectedIds);
    selectedIds.forEach(id => {
      const selected = shapes.find(shape => shape.id === id && !shape.deleted);
      if (selected?.data.kind === ShapeKind.Rect && selected.data.frameTitle) frameDescendants(shapes, id).forEach(member => memberIds.add(member.id));
    });
    memberIds.forEach(id => {
      if (!shapes.find(shape => shape.id === id)?.data.locked) updateShape(id, { groupId: undefined }, 'update');
    });
  }, [selectedIds, shapes, updateShape]);

  const canUngroupSelection = selectedIds.some(id => {
    const shape = shapes.find(item => item.id === id && !item.deleted);
    return shape && Boolean(shape.data.groupId);
  }) || selectedIds.some(id => {
    const shape = shapes.find(item => item.id === id && !item.deleted);
    return shape?.data.kind === ShapeKind.Rect && !!shape.data.frameTitle && frameDescendants(shapes, id).some(member => !!member.data.groupId);
  });

  const selectionLocked = selectedIds.length > 0 && selectedIds.every(id => shapes.find(shape => shape.id === id)?.data.locked);

  const toggleSelectionLock = useCallback(() => {
    const locked = !selectionLocked;
    selectedIds.forEach(id => updateShape(id, { locked }, 'update'));
  }, [selectedIds, selectionLocked, updateShape]);

  const moveSelectionLayer = useCallback((direction: 'front' | 'back') => {
    const visibleShapes = shapes.filter(shape => !shape.deleted).map((shape, index) => ({ shape, index }))
      .sort((a, b) => (a.shape.data.zIndex ?? a.index) - (b.shape.data.zIndex ?? b.index) || a.index - b.index)
      .map(({ shape }) => shape);
    const layerIds = new Set(selectedIds);
    selectedIds.forEach(id => {
      const shape = shapes.find(item => item.id === id && !item.deleted);
      if (shape?.data.kind === ShapeKind.Rect && shape.data.frameTitle) frameDescendants(shapes, id).forEach(member => layerIds.add(member.id));
    });
    const selected = visibleShapes.filter(shape => layerIds.has(shape.id) && !shape.data.locked)
      .sort((a, b) => Number(b.data.kind === ShapeKind.Rect && !!b.data.frameTitle) - Number(a.data.kind === ShapeKind.Rect && !!a.data.frameTitle));
    if (!selected.length) return;
    const minLayer = Math.min(...visibleShapes.map((shape, index) => shape.data.zIndex ?? index));
    const maxLayer = Math.max(...visibleShapes.map((shape, index) => shape.data.zIndex ?? index));
    const base = direction === 'front' ? maxLayer + 1 : minLayer - selected.length;
    selected.forEach((shape, index) => updateShape(shape.id, { zIndex: base + index }, 'update'));
  }, [shapes, selectedIds, updateShape]);

  const alignSelection = useCallback((mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY') => {
    const selected = shapes.filter(shape => selectedIds.includes(shape.id) && !shape.deleted && !shape.data.locked);
    if (selected.length < 2) return;
    const bounds = selected.map(shape => ({ shape, box: shapeBBox(shape) }));
    const minX = Math.min(...bounds.map(item => item.box.minX));
    const maxX = Math.max(...bounds.map(item => item.box.maxX));
    const minY = Math.min(...bounds.map(item => item.box.minY));
    const maxY = Math.max(...bounds.map(item => item.box.maxY));
    const translations = new Map<string, { dx: number; dy: number }>();
    const translateTo = (shape: Shape, dx: number, dy: number) => {
      const data = shape.data;
      let next: ShapeData;
      if (data.kind === ShapeKind.Ellipse) next = { ...data, cx: data.cx + dx, cy: data.cy + dy };
      else if (data.kind === ShapeKind.Line) next = { ...data, x1: data.x1 + dx, y1: data.y1 + dy, x2: data.x2 + dx, y2: data.y2 + dy };
      else if (data.kind === ShapeKind.Stroke) next = { ...data, points: data.points.map(point => ({ x: point.x + dx, y: point.y + dy })) };
      else next = { ...data, x: data.x + dx, y: data.y + dy };
      return { ...next, frameId: frameForData(next, shape.id) } as ShapeData;
    };

    if (mode === 'distributeX' || mode === 'distributeY') {
      if (bounds.length < 3) return;
      const horizontal = mode === 'distributeX';
      const ordered = [...bounds].sort((a, b) => horizontal ? a.box.minX - b.box.minX : a.box.minY - b.box.minY);
      const start = horizontal ? ordered[0].box.minX : ordered[0].box.minY;
      const end = horizontal ? ordered.at(-1)!.box.maxX : ordered.at(-1)!.box.maxY;
      const occupied = ordered.reduce((total, item) => total + (horizontal ? item.box.maxX - item.box.minX : item.box.maxY - item.box.minY), 0);
      const gap = (end - start - occupied) / (ordered.length - 1);
      let cursor = start;
      ordered.forEach((item, index) => {
        const size = horizontal ? item.box.maxX - item.box.minX : item.box.maxY - item.box.minY;
        const delta = cursor - (horizontal ? item.box.minX : item.box.minY);
        translations.set(item.shape.id, horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta });
        cursor += size + gap;
        if (index === ordered.length - 1) translations.delete(item.shape.id);
      });
    } else {
      for (const { shape, box } of bounds) {
        let dx = 0;
        let dy = 0;
        if (mode === 'left') dx = minX - box.minX;
        else if (mode === 'centerX') dx = (minX + maxX - box.minX - box.maxX) / 2;
        else if (mode === 'right') dx = maxX - box.maxX;
        else if (mode === 'top') dy = minY - box.minY;
        else if (mode === 'centerY') dy = (minY + maxY - box.minY - box.maxY) / 2;
        else if (mode === 'bottom') dy = maxY - box.maxY;
        if (dx || dy) translations.set(shape.id, { dx, dy });
      }
    }

    const entries = Array.from(translations, ([id, delta]) => {
      const shape = selected.find(item => item.id === id)!;
      return { id, prevData: shape.data, nextData: translateTo(shape, delta.dx, delta.dy) };
    });
    if (!entries.length) return;
    commitShapeHistoryBatch(entries);
    doc?.transact(() => entries.forEach(entry => updateShape(entry.id, entry.nextData, 'move', true)), 'align-selection');
    sound.playSuccess();
  }, [shapes, selectedIds, frameForData, commitShapeHistoryBatch, doc, updateShape]);

  // Handle image upload from file input
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const currentBytes = calculateBoardImageBytes(shapes);
    void prepareBoardImage(file, currentBytes).then(({ src, width, height }) => {
      const id = createImage(100, 100, width, height, src);
      assignCreatedShapeToFrame(id, { kind: ShapeKind.Image, x: 100, y: 100, w: width, h: height, src });
      sound.playPop();
    }).catch(error => window.alert(error instanceof Error ? error.message : 'Could not add this image.'));
    e.target.value = '';
  }, [createImage, assignCreatedShapeToFrame, shapes]);

  // History playback interval
  useEffect(() => {
    if (isPlaying && history) {
      historyTimerRef.current = setInterval(() => {
        setHistoryStep(prev => {
          if (prev >= history.totalSteps) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 700);
    } else {
      if (historyTimerRef.current) clearInterval(historyTimerRef.current);
    }
    return () => {
      if (historyTimerRef.current) clearInterval(historyTimerRef.current);
    };
  }, [isPlaying, history]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        if (canRedo) redo();
      } else if (e.key === 'r' || e.key === 'R') {
        setTool('rect');
        sound.playClick();
      } else if (e.key === 's' || e.key === 'S') {
        setTool('stroke');
        sound.playClick();
      } else if (e.key === 'v' || e.key === 'V') {
        setTool('select');
        sound.playClick();
      } else if (e.key === 'e' || e.key === 'E') {
        setTool('ellipse');
        sound.playClick();
      } else if (e.key === 'l' || e.key === 'L') {
        setTool('line');
        sound.playClick();
      } else if (e.key === 'a' || e.key === 'A') {
        setTool('arrow');
        sound.playClick();
      } else if (e.key === 'f' || e.key === 'F') {
        setTool('frame');
        sound.playClick();
      } else if (e.key === 't' || e.key === 'T') {
        setTool('text');
        sound.playClick();
      } else if (e.key === 'p' || e.key === 'P') {
        setTool('laser');
        sound.playClick();
      } else if (e.key === 'n' || e.key === 'N') {
        setTool('note');
        sound.playClick();
      } else if (e.key === 'i' || e.key === 'I') {
        setTool('image');
        fileInputRef.current?.click();
      } else if (e.key === 'x' || e.key === 'X') {
        setTool('eraser');
        sound.playClick();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  const handleResolveConflict = useCallback((shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => {
    resolveConflict(shapeId, action);
    sound.playSuccess();
  }, [resolveConflict]);

  // 1-Click Guided Demo Actions
  const runUnionBoxDemo = useCallback(() => {
    setMergeLens('union');
    const id = createRect(180, 160, 200, 120, '#7c3aed');
    if (!id) return;
    setTimeout(() => {
      // Simulate concurrent resize: Actor A expands right, Actor B expands left/down
      updateShape(id, { x: 180, y: 160, w: 320, h: 120 }, 'resize');
      updateShape(id, { x: 130, y: 160, w: 250, h: 220 }, 'resize');
    }, 400);
  }, [createRect, updateShape]);

  const runAmbiguityDemo = useCallback(() => {
    setMergeLens('ambiguity');
    const id = createRect(240, 200, 160, 110, '#f59e0b');
    if (!id) return;
    setTimeout(() => {
      // Conflicting moves to opposing quadrants
      updateShape(id, { x: 80, y: 80 }, 'move');
      updateShape(id, { x: 480, y: 360 }, 'move');
      setShowConflicts(true);
    }, 400);
  }, [createRect, updateShape]);

  const runHistoryDemo = useCallback(() => {
    setMergeLens('history');
    createRect(140, 140, 160, 100, '#38bdf8');
    setTimeout(() => createNote(340, 140, 'Collaborative CRDT note', '#1e293b', '#fef3c7'), 200);
    setTimeout(() => createStroke([{ x: 140, y: 290 }, { x: 260, y: 330 }, { x: 380, y: 290 }], '#10b981', 4), 400);
    setTimeout(() => {
      setShowScrubber(true);
      setIsPlaying(true);
      setHistoryStep(0);
    }, 700);
  }, [createRect, createNote, createStroke]);

  const runPartitionDemo = useCallback(() => {
    setMergeLens('partition');
    simulateOffline();
    setShowSimulator(true);
    setTimeout(() => {
      createNote(220, 240, 'Queued offline operation!', '#1e293b', '#fde047');
      setTimeout(() => {
        simulateOnline();
      }, 2500);
    }, 800);
  }, [simulateOffline, simulateOnline, createNote]);

  return (
    <Box sx={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: '#f8fafc',
      position: 'relative',
    }}>
      {/* Hidden file input for image upload */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageUpload}
      />
      <input ref={snapshotInputRef} type="file" accept="application/json,.json,.yupdate,application/octet-stream" style={{ display: 'none' }} onChange={handleImportSnapshot} />

      {/* Top room & peer badge header */}
      <Box sx={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        borderBottom: '1px solid #e2e8f0',
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(16px)',
        zIndex: 40,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{
            fontSize: 14,
            fontWeight: 800,
            background: 'linear-gradient(135deg, #c4b5fd 0%, #7c3aed 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.02em',
            fontFamily: 'Outfit, sans-serif',
          }}>
            ✦ CRDT Canvas
          </Typography>

          {renamingBoard ? (
            <input
              autoFocus
              aria-label="Board title"
              value={boardTitle}
              onChange={event => setBoardTitle(event.target.value)}
              onBlur={() => { const title = boardTitle.trim() || roomId; setBoardTitle(title); localStorage.setItem(`crdt-canvas-title-${roomId}`, title); setRenamingBoard(false); }}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setBoardTitle(localStorage.getItem(`crdt-canvas-title-${roomId}`) || roomId); setRenamingBoard(false); } }}
              style={{ width: 170, padding: '4px 8px', borderRadius: 6, background: '#f1f5f9', color: '#0f172a', border: '1px solid #7c3aed', outline: 'none', fontSize: 12, fontWeight: 600 }}
            />
          ) : (
            <button
              type="button"
              aria-label={`Rename board ${boardTitle}`}
              title="Rename board"
              onClick={() => setRenamingBoard(true)}
              style={{ padding: '4px 8px', borderRadius: 6, background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0', fontSize: 12, fontWeight: 600, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >{boardTitle}</button>
          )}
          <Button size="small" onClick={() => setShowBoardDetails(value => !value)} aria-pressed={showBoardDetails} aria-label="Edit board description, workspace, and tags" sx={{ minWidth: 0, px: 1, fontSize: 10, color: showBoardDetails ? '#7c3aed' : '#64748b', border: '1px solid #e2e8f0', textTransform: 'none' }}>Details</Button>
          <Button size="small" onClick={() => void handleDuplicateBoard()} title="Duplicate board into an independent new room without sharing live state" aria-label="Duplicate board" sx={{ minWidth: 0, px: 1, fontSize: 10, color: '#7c3aed', border: '1px solid #ddd6fe', textTransform: 'none' }}>Duplicate</Button>
          <Button size="small" onClick={() => setShowTemplates(true)} title="Browse curated board templates" aria-label="Browse curated board templates" sx={{ minWidth: 0, px: 1, fontSize: 10, color: '#6d28d9', border: '1px solid #ddd6fe', textTransform: 'none' }}>Templates</Button>
          <Button
            size="small"
            onClick={() => {
              setShowFindBar(prev => {
                if (!prev) setTimeout(() => findInputRef.current?.select(), 50);
                return !prev;
              });
            }}
            title="Find text, notes, and frames on board (Ctrl+F)"
            aria-label="Find on board"
            aria-pressed={showFindBar}
            sx={{ minWidth: 0, px: 1, fontSize: 10, color: showFindBar ? '#f43f5e' : '#e2e2f0', border: '1px solid rgba(255,255,255,.08)', textTransform: 'none' }}
          >
            Find
          </Button>
          <Button
            size="small"
            onClick={() => setShowTaskHandoff(true)}
            title="Export board sticky notes and frames to task trackers (Linear, Jira, GitHub Issues)"
            aria-label="Export board tasks"
            sx={{ minWidth: 0, px: 1, fontSize: 10, color: '#38bdf8', border: '1px solid rgba(56,189,248,.25)', textTransform: 'none' }}
          >
            Tasks
          </Button>
          <Button
            size="small"
            onClick={() => setShowShare(true)}
            title="Share board — get editor, viewer, and presentation links"
            aria-label="Share board"
            sx={{ minWidth: 0, px: 1, fontSize: 10, color: '#34d399', border: '1px solid rgba(52,211,153,.25)', textTransform: 'none' }}
          >
            Share
          </Button>
          {isReadOnly && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: 1, bgcolor: 'rgba(251,146,60,.12)', border: '1px solid rgba(251,146,60,.3)' }}>
              <Typography sx={{ fontSize: 9, fontWeight: 800, color: '#fb923c', textTransform: 'uppercase', letterSpacing: 1 }}>Read Only</Typography>
            </Box>
          )}
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            background: 'rgba(124, 58, 237, 0.06)',
            border: '1px solid rgba(124, 58, 237, 0.15)',
            borderRadius: '12px',
            px: 1.25,
            py: 0.25,
          }}>
            <Typography sx={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Room:</Typography>
            <Typography sx={{ fontSize: 11, color: '#7c3aed', fontWeight: 600, fontFamily: 'monospace' }}>
              {canvasRoomId || roomId}
            </Typography>
          </Box>

          {onLeave && (
            <Button
              size="small"
              onClick={onLeave}
              sx={{
                fontSize: 11,
                color: '#ef4444',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '6px',
                px: 1,
                py: 0.25,
                textTransform: 'none',
                '&:hover': { background: 'rgba(239, 68, 68, 0.18)' },
              }}
            >
              Leave Room
            </Button>
          )}
          {frames.length > 0 && <Button size="small" onClick={() => {
            if (!presentationMode) setPresentationIndex(0);
            setPresentationMode(value => !value);
            setShowComments(false); setShowChat(false); setShowFacilitation(false); setShowCheckpoints(false);
          }} sx={{ fontSize: 11, color: '#c4b5fd', border: '1px solid rgba(167,139,250,.25)', borderRadius: '6px', textTransform: 'none' }}>
            {presentationMode ? 'Exit present' : 'Present frames'}
          </Button>}
        </Box>

        {/* User indicator & presence */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Avatar
              sx={{
                width: 26,
                height: 26,
                fontSize: 12,
                fontWeight: 700,
                background: activeColor,
                boxShadow: `0 0 10px ${activeColor}55`,
              }}
            >
              {actorName.slice(0, 1).toUpperCase()}
            </Avatar>
            <Typography sx={{ fontSize: 12, color: '#0f172a', fontWeight: 600 }}>
              {actorName}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Main workspace */}
      <Box sx={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {/* Canvas renderer */}
        <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0 }}>
          <CanvasRenderer
            focusShapeIds={presentationMode ? presentationFocusIds : focusObjectId ? [focusObjectId] : undefined}
            highlightShapeId={highlightShapeId}
            editShapeRequest={editShapeRequest}
            selectedIdsExternal={selectedIds}
            selectedIdExternal={selectedId}
            shapes={shapes}
            conflicts={conflicts}
            remoteCursors={remoteCursors}
            remoteLasers={remoteLasers}
            history={history}
            historyStep={historyStep}
            isPlaying={isPlaying}
            tool={tool}
            activeColor={activeColor}
            strokeWidth={strokeWidth}
            fillOpacity={fillOpacity}
            cornerRadius={cornerRadius}
            showGrid={showGrid}
            snapToGrid={snapToGrid}
            comments={comments}
            voteMode={facilitation.voting}
            voteCounts={facilitation.voteCounts}
            onVoteAt={shapeId => {
              if (!facilitation.toggleVote(shapeId)) window.alert(`Voting allows up to ${facilitation.maxVotesPerPerson} votes per person.`);
            }}
            scale={canvasScale}
            onStrokeEnd={(pts, c, w) => { const id = createStroke(pts, c, w); assignCreatedShapeToFrame(id, { kind: ShapeKind.Stroke, points: pts, color: c, width: w }); sound.playPop(); }}
            onRectEnd={(x, y, w, h, c, opacity, width, radius, frameTitle) => {
              const id = createRect(x, y, w, h, c, opacity, width, radius);
              if (id && frameTitle) {
                const minLayer = Math.min(...shapes.filter(shape => !shape.deleted).map((shape, index) => shape.data.zIndex ?? index), 0);
                updateShape(id, { frameTitle, zIndex: minLayer - 1, fillOpacity: 0.02 }, 'update');
                shapes.filter(shape => {
                  if (shape.deleted || shape.data.frameId || (shape.data.kind === ShapeKind.Rect && shape.data.frameTitle)) return false;
                  const bounds = shapeBBox(shape);
                  return bounds.minX >= x && bounds.minY >= y && bounds.maxX <= x + w && bounds.maxY <= y + h;
                }).forEach(shape => updateShape(shape.id, { frameId: id }, 'update'));
              } else {
                assignCreatedShapeToFrame(id, { kind: ShapeKind.Rect, x, y, w, h, color: c, fillOpacity: opacity, strokeWidth: width, cornerRadius: radius });
              }
              sound.playPop();
            }}
            onEllipseEnd={(cx, cy, rx, ry, c, opacity, width) => { const id = createEllipse(cx, cy, rx, ry, c, opacity, width); assignCreatedShapeToFrame(id, { kind: ShapeKind.Ellipse, cx, cy, rx, ry, color: c, fillOpacity: opacity, strokeWidth: width }); sound.playPop(); }}
            onLineEnd={(x1, y1, x2, y2, c, w, arrowEnd) => {
              const startTarget = findConnectorTarget({ x: x1, y: y1 });
              const endTarget = findConnectorTarget({ x: x2, y: y2 });
              const sameTarget = startTarget && startTarget === endTarget;
              const startShapeId = sameTarget ? undefined : startTarget;
              const endShapeId = sameTarget ? undefined : endTarget;
              const id = createLine(x1, y1, x2, y2, c, w, arrowEnd, startShapeId, endShapeId);
              assignCreatedShapeToFrame(id, { kind: ShapeKind.Line, x1, y1, x2, y2, color: c, width: w, arrowEnd, startShapeId, endShapeId });
              sound.playPop();
            }}
            onTextSubmit={(x, y, text, c) => { const pos = resolveTextOverlap({ x, y, text }, shapes); const id = createText(pos.x, pos.y, text, c); assignCreatedShapeToFrame(id, { kind: ShapeKind.Text, x: pos.x, y: pos.y, text, color: c }); sound.playPop(); }}
            onImageAdd={(x, y, w, h, src) => { const id = createImage(x, y, w, h, src); assignCreatedShapeToFrame(id, { kind: ShapeKind.Image, x, y, w, h, src }); sound.playPop(); }}
            onNoteAdd={(x, y, text, c, bg) => { const id = createNote(x, y, text, c, bg); assignCreatedShapeToFrame(id, { kind: ShapeKind.Note, x, y, w: 160, h: 140, text, color: c, bgColor: bg }); sound.playPop(); }}
            onDelete={deleteUnlockedShape}
            onDuplicate={duplicateShape}
            onDuplicateSelection={duplicateSelection}
            onGroupSelection={groupSelection}
            onUngroupSelection={ungroupSelection}
            onSelectionChange={handleSelectionChange}
            onShapeMoved={handleShapeMoved}
            onShapeResized={handleShapeResized}
            onShapeHistoryCommit={commitShapeHistory}
            onShapeHistoryCommitBatch={commitShapeHistoryBatch}
            onZoomChange={setCanvasScale}
            onImageDrop={(x, y, w, h, src) => { const id = createImage(x, y, w, h, src); assignCreatedShapeToFrame(id, { kind: ShapeKind.Image, x, y, w, h, src }); sound.playPop(); }}
            onCursorMove={setCursor}
            onLaserUpdate={(pts) => setLaserPoints(pts)}
            onResolveConflict={handleResolveConflict}
          />

          {shapes.filter(shape => !shape.deleted).length === 0 && !presentationMode && (
            <Box
              role="region"
              aria-label="Board starters"
              sx={{
                position: 'absolute',
                zIndex: 20,
                left: '50%',
                top: '56%',
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5,
                width: 'min(580px, 92%)',
                pointerEvents: 'auto',
                p: 2,
                borderRadius: 3,
                bgcolor: 'rgba(15,15,24,.88)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,.09)',
                boxShadow: '0 16px 48px rgba(0,0,0,.5)',
              }}
            >
              <Typography sx={{ color: '#f3e8ff', fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
                Start drawing or choose a curated template
              </Typography>
              <Typography sx={{ color: '#8888a8', fontSize: 11, textAlign: 'center', mt: -1 }}>
                Templates provide structured frames, sample sticky notes, and connected flow arrows.
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1, width: '100%' }}>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => setShowTemplates(true)}
                  sx={{
                    color: '#fff',
                    background: 'linear-gradient(135deg, rgba(124,58,237,0.9) 0%, rgba(59,130,246,0.75) 100%)',
                    textTransform: 'none',
                    fontWeight: 700,
                    fontSize: 11,
                    px: 2,
                    boxShadow: '0 4px 14px rgba(124,58,237,.35)',
                  }}
                >
                  ✦ Browse templates
                </Button>
                {CURATED_TEMPLATES.map(template => (
                  <Button
                    key={template.id}
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      const newShapes = instantiateTemplate(template);
                      doc?.transact(() => {
                        restoreSnapshotAsCopy({ title: template.title, shapes: newShapes }, false);
                      }, 'insert-starter-template');
                      sound.playSuccess();
                    }}
                    sx={{
                      color: '#ddd6fe',
                      borderColor: 'rgba(167,139,250,.28)',
                      bgcolor: 'rgba(255,255,255,.03)',
                      textTransform: 'none',
                      fontSize: 11,
                      '&:hover': { borderColor: '#a78bfa', bgcolor: 'rgba(124,58,237,.16)' },
                    }}
                  >
                    {template.title}
                  </Button>
                ))}
              </Box>
            </Box>
          )}

          {/* Floating Toolbar */}
          {!presentationMode && <Toolbar
            tool={tool}
            setTool={(t: ToolType) => {
              setTool(t);
              sound.playClick();
              if (t === 'image') fileInputRef.current?.click();
            }}
            activeColor={activeColor}
            setActiveColor={(c: string) => { setActiveColor(c); sound.playClick(); }}
            strokeWidth={strokeWidth}
            setStrokeWidth={handleStrokeWidthChange}
            onStrokeWidthCommit={commitStrokeWidthChange}
            fillOpacity={fillOpacity}
            setFillOpacity={handleFillOpacityChange}
            onFillOpacityCommit={commitFillOpacityChange}
            cornerRadius={cornerRadius}
            setCornerRadius={handleCornerRadiusChange}
            onCornerRadiusCommit={commitCornerRadiusChange}
            showGrid={showGrid}
            setShowGrid={setShowGrid}
            snapToGrid={snapToGrid}
            setSnapToGrid={setSnapToGrid}
            showObjects={showObjects}
            onToggleObjects={() => setShowObjects(value => !value)}
            showComments={showComments}
            onToggleComments={() => {
              setShowComments(value => !value);
              setShowChat(false);
              setShowFacilitation(false);
              setShowCheckpoints(false);
              setShowStencils(false);
            }}
            showFacilitation={showFacilitation}
            onToggleFacilitation={() => {
              setShowFacilitation(value => !value);
              setShowChat(false);
              setShowComments(false);
              setShowCheckpoints(false);
              setShowStencils(false);
            }}
            showCheckpoints={showCheckpoints}
            onToggleCheckpoints={() => {
              setShowCheckpoints(value => !value);
              setShowChat(false);
              setShowComments(false);
              setShowFacilitation(false);
              setShowStencils(false);
            }}
            showStencils={showStencils}
            onToggleStencils={() => {
              setShowStencils(value => !value);
              setShowChat(false);
              setShowComments(false);
              setShowFacilitation(false);
              setShowCheckpoints(false);
            }}
            onExportBoard={() => { void exportBoardPng(shapes, undefined, boardTitle).catch(error => window.alert(error instanceof Error ? error.message : 'Could not export this board.')); }}
            onExportSelection={() => { void exportBoardPng(shapes, selectedIds, boardTitle).catch(error => window.alert(error instanceof Error ? error.message : 'Could not export this selection.')); }}
            onExportPdf={() => { void exportBoardPdf(shapes, undefined, boardTitle).catch(error => window.alert(error instanceof Error ? error.message : 'Could not export this board as PDF.')); }}
            onExportSnapshot={() => downloadBoardSnapshot(shapes, boardTitle)}
            onImportSnapshot={() => snapshotInputRef.current?.click()}
            onExportTasks={() => setShowTaskHandoff(true)}
            scale={canvasScale}
            onZoomIn={() => setCanvasScale(s => Math.min(s * 1.2, 5))}
            onZoomOut={() => setCanvasScale(s => Math.max(s / 1.2, 0.2))}
            onResetView={() => setCanvasScale(1)}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => { undo(); sound.playClick(); }}
            onRedo={() => { redo(); sound.playClick(); }}
            conflictCount={conflicts.length}
            participantCount={peerCount}
            history={history}
            historyStep={historyStep}
            onHistoryChange={setHistoryStep}
            isPlaying={showScrubber}
            roomId={canvasRoomId || roomId}
            onCopyRoomId={() => { navigator.clipboard.writeText(canvasRoomId || roomId); sound.playClick(); }}
            setIsPlaying={(val) => {
              setShowScrubber(val);
              if (val) setIsPlaying(true);
              else setIsPlaying(false);
            }}
            onResetHistory={() => setHistoryStep(0)}
            onShowConflicts={setShowConflicts}
            showConflicts={showConflicts}
            onToggleSimulator={() => setShowSimulator(v => !v)}
            showSimulator={showSimulator}
            onToggleChat={() => {
              setShowChat(v => !v);
              setShowComments(false);
              setShowFacilitation(false);
              setShowCheckpoints(false);
              setShowStencils(false);
            }}
            showChat={showChat}
            hasSelection={selectedIds.length > 0}
            onDuplicateSelected={duplicateSelection}
            onDeleteSelected={deleteSelection}
            canTidyNotes={selectedNotes.length > 1}
            onTidySelectedNotes={tidySelectedNotes}
            onApplyColor={handleApplyColor}
            onGroupSelected={groupSelection}
            onUngroupSelected={ungroupSelection}
            canUngroup={canUngroupSelection}
            selectionCount={selectedIds.length}
            selectionLocked={selectionLocked}
            onToggleSelectionLock={toggleSelectionLock}
            onMoveSelectionLayer={moveSelectionLayer}
            onAlignSelection={alignSelection}
            connectorStatus={selectedShape?.data.kind === ShapeKind.Line ? { start: Boolean(selectedShape.data.startShapeId), end: Boolean(selectedShape.data.endShapeId), locked: Boolean(selectedShape.data.locked) } : undefined}
            onToggleConnectorEndpoint={toggleConnectorEndpoint}
          />}

          {/* Quick Find Bar */}
          {showFindBar && (
            <Box
              role="search"
              aria-label="Find on board"
              sx={{
                position: 'absolute',
                top: 14,
                right: 20,
                zIndex: 120,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.75,
                borderRadius: 2,
                bgcolor: 'rgba(15,15,24,.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(244,63,94,.45)',
                boxShadow: '0 8px 32px rgba(0,0,0,.6), 0 0 16px rgba(244,63,94,.2)',
              }}
            >
              <input
                ref={findInputRef}
                type="search"
                placeholder="Find text, notes, frames…"
                value={findQuery}
                onChange={e => {
                  setFindQuery(e.target.value);
                  setFindActiveIndex(0);
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowFindBar(false);
                    setHighlightShapeId(null);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) {
                      navigateToSearchMatch(findActiveIndex - 1);
                    } else {
                      navigateToSearchMatch(findActiveIndex + 1);
                    }
                  }
                }}
                aria-label="Search board text"
                style={{
                  width: 180,
                  padding: '5px 8px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,.07)',
                  color: '#f8fafc',
                  border: '1px solid rgba(255,255,255,.15)',
                  outline: 'none',
                  fontSize: 12,
                }}
              />
              <Typography sx={{ fontSize: 11, color: searchMatches.length ? '#f43f5e' : '#94a3b8', minWidth: 64, textAlign: 'center', fontWeight: 600 }}>
                {searchMatches.length > 0
                  ? `${findActiveIndex + 1} of ${searchMatches.length}`
                  : findQuery.trim()
                  ? '0 results'
                  : 'Type to find'}
              </Typography>
              <Button
                size="small"
                disabled={searchMatches.length === 0}
                onClick={() => navigateToSearchMatch(findActiveIndex - 1)}
                aria-label="Previous match"
                sx={{ minWidth: 24, px: 0.75, py: 0.25, fontSize: 11, color: '#f43f5e' }}
              >
                ▲
              </Button>
              <Button
                size="small"
                disabled={searchMatches.length === 0}
                onClick={() => navigateToSearchMatch(findActiveIndex + 1)}
                aria-label="Next match"
                sx={{ minWidth: 24, px: 0.75, py: 0.25, fontSize: 11, color: '#f43f5e' }}
              >
                ▼
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setShowFindBar(false);
                  setHighlightShapeId(null);
                }}
                aria-label="Close find bar"
                sx={{ minWidth: 24, px: 0.75, py: 0.25, fontSize: 11, color: '#94a3b8' }}
              >
                ✕
              </Button>
              {searchAnnouncement && (
                <Box sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }} aria-live="polite">
                  {searchAnnouncement}
                </Box>
              )}
            </Box>
          )}

          {presentationMode && activePresentationFrame && <Box role="region" aria-label="Frame presentation controls" sx={{ position: 'absolute', zIndex: 120, left: '50%', bottom: 24, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: 2, bgcolor: 'rgba(15,15,22,.94)', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 8px 28px rgba(0,0,0,.45)' }}>
            <Button size="small" disabled={presentationIndex <= 0} onClick={() => setPresentationIndex(index => Math.max(0, index - 1))} aria-label="Previous frame">← Previous</Button>
            <Typography aria-live="polite" sx={{ minWidth: 150, textAlign: 'center', color: '#e2e2f0', fontSize: 12, fontWeight: 700 }}>
              {activePresentationFrame.data.kind === ShapeKind.Rect ? activePresentationFrame.data.frameTitle : 'Frame'} · {presentationIndex + 1} / {frames.length}
            </Typography>
            <Button size="small" disabled={presentationIndex >= frames.length - 1} onClick={() => setPresentationIndex(index => Math.min(frames.length - 1, index + 1))} aria-label="Next frame">Next →</Button>
            <Button size="small" onClick={() => setPresentationMode(false)} aria-label="Exit frame presentation">Exit</Button>
          </Box>}

          {showObjects && <Box sx={{
            position: 'absolute', top: 58, left: 16, zIndex: 95, width: 250, maxHeight: 'calc(100% - 80px)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 2,
            background: 'rgba(15,15,22,.97)', border: '1px solid rgba(255,255,255,.1)',
            boxShadow: '0 8px 28px rgba(0,0,0,.4)',
          }}>
            <Box sx={{ p: 1.25, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#e2e2f0', mb: 0.25 }}>Board objects · {shapes.filter(shape => !shape.deleted).length}</Typography>
              <Typography sx={{ fontSize: 9, color: '#85859b', mb: 0.75 }}>Use arrows to navigate · F2 edits text and notes</Typography>
              <input
                type="search"
                aria-label="Search board objects"
                placeholder="Find text, notes, and frames…"
                value={objectSearch}
                onChange={event => setObjectSearch(event.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 6, color: '#e2e2f0', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', outline: 'none', fontSize: 11 }}
              />
            </Box>
            <Box role="listbox" aria-label="Board objects" sx={{ overflowY: 'auto', p: 0.5 }}>
              {shapes.filter(shape => !shape.deleted).slice().reverse().filter(shape => {
                const data = shape.data;
                const label = data.kind === ShapeKind.Text || data.kind === ShapeKind.Note ? data.text
                  : data.kind === ShapeKind.Rect && data.frameTitle ? data.frameTitle : data.kind;
                return label.toLowerCase().includes(objectSearch.trim().toLowerCase());
              }).map(shape => {
                const data = shape.data;
                const label = data.kind === ShapeKind.Text || data.kind === ShapeKind.Note ? data.text.replace(/\s+/g, ' ').slice(0, 38)
                  : data.kind === ShapeKind.Rect && data.frameTitle ? data.frameTitle : data.kind;
                return <button
                  key={shape.id}
                  role="option"
                  aria-keyshortcuts={data.kind === ShapeKind.Text || data.kind === ShapeKind.Note || (data.kind === ShapeKind.Rect && !!data.frameTitle) ? 'F2' : undefined}
                  aria-selected={selectedIds.includes(shape.id)}
                  tabIndex={selectedIds.includes(shape.id) || !selectedIds.length ? 0 : -1}
                  onClick={() => { setSelectedIds([shape.id]); setSelectedId(shape.id); setTool('select'); setFocusObjectId(shape.id); triggerTemporaryHighlight(shape.id); }}
                  onKeyDown={event => {
                    if (event.key === 'F2' && (data.kind === ShapeKind.Text || data.kind === ShapeKind.Note || (data.kind === ShapeKind.Rect && !!data.frameTitle))) {
                      event.preventDefault();
                      setTool('select');
                      setEditShapeRequest({ id: shape.id, token: ++editRequestSequenceRef.current });
                      return;
                    }
                    const options = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="option"]') ?? []);
                    const index = options.indexOf(event.currentTarget);
                    const nextIndex = event.key === 'ArrowDown' ? Math.min(options.length - 1, index + 1)
                      : event.key === 'ArrowUp' ? Math.max(0, index - 1)
                      : event.key === 'Home' ? 0
                      : event.key === 'End' ? options.length - 1 : -1;
                    if (nextIndex >= 0) {
                      event.preventDefault();
                      options[nextIndex]?.focus();
                    }
                  }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', textAlign: 'left', color: selectedIds.includes(shape.id) ? '#e9d5ff' : '#b7b7c9', background: selectedIds.includes(shape.id) ? 'rgba(124,58,237,.2)' : 'transparent', border: 0, borderRadius: 5, cursor: 'pointer', fontSize: 11 }}
                >
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, flex: '0 0 auto', background: data.kind === ShapeKind.Note ? data.bgColor : 'color' in data ? data.color : '#64748b' }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label || `Untitled ${data.kind}`}</span>
                  {data.locked && <span aria-label="Locked">🔒</span>}
                </button>;
              })}
            </Box>
          </Box>}

          {showBoardDetails && <Box role="region" aria-label="Board details" sx={{ position: 'absolute', top: 58, right: 16, zIndex: 96, width: 260, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 2, bgcolor: 'rgba(15,15,22,.97)', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 8px 28px rgba(0,0,0,.4)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ color: '#e2e2f0', fontSize: 12, fontWeight: 700 }}>Board details</Typography>
              <Button size="small" onClick={() => setShowBoardDetails(false)} aria-label="Close board details">Close</Button>
            </Box>
            <label style={{ color: '#9898ae', fontSize: 10 }}>Description
              <textarea aria-label="Board description" maxLength={400} rows={3} value={boardMetadata.description} onChange={event => updateBoardMetadata({ description: event.target.value })} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 8, borderRadius: 6, color: '#e2e2f0', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', font: '11px Inter, sans-serif' }} />
            </label>
            <label style={{ color: '#9898ae', fontSize: 10 }}>Workspace / folder
              <input aria-label="Workspace or folder" maxLength={48} value={boardMetadata.folder} onChange={event => updateBoardMetadata({ folder: event.target.value })} placeholder="e.g. Product team" style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6, color: '#e2e2f0', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', fontSize: 11 }} />
            </label>
            <label style={{ color: '#9898ae', fontSize: 10 }}>Tags (comma separated)
              <input aria-label="Board tags, separated by commas" value={boardMetadata.tags.join(', ')} onChange={event => updateBoardMetadata({ tags: [...new Set(event.target.value.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, 12) })} placeholder="planning, Q4, research" style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6, color: '#e2e2f0', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', fontSize: 11 }} />
            </label>
            <Divider sx={{ borderColor: 'rgba(255,255,255,.08)', my: 0.25 }} />
            <Button
              variant="outlined"
              size="small"
              onClick={() => void handleDuplicateBoard()}
              sx={{
                textTransform: 'none',
                color: '#c4b5fd',
                borderColor: 'rgba(167,139,250,.35)',
                fontSize: 11,
                fontWeight: 600,
                '&:hover': { borderColor: '#a78bfa', bgcolor: 'rgba(124,58,237,.14)' },
              }}
            >
              ⧉ Duplicate as new board
            </Button>
            <Typography sx={{ color: '#73738a', fontSize: 9 }}>These organization details are saved on this device.</Typography>
          </Box>}

          <Box aria-live="polite" aria-atomic="true" sx={{ position: 'absolute', width: 1, height: 1, p: 0, m: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
            {selectedShape ? `Selected ${selectedShape.data.kind}${selectedShape.data.kind === ShapeKind.Text || selectedShape.data.kind === ShapeKind.Note ? `: ${selectedShape.data.text.slice(0, 80)}` : selectedShape.data.kind === ShapeKind.Rect && selectedShape.data.frameTitle ? `: ${selectedShape.data.frameTitle}` : ''}. ${selectedIds.length} object${selectedIds.length === 1 ? '' : 's'} selected.` : 'No object selected.'}
          </Box>

          {/* Floating Demo Showcase Bar */}
          {!hideShowcase && (
            <DemoShowcaseBar
              onRunUnionBoxDemo={runUnionBoxDemo}
              onRunAmbiguityDemo={runAmbiguityDemo}
              onRunHistoryDemo={runHistoryDemo}
              onRunPartitionDemo={runPartitionDemo}
              onToggleSplitScreen={onToggleSplitScreen}
              isSplitScreen={isSplitScreen}
            />
          )}

          {/* Conflict Resolution handled by CanvasRenderer natively */}

          {/* Partition Simulator Modal */}
          <PartitionSimulator
            enabled={showSimulator}
            setEnabled={setShowSimulator}
            onSimulate={scenario => {
              if (scenario === 'network-split') simulateOffline();
              else if (scenario === 'reconnect') simulateOnline();
              else if (scenario === 'offline-edit') simulateOffline();
            }}
          />

          {/* Time Travel Scrubber */}
          {history && showScrubber && (
            <TimeTravelScrubber
              historyStep={historyStep}
              totalSteps={history.totalSteps}
              isPlaying={isPlaying}
              onHistoryChange={(step) => {
                setHistoryStep(step);
                setIsPlaying(false);
              }}
              onPlayPause={() => setIsPlaying(!isPlaying)}
              onClose={() => {
                setShowScrubber(false);
                setIsPlaying(false);
              }}
            />
          )}

          {/* Connection status banner */}
          <ConnectionBanner
            state={connectionState}
            peerCount={peerCount}
            queuedOps={queuedOps}
            onReconnect={triggerReconnect}
          />

          {/* Status Panel (bottom right) */}
          <StatusPanel
            connected={connected}
            peerCount={peerCount}
            shapeCount={shapes.length}
            conflictCount={conflicts.length}
            historyStep={historyStep}
            totalHistorySteps={history?.totalSteps ?? 0}
            roomId={canvasRoomId || roomId}
            localIP={localIP}
            connectionState={connectionState}
            queuedOps={queuedOps}
            persistenceState={persistenceState}
            persistenceError={persistenceError}
            migrationSummary={migrationSummary}
            migrationBackupAvailable={migrationBackupAvailable}
            onDownloadMigrationBackup={() => void downloadMigrationBackup(canvasRoomId || roomId).catch(error => window.alert(error instanceof Error ? error.message : 'Could not download the recovery copy.'))}
          />

          {mergeLens && (
            <MergeLens
              scenario={mergeLens}
              compact={isCompact}
              onClose={() => setMergeLens(null)}
            />
          )}
        </Box>

        {/* Right collapsible chat sidebar */}
        <Box sx={{
          width: showChat || showComments || showFacilitation || showCheckpoints || showStencils ? (isCompact ? 260 : 300) : 0,
          minWidth: showChat || showComments || showFacilitation || showCheckpoints || showStencils ? (isCompact ? 260 : 300) : 0,
          height: '100%',
          background: 'rgba(15, 15, 22, 0.98)',
          borderLeft: showChat || showComments || showFacilitation || showCheckpoints || showStencils ? '1px solid rgba(255,255,255,0.06)' : 'none',
          overflow: 'hidden',
          transition: 'width 0.2s ease, min-width 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          zIndex: 25,
        }}>
          {showComments && <CommentsPanel
            comments={comments}
            actorName={actorName}
            participants={participants}
            selectedShape={selectedShape}
            onAdd={handleAddComment}
            onResolve={resolveComment}
            onReact={(id, emoji) => toggleReaction(id, commentActorId, emoji)}
            onClose={() => setShowComments(false)}
          />}
          {showFacilitation && <FacilitationPanel
            shapes={shapes}
            voting={facilitation.voting}
            maxVotesPerPerson={facilitation.maxVotesPerPerson}
            voteCounts={facilitation.voteCounts}
            remainingSeconds={facilitation.remainingSeconds}
            timerLabel={facilitation.timerLabel}
            timerRunning={facilitation.timerRunning}
            retrospectiveStep={facilitation.retrospectiveStep}
            onSetVoting={facilitation.setVoting}
            onStartTimer={facilitation.startTimer}
            onStopTimer={facilitation.stopTimer}
            onSetRetrospectiveStep={facilitation.setRetrospectiveStep}
            onClose={() => setShowFacilitation(false)}
          />}
          {showCheckpoints && <CheckpointsPanel
            checkpoints={checkpoints}
            onCreate={name => createCheckpoint(name, actorName, shapes)}
            onRestore={checkpoint => restoreSnapshotAsCopy({ title: checkpoint.name, shapes: checkpoint.shapes })}
            onDelete={deleteCheckpoint}
            onClose={() => setShowCheckpoints(false)}
          />}
          {showStencils && <StencilsPanel
            stencils={stencilLibrary.stencils}
            selectedShapes={shapes.filter(shape => selectedIds.includes(shape.id) && !shape.deleted)}
            loading={stencilLibrary.loading}
            error={stencilLibrary.error}
            onSave={stencilLibrary.save}
            onInsert={(stencil, version) => {
              const shiftedShapes = offsetSnapshotShapes(version.shapes, 56, 56);
              doc?.transact(() => restoreSnapshotAsCopy({ title: stencil.name, shapes: shiftedShapes }, false), 'insert-stencil');
            }}
            onDelete={stencilLibrary.remove}
            onClose={() => setShowStencils(false)}
          />}
          {showChat && (
            <ChatPanel
              doc={doc}
              actorName={actorName}
              actorColor={activeColor}
              onClose={() => setShowChat(false)}
            />
          )}
          <TemplatesModal
            open={showTemplates}
            onClose={() => setShowTemplates(false)}
            onInsertToCanvas={(templateShapes, title) => {
              doc?.transact(() => {
                restoreSnapshotAsCopy({ title, shapes: templateShapes }, false);
              }, 'insert-template');
              sound.playSuccess();
            }}
            onCreateNewBoard={(templateShapes, title) => {
              const newRoomId = generateRoomId();
              try {
                localStorage.setItem(`crdt-canvas-title-${newRoomId}`, title);
                sessionStorage.setItem(`crdt-canvas-initial-snapshot-${newRoomId}`, JSON.stringify({ title, shapes: templateShapes }));
                const rawRecents = localStorage.getItem('crdt-canvas-recent-boards') || '[]';
                const recentBoards = JSON.parse(rawRecents);
                const updated = [{ roomId: newRoomId, title }, ...recentBoards.filter((b: any) => b.roomId !== newRoomId)].slice(0, 10);
                localStorage.setItem('crdt-canvas-recent-boards', JSON.stringify(updated));
              } catch {
                // ignore
              }
              if (onSwitchRoom) {
                onSwitchRoom(newRoomId);
              } else {
                window.alert(`Created board “${title}” (Room: ${newRoomId}).`);
              }
            }}
            isCanvasEmpty={shapes.filter(s => !s.deleted).length === 0}
          />
          <TaskTrackerHandoffModal
            open={showTaskHandoff}
            onClose={() => setShowTaskHandoff(false)}
            shapes={shapes}
            selectedIds={selectedIds}
            boardTitle={boardTitle}
          />
          <ShareBoardModal
            open={showShare}
            onClose={() => setShowShare(false)}
            roomId={canvasRoomId || roomId}
            boardTitle={boardTitle}
            isReadOnly={isReadOnly}
          />
        </Box>
      </Box>
    </Box>
  );
}

function readLocalBoardMetadata(roomId: string): LocalBoardMetadata {
  try {
    const value = JSON.parse(localStorage.getItem(`crdt-canvas-meta-${roomId}`) || '{}');
    return {
      description: typeof value.description === 'string' ? value.description : '',
      folder: typeof value.folder === 'string' ? value.folder : '',
      tags: Array.isArray(value.tags) ? value.tags.filter((tag: unknown): tag is string => typeof tag === 'string').slice(0, 12) : [],
    };
  } catch {
    return { description: '', folder: '', tags: [] };
  }
}
