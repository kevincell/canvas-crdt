import { useState, useCallback, useRef, useEffect } from 'react';
import { useCanvasCRDT } from '../hooks/useCanvasCRDT';
import { CanvasRenderer } from '../features/canvas/CanvasRenderer';
import { Toolbar } from '../features/canvas/Toolbar';
import { StatusPanel } from '../features/crdt/StatusPanel';
import { ConnectionBanner } from '../features/crdt/ui/ConnectionBanner';
import { PartitionSimulator } from '../features/crdt/PartitionSimulator';
import { ChatPanel } from '../features/chat/ChatPanel';
import { DemoTip } from '../features/demo/DemoTip';
import { DemoShowcaseBar } from '../features/demo/DemoShowcaseBar';
import { TimeTravelScrubber } from '../features/crdt/ui/TimeTravelScrubber';
import { MergeLens, type MergeLensScenario } from '../features/crdt/ui/MergeLens';
import { Box, Button, Typography, Avatar } from '@mui/material';
import { type Conflict, type Shape, ShapeKind } from '@crdt-canvas/engine';
import { sound } from '../utils/audio';

type ToolType = 'stroke' | 'rect' | 'ellipse' | 'line' | 'text' | 'image' | 'note' | 'laser' | 'select' | 'eraser';

interface SingleCanvasViewProps {
  actorName: string;
  roomId: string;
  initialColor?: string;
  isCompact?: boolean;
  onLeave?: () => void;
  onToggleSplitScreen?: () => void;
  isSplitScreen?: boolean;
  hideShowcase?: boolean;
}

const DEFAULT_NOTE_BG = '#fef3c7';

export function SingleCanvasView({
  actorName,
  roomId,
  initialColor = '#7c3aed',
  isCompact = false,
  onLeave,
  onToggleSplitScreen,
  isSplitScreen = false,
  hideShowcase = false,
}: SingleCanvasViewProps) {
  const [tool, setTool] = useState<ToolType>('stroke');
  const [activeColor, setActiveColor] = useState(initialColor);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [historyStep, setHistoryStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showConflicts, setShowConflicts] = useState(true);
  const [showScrubber, setShowScrubber] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [mergeLens, setMergeLens] = useState<MergeLensScenario | null>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [showDemoTip, setShowDemoTip] = useState(() => !localStorage.getItem('demoTipShown'));

  const historyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    shapes,
    conflicts,
    history,
    connected,
    peerCount,
    roomId: canvasRoomId,
    localIP,
    connectionState,
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
    doc,
  } = useCanvasCRDT(actorName, roomId, activeColor);

  const handleShapeMoved = useCallback((id: string, dx: number, dy: number, skipHistory = false) => {
    const shape = shapes.find(s => s.id === id);
    if (shape) {
      const data = shape.data as { x?: number; y?: number };
      const newX = (data.x ?? 0) + dx;
      const newY = (data.y ?? 0) + dy;
      updateShape(id, { x: newX, y: newY }, 'move', skipHistory);
    }
  }, [shapes, updateShape]);

  const handleShapeResized = useCallback((id: string, data: Partial<any>, op: 'resize' | 'move' | 'update' = 'resize', skipHistory = false) => {
    updateShape(id, data, op, skipHistory);
  }, [updateShape]);

  // Handle image upload from file input
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
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
        createImage(100, 100, w, h, src);
        sound.playPop();
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [createImage]);

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
      background: 'radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.06) 0%, transparent 60%), #0c0d14',
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

      {/* Top room & peer badge header */}
      <Box sx={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(14, 15, 23, 0.95)',
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

          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            px: 1.25,
            py: 0.25,
          }}>
            <Typography sx={{ fontSize: 11, color: '#8888a8', fontWeight: 500 }}>Room:</Typography>
            <Typography sx={{ fontSize: 11, color: '#c4b5fd', fontWeight: 600, fontFamily: 'monospace' }}>
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
            <Typography sx={{ fontSize: 12, color: '#e2e2f0', fontWeight: 600 }}>
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
            scale={canvasScale}
            onStrokeEnd={(pts, c, w) => { createStroke(pts, c, w); sound.playPop(); }}
            onRectEnd={(x, y, w, h, c) => { createRect(x, y, w, h, c); sound.playPop(); }}
            onEllipseEnd={(cx, cy, rx, ry, c) => { createEllipse(cx, cy, rx, ry, c); sound.playPop(); }}
            onLineEnd={(x1, y1, x2, y2, c, w) => { createLine(x1, y1, x2, y2, c, w); sound.playPop(); }}
            onTextSubmit={(x, y, text, c) => { createText(x, y, text, c); sound.playPop(); }}
            onImageAdd={(x, y, w, h, src) => { createImage(x, y, w, h, src); sound.playPop(); }}
            onNoteAdd={(x, y, text, c, bg) => { createNote(x, y, text, c, bg); sound.playPop(); }}
            onDelete={deleteShape}
            onShapeMoved={handleShapeMoved}
            onShapeResized={handleShapeResized}
            onShapeHistoryCommit={commitShapeHistory}
            onZoomChange={setCanvasScale}
            onImageDrop={(x, y, w, h, src) => { createImage(x, y, w, h, src); sound.playPop(); }}
            onCursorMove={setCursor}
            onLaserUpdate={(pts) => setLaserPoints(pts)}
            onResolveConflict={handleResolveConflict}
          />

          {/* Floating Toolbar */}
          <Toolbar
            tool={tool}
            setTool={(t: ToolType) => {
              setTool(t);
              sound.playClick();
              if (t === 'image') fileInputRef.current?.click();
            }}
            activeColor={activeColor}
            setActiveColor={(c: string) => { setActiveColor(c); sound.playClick(); }}
            strokeWidth={strokeWidth}
            setStrokeWidth={setStrokeWidth}
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
            onToggleChat={() => setShowChat(v => !v)}
            showChat={showChat}
          />

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
          width: showChat ? (isCompact ? 260 : 300) : 0,
          minWidth: showChat ? (isCompact ? 260 : 300) : 0,
          height: '100%',
          background: 'rgba(15, 15, 22, 0.98)',
          borderLeft: showChat ? '1px solid rgba(255,255,255,0.06)' : 'none',
          overflow: 'hidden',
          transition: 'width 0.2s ease, min-width 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          zIndex: 25,
        }}>
          {showChat && (
            <ChatPanel
              doc={doc}
              actorName={actorName}
              actorColor={activeColor}
              onClose={() => setShowChat(false)}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
