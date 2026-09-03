export function PartitionSimulator({
  enabled,
  setEnabled,
  onSimulate,
}: {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  onSimulate: (scenario: 'network-split' | 'reconnect' | 'offline-edit') => void;
}) {
  if (!enabled) return null;

  return (
    <div style={{
      position: 'absolute',
      top: 60,
      right: 16,
      background: 'rgba(30, 30, 46, 0.95)',
      border: '1px solid rgba(124, 58, 237, 0.4)',
      borderRadius: 10,
      padding: '12px 14px',
      zIndex: 100,
      backdropFilter: 'blur(12px)',
      minWidth: 180,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Partition Simulator
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button onClick={() => onSimulate('network-split')} style={btnStyle}>
          🌐 Network Split
        </button>
        <button onClick={() => onSimulate('reconnect')} style={btnStyle}>
          🔗 Reconnect
        </button>
        <button onClick={() => onSimulate('offline-edit')} style={btnStyle}>
          ✏️ Offline Edit
        </button>
        <button onClick={() => setEnabled(false)} style={{ ...btnStyle, color: '#8888a8' }}>
          ✕ Close
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#555570', marginTop: 8, fontStyle: 'italic' }}>
        Simulates P2P network partitions to test CRDT convergence and offline sync.
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: 12,
  background: 'rgba(124, 58, 237, 0.2)',
  border: '1px solid rgba(124, 58, 237, 0.4)',
  borderRadius: 6,
  color: '#c4b5fd',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'all 0.15s',
};
