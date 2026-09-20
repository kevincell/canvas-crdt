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

  useEffect(() => {
    if (!doc || !awareness) return;

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

      setParticipants(Array.from(awareness.getStates().entries() as Iterable<[number, any]>).map(([id, state]) => ({
        id: String(id),
        name: (state as any)?.actor ?? 'Anonymous',
        color: (state as any)?.color ?? '#7c3aed',
      })));
    };

    awareness.on('update', handleAwarenessUpdate);
    return () => {
      awareness.off('update', handleAwarenessUpdate);
    };
  }, [doc, awareness]);

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
