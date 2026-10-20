/**
 * BoardView — one board of a room: header, tools, canvas, panels, votes, Watch Party.
 *
 * The board drawing lives in its own Yjs document (synced by useCanvasCRDT, unchanged CRDT
 * engine + conflict detection). Room-level things — members, boards, votes, chat, Watch Party —
 * live in the room document from useRoom.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, Menu, MenuItem, Snackbar, TextField, Tooltip } from '@mui/material';
import {
  ShareOutlined, ForumOutlined, LiveTvOutlined, ChatBubbleOutlineOutlined as ChatBubbleOutline, Flag, FileDownloadOutlined, ViewQuiltOutlined,
  LightModeOutlined, DarkModeOutlined, HelpOutlineOutlined as HelpOutline, MeetingRoomOutlined, ExpandMore, Add, HowToVote, Visibility, Spa, MapOutlined,
} from '@mui/icons-material';
import { type Shape, ShapeKind } from '@crdt-canvas/engine';
import { useCanvasCRDT } from '../hooks/useCanvasCRDT';
import { BoardCanvas, type ShapeUpdate } from '../features/board/BoardCanvas';
import { BoardToolbar } from '../features/board/BoardToolbar';
import { SelectionBar, stylePatchFor, type StylePatch } from '../features/board/SelectionBar';
import { useBoardLogs, restoreSnapshot, type Checkpoint } from '../features/board/useBoardLogs';
import { type ToolId, type ToolStyle, type EraserSize, DEFAULT_STYLE, type BoardData, dataOf } from '../features/board/model';
import { type Bounds, type Pt, boundsOf, unionBounds, resolveLine, scaleData } from '../features/board/geometry';
import { ToolButton, ConflictIcon, panelSx } from '../features/board/ui';
import { RoomPanel, ProposalRow } from '../features/panels/RoomPanel';
import { ConflictsPanel } from '../features/panels/ConflictsPanel';
import { CheckpointsPanel } from '../features/panels/CheckpointsPanel';
import { CommentsPanel } from '../features/panels/CommentsPanel';
import { AboutPanel } from '../features/panels/AboutPanel';
import { BoardMapPanel } from '../features/panels/BoardMapPanel';
import { ProfileMenu, Avatar } from '../features/panels/ProfileMenu';
import { ShareDialog } from '../features/panels/ShareDialog';
import { Dot } from '../features/panels/SidePanel';
import { ChatPanel } from '../features/chat/ChatPanel';
import { TemplatesDialog } from '../features/templates/TemplatesDialog';
import { placeTemplate, type BoardTemplate } from '../features/templates/boardTemplates';
import { DemoShowcaseBar } from '../features/demo/DemoShowcaseBar';
import { exportBoardPng, exportBoardPdf } from '../features/canvas/exportBoard';
import { prepareBoardImage, calculateBoardImageBytes } from '../features/canvas/prepareImage';
import { type RoomApi } from '../features/room/useRoom';
import { type BoardInfo } from '../features/room/roomTypes';
import { useThemeMode, v } from '../theme/theme';

type PanelId = 'room' | 'chat' | 'conflicts' | 'checkpoints' | 'comments' | 'map' | 'about' | null;

export interface BoardViewProps {
  room: RoomApi;
  board: BoardInfo;
  readOnly: boolean;
  onOpenBoard: (id: string) => void;
  onHome: () => void;
  onSwitchRoom: (roomId: string) => void;
  onRename: (name: string) => void;
  onColor: (color: string) => void;
  /** Watch Party lives at room level so it keeps playing when you switch boards */
  watchParty: { open: boolean; toggle: () => void };
}

