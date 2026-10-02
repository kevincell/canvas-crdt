import {
  Box, IconButton, Slider, Menu, MenuItem,
  Typography, Chip,
} from '@mui/material';
import {
  Deselect as SelectIcon, Draw, Rectangle, Circle,
  Straight as StraightLineIcon, TextFields, Delete as EraserIcon,
  Undo, Redo, ZoomIn, ZoomOut, RestartAlt,
  People, Chat as ChatIcon,
  Image as ImageIcon, Note as NoteIcon, 
  Highlight as LaserIcon,
  ContentCopy, DeleteOutlined as DeleteOutline, GroupWork, LinkOff, Lock, LockOpen, VerticalAlignTop, VerticalAlignBottom, Opacity, RoundedCorner,
  East as ArrowToolIcon, CropFree as FrameToolIcon,
  GridOn as GridIcon, Grid4x4 as SnapGridIcon,
  FormatListBulleted as ObjectsIcon,
  ModeCommentOutlined as CommentsIcon,
  FileDownload as ExportIcon,
  Poll as FacilitationIcon,
  AutoFixHigh as TidyIcon,
  BookmarkAdd as CheckpointIcon,
  AlignHorizontalCenter as AlignIcon,
  Link as LinkIcon,
  Widgets as StencilsIcon,
} from '@mui/icons-material';
import { useState } from 'react';

const TOOLS = [
  { id: 'select',  label: 'Select (V)',       icon: SelectIcon },
  { id: 'stroke',  label: 'Draw (S)',         icon: Draw },
  { id: 'rect',    label: 'Rectangle (R)',    icon: Rectangle },
  { id: 'ellipse', label: 'Ellipse (E)',      icon: Circle },
  { id: 'line',    label: 'Line (L)',         icon: StraightLineIcon },
  { id: 'arrow',   label: 'Arrow connector (A)', icon: ArrowToolIcon },
  { id: 'frame',   label: 'Frame (F)',        icon: FrameToolIcon },
  { id: 'text',    label: 'Text (T)',         icon: TextFields },
  { id: 'image',   label: 'Upload Image (I)', icon: ImageIcon },
  { id: 'note',    label: 'Sticky Note (N)',  icon: NoteIcon },
  { id: 'laser',   label: 'Laser Pointer (P)',icon: LaserIcon },
  { id: 'eraser',  label: 'Eraser (X)',       icon: EraserIcon },
] as const;

const COLORS = [
  '#ef4444', '#f59e0b', '#10b981', '#3b82f6',
  '#7c3aed', '#ec4899', '#ffffff', '#94a3b8',
];

