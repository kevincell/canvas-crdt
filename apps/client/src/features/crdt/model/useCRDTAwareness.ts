import { useEffect, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

export interface RemoteCursor {
  x: number;
  y: number;
  color: string;
  name: string;
}

export interface Participant {
  id: string;
  name: string;
  color: string;
}

export interface RemoteLaser {
  points: { x: number; y: number }[];
  color: string;
}

export interface CRDTAwareness {
  remoteCursors: Map<string, RemoteCursor>;
  remoteLasers: Map<string, RemoteLaser>;
  participants: Participant[];
  setCursor: (x: number, y: number) => void;
  setParticipantName: (name: string) => void;
  setLaserPoints: (points: { x: number; y: number }[] | null) => void;
}

export function useCRDTAwareness(doc: Y.Doc | null, awareness: Awareness | null): CRDTAwareness {
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const [remoteLasers, setRemoteLasers] = useState<Map<string, RemoteLaser>>(new Map());
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Helper to rebuild participants from the full awareness state (deduped by name)
  const rebuildParticipants = useCallback(() => {
    if (!awareness) return;
    const states = awareness.getStates();
    const seen = new Map<string, Participant>();
    for (const [id, state] of states.entries()) {
      const s = state as any;
      const name = s?.actor ?? 'Anonymous';
      // Keep the entry with the highest clientID (most recent connection) when names collide
      if (!seen.has(name) || Number(id) > Number(seen.get(name)!.id)) {
        seen.set(name, { id: String(id), name, color: s?.color ?? '#7c3aed' });
      }
    }
    setParticipants(Array.from(seen.values()));
  }, [awareness]);

  useEffect(() => {
    if (!doc || !awareness) return;

    // Build initial participant list from existing awareness states on mount
    rebuildParticipants();

    const handleAwarenessUpdate = (updated: any) => {
      setRemoteCursors(prev => {
        const next = new Map(prev);
        const states = awareness.getStates();
        
        for (const clientID of updated.added || []) {
          if (clientID === doc.clientID) continue;
          const state = states.get(clientID) as any;
          if (state?.cursor) {
            next.set(String(clientID), {
              x: state.cursor.x ?? 0,
              y: state.cursor.y ?? 0,
              color: state.color ?? '#7c3aed',
              name: state.actor ?? 'Anonymous',
            });
          }
        }
        for (const clientID of updated.updated || []) {
          if (clientID === doc.clientID) continue;
          const state = states.get(clientID) as any;
          if (state?.cursor) {
            next.set(String(clientID), {
              x: state.cursor.x ?? 0,
              y: state.cursor.y ?? 0,
              color: state.color ?? '#7c3aed',
              name: state.actor ?? 'Anonymous',
            });
          }
        }
        for (const clientID of updated.removed || []) {
          next.delete(String(clientID));
        }
        return next;
      });

      setRemoteLasers(prev => {
        const next = new Map(prev);
        const states = awareness.getStates();
        
        for (const clientID of updated.added || []) {
          if (clientID === doc.clientID) continue;
          const state = states.get(clientID) as any;
          if (state?.laser) {
            next.set(String(clientID), {
              points: state.laser.points || [],
              color: state.color ?? '#ef4444',
            });
          }
        }
        for (const clientID of updated.updated || []) {
          if (clientID === doc.clientID) continue;
          const state = states.get(clientID) as any;
          if (state?.laser) {
            next.set(String(clientID), {
              points: state.laser.points || [],
              color: state.color ?? '#ef4444',
            });
          } else {
            next.delete(String(clientID));
          }
        }
        for (const clientID of updated.removed || []) {
          next.delete(String(clientID));
        }
        return next;
      });

      // Rebuild full participant list (deduped by name) on every awareness change
      rebuildParticipants();
    };

    awareness.on('update', handleAwarenessUpdate);
    return () => {
      awareness.off('update', handleAwarenessUpdate);
    };
  }, [doc, awareness, rebuildParticipants]);

  const setCursor = useCallback((x: number, y: number) => {
    awareness?.setLocalStateField('cursor', { x, y });
  }, [awareness]);

  const setParticipantName = useCallback((name: string) => {
    awareness?.setLocalStateField('actor', name);
  }, [awareness]);

  const setLaserPoints = useCallback((points: { x: number; y: number }[] | null) => {
    if (points) {
      awareness?.setLocalStateField('laser', { points });
    } else {
      awareness?.setLocalStateField('laser', null);
    }
  }, [awareness]);

  return {
    remoteCursors,
    remoteLasers,
    participants,
    setCursor,
    setParticipantName,
    setLaserPoints,
  };
}