export function BoardView({ room, board, readOnly, onOpenBoard, onHome, onSwitchRoom, onRename, onColor, watchParty }: BoardViewProps) {
  const { mode, toggleMode } = useThemeMode();
  const me = room.me;
  // The board connection keeps the name it was opened with (renaming updates presence only)
  const [connName] = useState(me.name);
  const crdt = useCanvasCRDT(connName, board.docName, me.color, readOnly);
  const { doc, shapes } = crdt;
  useEffect(() => { crdt.setParticipantName(me.name); }, [me.name, crdt.setParticipantName]); // eslint-disable-line react-hooks/exhaustive-deps

  const logs = useBoardLogs(doc, { name: me.name, deviceId: me.deviceId }, crdt.conflicts, !readOnly);
  useEffect(() => () => logs.endSession(), [logs.endSession]); // close the edit session when leaving the board

  // ── tool state ──
  const [tool, setTool] = useState<ToolId>(readOnly ? 'select' : 'pen');
  const [style, setStyleState] = useState<ToolStyle>(() => {
    try { return { ...DEFAULT_STYLE, ...JSON.parse(localStorage.getItem('crdt-tool-style') || '{}') }; } catch { return DEFAULT_STYLE; }
  });
  const setStyle = useCallback((patch: Partial<ToolStyle>) => setStyleState(s => {
    const next = { ...s, ...patch };
    try { localStorage.setItem('crdt-tool-style', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  }), []);
  const [eraserSize, setEraserSize] = useState<EraserSize>('M');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [box, setBox] = useState<Bounds | null>(null);
  const [boxRequest, setBoxRequest] = useState<{ box: Bounds | null; token: number }>();
  const [panel, setPanel] = useState<PanelId>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null);
  const [boardMenu, setBoardMenu] = useState<HTMLElement | null>(null);
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [focusRequest, setFocusRequest] = useState<{ ids: string[]; token: number } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageAtRef = useRef<Pt>({ x: 0, y: 0 });

  useEffect(() => { setSelectedIds([]); setBox(null); }, [board.id]);
  const togglePanel = (p: Exclude<PanelId, null>) => setPanel(cur => (cur === p ? null : p));

  // ── shapes & selection ──
  const active = useMemo(() => shapes.filter(s => !s.deleted), [shapes]);
  const byId = useMemo(() => new Map(active.map(s => [s.id, s])), [active]);
  useEffect(() => { setSelectedIds(ids => { const next = ids.filter(id => byId.has(id)); return next.length === ids.length ? ids : next; }); }, [byId]);
  const selectedShapes = useMemo(() => selectedIds.map(id => byId.get(id)).filter(Boolean) as Shape[], [selectedIds, byId]);

  // ── dismissed conflict outlines (per device) ──
  const dismissKey = `crdt-dismissed-${board.docName}`;
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(dismissKey) || '[]')); } catch { return new Set(); }
  });
  const saveDismissed = (next: Set<string>) => {
    setDismissed(next);
    try { localStorage.setItem(dismissKey, JSON.stringify([...next].slice(-300))); } catch { /* ignore */ }
  };
  const conflictAreas = useMemo(() => logs.openConflicts.filter(c => c.area && !dismissed.has(c.id)).map(c => ({ id: c.id, area: c.area! })), [logs.openConflicts, dismissed]);

  // ── comment pins ──
  const commentPins = useMemo(() => {
    const groups = new Map<string, { ids: string[]; count: number }>();
    logs.comments.forEach(c => {
      const ids = c.shapeIds.filter(id => byId.has(id));
      if (!ids.length) return;
      const key = ids.slice().sort().join(',');
      const g = groups.get(key);
      if (g) g.count++; else groups.set(key, { ids, count: 1 });
    });
    return [...groups.entries()].map(([key, g]) => {
      const b = unionBounds(g.ids.map(id => boundsOf(resolveLine(byId.get(id)!, byId))))!;
      return { key, x: b.maxX, y: b.minY, count: g.count, shapeIds: g.ids };
    });
  }, [logs.comments, byId]);
  const selectionCommentCount = useMemo(() => {
    const sel = new Set(selectedIds);
    return logs.comments.filter(c => c.shapeIds.some(id => sel.has(id))).length;
  }, [logs.comments, selectedIds]);

  // ── writes ──
  const createShape = useCallback((kind: ShapeKind, data: Partial<BoardData>) => crdt.createShape(kind, { kind, ...data }), [crdt.createShape]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateShapes = useCallback((updates: ShapeUpdate[], skipHistory: boolean) => crdt.updateShapes(updates, skipHistory), [crdt.updateShapes]); // eslint-disable-line react-hooks/exhaustive-deps
  const deleteShapes = useCallback((ids: string[]) => {
    crdt.deleteShapes(ids);
    ids.forEach(id => logs.resolveConflictsForShape(id));
  }, [crdt.deleteShapes, logs.resolveConflictsForShape]); // eslint-disable-line react-hooks/exhaustive-deps

  const replaceStrokes = useCallback((replacements: Array<{ id: string; pieces: Pt[][] }>) => {
    if (!doc) return;
    doc.transact(() => {
      for (const r of replacements) {
        const s = byId.get(r.id);
        if (!s) continue;
        const d = dataOf(s) as any;
        crdt.deleteShape(r.id);
        for (const pts of r.pieces) {
          if (pts.length < 2) continue;
          crdt.createShape(ShapeKind.Stroke, { ...d, points: pts, fillColor: undefined, zIndex: d.zIndex });
        }
      }
    });
  }, [doc, byId, crdt.deleteShape, crdt.createShape]); // eslint-disable-line react-hooks/exhaustive-deps

  const lockedAttempt = useCallback((ids: string[], action: 'move' | 'delete' | 'edit') => {
    if (action === 'delete') {
      room.propose('delete-locked', { boardId: board.id, targets: ids, title: `Delete ${ids.length} locked object${ids.length === 1 ? '' : 's'} on “${board.name}”` });
      setToast('Locked objects need a vote to delete — vote started (more than half must agree).');
    } else {
      setToast(`That object is locked. Unlock it from the selection bar (needs more than half of the room).`);
    }
  }, [room, board.id, board.name]);

  // ── selection bar actions ──
  const applyStyle = useCallback((patch: StylePatch) => {
    const updates: ShapeUpdate[] = [];
    selectedShapes.forEach(s => {
      if (dataOf(s).locked) return;
      const data = stylePatchFor(s, patch);
      if (data) updates.push({ id: s.id, data, op: 'update' });
    });
    if (updates.length) updateShapes(updates, false);
  }, [selectedShapes, updateShapes]);

  const scaleSelection = useCallback((factor: number) => {
    const free = selectedShapes.filter(s => !dataOf(s).locked);
    const b = box ?? unionBounds(free.map(s => boundsOf(resolveLine(s, byId))));
    if (!b || !free.length) return;
    const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    updateShapes(free.map(s => ({ id: s.id, data: scaleData(dataOf(s), c, factor, factor), op: 'resize' as const })), false);
    if (box) {
      const nb = { minX: c.x + (box.minX - c.x) * factor, minY: c.y + (box.minY - c.y) * factor, maxX: c.x + (box.maxX - c.x) * factor, maxY: c.y + (box.maxY - c.y) * factor };
      setBoxRequest({ box: nb, token: Date.now() });
    }
  }, [selectedShapes, box, byId, updateShapes]);

  const lockSelection = useCallback(() => {
    const ids = selectedShapes.filter(s => !dataOf(s).locked).map(s => s.id);
    if (!ids.length) return;
    updateShapes(ids.map(id => ({ id, data: { locked: true, lockedBy: me.name, lockedAt: Date.now() } as any, op: 'update' as const })), false);
    setToast(`Locked ${ids.length} object${ids.length === 1 ? '' : 's'}.`);
  }, [selectedShapes, updateShapes, me.name]);

  const unlockSelection = useCallback(() => {
    const ids = selectedShapes.filter(s => dataOf(s).locked).map(s => s.id);
    if (!ids.length) return;
    room.propose('unlock', { boardId: board.id, targets: ids, title: `Unlock ${ids.length} object${ids.length === 1 ? '' : 's'} on “${board.name}”` });
    setToast('Unlock vote started — more than half of the room must agree.');
  }, [selectedShapes, room, board.id, board.name]);

  const deleteSelection = useCallback(() => {
    const locked = selectedShapes.filter(s => dataOf(s).locked).map(s => s.id);
    const free = selectedShapes.filter(s => !dataOf(s).locked).map(s => s.id);
    if (free.length) deleteShapes(free);
    if (locked.length) lockedAttempt(locked, 'delete');
    setSelectedIds([]);
    setBoxRequest({ box: null, token: Date.now() });
  }, [selectedShapes, deleteShapes, lockedAttempt]);

  // ── apply passed board-level votes (unlock / delete locked / revert) ──
  const appliedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!doc || readOnly) return;
    for (const p of room.proposals) {
      if (p.boardId !== board.id || p.status !== 'passed' || p.applied || appliedRef.current.has(p.id)) continue;
      if (p.kind !== 'unlock' && p.kind !== 'delete-locked' && p.kind !== 'revert') continue;
      appliedRef.current.add(p.id);
      if (p.kind === 'unlock') {
        const ids = p.targets.filter(id => byId.has(id));
        updateShapes(ids.map(id => ({ id, data: { locked: false, lockedBy: undefined, lockedAt: undefined } as any, op: 'update' as const })), true);
        setToast('Vote passed: objects unlocked.');
      } else if (p.kind === 'delete-locked') {
        deleteShapes(p.targets.filter(id => byId.has(id)));
        setToast('Vote passed: locked objects deleted.');
      } else if (p.kind === 'revert') {
        const cp = logs.checkpoints.find(c => c.id === p.targets[0]);
        if (cp && restoreSnapshot(doc, cp.snapshotKey, me.name)) {
          logs.logRevert(cp);
          setToast(`Vote passed: board reverted to ${cp.actor}’s checkpoint.`);
        } else if (!cp) {
          appliedRef.current.delete(p.id); // checkpoint list not synced yet — try again later
          continue;
        }
      }
      room.markApplied(p.id);
    }
  }, [room.proposals, board.id, doc, readOnly, byId, logs.checkpoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── images ──
  const onImageRequest = useCallback((at: Pt) => {
    imageAtRef.current = at;
    const dropped = (window as any).__boardDroppedImage as File | undefined;
    if (dropped) { delete (window as any).__boardDroppedImage; void addImage(dropped); return; }
    imageInputRef.current?.click();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addImage = useCallback(async (file: File) => {
    try {
      const img = await prepareBoardImage(file, calculateBoardImageBytes(shapes));
      const maxW = 520;
      const scale = Math.min(1, maxW / img.width);
      const w = img.width * scale, h = img.height * scale;
      const at = imageAtRef.current;
      const id = createShape(ShapeKind.Image, { x: at.x - w / 2, y: at.y - h / 2, w, h, src: img.src, createdBy: me.name, createdById: me.deviceId } as any);
      if (id) { setSelectedIds([id]); setTool('select'); }
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not add that image.');
    }
  }, [shapes, createShape, me.name, me.deviceId]);

  // Paste images
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const file = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); imageAtRef.current = lastCursorRef.current; void addImage(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [readOnly, addImage]);

  // ── cursor / laser (throttled) ──
  const lastCursorRef = useRef<Pt>({ x: 0, y: 0 });
  const cursorTimer = useRef(0);
  const onCursor = useCallback((x: number, y: number) => {
    lastCursorRef.current = { x, y };
    if (readOnly) return;
    const now = performance.now();
    if (now - cursorTimer.current < 40) return;
    cursorTimer.current = now;
    crdt.setCursor(x, y);
  }, [readOnly, crdt.setCursor]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── templates ──
  const addTemplate = useCallback((t: BoardTemplate) => {
    if (!doc) return;
    const b = unionBounds(active.map(boundsOf));
    const at = b ? { x: b.maxX + 120, y: b.minY } : { x: 0, y: 0 };
    const idMap = new Map<string, string>();
    doc.transact(() => {
      for (const s of placeTemplate(t, at)) {
        const data: any = { ...s.data, createdBy: me.name, createdById: me.deviceId };
        if (data.startShapeId) data.startShapeId = idMap.get(data.startShapeId);
        if (data.endShapeId) data.endShapeId = idMap.get(data.endShapeId);
        const id = crdt.createShape(s.kind, data);
        if (id) idMap.set(s.id, id);
      }
    });
    setTemplatesOpen(false);
    setFocusRequest({ ids: [...idMap.values()], token: Date.now() });
    setToast(`Added “${t.title}”.`);
  }, [doc, active, me.name, me.deviceId, crdt.createShape]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── focus helpers (conflicts / comments → board) ──
  const focusShapes = useCallback((ids: string[]) => {
    const present = ids.filter(id => byId.has(id));
    if (present.length) { setSelectedIds(present); if (tool !== 'select' && tool !== 'box') setTool('select'); }
    setFocusRequest({ ids, token: Date.now() });
  }, [byId, tool]);

  // ── export ──
  const doExport = async (kind: 'png' | 'pdf', selectionOnly: boolean) => {
    setExportMenu(null);
    try {
      const fn = kind === 'png' ? exportBoardPng : exportBoardPdf;
      await fn(shapes, selectionOnly ? selectedIds : undefined, `${room.meta?.name ?? room.roomId}-${board.name}`, mode);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Export failed.');
    }
  };


  // ── notifications: votes I haven't answered ──
  const [hiddenVotes, setHiddenVotes] = useState<Set<string>>(new Set());
  const voteNotices = useMemo(() => room.proposals.filter(p => p.status === 'open' && !p.votes[me.deviceId] && !hiddenVotes.has(p.id)), [room.proposals, me.deviceId, hiddenVotes]);

  const onlineHere = crdt.participants.length;
  const liveBoards = room.boards.filter(b => !b.deleted);
  const memberColor = useCallback((name: string) => room.members.find(m => m.name === name)?.color, [room.members]);
  const peerLinks = crdt.webrtcPeerCount + crdt.bcPeerCount;
  const othersHere = Math.max(0, onlineHere - 1);
  // Signalling reachable = online, even if you're the only one here
  const connected = room.connection === 'connected' || peerLinks > 0;
  const statusLabel = othersHere > 0 ? `${onlineHere} on this board` : connected ? 'Online · only you here' : 'Offline · saved locally';
  const statusTip = !connected
    ? 'Can’t reach the signalling server — your changes are saved on this device and sync when you reconnect'
    : othersHere > 0 ? `${crdt.webrtcPeerCount} device link(s), ${crdt.bcPeerCount} tab(s)` : 'Connected and waiting for others — share the room ID or a link';
  const activitySince = Date.now() - 24 * 60 * 60 * 1000;
  const changedToday = active.filter(shape => shape.updatedAt >= activitySince).length;
  const commentsToday = logs.comments.filter(comment => comment.ts >= activitySince).length;
  const pulseLabel = changedToday || commentsToday
    ? `Pulse · ${changedToday} changed${commentsToday ? ` · ${commentsToday} comment${commentsToday === 1 ? '' : 's'}` : ''}`
    : 'Pulse · quiet';
  const pulseTip = changedToday || commentsToday
    ? `${changedToday} board object${changedToday === 1 ? '' : 's'} changed and ${commentsToday} comment${commentsToday === 1 ? '' : 's'} added in the last 24 hours. Open checkpoints for a detailed timeline.`
    : 'No board activity in the last 24 hours. Open checkpoints to review saved board states.';

  // ── render ──
  const header = (
    <Box component="header" sx={{ height: 54, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1, px: 1.5, bgcolor: v('surface'), borderBottom: `1px solid ${v('border')}`, zIndex: 30, minWidth: 0 }}>
      <Tooltip title="Home">
        <IconButton onClick={onHome} aria-label="Home" sx={{ width: 34, height: 34, bgcolor: v('primarySoft'), color: v('primaryStrong'), '&:hover': { bgcolor: v('primarySoft') } }}><Spa fontSize="small" /></IconButton>
      </Tooltip>
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box component="button" onClick={() => !readOnly && togglePanel('room')} sx={{ fontWeight: 800, fontSize: 14.5, maxWidth: { xs: 110, md: 220 }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: readOnly ? 'default' : 'pointer', '&:hover': { color: readOnly ? 'inherit' : v('primaryStrong') } }} title={room.meta?.description || room.meta?.name}>
          {room.meta?.name ?? room.roomId}
        </Box>
        <Box sx={{ color: v('textFaint') }}>/</Box>
        <Box component="button" onClick={e => !readOnly && setBoardMenu(e.currentTarget)} title={board.description || board.name}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.2, fontWeight: 600, fontSize: 14, color: v('textMuted'), px: 0.8, py: 0.3, borderRadius: '8px', maxWidth: { xs: 120, md: 220 }, cursor: readOnly ? 'default' : 'pointer', '&:hover': { bgcolor: readOnly ? 'transparent' : v('surface2') } }}>
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{board.name}</Box>
          {!readOnly && <ExpandMore sx={{ fontSize: 18 }} />}
        </Box>
      </Box>
      <Tooltip title={statusTip}>
        <Chip size="small" icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: connected ? v('success') : v('warning'), ml: '8px !important' }} />}
          label={statusLabel}
          sx={{ display: { xs: 'none', sm: 'inline-flex' }, height: 24, fontSize: 11.5, bgcolor: v('surface2'), color: v('textMuted'), border: `1px solid ${v('border')}` }} />
      </Tooltip>
      <Tooltip title={pulseTip}>
        <Chip size="small" clickable onClick={() => setPanel('checkpoints')} label={pulseLabel}
          sx={{ display: { xs: 'none', md: 'inline-flex' }, height: 24, fontSize: 11.5, bgcolor: v('primarySoft'), color: v('primaryStrong'), border: `1px solid ${v('border')}` }} />
      </Tooltip>
      {readOnly && <Chip size="small" icon={<Visibility sx={{ fontSize: 15 }} />} label="View only" sx={{ height: 24, bgcolor: v('accentSoft'), color: v('accent'), fontWeight: 700 }} />}
      <Box sx={{ flex: 1 }} />

      {!readOnly && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, overflowX: 'auto', minWidth: 0 }}>
          <ToolButton placement="bottom" title="Templates" onClick={() => setTemplatesOpen(true)}><ViewQuiltOutlined fontSize="small" /></ToolButton>
          <ToolButton placement="bottom" title="Export PNG / PDF" onClick={e => setExportMenu(e.currentTarget)}><FileDownloadOutlined fontSize="small" /></ToolButton>
          <ToolButton placement="bottom" title="Share" onClick={() => setShareOpen(true)}><ShareOutlined fontSize="small" /></ToolButton>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 1.2, borderColor: v('border') }} />
          <ToolButton placement="bottom" title="Board map and search" active={panel === 'map'} onClick={() => togglePanel('map')}><MapOutlined fontSize="small" /></ToolButton>
          <ToolButton placement="bottom" title="Comments" active={panel === 'comments'} onClick={() => togglePanel('comments')} badge={logs.comments.length || undefined}><ChatBubbleOutline fontSize="small" /></ToolButton>
          <ToolButton placement="bottom" title="Checkpoints" active={panel === 'checkpoints'} onClick={() => togglePanel('checkpoints')}><Flag fontSize="small" /></ToolButton>
          <ToolButton placement="bottom" title="Conflicts" active={panel === 'conflicts'} onClick={() => togglePanel('conflicts')} badge={logs.openConflicts.length || undefined}><ConflictIcon /></ToolButton>
          <ToolButton placement="bottom" title="Chat" active={panel === 'chat'} onClick={() => togglePanel('chat')}><ForumOutlined fontSize="small" /></ToolButton>
          <ToolButton placement="bottom" title="Watch Party" active={watchParty.open} onClick={watchParty.toggle}><LiveTvOutlined fontSize="small" /></ToolButton>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 1.2, borderColor: v('border') }} />
        </Box>
      )}
      {readOnly && <ToolButton placement="bottom" title="Board map and search" active={panel === 'map'} onClick={() => togglePanel('map')}><MapOutlined fontSize="small" /></ToolButton>}
      <ToolButton placement="bottom" title={mode === 'day' ? 'Night mode' : 'Day mode'} onClick={toggleMode}>{mode === 'day' ? <DarkModeOutlined fontSize="small" /> : <LightModeOutlined fontSize="small" />}</ToolButton>
      {!readOnly && <ToolButton placement="bottom" title="About" active={panel === 'about'} onClick={() => togglePanel('about')}><HelpOutline fontSize="small" /></ToolButton>}
      {!readOnly && <ToolButton placement="bottom" title="Room details" active={panel === 'room'} onClick={() => togglePanel('room')} badge={room.pendingRequests.length || undefined}><MeetingRoomOutlined fontSize="small" /></ToolButton>}
      {!readOnly && (
        <Tooltip title={`${me.name} — profile`}>
          <Box component="button" onClick={e => setProfileAnchor(e.currentTarget)} aria-label="Your profile" sx={{ ml: 0.5, borderRadius: '50%', p: 0.2 }}>
            <Avatar name={me.name} color={me.color} size={30} />
          </Box>
        </Tooltip>
      )}
    </Box>
  );

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: v('bg'), color: v('text') }}>
      {header}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <BoardCanvas
            shapes={shapes}
            mode={mode}
            tool={readOnly ? 'select' : tool}
            style={style}
            eraserSize={eraserSize}
            readOnly={readOnly}
            me={me}
            remoteCursors={crdt.remoteCursors}
            remoteLasers={crdt.remoteLasers}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onBoxChange={setBox}
            boxRequest={boxRequest}
            conflictAreas={readOnly ? [] : conflictAreas}
            liveConflicts={readOnly ? undefined : crdt.conflicts}
            onResolveLiveConflict={(shapeId, action) => { crdt.resolveConflict(shapeId, action); logs.resolveConflictsForShape(shapeId); }}
            commentPins={readOnly ? [] : commentPins}
            onOpenComments={ids => { focusShapes(ids); setPanel('comments'); }}
            focusRequest={focusRequest}
            createShape={createShape}
            updateShapes={updateShapes}
            commitHistory={crdt.commitShapeHistoryBatch}
            deleteShapes={deleteShapes}
            replaceStrokes={replaceStrokes}
            onLockedAttempt={lockedAttempt}
            onImageRequest={onImageRequest}
            onCursor={onCursor}
            onLaser={readOnly ? undefined : crdt.setLaserPoints}
            onUndo={crdt.undo}
            onRedo={crdt.redo}
            renderSelectionBar={readOnly ? undefined : info => (
              <SelectionBar
                screen={info.screen}
                shapes={selectedShapes}
                boxActive={tool === 'box' && !!box}
                onStyle={applyStyle}
                onScale={scaleSelection}
                onComment={() => setPanel('comments')}
                onLock={lockSelection}
                onUnlock={unlockSelection}
                onDelete={deleteSelection}
                onTextInBox={box ? () => { (window as any).__boardOpenTextBox?.(box); setBoxRequest({ box: null, token: Date.now() }); setSelectedIds([]); } : undefined}
                commentCount={selectionCommentCount}
              />
            )}
          />

          {!readOnly && (
            <BoardToolbar tool={tool} setTool={t => { setTool(t); if (t !== 'select' && t !== 'box') setSelectedIds([]); }}
              style={style} setStyle={setStyle} eraserSize={eraserSize} setEraserSize={setEraserSize}
              onUndo={crdt.undo} onRedo={crdt.redo} canUndo={crdt.canUndo} canRedo={crdt.canRedo} laserColor={me.color} />
          )}
          {!readOnly && <DemoShowcaseBar />}

          {/* Notifications: join requests and votes */}
          {!readOnly && (room.pendingRequests.length > 0 || voteNotices.length > 0) && (
            <Box sx={{ position: 'absolute', right: 64, bottom: 14, zIndex: 35, display: 'flex', flexDirection: 'column', gap: 1, width: 300, maxWidth: 'calc(100% - 90px)' }}>
              {room.pendingRequests.slice(0, 3).map(p => (
                <Box key={p.deviceId} sx={{ ...panelSx, p: 1.4, animation: 'popIn .15s ease' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Dot color={p.color} />
                    <Box sx={{ fontSize: 13 }}><b>{p.name}</b> wants to join</Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                    <Button size="small" color="error" onClick={() => room.decline(p)}>Decline</Button>
                    <Button size="small" variant="contained" onClick={() => room.approve(p)}>Allow</Button>
                  </Box>
                </Box>
              ))}
              {voteNotices.slice(0, 2).map(p => (
                <Box key={p.id} sx={{ ...panelSx, p: 1.2, animation: 'popIn .15s ease' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.4, fontSize: 11, fontWeight: 800, color: v('accent'), letterSpacing: '.05em' }}>
                    <HowToVote sx={{ fontSize: 15 }} /> VOTE
                    <Box sx={{ flex: 1 }} />
                    <Box component="button" onClick={() => setHiddenVotes(s => new Set(s).add(p.id))} sx={{ fontSize: 11, color: v('textFaint'), fontWeight: 600 }}>Later</Box>
                  </Box>
                  <ProposalRow p={p} room={room} boards={room.boards} />
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {!readOnly && panel === 'room' && (
          <RoomPanel room={room} currentBoardId={board.id} onOpenBoard={id => { onOpenBoard(id); }} onClose={() => setPanel(null)} onLeft={onHome} onToast={setToast} />
        )}
        {panel === 'chat' && (
          <ChatPanel doc={room.doc} actorName={me.name} actorColor={me.color} colorOf={memberColor} onClose={() => setPanel(null)} readOnly={readOnly} />
        )}
        {panel === 'conflicts' && (
          <ConflictsPanel doc={doc} mode={mode} entries={logs.conflictLog} dismissed={dismissed} readOnly={readOnly}
            onDismiss={id => saveDismissed(new Set(dismissed).add(id))}
            onUndismiss={id => { const n = new Set(dismissed); n.delete(id); saveDismissed(n); }}
            onResolve={logs.resolveConflict}
            onFocus={(_, ids) => focusShapes(ids)}
            onClose={() => setPanel(null)} />
        )}
        {panel === 'checkpoints' && (
          <CheckpointsPanel doc={doc} mode={mode} checkpoints={logs.checkpoints} proposals={room.proposals.filter(p => p.boardId === board.id)}
            votesNeeded={room.votesNeeded} validVotes={room.validVotes} myDeviceId={me.deviceId} readOnly={readOnly}
            onProposeRevert={(cp: Checkpoint) => {
              room.propose('revert', { boardId: board.id, targets: [cp.id], title: `Revert “${board.name}” to ${cp.actor}’s checkpoint (${new Date(cp.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` });
              setToast('Revert vote started — more than half of the room must agree.');
            }}
            onVote={room.vote}
            onClose={() => setPanel(null)} />
        )}
        {panel === 'map' && (
          <BoardMapPanel shapes={active} selectedIds={selectedIds} onFocus={focusShapes} onClose={() => setPanel(null)} />
        )}
        {panel === 'comments' && (
          <CommentsPanel comments={logs.comments} selectedIds={selectedIds} myDeviceId={me.deviceId} readOnly={readOnly}
            onAdd={text => {
              const b = unionBounds(selectedShapes.map(s => boundsOf(resolveLine(s, byId))));
              logs.addComment(text, selectedIds, b ? { x: b.maxX, y: b.minY } : null);
            }}
            onDelete={logs.deleteComment}
            onFocus={focusShapes}
            onClose={() => setPanel(null)} />
        )}
        {panel === 'about' && <AboutPanel onClose={() => setPanel(null)} />}
      </Box>

      {/* Menus & dialogs */}
      <Menu anchorEl={boardMenu} open={!!boardMenu} onClose={() => setBoardMenu(null)} slotProps={{ paper: { sx: { minWidth: 240 } } }}>
        {liveBoards.map(b => (
          <MenuItem key={b.id} selected={b.id === board.id} onClick={() => { setBoardMenu(null); if (b.id !== board.id) onOpenBoard(b.id); }}>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ fontSize: 13.5, fontWeight: 600 }}>{b.name}</Box>
              <Box sx={{ fontSize: 11, color: v('textFaint') }}>{b.description || `by ${b.createdByName}`}</Box>
            </Box>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => { setBoardMenu(null); setNewBoardName(`Board ${liveBoards.length + 1}`); setNewBoardDesc(''); setNewBoardOpen(true); }}>
          <Add fontSize="small" sx={{ mr: 1 }} /> New board
        </MenuItem>
      </Menu>

      <Menu anchorEl={exportMenu} open={!!exportMenu} onClose={() => setExportMenu(null)}>
        <MenuItem onClick={() => doExport('png', false)}>Whole board as PNG</MenuItem>
        <MenuItem onClick={() => doExport('pdf', false)}>Whole board as PDF</MenuItem>
        <MenuItem disabled={!selectedIds.length} onClick={() => doExport('png', true)}>Selection as PNG</MenuItem>
        <MenuItem disabled={!selectedIds.length} onClick={() => doExport('pdf', true)}>Selection as PDF</MenuItem>
      </Menu>

      <Dialog open={newBoardOpen} onClose={() => setNewBoardOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New board</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
          <TextField autoFocus label="Name" size="small" value={newBoardName} onChange={e => setNewBoardName(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
          <TextField label="Description" size="small" value={newBoardDesc} onChange={e => setNewBoardDesc(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
          <Box sx={{ fontSize: 12, color: v('textMuted') }}>Starts empty. Your current board stays as it is.</Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewBoardOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => {
            const id = room.createBoard(newBoardName, newBoardDesc.trim());
            setNewBoardOpen(false);
            if (id) onOpenBoard(id);
          }}>Create</Button>
        </DialogActions>
      </Dialog>

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} roomId={room.roomId} boardId={board.id} boardName={board.name} localIP={room.localIP} onToast={setToast} />
      <TemplatesDialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} onPick={addTemplate} mode={mode} />
      <ProfileMenu anchorEl={profileAnchor} onClose={() => setProfileAnchor(null)} name={me.name} color={me.color} currentRoomId={room.roomId}
        onRename={onRename} onColor={onColor} onSwitchRoom={onSwitchRoom} onHome={onHome} />

      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addImage(f); }} />

      <Snackbar open={!!toast} autoHideDuration={3800} onClose={() => setToast(null)} message={toast ?? ''} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