interface ToolbarProps {
  tool: string;
  setTool: (t: 'stroke' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'frame' | 'text' | 'image' | 'note' | 'laser' | 'select' | 'eraser') => void;
  activeColor: string;
  setActiveColor: (c: string) => void;
  strokeWidth: number;
  setStrokeWidth: (w: number) => void;
  onStrokeWidthCommit?: (w: number) => void;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  conflictCount: number;
  participantCount: number;
  history: { totalSteps: number } | null;
  historyStep: number;
  onHistoryChange: (s: number) => void;
  isPlaying: boolean;
  roomId: string;
  onCopyRoomId: () => void;
  setIsPlaying: (p: boolean) => void;
  onResetHistory: () => void;
  onShowConflicts: (show: boolean) => void;
  showConflicts: boolean;
  onToggleSimulator: () => void;
  showSimulator: boolean;
  onToggleChat: () => void;
  showChat: boolean;
  hasSelection?: boolean;
  onDuplicateSelected?: () => void;
  onDeleteSelected?: () => void;
  canTidyNotes?: boolean;
  onTidySelectedNotes?: () => void;
  onApplyColor?: (color: string) => void;
  onGroupSelected?: () => void;
  onUngroupSelected?: () => void;
  canUngroup?: boolean;
  selectionCount?: number;
  selectionLocked?: boolean;
  onToggleSelectionLock?: () => void;
  onMoveSelectionLayer?: (direction: 'front' | 'back') => void;
  onAlignSelection?: (mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY') => void;
  connectorStatus?: { start: boolean; end: boolean; locked: boolean };
  onToggleConnectorEndpoint?: (endpoint: 'start' | 'end') => void;
  fillOpacity: number;
  setFillOpacity: (opacity: number) => void;
  onFillOpacityCommit?: (opacity: number) => void;
  cornerRadius: number;
  setCornerRadius: (radius: number) => void;
  onCornerRadiusCommit?: (radius: number) => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  snapToGrid: boolean;
  setSnapToGrid: (snap: boolean) => void;
  showObjects: boolean;
  onToggleObjects: () => void;
  showComments: boolean;
  onToggleComments: () => void;
  showFacilitation: boolean;
  onToggleFacilitation: () => void;
  showCheckpoints: boolean;
  onToggleCheckpoints: () => void;
  showStencils: boolean;
  onToggleStencils: () => void;
  onExportBoard: () => void;
  onExportSelection: () => void;
  onExportPdf: () => void;
  onExportSnapshot: () => void;
  onImportSnapshot: () => void;
  onExportTasks?: () => void;
}

export function Toolbar({
  tool, setTool, activeColor, setActiveColor,
  strokeWidth, setStrokeWidth,
  scale, onZoomIn, onZoomOut, onResetView,
  canUndo, canRedo, onUndo, onRedo,
  conflictCount, participantCount,
  history, historyStep, onHistoryChange, isPlaying, setIsPlaying, onResetHistory,
  onShowConflicts, showConflicts,
  onToggleSimulator, showSimulator,
  onToggleChat, showChat,
  roomId, onCopyRoomId,
  hasSelection = false, onDuplicateSelected, onDeleteSelected, onApplyColor,
  canTidyNotes = false, onTidySelectedNotes,
  onGroupSelected, onUngroupSelected, canUngroup = false, selectionCount = 0,
  selectionLocked = false, onToggleSelectionLock, onMoveSelectionLayer,
  onAlignSelection,
  connectorStatus, onToggleConnectorEndpoint,
  fillOpacity, setFillOpacity, cornerRadius, setCornerRadius,
  onStrokeWidthCommit, onFillOpacityCommit, onCornerRadiusCommit,
  showGrid, setShowGrid, snapToGrid, setSnapToGrid,
  showObjects, onToggleObjects,
  showComments, onToggleComments,
  showFacilitation, onToggleFacilitation,
  showCheckpoints, onToggleCheckpoints,
  showStencils, onToggleStencils,
  onExportBoard, onExportSelection, onExportPdf, onExportSnapshot, onImportSnapshot, onExportTasks,
}: ToolbarProps) {
  const [alignAnchor, setAlignAnchor] = useState<HTMLElement | null>(null);
  const chooseColor = (color: string) => {
    setActiveColor(color);
    if (hasSelection) onApplyColor?.(color);
  };
  return (
    <Box sx={{
      position: 'absolute',
      top: 12,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 0.4,
      padding: '5px 8px',
      background: 'rgba(15, 15, 22, 0.94)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 2,
      backdropFilter: 'blur(16px)',
      zIndex: 100,
      flexWrap: 'nowrap',
      justifyContent: 'center',
      maxWidth: '96vw',
      overflowX: 'auto',
      overflowY: 'hidden',
      scrollbarWidth: 'none',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    }}>
      {/* Tools */}
      {TOOLS.map(t => (
        <IconButton
          key={t.id}
          title={t.label}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          size="small"
          onClick={() => setTool(t.id)}
          sx={{
            width: 30, height: 30,
            background: tool === t.id ? 'rgba(124, 58, 237, 0.45)' : 'transparent',
            color: tool === t.id ? '#c4b5fd' : '#6b6b8a',
            border: tool === t.id ? '1px solid rgba(124, 58, 237, 0.7)' : '1px solid transparent',
            borderRadius: 1,
            transition: 'all 0.15s',
            '&:hover': { background: tool === t.id ? 'rgba(124, 58, 237, 0.6)' : 'rgba(255,255,255,0.06)' },
          }}
        >
          <t.icon sx={{ fontSize: 15 }} />
        </IconButton>
      ))}

      <Box sx={{ width: '1px', height: 18, background: 'rgba(255,255,255,0.1)', mx: 0.5, flexShrink: 0 }} />

      {/* Colors */}
      {COLORS.map(c => (
        <Box
          component="button"
          type="button"
          key={c}
          onClick={() => chooseColor(c)}
          title={c}
          aria-label={`Use colour ${c}`}
          aria-pressed={activeColor === c}
          sx={{
              width: 16, height: 16, borderRadius: '50%',
              background: c,
              border: activeColor === c ? '2px solid #a78bfa' : '2px solid rgba(255,255,255,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.1s, border-color 0.1s',
            '&:hover': { transform: 'scale(1.25)' },
          }}
        />
      ))}
      <label title={`Choose custom colour (${activeColor})`} style={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
        <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', background: activeColor, border: '2px solid rgba(255,255,255,.35)', boxShadow: '0 0 0 1px rgba(0,0,0,.35)' }} />
        <input aria-label="Custom colour" type="color" value={/^#[0-9a-f]{6}$/i.test(activeColor) ? activeColor : '#7c3aed'} onChange={e => chooseColor(e.target.value)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
      </label>

      {hasSelection && <>
        {selectionCount === 1 && connectorStatus && (['start', 'end'] as const).map(endpoint => {
          const attached = connectorStatus[endpoint];
          const label = `${attached ? 'Detach' : 'Attach'} ${endpoint} connector endpoint${attached ? '' : ' to nearest object'}`;
          return <IconButton key={endpoint} size="small" disabled={connectorStatus.locked} onClick={() => onToggleConnectorEndpoint?.(endpoint)} title={label} aria-label={label} aria-pressed={attached} sx={{ color: attached ? '#6ee7b7' : '#a78bfa', width: 28, height: 28 }}>
            {attached ? <LinkOff sx={{ fontSize: 15 }} /> : <LinkIcon sx={{ fontSize: 15 }} />}
          </IconButton>;
        })}
        <IconButton size="small" disabled={selectionCount < 2} onClick={event => setAlignAnchor(event.currentTarget)} title="Align or distribute selection" aria-label="Align or distribute selection" sx={{ color: '#a78bfa', width: 28, height: 28 }}>
          <AlignIcon sx={{ fontSize: 15 }} />
        </IconButton>
        <Menu anchorEl={alignAnchor} open={Boolean(alignAnchor)} onClose={() => setAlignAnchor(null)}>
          {([
            ['left', 'Align left edges'], ['centerX', 'Align horizontal centers'], ['right', 'Align right edges'],
            ['top', 'Align top edges'], ['centerY', 'Align vertical centers'], ['bottom', 'Align bottom edges'],
            ['distributeX', 'Distribute horizontally'], ['distributeY', 'Distribute vertically'],
          ] as const).map(([mode, label]) => <MenuItem key={mode} dense disabled={mode.startsWith('distribute') && selectionCount < 3} onClick={() => { onAlignSelection?.(mode); setAlignAnchor(null); }}>{label}</MenuItem>)}
        </Menu>
        <IconButton size="small" disabled={!canUngroup && selectionCount < 2} onClick={canUngroup ? onUngroupSelected : onGroupSelected} title={canUngroup ? 'Ungroup selection' : 'Group selection'} sx={{ color: '#a78bfa', width: 28, height: 28 }}>
          {canUngroup ? <LinkOff sx={{ fontSize: 15 }} /> : <GroupWork sx={{ fontSize: 15 }} />}
        </IconButton>
        <IconButton size="small" onClick={onToggleSelectionLock} title={selectionLocked ? 'Unlock selection' : 'Lock selection'} sx={{ color: selectionLocked ? '#fbbf24' : '#a78bfa', width: 28, height: 28 }}>
          {selectionLocked ? <Lock sx={{ fontSize: 15 }} /> : <LockOpen sx={{ fontSize: 15 }} />}
        </IconButton>
        <IconButton size="small" onClick={() => onMoveSelectionLayer?.('front')} title="Bring selection to front" sx={{ color: '#a78bfa', width: 28, height: 28 }}>
          <VerticalAlignTop sx={{ fontSize: 15 }} />
        </IconButton>
        <IconButton size="small" onClick={() => onMoveSelectionLayer?.('back')} title="Send selection to back" sx={{ color: '#a78bfa', width: 28, height: 28 }}>
          <VerticalAlignBottom sx={{ fontSize: 15 }} />
        </IconButton>
        <IconButton size="small" onClick={onDuplicateSelected} title="Duplicate selection (Ctrl+D)" sx={{ color: '#a78bfa', width: 28, height: 28 }}>
          <ContentCopy sx={{ fontSize: 14 }} />
        </IconButton>
        <IconButton size="small" disabled={!canTidyNotes} onClick={onTidySelectedNotes} title="Tidy selected sticky notes" aria-label="Tidy selected sticky notes; undo restores their previous positions" sx={{ color: canTidyNotes ? '#a78bfa' : '#3b3b50', width: 28, height: 28 }}>
          <TidyIcon sx={{ fontSize: 15 }} />
        </IconButton>
        <IconButton size="small" onClick={onDeleteSelected} title="Delete selection" sx={{ color: '#f87171', width: 28, height: 28 }}>
          <DeleteOutline sx={{ fontSize: 16 }} />
        </IconButton>
        <IconButton size="small" onClick={onExportSelection} title="Export selection as PNG" sx={{ color: '#a78bfa', width: 28, height: 28 }}>
          <ExportIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </>}
      <IconButton size="small" onClick={onExportBoard} title="Export board as PNG" aria-label="Export board as PNG" sx={{ color: '#a78bfa', width: 28, height: 28 }}><ExportIcon sx={{ fontSize: 16 }} /></IconButton>
      <IconButton size="small" onClick={onExportPdf} title="Export board as PDF" aria-label="Export board as PDF" sx={{ color: '#a78bfa', width: 28, height: 28 }}><Typography sx={{ fontSize: 8, fontWeight: 800 }}>PDF</Typography></IconButton>
      <IconButton size="small" onClick={onExportSnapshot} title="Download recovery snapshot" aria-label="Download recovery snapshot" sx={{ color: '#a78bfa', width: 34, height: 28 }}><Typography sx={{ fontSize: 8, fontWeight: 800 }}>JSON↓</Typography></IconButton>
      <IconButton size="small" onClick={onImportSnapshot} title="Import snapshot as a copy into this board" aria-label="Import snapshot as a copy into this board" sx={{ color: '#a78bfa', width: 34, height: 28 }}><Typography sx={{ fontSize: 8, fontWeight: 800 }}>JSON↑</Typography></IconButton>
      {onExportTasks && (
        <IconButton size="small" onClick={onExportTasks} title="Export board tasks to Linear, Jira, GitHub Issues" aria-label="Export board tasks" sx={{ color: '#38bdf8', width: 38, height: 28 }}><Typography sx={{ fontSize: 8, fontWeight: 800 }}>TASKS</Typography></IconButton>
      )}

      {/* Stroke width */}
      <Box title="Stroke width" sx={{ display: 'flex', alignItems: 'center', gap: 0.4, ml: 0.5, mr: 0.25 }}>
        <Typography sx={{ fontSize: 9, color: '#6b6b8a' }}>●</Typography>
        <Slider
          aria-label="Stroke width"
          value={strokeWidth}
          min={1} max={20} step={1}
          onChange={(_, v) => setStrokeWidth(v as number)}
          onChangeCommitted={(_, value) => onStrokeWidthCommit?.(value as number)}
          size="small"
          sx={{ width: 48, '& .MuiSlider-thumb': { width: 9, height: 9 }, '& .MuiSlider-track': { height: 2 } }}
        />
      </Box>
      <Box title="Shape fill opacity" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
        <Opacity sx={{ fontSize: 14, color: '#6b6b8a' }} />
        <Slider aria-label="Shape fill opacity" value={fillOpacity * 100} min={0} max={100} step={5} onChange={(_, value) => setFillOpacity((value as number) / 100)} onChangeCommitted={(_, value) => onFillOpacityCommit?.((value as number) / 100)} size="small" sx={{ width: 42, '& .MuiSlider-thumb': { width: 9, height: 9 }, '& .MuiSlider-track': { height: 2 } }} />
      </Box>
      <Box title="Rectangle corner radius" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
        <RoundedCorner sx={{ fontSize: 14, color: '#6b6b8a' }} />
        <Slider aria-label="Rectangle corner radius" value={cornerRadius} min={0} max={32} step={2} onChange={(_, value) => setCornerRadius(value as number)} onChangeCommitted={(_, value) => onCornerRadiusCommit?.(value as number)} size="small" sx={{ width: 42, '& .MuiSlider-thumb': { width: 9, height: 9 }, '& .MuiSlider-track': { height: 2 } }} />
      </Box>
      <IconButton size="small" onClick={() => setShowGrid(!showGrid)} aria-label={showGrid ? 'Hide grid' : 'Show grid'} aria-pressed={showGrid} title={showGrid ? 'Hide grid' : 'Show grid'} sx={{ color: showGrid ? '#a78bfa' : '#6b6b8a', width: 28, height: 28 }}><GridIcon sx={{ fontSize: 15 }} /></IconButton>
      <IconButton size="small" onClick={() => setSnapToGrid(!snapToGrid)} aria-label={snapToGrid ? 'Disable snap to grid' : 'Enable snap to grid'} aria-pressed={snapToGrid} title={snapToGrid ? 'Disable snap to grid' : 'Enable snap to grid'} sx={{ color: snapToGrid ? '#a78bfa' : '#6b6b8a', width: 28, height: 28 }}><SnapGridIcon sx={{ fontSize: 15 }} /></IconButton>
      <IconButton size="small" onClick={onToggleObjects} aria-label={showObjects ? 'Hide objects list' : 'Show objects list'} aria-pressed={showObjects} title={showObjects ? 'Hide objects list' : 'Show objects list'} sx={{ color: showObjects ? '#a78bfa' : '#6b6b8a', width: 28, height: 28 }}><ObjectsIcon sx={{ fontSize: 15 }} /></IconButton>
      <IconButton size="small" onClick={onToggleComments} aria-label={showComments ? 'Hide comments' : 'Show comments'} aria-pressed={showComments} title={showComments ? 'Hide comments' : 'Show comments'} sx={{ color: showComments ? '#a78bfa' : '#6b6b8a', width: 28, height: 28 }}><CommentsIcon sx={{ fontSize: 15 }} /></IconButton>
      <IconButton size="small" onClick={onToggleFacilitation} aria-label={showFacilitation ? 'Hide facilitation tools' : 'Show facilitation tools'} aria-pressed={showFacilitation} title="Facilitation tools" sx={{ color: showFacilitation ? '#fbbf24' : '#6b6b8a', width: 28, height: 28 }}><FacilitationIcon sx={{ fontSize: 15 }} /></IconButton>
      <IconButton size="small" onClick={onToggleCheckpoints} aria-label={showCheckpoints ? 'Hide checkpoints' : 'Show checkpoints'} aria-pressed={showCheckpoints} title="Shared board checkpoints" sx={{ color: showCheckpoints ? '#6ee7b7' : '#6b6b8a', width: 28, height: 28 }}><CheckpointIcon sx={{ fontSize: 15 }} /></IconButton>
      <IconButton size="small" onClick={onToggleStencils} aria-label={showStencils ? 'Hide stencil library' : 'Show stencil library'} aria-pressed={showStencils} title="Reusable stencil library" sx={{ color: showStencils ? '#a78bfa' : '#6b6b8a', width: 28, height: 28 }}><StencilsIcon sx={{ fontSize: 15 }} /></IconButton>

      <Box sx={{ width: '1px', height: 18, background: 'rgba(255,255,255,0.1)', mx: 0.5, flexShrink: 0 }} />

      {/* Undo / Redo */}
      <IconButton size="small" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
        sx={{ color: canUndo ? '#a78bfa' : '#3b3b50', width: 28, height: 28 }}>
        <Undo sx={{ fontSize: 15 }} />
      </IconButton>
      <IconButton size="small" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)"
        sx={{ color: canRedo ? '#a78bfa' : '#3b3b50', width: 28, height: 28 }}>
        <Redo sx={{ fontSize: 15 }} />
      </IconButton>

      <Box sx={{ width: '1px', height: 18, background: 'rgba(255,255,255,0.1)', mx: 0.5, flexShrink: 0 }} />

      {/* Zoom */}
      <IconButton size="small" onClick={onZoomIn} title="Zoom in" sx={{ color: '#6b6b8a', width: 28, height: 28 }}>
        <ZoomIn sx={{ fontSize: 15 }} />
      </IconButton>
      <Typography sx={{ fontSize: 10, color: '#6b6b8a', minWidth: 32, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(scale * 100)}%
      </Typography>
      <IconButton size="small" onClick={onZoomOut} title="Zoom out" sx={{ color: '#6b6b8a', width: 28, height: 28 }}>
        <ZoomOut sx={{ fontSize: 15 }} />
      </IconButton>
      <IconButton size="small" onClick={onResetView} title="Reset view" sx={{ color: '#6b6b8a', width: 28, height: 28 }}>
        <RestartAlt sx={{ fontSize: 15 }} />
      </IconButton>

      <Box sx={{ width: '1px', height: 18, background: 'rgba(255,255,255,0.1)', mx: 0.5, flexShrink: 0 }} />

      {/* Chat toggle */}
      <IconButton
        size="small"
        onClick={onToggleChat}
        title="Toggle chat"
        sx={{
          width: 28, height: 28,
          color: showChat ? '#a78bfa' : '#6b6b8a',
          background: showChat ? 'rgba(124, 58, 237, 0.2)' : 'transparent',
          border: showChat ? '1px solid rgba(124, 58, 237, 0.4)' : '1px solid transparent',
        }}
      >
        <ChatIcon sx={{ fontSize: 15 }} />
      </IconButton>

      {/* Conflict toggle */}
      <IconButton
        size="small"
        onClick={() => onShowConflicts(!showConflicts)}
        title="Show conflicts"
        sx={{
          width: 28, height: 28,
          color: showConflicts ? '#fca5a5' : '#6b6b8a',
          background: showConflicts ? 'rgba(239, 68, 68, 0.12)' : 'transparent',
        }}
      >
        <span style={{ fontSize: 14 }}>⚠</span>
      </IconButton>

      {/* Participant count */}
      <Chip
        icon={<People sx={{ fontSize: 14 }} />}
        label={`${participantCount} online`}
        size="small"
        sx={{
          background: participantCount > 1 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(124, 58, 237, 0.12)',
          color: participantCount > 1 ? '#6ee7b7' : '#a78bfa',
          border: '1px solid rgba(255,255,255,0.05)',
          fontSize: 10,
          borderRadius: 1,
          height: 24,
        }}
      />

      {/* Room ID */}
      {roomId && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 4, ml: 0.5 }}>
          <IconButton
            size="small"
            onClick={onCopyRoomId}
            title="Copy room ID"
            sx={{
              width: 28, height: 28,
              color: '#a78bfa',
              background: 'rgba(124, 58, 237, 0.12)',
            }}
          >
            <span style={{ fontSize: 12 }}>📋</span>
          </IconButton>
          <Typography sx={{ fontSize: 10, color: '#a78bfa', fontFamily: 'monospace', fontWeight: 600 }}>
            {roomId}
          </Typography>
        </Box>
      )}

      <Box sx={{ width: '1px', height: 18, background: 'rgba(255,255,255,0.1)', mx: 0.5, flexShrink: 0 }} />

      {/* History playback */}
      {history && (
        <IconButton
          size="small"
          onClick={() => { setIsPlaying(!isPlaying); if (!isPlaying) onResetHistory(); }}
          title={isPlaying ? 'Close Time Travel' : 'Time Travel Scrubber'}
          sx={{
            width: 28, height: 28,
            color: isPlaying ? '#10b981' : '#a78bfa',
            background: isPlaying ? 'rgba(16, 185, 129, 0.12)' : 'rgba(124, 58, 237, 0.12)',
          }}
        >
          {isPlaying ? '⏸' : '⏳'}
        </IconButton>
      )}

      <Box sx={{ width: '1px', height: 18, background: 'rgba(255,255,255,0.1)', mx: 0.5, flexShrink: 0 }} />

      {/* Simulator toggle */}
      <IconButton
        size="small"
        onClick={onToggleSimulator}
        title={showSimulator ? 'Hide partition simulator (offline/online testing)' : 'Show partition simulator (offline/online testing)'}
        sx={{
          width: 28, height: 28,
          color: showSimulator ? '#f97316' : '#6b6b8a',
          background: showSimulator ? 'rgba(249, 115, 22, 0.12)' : 'transparent',
        }}
      >
        <span style={{ fontSize: 14 }}>🔬</span>
      </IconButton>
    </Box>
  );
}
