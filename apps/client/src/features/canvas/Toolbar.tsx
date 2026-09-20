import {
  Box, IconButton, Slider,
  Typography, Chip,
} from '@mui/material';
import {
  Deselect as SelectIcon, Draw, Rectangle, Circle,
  Straight as StraightLineIcon, TextFields, Delete as EraserIcon,
  Undo, Redo, ZoomIn, ZoomOut, RestartAlt,
  People, Chat as ChatIcon,
  Image as ImageIcon, Note as NoteIcon, 
  Highlight as LaserIcon,
} from '@mui/icons-material';

const TOOLS = [
  { id: 'select',  label: 'Select (V)',       icon: SelectIcon },
  { id: 'stroke',  label: 'Draw (S)',         icon: Draw },
  { id: 'rect',    label: 'Rectangle (R)',    icon: Rectangle },
  { id: 'ellipse', label: 'Ellipse (E)',      icon: Circle },
  { id: 'line',    label: 'Line (L)',         icon: StraightLineIcon },
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
  setTool: (t: 'stroke' | 'rect' | 'ellipse' | 'line' | 'text' | 'image' | 'note' | 'laser' | 'select' | 'eraser') => void;
  activeColor: string;
  setActiveColor: (c: string) => void;
  strokeWidth: number;
  setStrokeWidth: (w: number) => void;
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
}: ToolbarProps) {
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
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    }}>
      {/* Tools */}
      {TOOLS.map(t => (
        <IconButton
          key={t.id}
          title={t.label}
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
          key={c}
          onClick={() => setActiveColor(c)}
          title={c}
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

      {/* Stroke width */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, ml: 0.5, mr: 0.25 }}>
        <Typography sx={{ fontSize: 9, color: '#6b6b8a' }}>●</Typography>
        <Slider
          value={strokeWidth}
          min={1} max={20} step={1}
          onChange={(_, v) => setStrokeWidth(v as number)}
          size="small"
          sx={{ width: 48, '& .MuiSlider-thumb': { width: 9, height: 9 }, '& .MuiSlider-track': { height: 2 } }}
        />
      </Box>

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
