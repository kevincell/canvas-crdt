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
      top: 70,
      right: 20,
      background: 'rgba(15, 15, 20, 0.95)',
      border: '1px solid rgba(229, 57, 53, 0.5)',
      borderRadius: 12,
      padding: '16px',
      zIndex: 100,
      backdropFilter: 'blur(16px)',
      minWidth: 260,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 15px rgba(229, 57, 53, 0.2)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e53935', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Network Simulator
        </div>
        <button onClick={() => setEnabled(false)} style={{ background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: 16 }}>
          ✕
        </button>
      </div>

      <div style={{ fontSize: 12, color: '#e2e2f0', marginBottom: 16, lineHeight: 1.4 }}>
        Test how the CRDT engine resolves conflicts when peers disconnect and edit offline.
      </div>

      <div style={{ background: 'rgba(229, 57, 53, 0.1)', padding: '10px', borderRadius: 6, marginBottom: 16, border: '1px dashed rgba(229, 57, 53, 0.3)' }}>
        <div style={{ fontSize: 11, color: '#ff5252', fontWeight: 600, marginBottom: 4 }}>
          ⚠️ LOCAL TESTING TIP
        </div>
        <div style={{ fontSize: 11, color: '#a3a3a3', lineHeight: 1.3 }}>
          If testing on one computer, open your second peer in an <b>Incognito Window</b>. Otherwise, tabs will still sync instantly bypassing the network via shared IndexedDB/Local Storage!
        </div>        </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={() => onSimulate('network-split')} style={btnStyle}>
          <span style={{ fontSize: 16 }}>🔌</span> Network Split
        </button>
        <button onClick={() => onSimulate('reconnect')} style={{...btnStyle, borderColor: 'rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.1)'}}>
          <span style={{ fontSize: 16 }}>🔗</span> Reconnect
        </button>
        <button onClick={() => onSimulate('offline-edit')} style={{...btnStyle, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.1)'}}>
          <span style={{ fontSize: 16 }}>✏️</span> Offline Edit
        </button>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 500,
  background: 'rgba(229, 57, 53, 0.15)',
  border: '1px solid rgba(229, 57, 53, 0.4)',
  borderRadius: 8,
  color: '#ffffff',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'all 0.15s ease',
};
