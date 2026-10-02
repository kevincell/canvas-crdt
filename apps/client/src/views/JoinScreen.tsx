import { useState, useEffect } from 'react';
import { duplicateBoard, generateRoomId } from '../features/canvas/boardDuplication';
import { TemplatesModal } from '../features/templates/TemplatesModal';
import { type ShapeData } from '@crdt-canvas/engine';

export function JoinScreen({
  onJoin,
  onLaunchDual,
}: {
  onJoin: (name: string, roomId: string) => void;
  onLaunchDual?: (roomId: string) => void;
}) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [localIP, setLocalIP] = useState('');
  const [loadingIP, setLoadingIP] = useState(true);
  const [recentBoards, setRecentBoards] = useState<Array<{ roomId: string; title: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('crdt-canvas-recent-boards') || '[]').slice(0, 5); }
    catch { return []; }
  });
  const [favoriteRooms, setFavoriteRooms] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('crdt-canvas-favorite-boards') || '[]'); }
    catch { return []; }
  });
  const [boardSearch, setBoardSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const hasSavedBoards = recentBoards.length > 0 || favoriteRooms.length > 0;
  const savedBoards = [...new Set([...favoriteRooms, ...recentBoards.map(board => board.roomId)])]
    .map(id => ({ roomId: id, title: localStorage.getItem(`crdt-canvas-title-${id}`) || id, ...readBoardMetadata(id) }))
    .filter(board => (!favoritesOnly || favoriteRooms.includes(board.roomId))
      && (!boardSearch.trim() || `${board.title} ${board.roomId} ${board.description} ${board.folder} ${board.tags.join(' ')}`.toLowerCase().includes(boardSearch.trim().toLowerCase())))
    .sort((a, b) => Number(favoriteRooms.includes(b.roomId)) - Number(favoriteRooms.includes(a.roomId)));

  const toggleFavorite = (id: string) => {
    const next = favoriteRooms.includes(id) ? favoriteRooms.filter(room => room !== id) : [...favoriteRooms, id];
    setFavoriteRooms(next);
    localStorage.setItem('crdt-canvas-favorite-boards', JSON.stringify(next));
  };

  const joinBoard = (displayName: string, id: string) => {
    const title = localStorage.getItem(`crdt-canvas-title-${id}`) || id;
    const next = [{ roomId: id, title }, ...recentBoards.filter(board => board.roomId !== id)].slice(0, 5);
    setRecentBoards(next);
    localStorage.setItem('crdt-canvas-recent-boards', JSON.stringify(next));
    onJoin(displayName, id);
  };

  const handleDuplicate = async (sourceRoomId: string, sourceTitle: string) => {
    try {
      const { newRoomId } = await duplicateBoard({ sourceRoomId, sourceTitle });
      const activeName = name.trim() || 'Collaborator';
      joinBoard(activeName, newRoomId);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not duplicate this board.');
    }
  };

  const handleCreateFromTemplate = (shapes: Array<{ id: string; data: ShapeData }>, title: string) => {
    const newRoomId = generateRoomId();
    try {
      localStorage.setItem(`crdt-canvas-title-${newRoomId}`, title);
      sessionStorage.setItem(
        `crdt-canvas-initial-snapshot-${newRoomId}`,
        JSON.stringify({ title, shapes })
      );
    } catch {
      // ignore
    }
    const activeName = name.trim() || 'Collaborator';
    joinBoard(activeName, newRoomId);
  };

  useEffect(() => {
    fetch('/api/ip')
      .then(r => r.json())
      .then(data => setLocalIP(data.ip || data.localIP || ''))
      .catch(() => setLocalIP(''))
      .finally(() => setLoadingIP(false));
  }, []);

  const handleCreate = () => {
    setIsCreating(true);
    const newRoomId = (typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        })
    ).slice(0, 8);
    setRoomId(newRoomId);
    // Auto-join after setting room ID
    setTimeout(() => {
      if (name.trim() && newRoomId.trim()) {
        joinBoard(name.trim(), newRoomId.trim());
      }
      setIsCreating(false);
    }, 50);
  };

  const handleJoin = () => {
    if (name.trim() && roomId.trim()) {
      joinBoard(name.trim(), roomId.trim());
    }
  };

  const canJoin = name.trim().length > 0 && roomId.trim().length > 0;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at 30% 20%, rgba(124,58,237,0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(59,130,246,0.06) 0%, transparent 50%), #0f0f14',
    }}>
      <style>{`
        .join-input:focus { border-color: rgba(124,58,237,0.6) !important; box-shadow: 0 0 0 2px rgba(124,58,237,0.2) !important; }
        .join-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(124,58,237,0.3) !important; filter: brightness(1.1); }
        .join-btn:active:not(:disabled) { transform: translateY(1px); }
        .dual-btn:hover { background: rgba(16, 185, 129, 0.18) !important; border-color: rgba(16, 185, 129, 0.5) !important; transform: translateY(-1px); box-shadow: 0 6px 24px rgba(16, 185, 129, 0.2) !important; }
        .dual-btn:active { transform: translateY(1px); }
      `}</style>
      <div style={{
        width: 400,
        padding: '36px 32px',
        background: 'rgba(30, 30, 46, 0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        backdropFilter: 'blur(20px)',
        boxShadow: '0 8px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)',
        animation: 'fadeIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            fontSize: 28,
            fontWeight: 800,
            color: '#e2e2f0',
            marginBottom: 6,
            letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #c4b5fd 0%, #7c3aed 50%, #3b82f6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            ✦ CRDT Canvas
          </div>
          <div style={{ fontSize: 12, color: '#8888a8', letterSpacing: '0.04em' }}>
            P2P · Conflict-free · Offline-ready
          </div>
        </div>

        {/* Name input */}
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="crdt-name" style={{ display: 'block', fontSize: 10, color: '#8888a8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
            Your Name
          </label>
          <input
            id="crdt-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Alice"
            className="join-input"
            style={{
              width: '100%',
              padding: '11px 14px',
              background: 'rgba(15, 15, 20, 0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              color: '#e2e2f0',
              fontSize: 14,
              outline: 'none',
              transition: 'all 0.2s',
              fontFamily: 'Inter, sans-serif',
            }}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
          />
        </div>

        {/* Room ID input */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label htmlFor="crdt-room" style={{ display: 'block', fontSize: 10, color: '#8888a8', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
              Room ID
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setShowTemplates(true)}
                style={{
                  fontSize: 10,
                  color: '#c4b5fd',
                  background: 'rgba(124,58,237,0.18)',
                  border: '1px solid rgba(124,58,237,0.35)',
                  borderRadius: 6,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                }}
              >
                ✦ Templates
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating}
                style={{
                  fontSize: 10,
                  color: '#a78bfa',
                  background: 'rgba(124,58,237,0.12)',
                  border: '1px solid rgba(124,58,237,0.3)',
                  borderRadius: 6,
                  padding: '2px 8px',
                  cursor: isCreating ? 'not-allowed' : 'pointer',
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                }}
              >
                {isCreating ? '…' : 'Create & Join'}
              </button>
            </div>
          </div>
          <input
            id="crdt-room"
            type="text"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
            placeholder="Enter or create a room…"
            className="join-input"
            style={{
              width: '100%',
              padding: '11px 14px',
              background: 'rgba(15, 15, 20, 0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              color: '#e2e2f0',
              fontSize: 14,
              outline: 'none',
              transition: 'all 0.2s',
              fontFamily: 'monospace',
              letterSpacing: '0.05em',
            }}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
          />
        </div>

        {hasSavedBoards && <div style={{ marginTop: -12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: '#8888a8', textTransform: 'uppercase', letterSpacing: '.08em' }}>Your boards</div>
            <button type="button" onClick={() => setFavoritesOnly(value => !value)} aria-pressed={favoritesOnly} style={{ color: favoritesOnly ? '#fbbf24' : '#8888a8', background: 'transparent', border: 0, fontSize: 10, cursor: 'pointer' }}>★ Favorites</button>
          </div>
          <input type="search" aria-label="Search recent and favorite boards" placeholder="Search boards…" value={boardSearch} onChange={event => setBoardSearch(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6, padding: '7px 9px', borderRadius: 6, color: '#d4d4e1', background: 'rgba(15,15,20,.55)', border: '1px solid rgba(255,255,255,.09)', fontSize: 11 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {savedBoards.map(board => <div key={board.roomId} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button type="button" onClick={() => { setRoomId(board.roomId); if (name.trim()) joinBoard(name.trim(), board.roomId); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, padding: '7px 9px', textAlign: 'left', borderRadius: 6, background: 'rgba(255,255,255,.04)', color: '#d4d4e1', border: '1px solid rgba(255,255,255,.07)', fontSize: 11, cursor: 'pointer' }}>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{board.title}</span>
                  {(board.folder || board.tags.length > 0) && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#8888a8', fontSize: 9 }}>{[board.folder, ...board.tags].filter(Boolean).join(' · ')}</span>}
                </span>
                <span style={{ flexShrink: 0, color: '#8888a8', fontFamily: 'monospace' }}>{board.roomId}</span>
              </button>
              <button type="button" onClick={() => void handleDuplicate(board.roomId, board.title)} title="Duplicate board as a new independent copy" aria-label={`Duplicate ${board.title}`} style={{ width: 28, height: 28, color: '#a78bfa', background: 'transparent', border: 0, cursor: 'pointer', fontSize: 13 }}>⧉</button>
              <button type="button" onClick={() => toggleFavorite(board.roomId)} aria-label={favoriteRooms.includes(board.roomId) ? `Remove ${board.title} from favorites` : `Add ${board.title} to favorites`} aria-pressed={favoriteRooms.includes(board.roomId)} style={{ width: 28, height: 28, color: favoriteRooms.includes(board.roomId) ? '#fbbf24' : '#64647a', background: 'transparent', border: 0, cursor: 'pointer' }}>★</button>
            </div>)}
            {savedBoards.length === 0 && <div style={{ color: '#8888a8', fontSize: 11, padding: '6px 2px' }}>No matching boards.</div>}
          </div>
        </div>}

        {/* Join button */}
        <button
          onClick={handleJoin}
          disabled={!canJoin}
          className="join-btn"
          style={{
            width: '100%',
            padding: '13px',
            background: canJoin ? 'linear-gradient(135deg, rgba(124,58,237,0.7) 0%, rgba(59,130,246,0.5) 100%)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${canJoin ? 'rgba(124,58,237,0.7)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 12,
            color: canJoin ? '#fff' : '#555570',
            fontSize: 15,
            fontWeight: 600,
            cursor: canJoin ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            fontFamily: 'Inter, sans-serif',
            letterSpacing: '0.02em',
            boxShadow: canJoin ? '0 4px 16px rgba(124,58,237,0.25)' : 'none',
          }}
        >
          Join Room
        </button>

        {/* Divider */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          margin: '18px 0 14px',
          color: '#555570',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
        }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          <span>Or 1-Click Live Demo</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        </div>

        {/* Dual-Peer Presenter Mode Button */}
        {onLaunchDual && (
          <button
            onClick={() => onLaunchDual(roomId.trim() || 'demo-' + Math.random().toString(36).slice(2, 8))}
            className="dual-btn"
            style={{
              width: '100%',
              padding: '11px',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: 12,
              color: '#6ee7b7',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              fontFamily: 'Inter, sans-serif',
              letterSpacing: '0.01em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 16px rgba(16, 185, 129, 0.15)',
            }}
          >
            <span>🚀</span> Launch Dual-Peer Demo (Side-by-Side)
          </button>
        )}

        {/* LAN IP */}
        {localIP && (
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'rgba(59, 130, 246, 0.07)',
            border: '1px solid rgba(59, 130, 246, 0.18)',
            borderRadius: 10,
            fontSize: 12,
            color: '#93c5fd',
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 3, fontSize: 11, color: '#60a5fa' }}>
              LAN Address
            </div>
            <code style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {localIP}:5174
            </code>
            <div style={{ marginTop: 4, color: '#555570', fontSize: 11 }}>
              Share with collaborators on same WiFi
            </div>
          </div>
        )}

        {/* How it works */}
        <div style={{
          marginTop: 20,
          padding: '14px 16px',
          background: 'rgba(15, 15, 20, 0.4)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: 10,
          fontSize: 11,
          color: '#555570',
          lineHeight: 1.8,
        }}>
          <div style={{ color: '#8888a8', fontWeight: 600, marginBottom: 6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            How it works
          </div>
          <div>• Share the room ID with collaborators</div>
          <div>• All data syncs peer-to-peer via WebRTC</div>
          <div>• Yjs CRDT ensures conflict-free merging</div>
          <div>• Works offline — edits queue and sync on reconnect</div>
        </div>
      </div>

      <TemplatesModal
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onCreateNewBoard={handleCreateFromTemplate}
        isCanvasEmpty={true}
      />
    </div>
  );
}

function readBoardMetadata(roomId: string): { description: string; folder: string; tags: string[] } {
  try {
    const value = JSON.parse(localStorage.getItem(`crdt-canvas-meta-${roomId}`) || '{}');
    return {
      description: typeof value.description === 'string' ? value.description : '',
      folder: typeof value.folder === 'string' ? value.folder : '',
      tags: Array.isArray(value.tags) ? value.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
    };
  } catch {
    return { description: '', folder: '', tags: [] };
  }
}
