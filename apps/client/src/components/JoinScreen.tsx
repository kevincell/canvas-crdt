import { useState, useEffect } from 'react';

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
  const [localIP, setLocalIP] = useState('');
  const [loadingIP, setLoadingIP] = useState(true);

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
        onJoin(name.trim(), newRoomId.trim());
      }
      setIsCreating(false);
    }, 50);
  };

  const handleJoin = () => {
    if (name.trim() && roomId.trim()) {
      onJoin(name.trim(), roomId.trim());
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
      <div style={{
        width: 400,
        padding: '36px 32px',
        background: 'rgba(30, 30, 46, 0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        backdropFilter: 'blur(20px)',
        boxShadow: '0 8px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)',
        animation: 'fadeIn 0.3s ease',
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
            style={{
              width: '100%',
              padding: '11px 14px',
              background: 'rgba(15, 15, 20, 0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              color: '#e2e2f0',
              fontSize: 14,
              outline: 'none',
              transition: 'border-color 0.15s',
              fontFamily: 'Inter, sans-serif',
            }}
            onFocus={e => (e.target.style.borderColor = 'rgba(124,58,237,0.5)')}
            onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
          />
        </div>

        {/* Room ID input */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label htmlFor="crdt-room" style={{ display: 'block', fontSize: 10, color: '#8888a8', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
              Room ID
            </label>
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
          <input
            id="crdt-room"
            type="text"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
            placeholder="Enter or create a room…"
            style={{
              width: '100%',
              padding: '11px 14px',
              background: 'rgba(15, 15, 20, 0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              color: '#e2e2f0',
              fontSize: 14,
              outline: 'none',
              transition: 'border-color 0.15s',
              fontFamily: 'monospace',
              letterSpacing: '0.05em',
            }}
            onFocus={e => (e.target.style.borderColor = 'rgba(124,58,237,0.5)')}
            onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
          />
        </div>

        {/* Join button */}
        <button
          onClick={handleJoin}
          disabled={!canJoin}
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
            transition: 'all 0.2s',
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
              transition: 'all 0.2s',
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
    </div>
  );
}
