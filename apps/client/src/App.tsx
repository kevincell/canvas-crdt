import { useState, useCallback, useRef, useEffect } from 'react';
import { useCanvasCRDT } from './hooks/useCanvasCRDT';
import { CanvasRenderer } from './canvas/CanvasRenderer';
import { Toolbar } from './components/Toolbar';
import { ConflictPanel } from './components/ConflictPanel';
import { StatusPanel } from './components/StatusPanel';
import { JoinScreen } from './components/JoinScreen';
import { ConnectionBanner } from './components/ConnectionBanner';
import { PartitionSimulator } from './components/PartitionSimulator';
import { ChatPanel } from './components/ChatPanel';
import { type Conflict, type Shape, ShapeKind } from '@crdt-canvas/engine';

type AppMode = 'join' | 'canvas';
type ToolType = 'stroke' | 'rect' | 'ellipse' | 'line' | 'text' | 'image' | 'note' | 'select' | 'eraser';

// Load persisted preferences
function loadPrefs() {
  return {
    name: localStorage.getItem('crdt-canvas-name') || '',
    roomId: localStorage.getItem('crdt-canvas-last-room') || '',
    color: localStorage.getItem('crdt-canvas-color') || '#7c3aed',
    showSimulator: localStorage.getItem('crdt-canvas-show-sim') === '1',
  };
}

const DEFAULT_NOTE_BG = '#fef3c7';

