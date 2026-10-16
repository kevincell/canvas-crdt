/**
 * BoardScreen — composition root for one open board.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  ShapeKind,
  applyMerge,
  decodeBoardFile,
  isBoardFile,
  previewMerge,
  shapeBBox,
  yjsShapesToShapes,
  type BoardFileHeader,
  type MergePreview,
  type Shape,
} from '@crdt-canvas/engine';
import { BoardSession } from './session';
import { Editor, type Tool } from './editor';
import { CanvasView } from './canvas/CanvasView';
import { TopBar, PANELS, type PanelId } from './chrome/TopBar';
import { ToolDock, TOOLS } from './chrome/ToolDock';
import { StylePanel } from './chrome/StylePanel';
import { CatchUpBanner, EmptyHint, Minimap, ZoomBar } from './chrome/Overlays';
import { CommandPalette, shapeText, type Command } from './chrome/CommandPalette';
import { MergeDialog, ProfileDialog, ShareDialog, ShortcutsDialog } from './chrome/Dialogs';
import { SidePanel, useTimeline } from './chrome/SidePanel';
import { useParticipants } from './presence';
import { copyPng, exportMergeFile, exportPdf, exportPng, exportSnapshot, renderToCanvas } from './export';
import { mergeBranchInto, previewBranchMerge } from './branches';
import { MenuItem, errorMessage, useToast } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { getBoard, upsertBoard } from '../app/boards';
import { boardHash, goHome, navigate, type Route } from '../app/router';
import { makeActor, saveIdentity, type Identity } from '../app/identity';
import { setThemePreference, useThemePreference } from '../app/theme';
import { createBoard, takeInitialContent } from '../app/newBoard';
import { calculateBoardImageBytes, prepareBoardImage } from '../features/canvas/prepareImage';
import { readBoardSnapshot } from '../features/canvas/boardSnapshot';
import { consumeInitialBoardSnapshot } from '../features/canvas/boardDuplication';
import { downloadMigrationBackup } from '../features/canvas/migrationRecovery';
import { useBoardComments } from '../features/comments/useBoardComments';
import { useFacilitation } from '../features/facilitation/useFacilitation';

const TemplatesModal = lazy(() => Promise.all([import('../ui/mui'), import('../features/templates/TemplatesModal')]).then(([ui, m]) => ({ default: ui.withMui(m.TemplatesModal) })));
const TaskTrackerHandoffModal = lazy(() => Promise.all([import('../ui/mui'), import('../features/integrations/TaskTrackerHandoffModal')]).then(([ui, m]) => ({ default: ui.withMui(m.TaskTrackerHandoffModal) })));

type BoardRoute = Extract<Route, { name: 'board' }>;

export function BoardScreen({ route, identity, onIdentity, dark }: {
  route: BoardRoute;
  identity: Identity;
  onIdentity: (identity: Identity) => void;
  dark: boolean;
}) {
  // A `?as=Name` link opens a guest identity for this tab only (second-peer demos).
  const effectiveIdentity = useMemo<Identity>(() => {
    if (!route.as) return identity;
    const name = route.as.slice(0, 32);
    return { ...identity, name, actor: makeActor(name, identity.deviceId.split('').reverse().join('')), color: '#0c8599' };
  }, [identity, route.as]);

  const registryEntry = getBoard(route.roomId);
  const boardKey = route.key ?? registryEntry?.key;

  const [session, setSession] = useState<BoardSession | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    const s = new BoardSession({
      roomId: route.roomId,
      actor: effectiveIdentity.actor,
      key: boardKey,
      readOnly: route.viewOnly,
      fallbackTitle: registryEntry?.title && registryEntry.title !== route.roomId ? registryEntry.title : 'Untitled board',
    });
    const e = new Editor(s);
    setSession(s);
    setEditor(e);
    return () => { s.destroy(); setSession(null); setEditor(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.roomId, boardKey, route.viewOnly]);

  // Identity changes apply to new edits immediately.
  useEffect(() => { if (session) session.store.actor = effectiveIdentity.actor; }, [session, effectiveIdentity.actor]);

  // Remember the board (and its key) on this device; keep the key in the URL.
  useEffect(() => {
    upsertBoard(route.roomId, { lastOpened: Date.now(), ...(boardKey ? { key: boardKey } : {}) });
    if (!route.key && boardKey) navigate(boardHash(route.roomId, { key: boardKey, viewOnly: route.viewOnly, present: route.present, as: route.as }), true);
  }, [route.roomId, route.key, boardKey, route.viewOnly, route.present, route.as]);

  if (!session || !editor) return <div style={{ position: 'absolute', inset: 0, background: 'var(--canvas)' }} />;
  return <BoardUI key={route.roomId} session={session} editor={editor} route={route} identity={effectiveIdentity} onIdentity={onIdentity} dark={dark} boardKey={boardKey} />;
}

function BoardUI({ session, editor, route, identity, onIdentity, dark, boardKey }: {
  session: BoardSession; editor: Editor; route: BoardRoute; identity: Identity; onIdentity: (identity: Identity) => void; dark: boolean; boardKey?: string;
}) {
  const toast = useToast();
  const status = useSyncExternalStore(session.subscribeStatus, session.getStatus);
  const meta = useSyncExternalStore(session.subscribeMeta, session.getMeta);
  const snapshot = useSyncExternalStore(session.store.subscribe, session.store.getSnapshot);
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const catchUp = useSyncExternalStore(session.subscribeCatchUp, session.getCatchUp);
  const participants = useParticipants(session.awareness);
  const comments = useBoardComments(session.doc, identity.name, identity.actor);
  const facilitation = useFacilitation(session.doc, identity.name);
  const timeline = useTimeline(session);
  const themePref = useThemePreference();

  const [panel, setPanel] = useState<PanelId | null>(null);
  const [palette, setPalette] = useState<{ open: boolean; query: string }>({ open: false, query: '' });
  const [dialog, setDialog] = useState<'share' | 'shortcuts' | 'profile' | 'templates' | 'tasks' | null>(null);
  const [merge, setMerge] = useState<{ header: BoardFileHeader; preview: MergePreview; apply: () => Promise<void> | void; copy: () => void } | null>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const compact = width < 760;
  const readOnly = editor.readOnly;
  const registry = getBoard(session.roomId);

  useEffect(() => {
    editor.onToast = (message, tone) => toast(message, { tone });
  }, [editor, toast]);

  // Test/debug handle (development builds, or ?debug in the URL).
  useEffect(() => {
    if (!import.meta.env.DEV && !window.location.hash.includes('debug')) return;
    (window as unknown as { __crdtCanvas?: unknown }).__crdtCanvas = { editor, session };
    return () => { delete (window as unknown as { __crdtCanvas?: unknown }).__crdtCanvas; };
  }, [editor, session]);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { document.title = `${meta.title} · CRDT Canvas`; return () => { document.title = 'CRDT Canvas'; }; }, [meta.title]);

  // Keep the local registry in step with the shared title.
  useEffect(() => { upsertBoard(session.roomId, { title: meta.title }); }, [meta.title, session.roomId]);

  // First load: adopt a legacy local title into the shared document, hydrate new-board content.
  const hydrated = useRef(false);
  useEffect(() => {
    if (status.persistence !== 'ready' || hydrated.current) return;
    hydrated.current = true;
    if (!session.meta.get('title') && registry?.title && registry.title !== session.roomId && !readOnly) session.setTitle(registry.title);
    const content = takeInitialContent(session.roomId);
    const legacy = content ? null : consumeInitialBoardSnapshot(session.roomId);
    if (content?.kind === 'update') {
      Y.applyUpdate(session.doc, content.update, 'board-init');
      if (registry?.title) session.setTitle(registry.title);
      session.markBaseline('reopen');
    } else if (content?.kind === 'shapes' || legacy) {
      const shapes = content?.kind === 'shapes' ? content.shapes : legacy!.shapes;
      editor.insertShapes(shapes);
      session.store.undoManager.clear();
      setTimeout(() => editor.zoomToFit(undefined, false), 50);
    }
    if (route.present) startPresentation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.persistence]);

  // Save a thumbnail for the home screen when leaving or hiding the tab.
  useEffect(() => {
    const save = async () => {
      const snap = session.store.getSnapshot();
      if (!snap.shapes.length) { upsertBoard(session.roomId, { thumbnail: undefined, shapeCount: 0 }); return; }
      try {
        const canvas = await renderToCanvas({ shapes: snap.shapes, byId: snap.byId, dark: false, sketch: session.getMeta().style === 'sketch', background: true, scale: 0.25 });
        const thumb = document.createElement('canvas');
        const ratio = Math.min(320 / canvas.width, 200 / canvas.height, 1);
        thumb.width = Math.max(1, Math.round(canvas.width * ratio));
        thumb.height = Math.max(1, Math.round(canvas.height * ratio));
        thumb.getContext('2d')?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
        upsertBoard(session.roomId, { thumbnail: thumb.toDataURL('image/webp', 0.7), shapeCount: snap.shapes.length });
      } catch { /* thumbnails are best-effort */ }
    };
    const onHide = () => { if (document.visibilityState === 'hidden') void save(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); void save(); };
  }, [session]);

  // Facilitation timer finished.
  const lastTimer = useRef(facilitation.timerRunning);
  useEffect(() => {
    if (lastTimer.current && !facilitation.timerRunning && facilitation.remainingSeconds === 0) toast(`⏰ ${facilitation.timerLabel || 'Timer'} finished`);
    lastTimer.current = facilitation.timerRunning;
  }, [facilitation.timerRunning, facilitation.remainingSeconds, facilitation.timerLabel, toast]);

  // ── Presentation ──────────────────────────────────────────────────────────
  const frames = useMemo(() => snapshot.shapes
    .filter(s => s.data.kind === ShapeKind.Rect && s.data.frameTitle)
    .sort((a, b) => {
      const A = shapeBBox(a), B = shapeBBox(b);
      return Math.abs(A.minY - B.minY) > 80 ? A.minY - B.minY : A.minX - B.minX;
    }), [snapshot.shapes]);

  const startPresentation = useCallback(() => {
    if (!frames.length) { toast('Add a frame (F) to present: each frame becomes a slide.'); return; }
    editor.setState({ presenting: { index: 0 }, selection: [] });
    setPanel(null);
  }, [editor, frames.length, toast]);

  useEffect(() => {
    if (!state.presenting) return;
    const frame = frames[state.presenting.index];
    if (frame) editor.zoomToBounds(shapeBBox(frame), 4);
  }, [state.presenting, frames, editor]);

  // ── Files ─────────────────────────────────────────────────────────────────
  const addImage = useCallback(async (file: File, at: { x: number; y: number }) => {
    try {
      const { src, width: w, height: h } = await prepareBoardImage(file, calculateBoardImageBytes(session.store.getSnapshot().shapes));
      const scale = Math.min(1, 640 / Math.max(w, h));
      editor.create(ShapeKind.Image, { x: at.x - (w * scale) / 2, y: at.y - (h * scale) / 2, w: w * scale, h: h * scale, src });
    } catch (error) {
      toast(errorMessage(error, 'Could not add this image.'), { tone: 'error' });
    }
  }, [editor, session, toast]);

  const openFile = useCallback(async (file: File, at?: { x: number; y: number }) => {
    const center = at ?? editor.viewportCenter();
    try {
      if (file.type.startsWith('image/')) { await addImage(file, center); return; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isBoardFile(bytes)) {
        const { header, update } = decodeBoardFile(bytes);
        const preview = previewMerge(session.doc, update);
        setMerge({
          header,
          preview,
          apply: () => {
            session.markBaseline('merge');
            applyMerge(session.doc, update);
            toast(`Merged “${header.title}”`);
          },
          copy: () => {
            const scratch = new Y.Doc();
            applyMerge(scratch, update);
            const live = yjsShapesToShapes(scratch.getArray<Y.XmlElement>('shapes')).filter(s => !s.deleted);
            scratch.destroy();
            const ids = editor.insertShapes(live.map(s => ({ id: s.id, data: s.data })), { center });
            editor.select(ids, { expandGroups: false });
          },
        });
        return;
      }
      const snapshotFile = await readBoardSnapshot(file);
      const ids = editor.insertShapes(snapshotFile.shapes, { center });
      editor.select(ids, { expandGroups: false });
      toast(`Added ${ids.length} objects from “${snapshotFile.title}”`);
    } catch (error) {
      toast(errorMessage(error, 'This file could not be opened.'), { tone: 'error' });
    }
  }, [addImage, editor, session, toast]);

  // ── Exports ───────────────────────────────────────────────────────────────
  const exportOptions = useCallback((selectionOnly: boolean) => {
    const snap = session.store.getSnapshot();
    const shapes = selectionOnly && state.selection.length ? editor.withFrameContents(editor.selectedShapes) : snap.shapes;
    return { shapes, byId: snap.byId, dark, sketch: meta.style === 'sketch', background: true };
  }, [session, editor, state.selection, dark, meta.style]);

  const run = useCallback((task: () => Promise<unknown> | unknown, success?: string) => {
    Promise.resolve().then(task).then(() => { if (success) toast(success); }).catch(error => toast(errorMessage(error, 'Something went wrong.'), { tone: 'error' }));
  }, [toast]);

  const saveMergeFile = useCallback(() => {
    exportMergeFile(session.doc, meta.title, session.roomId, identity.actor);
    toast('Merge file saved. Anyone who opens it gets your changes merged into theirs.');
  }, [session, meta.title, identity.actor, toast]);

  // ── Board-level actions ───────────────────────────────────────────────────
  const duplicateBoard = useCallback(() => {
    const shapes = session.store.getSnapshot().shapes.map(s => ({ id: s.id, data: s.data }));
    createBoard({ title: `${meta.title} (copy)`, content: { kind: 'shapes', shapes } });
  }, [session, meta.title]);

  const branchBoard = useCallback(() => {
    createBoard({ title: `${meta.title} · branch`, content: { kind: 'update', update: Y.encodeStateAsUpdate(session.doc) }, parentId: session.roomId });
    toast('Branch created. Experiment freely, then merge it back from the menu.');
  }, [session, meta.title, toast]);

  const mergeIntoParent = useCallback(async () => {
    const parentId = registry?.parentId;
    if (!parentId) return;
    const parent = getBoard(parentId);
    try {
      const preview = await previewBranchMerge(parentId, session.doc);
      setMerge({
        header: { format: 'crdt-canvas-merge', version: 1, title: `Merge into “${parent?.title ?? parentId}”`, exportedAt: new Date().toISOString(), shapeCount: snapshot.shapes.length },
        preview,
        apply: async () => {
          await mergeBranchInto(parentId, session.doc);
          toast(`Merged into “${parent?.title ?? parentId}”`, { action: { label: 'Open', run: () => navigate(boardHash(parentId, { key: parent?.key })) } });
        },
        copy: () => {},
      });
    } catch (error) {
      toast(errorMessage(error, 'The parent board is not stored on this device.'), { tone: 'error' });
    }
  }, [registry?.parentId, session, snapshot.shapes.length, toast]);

  const jumpToShape = useCallback((shape: Shape) => {
    editor.select([shape.id]);
    editor.zoomToFit([shape.id]);
    editor.highlight(shape.id);
    setTimeout(() => { if (editor.getState().highlightId === shape.id) editor.highlight(null); }, 2200);
  }, [editor]);

  const pickImage = useCallback(() => imageInput.current?.click(), []);

  // ── Commands (palette + menu share these) ─────────────────────────────────
  const commands = useMemo<Command[]>(() => {
    const edit = !readOnly;
    const sel = state.selection.length > 0;
    const list: Command[] = [
      ...TOOLS.filter(t => edit || ['select', 'hand', 'laser'].includes(t.id)).map(t => ({ id: `tool-${t.id}`, label: `${t.label} tool`, group: 'Tools', icon: t.icon, hint: t.key, run: () => t.id === 'image' ? pickImage() : editor.setTool(t.id as Tool) })),
      { id: 'undo', label: 'Undo', group: 'Edit', icon: 'undo', hint: 'Ctrl Z', run: () => editor.undo(), disabled: !edit },
      { id: 'redo', label: 'Redo', group: 'Edit', icon: 'redo', hint: 'Ctrl Shift Z', run: () => editor.redo(), disabled: !edit },
      { id: 'select-all', label: 'Select all', group: 'Edit', icon: 'select', hint: 'Ctrl A', run: () => editor.selectAll() },
      { id: 'duplicate', label: 'Duplicate selection', group: 'Edit', icon: 'copy', hint: 'Ctrl D', run: () => editor.duplicateSelection(), disabled: !edit || !sel },
      { id: 'delete', label: 'Delete selection', group: 'Edit', icon: 'trash', hint: 'Del', run: () => editor.deleteSelection(), disabled: !edit || !sel },
      { id: 'group', label: 'Group selection', group: 'Edit', icon: 'group', hint: 'Ctrl G', run: () => editor.groupSelection(), disabled: !edit || state.selection.length < 2 },
      { id: 'ungroup', label: 'Ungroup', group: 'Edit', icon: 'ungroup', hint: 'Ctrl Shift G', run: () => editor.ungroupSelection(), disabled: !edit || !sel },
      { id: 'lock', label: 'Lock / unlock selection', group: 'Edit', icon: 'lock', hint: 'Ctrl Shift L', run: () => editor.toggleLock(), disabled: !edit || !sel },
      { id: 'front', label: 'Bring to front', group: 'Arrange', icon: 'front', hint: ']', run: () => editor.reorder('front'), disabled: !edit || !sel },
      { id: 'back', label: 'Send to back', group: 'Arrange', icon: 'back', hint: '[', run: () => editor.reorder('back'), disabled: !edit || !sel },
      ...(['left', 'centerX', 'right', 'top', 'centerY', 'bottom', 'distributeX', 'distributeY'] as const).map(mode => ({
        id: `align-${mode}`, label: { left: 'Align left', centerX: 'Align centres', right: 'Align right', top: 'Align top', centerY: 'Align middles', bottom: 'Align bottom', distributeX: 'Distribute horizontally', distributeY: 'Distribute vertically' }[mode],
        group: 'Arrange', icon: (mode.startsWith('distribute') ? (mode === 'distributeX' ? 'distributeH' : 'distributeV') : ({ left: 'alignLeft', centerX: 'alignCenterH', right: 'alignRight', top: 'alignTop', centerY: 'alignCenterV', bottom: 'alignBottom' } as const)[mode as 'left']) as Command['icon'],
        run: () => editor.align(mode), disabled: !edit || state.selection.length < 2,
      })),
      { id: 'tidy', label: 'Tidy selected notes into a grid', group: 'Arrange', icon: 'wand', run: () => editor.tidyNotes(), disabled: !edit || state.selection.length < 2 },
      { id: 'fit', label: 'Zoom to fit', group: 'View', icon: 'fit', hint: 'Shift 1', run: () => editor.zoomToFit() },
      { id: 'fit-sel', label: 'Zoom to selection', group: 'View', icon: 'select', hint: 'Shift 2', run: () => editor.zoomToFit(state.selection), disabled: !sel },
      { id: 'zoom-100', label: 'Zoom to 100%', group: 'View', hint: 'Shift 0', run: () => editor.zoomTo(1) },
      { id: 'grid', label: state.showGrid ? 'Hide grid' : 'Show grid', group: 'View', icon: 'grid', hint: 'G', run: () => editor.toggleGrid() },
      { id: 'snap', label: state.snapToGrid ? 'Turn off snap to grid' : 'Snap to grid', group: 'View', icon: 'magnet', run: () => editor.setState({ snapToGrid: !state.snapToGrid }) },
      { id: 'ink', label: state.inkToShape ? 'Turn off hold-to-snap shapes' : 'Turn on hold-to-snap shapes', group: 'View', icon: 'scribble', run: () => editor.toggleInkToShape() },
      { id: 'authorship', label: state.authorship ? 'Hide who made what' : 'Show who made what', group: 'View', icon: 'fingerprint', run: () => editor.setState({ authorship: !state.authorship }) },
      { id: 'sketch', label: meta.style === 'sketch' ? 'Clean style (for everyone)' : 'Hand-drawn style (for everyone)', group: 'View', icon: 'scribble', run: () => session.setStyle(meta.style === 'sketch' ? 'clean' : 'sketch'), disabled: !edit },
      { id: 'theme-light', label: 'Light theme', group: 'View', icon: 'sun', run: () => setThemePreference('light') },
      { id: 'theme-dark', label: 'Dark theme', group: 'View', icon: 'moon', run: () => setThemePreference('dark') },
      { id: 'theme-system', label: 'Match system theme', group: 'View', icon: 'monitor', run: () => setThemePreference('system') },
      { id: 'present', label: 'Present frames', group: 'Board', icon: 'presentation', run: startPresentation },
      { id: 'share', label: 'Share board', group: 'Board', icon: 'share', run: () => setDialog('share') },
      { id: 'templates', label: 'Insert a template', group: 'Board', icon: 'template', run: () => setDialog('templates'), disabled: !edit },
      { id: 'branch', label: 'Branch this board', group: 'Board', icon: 'merge', keywords: 'fork experiment', run: branchBoard },
      { id: 'merge-parent', label: 'Merge branch into parent', group: 'Board', icon: 'merge', run: () => void mergeIntoParent(), disabled: !registry?.parentId },
      { id: 'duplicate-board', label: 'Duplicate as independent copy', group: 'Board', icon: 'copy', run: duplicateBoard },
      { id: 'pause', label: status.network === 'paused' ? 'Resume sync' : 'Pause sync (draft privately)', group: 'Board', icon: status.network === 'paused' ? 'play' : 'pause', run: () => status.network === 'paused' ? session.resumeSync() : session.pauseSync(), disabled: !edit },
      { id: 'export-png', label: 'Export as PNG', group: 'Export', icon: 'image', run: () => run(() => exportPng(exportOptions(false), meta.title, false)) },
      { id: 'export-sel', label: 'Export selection as PNG', group: 'Export', icon: 'image', run: () => run(() => exportPng(exportOptions(true), meta.title, true)), disabled: !sel },
      { id: 'copy-png', label: 'Copy as image', group: 'Export', icon: 'copy', hint: 'Ctrl Shift C', run: () => run(() => copyPng(exportOptions(sel)), 'Copied as PNG') },
      { id: 'export-pdf', label: 'Export as PDF', group: 'Export', icon: 'download', run: () => run(() => exportPdf(exportOptions(false), meta.title)) },
      { id: 'export-json', label: 'Export snapshot (.json)', group: 'Export', icon: 'download', run: () => exportSnapshot(snapshot.shapes, meta.title) },
      { id: 'export-merge', label: 'Save merge file (.crdtcanvas)', group: 'Export', icon: 'merge', keywords: 'sneakernet offline usb email', run: saveMergeFile },
      { id: 'export-tasks', label: 'Send notes to a task tracker', group: 'Export', icon: 'upload', keywords: 'jira github linear', run: () => setDialog('tasks') },
      { id: 'import', label: 'Open or merge a file…', group: 'Board', icon: 'upload', run: () => fileInput.current?.click(), disabled: !edit },
      { id: 'profile', label: 'Change your name or colour', group: 'App', icon: 'users', run: () => setDialog('profile') },
      { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'App', icon: 'keyboard', hint: '?', run: () => setDialog('shortcuts') },
      { id: 'home', label: 'All boards', group: 'App', icon: 'home', run: () => goHome() },
      { id: 'new', label: 'New board', group: 'App', icon: 'plus', run: () => createBoard() },
      ...PANELS.map(p => ({ id: `panel-${p.id}`, label: `Open ${p.label.split(':')[0]}`, group: 'Panels', icon: p.icon, run: () => setPanel(p.id) })),
    ];
    if (status.migrationBackupAvailable) list.push({ id: 'backup', label: 'Download migration recovery copy', group: 'Board', icon: 'download', run: () => run(() => downloadMigrationBackup(session.roomId)) });
    return list;
  }, [readOnly, state.selection, state.showGrid, state.snapToGrid, state.inkToShape, state.authorship, meta.style, meta.title, status.network, status.migrationBackupAvailable, editor, session, pickImage, startPresentation, branchBoard, mergeIntoParent, duplicateBoard, run, exportOptions, saveMergeFile, snapshot.shapes, registry?.parentId]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || document.querySelector('.dialog-backdrop')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const st = editor.getState();

      if (st.presenting) {
        if (key === 'escape') editor.setState({ presenting: null });
        else if (['arrowright', 'arrowdown', ' ', 'pagedown', 'enter'].includes(key)) editor.setState({ presenting: { index: Math.min(frames.length - 1, st.presenting.index + 1) } });
        else if (['arrowleft', 'arrowup', 'pageup', 'backspace'].includes(key)) editor.setState({ presenting: { index: Math.max(0, st.presenting.index - 1) } });
        else return;
        event.preventDefault();
        return;
      }

      const handled = () => event.preventDefault();
      if (mod && key === 'k') { handled(); setPalette({ open: true, query: '' }); return; }
      if (mod && key === 'f') { handled(); setPalette({ open: true, query: '' }); return; }
      if (mod && key === 's') { handled(); toast('Boards save automatically on this device. Use “Save merge file” to carry a copy.'); return; }
      if (mod && key === 'z') { handled(); if (event.shiftKey) editor.redo(); else editor.undo(); return; }
      if (mod && key === 'y') { handled(); editor.redo(); return; }
      if (mod && key === 'a') { handled(); editor.selectAll(); return; }
      if (mod && key === 'd') { handled(); editor.duplicateSelection(); return; }
      if (mod && key === 'g') { handled(); if (event.shiftKey) editor.ungroupSelection(); else editor.groupSelection(); return; }
      if (mod && event.shiftKey && key === 'l') { handled(); editor.toggleLock(); return; }
      if (mod && event.shiftKey && key === 'c') { handled(); run(() => copyPng(exportOptions(st.selection.length > 0)), 'Copied as PNG'); return; }
      if (mod && (key === '=' || key === '+')) { handled(); editor.zoomBy(1.25); return; }
      if (mod && key === '-') { handled(); editor.zoomBy(1 / 1.25); return; }
      if (mod && key === '0') { handled(); editor.zoomTo(1); return; }
      if (mod) return;

      if (event.altKey && st.selection.length > 1) {
        const map: Record<string, Parameters<Editor['align']>[0]> = { a: 'left', d: 'right', h: 'centerX', w: 'top', s: 'bottom', v: 'centerY' };
        const mode = map[event.code.replace('Key', '').toLowerCase()];
        if (mode) { handled(); editor.align(mode); return; }
      }
      if (event.shiftKey && (event.code === 'Digit1')) { handled(); editor.zoomToFit(); return; }
      if (event.shiftKey && (event.code === 'Digit2')) { handled(); editor.zoomToFit(st.selection.length ? st.selection : undefined); return; }
      if (event.shiftKey && (event.code === 'Digit0')) { handled(); editor.zoomTo(1); return; }
      if (key === '?' || (event.shiftKey && event.code === 'Slash')) { handled(); setDialog('shortcuts'); return; }
      if (key === 'escape') {
        if (st.followingClientId !== null) editor.setState({ followingClientId: null });
        else if (st.catchUp) editor.showCatchUp(null);
        else if (st.selection.length) editor.clearSelection();
        else if (st.tool !== 'select') editor.setTool('select');
        else if (panel) setPanel(null);
        return;
      }
      if ((key === 'delete' || key === 'backspace') && st.selection.length) { handled(); editor.deleteSelection(); return; }
      if (key.startsWith('arrow') && st.selection.length) {
        handled();
        const step = event.shiftKey ? 10 : 1;
        editor.nudge(key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0);
        return;
      }
      if (key === 'enter' && st.selection.length === 1) { handled(); editor.beginEdit(st.selection[0]); return; }
      if (key === ']') { handled(); editor.reorder(event.altKey ? 'forward' : 'front'); return; }
      if (key === '[') { handled(); editor.reorder(event.altKey ? 'backward' : 'back'); return; }
      if (key === 'q') { editor.setState({ toolLocked: !st.toolLocked }); return; }
      if (key === 'g' && !event.shiftKey) { editor.toggleGrid(); return; }
      const toolKeys: Record<string, Tool> = { v: 'select', h: 'hand', p: 'pen', d: 'pen', s: 'pen', e: 'eraser', x: 'eraser', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', t: 'text', n: 'note', f: 'frame', k: 'laser' };
      if (key === 'i' && !readOnly) { pickImage(); return; }
      if (toolKeys[key] && !event.altKey) editor.setTool(toolKeys[key]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, frames.length, panel, pickImage, readOnly, run, exportOptions, toast]);

  // Clipboard events (no permission prompts).
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName));
    const onCopy = (event: ClipboardEvent) => {
      if (isTyping(event.target) || !editor.getState().selection.length) return;
      event.preventDefault();
      void editor.copy(event.type === 'cut');
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isTyping(event.target) || document.querySelector('.dialog-backdrop')) return;
      event.preventDefault();
      void editor.paste(event, { image: (file, at) => void addImage(file, at) });
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCopy);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('copy', onCopy); window.removeEventListener('cut', onCopy); window.removeEventListener('paste', onPaste); };
  }, [editor, addImage]);

  // ── Render ────────────────────────────────────────────────────────────────
  const presenting = state.presenting;
  const openComments = comments.comments.filter(c => !c.resolved);
  const commentPins = useMemo(() => {
    const groups = new Map<string, { id: string; x: number; y: number; count: number }>();
    for (const comment of openComments) {
      const shape = comment.shapeId ? snapshot.byId.get(comment.shapeId) : undefined;
      if (comment.shapeId && (!shape || shape.deleted)) continue;
      const b = shape ? shapeBBox(shape) : null;
      const at = b ? { x: b.minX, y: b.minY } : comment.anchor;
      if (!at) continue;
      const key = comment.shapeId ?? `${Math.round(at.x)}:${Math.round(at.y)}`;
      const existing = groups.get(key);
      if (existing) existing.count++;
      else groups.set(key, { id: key, x: at.x, y: at.y, count: 1 });
    }
    return [...groups.values()];
  }, [openComments, snapshot.byId]);

  const menu = (
    <>
      <MenuItem icon="home" label="All boards" onClick={() => goHome()} />
      <MenuItem icon="plus" label="New board" onClick={() => createBoard()} />
      <div className="menu-sep" />
      {!readOnly && <MenuItem icon="template" label="Insert template…" onClick={() => setDialog('templates')} />}
      {!readOnly && <MenuItem icon="upload" label="Open or merge a file…" onClick={() => fileInput.current?.click()} />}
      {!readOnly && compact && <MenuItem icon="image" label="Insert image…" onClick={pickImage} />}
      <MenuItem icon="merge" label="Branch this board" onClick={branchBoard} />
      {registry?.parentId && <MenuItem icon="merge" label="Merge branch into parent…" onClick={() => void mergeIntoParent()} />}
      <MenuItem icon="copy" label="Duplicate board" onClick={duplicateBoard} />
      <div className="menu-sep" />
      <div className="menu-heading">Export</div>
      <MenuItem icon="image" label="PNG image" onClick={() => run(() => exportPng(exportOptions(false), meta.title, false))} />
      <MenuItem icon="download" label="PDF" onClick={() => run(() => exportPdf(exportOptions(false), meta.title))} />
      <MenuItem icon="merge" label="Merge file (.crdtcanvas)" onClick={saveMergeFile} />
      <MenuItem icon="download" label="Snapshot (.json)" onClick={() => exportSnapshot(snapshot.shapes, meta.title)} />
      <MenuItem icon="upload" label="Task tracker…" onClick={() => setDialog('tasks')} />
      <div className="menu-sep" />
      <div className="menu-heading">View</div>
      <MenuItem icon="presentation" label="Present frames" onClick={startPresentation} />
      <MenuItem icon="grid" label="Grid" hint={state.showGrid ? 'On' : 'Off'} onClick={() => editor.toggleGrid()} />
      <MenuItem icon="scribble" label="Hand-drawn style" hint={meta.style === 'sketch' ? 'On' : 'Off'} disabled={readOnly} onClick={() => session.setStyle(meta.style === 'sketch' ? 'clean' : 'sketch')} />
      <MenuItem icon="wand" label="Hold-to-snap shapes" hint={state.inkToShape ? 'On' : 'Off'} onClick={() => editor.toggleInkToShape()} />
      <MenuItem icon="fingerprint" label="Who made what" hint={state.authorship ? 'On' : 'Off'} onClick={() => editor.setState({ authorship: !state.authorship })} />
      <MenuItem icon={themePref === 'dark' ? 'moon' : themePref === 'light' ? 'sun' : 'monitor'} label="Theme" hint={themePref} onClick={() => setThemePreference(themePref === 'system' ? 'light' : themePref === 'light' ? 'dark' : 'system')} />
      <div className="menu-sep" />
      <MenuItem icon="command" label="Command palette" hint="Ctrl K" onClick={() => setPalette({ open: true, query: '' })} />
      <MenuItem icon="keyboard" label="Keyboard shortcuts" hint="?" onClick={() => setDialog('shortcuts')} />
      <MenuItem icon="users" label="Your profile" onClick={() => setDialog('profile')} />
    </>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <CanvasView
        editor={editor}
        identity={identity}
        dark={dark}
        voting={facilitation.voting}
        onVote={shapeId => { if (!facilitation.toggleVote(shapeId)) toast(`You have used all ${facilitation.maxVotesPerPerson} votes. Click a voted object to take one back.`); }}
        voteCounts={facilitation.voteCounts}
        commentPins={commentPins}
        onDropFiles={(files, at) => files.forEach(file => void openFile(file, at))}
        onResolveConflict={(id, action) => { session.store.resolveConflict(id, action); session.store.stopCapturing(); }}
      />

      {!presenting && (
        <>
          <TopBar
            editor={editor}
            title={meta.title}
            onRename={title => session.setTitle(title)}
            status={status}
            participants={participants}
            onFollow={id => editor.setState({ followingClientId: id })}
            onShare={() => setDialog('share')}
            panel={panel}
            onPanel={setPanel}
            menu={menu}
            compact={compact}
            commentCount={openComments.length}
            readOnly={readOnly}
          />
          <StylePanel editor={editor} compact={compact} dark={dark} />
          <ToolDock editor={editor} onPickImage={pickImage} compact={compact} />
          <ZoomBar editor={editor} compact={compact} />
          {!compact && !panel && <Minimap editor={editor} dark={dark} />}
          {catchUp && <CatchUpBanner catchUp={catchUp} editor={editor} onDismiss={() => session.publishCatchUp(null)} />}
          {snapshot.shapes.length === 0 && status.persistence !== 'loading' && !state.timeTravel && (state.tool === 'select' || state.tool === 'hand') && <EmptyHint readOnly={readOnly} onTemplates={() => setDialog('templates')} />}
          {panel && (
            <SidePanel panel={panel} onClose={() => setPanel(null)} editor={editor} session={session} identity={identity} participants={participants} comments={comments} facilitation={facilitation} timeline={timeline} compact={compact} />
          )}
          {state.followingClientId !== null && (
            <Banner tone="accent" onClose={() => editor.setState({ followingClientId: null })}>
              Following {participants.find(p => p.clientId === state.followingClientId)?.name ?? 'collaborator'}. Pan or press Esc to stop.
            </Banner>
          )}
          {state.timeTravel && (
            <Banner tone="warning" onClose={() => editor.setState({ timeTravel: null })}>
              Viewing an earlier version{state.timeTravel.label ? ` (${state.timeTravel.label})` : ''}. Editing is paused.
            </Banner>
          )}
          {facilitation.voting && (
            <Banner tone="accent" onClose={() => facilitation.setVoting(false, facilitation.maxVotesPerPerson)}>
              Dot voting is on: click objects to vote ({facilitation.maxVotesPerPerson} votes each).
            </Banner>
          )}
          {facilitation.timerRunning && facilitation.remainingSeconds !== null && (
            <div className="panel" style={{ position: 'absolute', top: 64, right: panel ? 364 : 12, zIndex: 20, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>
              <Icon name="timer" size={15} /> {facilitation.timerLabel || 'Timer'} · {Math.floor(facilitation.remainingSeconds / 60)}:{String(facilitation.remainingSeconds % 60).padStart(2, '0')}
            </div>
          )}
        </>
      )}

      {presenting && (
        <div className="panel" role="region" aria-label="Presentation controls" style={{ position: 'absolute', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 30, display: 'flex', alignItems: 'center', gap: 6, padding: 6 }}>
          <button type="button" className="btn ghost sm" disabled={presenting.index <= 0} onClick={() => editor.setState({ presenting: { index: presenting.index - 1 } })}><Icon name="chevronLeft" size={15} /></button>
          <span style={{ minWidth: 160, textAlign: 'center', fontWeight: 600 }} aria-live="polite">
            {(frames[presenting.index]?.data as { frameTitle?: string })?.frameTitle ?? 'Frame'} · {presenting.index + 1}/{frames.length}
          </span>
          <button type="button" className="btn ghost sm" disabled={presenting.index >= frames.length - 1} onClick={() => editor.setState({ presenting: { index: presenting.index + 1 } })}><Icon name="chevronRight" size={15} /></button>
          <button type="button" className="btn sm" onClick={() => editor.setState({ presenting: null })}>Exit</button>
        </div>
      )}

      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void addImage(file, editor.viewportCenter());
      }} />
      <input ref={fileInput} type="file" accept=".crdtcanvas,.json,.yupdate,image/*,application/json,application/octet-stream" hidden onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void openFile(file);
      }} />

      <CommandPalette
        open={palette.open}
        initialQuery={palette.query}
        onClose={() => setPalette({ open: false, query: '' })}
        commands={commands}
        shapes={snapshot.shapes.filter(s => shapeText(s))}
        onJump={jumpToShape}
      />
      <ShareDialog open={dialog === 'share'} onClose={() => setDialog(null)} roomId={session.roomId} boardKey={boardKey} title={meta.title} onSaveMergeFile={saveMergeFile} readOnly={readOnly} />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
      <ProfileDialog open={dialog === 'profile'} onClose={() => setDialog(null)} identity={identity} onSave={(name, color) => {
        saveIdentity({ name, color });
        onIdentity({ ...identity, name, color, actor: makeActor(name, identity.deviceId) });
      }} />
      <MergeDialog
        open={Boolean(merge)}
        onClose={() => setMerge(null)}
        header={merge?.header ?? null}
        preview={merge?.preview ?? null}
        onMerge={() => { const m = merge; setMerge(null); if (m) run(m.apply); }}
        onImportCopy={() => { const m = merge; setMerge(null); m?.copy(); }}
      />
      <Suspense fallback={null}>
        {dialog === 'templates' && (
          <TemplatesModal
            open
            onClose={() => setDialog(null)}
            isCanvasEmpty={snapshot.shapes.length === 0}
            onInsertToCanvas={(shapes, title) => {
              const ids = editor.insertShapes(shapes, { center: editor.viewportCenter() });
              editor.select(ids, { expandGroups: false });
              setTimeout(() => editor.zoomToFit(ids), 30);
              toast(`Inserted “${title}”`);
              setDialog(null);
            }}
            onCreateNewBoard={(shapes, title) => { setDialog(null); createBoard({ title, content: { kind: 'shapes', shapes } }); }}
          />
        )}
        {dialog === 'tasks' && <TaskTrackerHandoffModal open onClose={() => setDialog(null)} shapes={snapshot.shapes} selectedIds={state.selection} boardTitle={meta.title} />}
      </Suspense>
    </div>
  );
}

function Banner({ children, tone, onClose }: { children: React.ReactNode; tone: 'accent' | 'warning'; onClose: () => void }) {
  return (
    <div role="status" style={{
      position: 'absolute', left: '50%', bottom: 76, transform: 'translateX(-50%)', zIndex: 21,
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 14px', borderRadius: 999,
      background: tone === 'accent' ? 'var(--accent)' : 'var(--warning)', color: tone === 'accent' ? 'var(--accent-contrast)' : '#1e1e1e',
      fontWeight: 600, fontSize: 12.5, boxShadow: 'var(--shadow-md)', maxWidth: 'calc(100vw - 24px)',
    }} onPointerDown={e => e.stopPropagation()}>
      <span>{children}</span>
      <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose} style={{ color: 'inherit' }}><Icon name="x" size={14} /></button>
    </div>
  );
}