export default function App() {
  const [mode, setMode] = useState<AppMode>('join');
  const [actorName, setActorName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [tool, setTool] = useState<ToolType>('stroke');
  const [activeColor, setActiveColor] = useState(() => loadPrefs().color);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [historyStep, setHistoryStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showConflicts, setShowConflicts] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showSimulator, setShowSimulator] = useState(() => loadPrefs().showSimulator);
  const [canvasScale, setCanvasScale] = useState(1);

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
    sendMessage,
    simulateOffline,
    simulateOnline,
    triggerReconnect,
    doc,
  } = useCanvasCRDT(actorName, roomId);

  const handleJoin = useCallback((name: string, room: string) => {
    setActorName(name);
    setRoomId(room);
    localStorage.setItem('crdt-canvas-name', name);
    localStorage.setItem('crdt-canvas-last-room', room);
    setMode('canvas');
  }, []);

  // Persist color preference
  useEffect(() => {
    localStorage.setItem('crdt-canvas-color', activeColor);
  }, [activeColor]);

  // Persist simulator visibility
  useEffect(() => {
    localStorage.setItem('crdt-canvas-show-sim', showSimulator ? '1' : '0');
  }, [showSimulator]);

  // History playback timer
  useEffect(() => {
    if (isPlaying && history) {
      historyTimerRef.current = setInterval(() => {
        setHistoryStep(prev => {
          if (prev >= history.totalSteps) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 800);
    }
    return () => {
      if (historyTimerRef.current) clearInterval(historyTimerRef.current);
    };
  }, [isPlaying, history]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && e.shiftKey && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === 'v' || e.key === 'V') setTool('select');
      else if (e.key === 's' || e.key === 'S') setTool('stroke');
      else if (e.key === 'r' || e.key === 'R') setTool('rect');
      else if (e.key === 'e' || e.key === 'E') setTool('ellipse');
      else if (e.key === 'l' || e.key === 'L') setTool('line');
      else if (e.key === 't' || e.key === 'T') setTool('text');
      else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setTool('image');
        fileInputRef.current?.click();
      }
      else if (e.key === 'n' || e.key === 'N') setTool('note');
      else if (e.key === 'x' || e.key === 'X') setTool('eraser');
      else if (e.key === 'c' || e.key === 'C') setShowChat(v => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // ── Image upload handler ─────────────────────────────────────────────────

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (!src) return;

      const img = new Image();
      img.onload = () => {
        const maxW = 600;
        const maxH = 400;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        // Place at center of current view
        const cx = -200;
        const cy = -150;
        createImage(cx - w / 2, cy - h / 2, w, h, src);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [createImage]);

  // ── Shape callbacks from canvas ──────────────────────────────────────────

  const handleStrokeEnd = useCallback((points: { x: number; y: number }[], color: string, width: number) => {
    createStroke(points, color, width);
  }, [createStroke]);

  const handleRectEnd = useCallback((x: number, y: number, w: number, h: number, color: string) => {
    createRect(x, y, w, h, color);
  }, [createRect]);

  const handleEllipseEnd = useCallback((cx: number, cy: number, rx: number, ry: number, color: string) => {
    createEllipse(cx, cy, rx, ry, color);
  }, [createEllipse]);

  const handleLineEnd = useCallback((x1: number, y1: number, x2: number, y2: number, color: string, width: number) => {
    createLine(x1, y1, x2, y2, color, width);
  }, [createLine]);

  const handleTextSubmit = useCallback((x: number, y: number, text: string, color: string) => {
    createText(x, y, text, color);
  }, [createText]);

  const handleImageAdd = useCallback((x: number, y: number, w: number, h: number, src: string) => {
    createImage(x, y, w, h, src);
  }, [createImage]);

  const handleNoteAdd = useCallback((x: number, y: number, text: string, color: string, bgColor: string) => {
    createNote(x, y, text, color, bgColor);
  }, [createNote]);

  const handleShapeMoved = useCallback((id: string, dx: number, dy: number) => {
    updateShape(id, {});
  }, [updateShape]);

  const handleShapeResized = useCallback((id: string, data: Partial<any>) => {
    updateShape(id, data);
  }, [updateShape]);

  const handleResolveConflict = useCallback((shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => {
    console.log(`[conflict-resolve] ${shapeId}: ${action}`);
  }, []);

  const handleSimulate = useCallback((scenario: 'network-split' | 'reconnect' | 'offline-edit') => {
    switch (scenario) {
      case 'network-split':
      case 'offline-edit':
        simulateOffline();
        break;
      case 'reconnect':
        simulateOnline();
        break;
    }
  }, [simulateOffline, simulateOnline]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (mode === 'join') {
    return <JoinScreen onJoin={handleJoin} />;
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      background: '#0d0d14',
    }}>
      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageUpload}
      />

      {/* Canvas area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0 }}>
        <CanvasRenderer
          shapes={shapes}
          conflicts={conflicts}
          remoteCursors={remoteCursors}
          history={history}
          historyStep={historyStep}
          isPlaying={isPlaying}
          tool={tool}
          activeColor={activeColor}
          strokeWidth={strokeWidth}
          scale={canvasScale}
          onStrokeEnd={handleStrokeEnd}
          onRectEnd={handleRectEnd}
          onEllipseEnd={handleEllipseEnd}
          onLineEnd={handleLineEnd}
          onTextSubmit={handleTextSubmit}
          onImageAdd={handleImageAdd}
          onImageDrop={handleImageAdd}
          onNoteAdd={handleNoteAdd}
          onDelete={deleteShape}
          onShapeMoved={handleShapeMoved}
          onShapeResized={handleShapeResized}
          onZoomChange={setCanvasScale}
        />

        <Toolbar
          tool={tool}
          setTool={setTool as (t: string) => void}
          activeColor={activeColor}
          setActiveColor={setActiveColor}
          strokeWidth={strokeWidth}
          setStrokeWidth={setStrokeWidth}
          scale={canvasScale}
          onZoomIn={() => setCanvasScale(s => Math.min(10, s * 1.25))}
          onZoomOut={() => setCanvasScale(s => Math.max(0.1, s * 0.8))}
          onResetView={() => setCanvasScale(1)}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          conflictCount={conflicts.length}
          participantCount={participants.length}
          history={history}
          historyStep={historyStep}
          onHistoryChange={setHistoryStep}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          onResetHistory={() => { setHistoryStep(0); setIsPlaying(false); }}
          onShowConflicts={setShowConflicts}
          showConflicts={showConflicts}
          onToggleSimulator={() => setShowSimulator(v => !v)}
          showSimulator={showSimulator}
          onToggleChat={() => setShowChat(v => !v)}
          showChat={showChat}
          roomId={roomId}
          onCopyRoomId={() => {
            navigator.clipboard.writeText(roomId);
          }}
        />

        <ConnectionBanner
          state={connectionState}
          peerCount={peerCount}
          queuedOps={queuedOps}
          onReconnect={triggerReconnect}
        />

        {showSimulator && (
          <PartitionSimulator
            enabled={showSimulator}
            setEnabled={setShowSimulator}
            onSimulate={handleSimulate}
          />
        )}

        {showConflicts && conflicts.length > 0 && (
          <ConflictPanel
            conflicts={conflicts}
            shapes={shapes}
            onResolve={handleResolveConflict}
          />
        )}

        <StatusPanel
          connected={connected}
          peerCount={peerCount}
          shapeCount={shapes.length}
          conflictCount={conflicts.length}
          historyStep={historyStep}
          totalHistorySteps={history?.totalSteps ?? 0}
          roomId={canvasRoomId}
          localIP={localIP}
          connectionState={connectionState}
          queuedOps={queuedOps}
        />
      </div>

      {/* Right sidebar */}
      <div style={{
        width: showChat ? 300 : 0,
        minWidth: showChat ? 300 : 0,
        height: '100%',
        background: 'rgba(15, 15, 22, 0.97)',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {showChat && (
          <ChatPanel
            doc={doc}
            actorName={actorName}
            actorColor={activeColor}
            onClose={() => setShowChat(false)}
          />
        )}
      </div>
    </div>
  );
}
