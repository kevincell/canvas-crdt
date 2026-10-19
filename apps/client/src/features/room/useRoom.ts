/**
 * useRoom — the shared "room" document: membership + join approval, boards, room votes,
 * room chat and the Watch Party channels.
 *
 * Join approval (basic, no cryptography — by design for now):
 *   • The creator of a room is its host and is approved automatically.
 *   • Someone joining sets their presence to "pending". Every approved member who is online
 *     (host OR any member — so it works when the host is offline) gets an Allow / Decline prompt.
 *   • Allow writes them into `members`; Decline writes into `declines`.
 *   • Kick (host only) marks the member as kicked; they can ask to rejoin, which needs approval again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { resolveSignalingUrl, fetchLanIp } from '../../app/signaling';
import { randomId, rememberRoom, forgetRoom } from '../../app/identity';
import {
  type BoardInfo, type Decline, type Member, type Proposal, type ProposalKind, type RoomMeta,
  ACTIVE_WINDOW_MS, PROPOSAL_TTL_MS, PROPOSAL_THRESHOLD, votesRequired,
} from './roomTypes';

export type JoinMode = 'create' | 'join' | 'view';
export type RoomStatus = 'loading' | 'pending' | 'approved' | 'declined' | 'kicked' | 'deleted' | 'viewer' | 'left';
export type RoomConnection = 'connecting' | 'connected' | 'disconnected';

export interface Identity {
  deviceId: string;
  name: string;
  color: string;
}

export interface OnlinePeer {
  clientId: number;
  deviceId: string;
  name: string;
  color: string;
  status: 'pending' | 'approved' | 'viewer';
  requestTs: number;
}

export interface RoomApi {
  roomId: string;
  doc: Y.Doc | null;
  awareness: Awareness | null;
  status: RoomStatus;
  connection: RoomConnection;
  meta: RoomMeta | null;
  members: Member[];
  activeMembers: Member[];
  boards: BoardInfo[];
  proposals: Proposal[];
  online: OnlinePeer[];
  pendingRequests: OnlinePeer[];
  isHost: boolean;
  me: Identity;
  localIP: string;
  webrtcLinks: number;
  tabLinks: number;
  /** Room-presence participants in the shape the Watch Party hooks expect */
  participants: Array<{ id: string; name: string; color: string }>;
  approve: (peer: OnlinePeer) => void;
  decline: (peer: OnlinePeer) => void;
  kick: (deviceId: string) => void;
  leave: () => void;
  requestRejoin: () => void;
  updateMeta: (patch: Partial<Pick<RoomMeta, 'name' | 'description'>>) => void;
  createBoard: (name: string, description?: string) => string | null;
  updateBoard: (id: string, patch: Partial<Pick<BoardInfo, 'name' | 'description'>>) => void;
  propose: (kind: ProposalKind, opts: { boardId?: string; targets?: string[]; title: string }) => string | null;
  vote: (proposalId: string) => void;
  markApplied: (proposalId: string) => void;
  votesNeeded: (p: Proposal) => number;
  validVotes: (p: Proposal) => number;
  setPresence: (patch: Partial<Identity>) => void;
}

function readMap<T>(map: Y.Map<unknown>): T {
  const out: Record<string, unknown> = {};
  map.forEach((value, key) => { out[key] = value; });
  return out as T;
}

async function legacyBoardExists(roomId: string): Promise<boolean> {
  try {
    const dbs = await (indexedDB as any).databases?.();
    if (Array.isArray(dbs)) return dbs.some((d: any) => d?.name === `crdt-canvas-${roomId}`);
  } catch { /* ignore */ }
  try {
    return JSON.parse(localStorage.getItem('crdt-canvas-recent-boards') || '[]').includes(roomId);
  } catch { return false; }
}

export function useRoom(
  roomId: string,
  mode: JoinMode,
  identity: Identity,
  createInfo?: { name: string; description: string },
): RoomApi {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<RoomConnection>('connecting');
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [memberMap, setMemberMap] = useState<Record<string, Member>>({});
  const [declineMap, setDeclineMap] = useState<Record<string, Decline>>({});
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [online, setOnline] = useState<OnlinePeer[]>([]);
  const [localIP, setLocalIP] = useState('');
  const [links, setLinks] = useState({ webrtc: 0, bc: 0 });
  const [left, setLeft] = useState(false);
  const [rejoinRequested, setRejoinRequested] = useState(false);
  const requestTsRef = useRef(Date.now());
  const identityRef = useRef(identity);
  identityRef.current = identity;

  // ── Document, persistence, network ────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const ydoc = new Y.Doc();
    const aw = new Awareness(ydoc);
    let provider: WebrtcProvider | null = null;
    let persistence: IndexeddbPersistence | null = null;

    setDoc(ydoc);
    setAwareness(aw);
    setReady(false);
    setLeft(false);
    requestTsRef.current = Date.now();

    const metaMap = ydoc.getMap('meta');
    const membersMap = ydoc.getMap('members');
    const boardsMap = ydoc.getMap('boards');
    ydoc.getText('chat');

    const seedNewRoom = (name: string, description: string, docName: string) => {
      const me = identityRef.current;
      const now = Date.now();
      ydoc.transact(() => {
        if (!metaMap.get('createdAt')) {
          metaMap.set('name', name || 'Untitled room');
          metaMap.set('description', description || '');
          metaMap.set('hostDeviceId', me.deviceId);
          metaMap.set('hostName', me.name);
          metaMap.set('createdAt', now);
        }
        membersMap.set(me.deviceId, {
          deviceId: me.deviceId, name: me.name, color: me.color, role: 'host',
          approvedBy: me.name, joinedAt: now, lastSeen: now,
        } satisfies Member);
        if (boardsMap.size === 0) {
          boardsMap.set('main', {
            id: 'main', name: 'Board 1', description: '', docName,
            createdBy: me.deviceId, createdByName: me.name, createdAt: now,
          } satisfies BoardInfo);
        }
      }, 'room-seed');
    };

    (async () => {
      if (mode !== 'view') {
        persistence = new IndexeddbPersistence(`crdt-room-${roomId}`, ydoc);
        try { await persistence.whenSynced; } catch { /* ignore */ }
      }
      if (cancelled) return;

      if (mode === 'create') {
        seedNewRoom(createInfo?.name ?? roomId, createInfo?.description ?? '', `${roomId}::b::main`);
      }

      const signaling = await resolveSignalingUrl(identityRef.current.name);
      if (cancelled) return;
      provider = new WebrtcProvider(`${roomId}::room`, ydoc, { signaling: [signaling], awareness: aw });
      provider.on('status', (e: any) => setConnection(e?.connected ? 'connected' : 'disconnected'));
      provider.on('peers', (e: any) => setLinks({ webrtc: e?.webrtcPeers?.length ?? 0, bc: e?.bcPeers?.length ?? 0 }));
      fetchLanIp().then(ip => { if (!cancelled) setLocalIP(ip); });

      // Existing pre-rooms board on this device: adopt it as the first board, become host.
      if (mode === 'join' && !metaMap.get('createdAt') && await legacyBoardExists(roomId)) {
        await new Promise(r => setTimeout(r, 2500)); // give peers a moment to send real room data
        if (!cancelled && !metaMap.get('createdAt')) {
          let title = roomId;
          try { title = localStorage.getItem(`crdt-canvas-title-${roomId}`) || roomId; } catch { /* ignore */ }
          seedNewRoom(title, '', roomId);
        }
      }
      if (!cancelled) setReady(true);
    })();

    // ── observers ──
    const syncMeta = () => setMeta(metaMap.get('createdAt') ? readMap<RoomMeta>(metaMap as Y.Map<unknown>) : null);
    const syncMembers = () => setMemberMap(readMap<Record<string, Member>>(membersMap as Y.Map<unknown>));
    const declinesMap = ydoc.getMap('declines');
    const syncDeclines = () => setDeclineMap(readMap<Record<string, Decline>>(declinesMap as Y.Map<unknown>));
    const syncBoards = () => {
      const list: BoardInfo[] = [];
      boardsMap.forEach(value => { if (value && typeof value === 'object') list.push(value as BoardInfo); });
      list.sort((a, b) => a.createdAt - b.createdAt);
      setBoards(list);
    };
    const proposalsMap = ydoc.getMap<Y.Map<unknown>>('proposals');
    const syncProposals = () => {
      const list: Proposal[] = [];
      proposalsMap.forEach(pm => {
        if (!(pm instanceof Y.Map)) return;
        const votesY = pm.get('votes');
        const votes: Record<string, number> = {};
        if (votesY instanceof Y.Map) votesY.forEach((ts, k) => { votes[k] = Number(ts); });
        list.push({ ...(readMap<any>(pm)), votes } as Proposal);
      });
      list.sort((a, b) => b.createdAt - a.createdAt);
      setProposals(list);
    };
    metaMap.observe(syncMeta);
    membersMap.observe(syncMembers);
    declinesMap.observe(syncDeclines);
    boardsMap.observe(syncBoards);
    proposalsMap.observeDeep(syncProposals);
    syncMeta(); syncMembers(); syncDeclines(); syncBoards(); syncProposals();

    const syncOnline = () => {
      const list: OnlinePeer[] = [];
      aw.getStates().forEach((state: any, clientId) => {
        if (!state?.deviceId) return;
        list.push({
          clientId, deviceId: state.deviceId, name: state.name ?? 'Someone', color: state.color ?? '#888',
          status: state.status ?? 'approved', requestTs: Number(state.requestTs ?? 0),
        });
      });
      setOnline(list);
    };
    aw.on('change', syncOnline);
    syncOnline();

    return () => {
      cancelled = true;
      metaMap.unobserve(syncMeta);
      membersMap.unobserve(syncMembers);
      declinesMap.unobserve(syncDeclines);
      boardsMap.unobserve(syncBoards);
      proposalsMap.unobserveDeep(syncProposals);
      aw.off('change', syncOnline);
      try { aw.setLocalState(null); } catch { /* ignore */ }
      provider?.destroy();
      persistence?.destroy();
      aw.destroy();
      ydoc.destroy();
    };
    // createInfo is only read on first mount of a 'create'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, mode]);

  // ── Derived status ─────────────────────────────────────────────────────
  const myMember = memberMap[identity.deviceId];
  const myDecline = declineMap[identity.deviceId];
  const status: RoomStatus = useMemo(() => {
    if (left) return 'left';
    if (mode === 'view') return meta?.deleted ? 'deleted' : 'viewer';
    if (!ready && !myMember) return 'loading';
    if (meta?.deleted) return 'deleted';
    if (myMember && !myMember.kicked) return 'approved';
    if (myMember?.kicked && !rejoinRequested) return 'kicked';
    if (myDecline && myDecline.ts >= requestTsRef.current) return 'declined';
    return 'pending';
  }, [left, mode, ready, meta?.deleted, myMember, myDecline, rejoinRequested]);

  // Publish presence
  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalState({
      ...(awareness.getLocalState() ?? {}),
      deviceId: identity.deviceId,
      name: identity.name,
      color: identity.color,
      status: status === 'approved' ? 'approved' : status === 'viewer' ? 'viewer' : 'pending',
      requestTs: requestTsRef.current,
    });
  }, [awareness, identity.deviceId, identity.name, identity.color, status]);

  // Keep my member record fresh (name / colour / lastSeen) and remember the room locally
  useEffect(() => {
    if (!doc || status !== 'approved') return;
    const membersMap = doc.getMap('members');
    const touch = () => {
      const current = membersMap.get(identity.deviceId) as Member | undefined;
      if (!current || current.kicked) return;
      membersMap.set(identity.deviceId, { ...current, name: identity.name, color: identity.color, lastSeen: Date.now() });
    };
    touch();
    const id = setInterval(touch, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [doc, status, identity.deviceId, identity.name, identity.color]);

  useEffect(() => {
    if (status === 'approved' && meta) {
      rememberRoom({ roomId, name: meta.name, role: meta.hostDeviceId === identity.deviceId ? 'host' : 'member' });
    }
  }, [status, meta?.name, meta?.hostDeviceId, roomId, identity.deviceId, meta]);

  // Room deleted by vote → wipe local copies
  useEffect(() => {
    if (status !== 'deleted') return;
    forgetRoom(roomId);
    try {
      indexedDB.deleteDatabase(`crdt-room-${roomId}`);
      boards.forEach(b => indexedDB.deleteDatabase(`crdt-canvas-${b.docName}`));
    } catch { /* ignore */ }
  }, [status, roomId, boards]);

  // ── Derived lists ─────────────────────────────────────────────────────
  const members = useMemo(() => Object.values(memberMap).filter(m => m && m.deviceId).sort((a, b) => a.joinedAt - b.joinedAt), [memberMap]);
  const activeMembers = useMemo(() => {
    const cutoff = Date.now() - ACTIVE_WINDOW_MS;
    return members.filter(m => !m.kicked && (m.lastSeen >= cutoff || m.deviceId === identity.deviceId));
  }, [members, identity.deviceId]);
  const isHost = !!meta && meta.hostDeviceId === identity.deviceId;

  const pendingRequests = useMemo(() => {
    if (status !== 'approved') return [];
    const seen = new Set<string>();
    return online.filter(p => {
      if (p.status !== 'pending' || p.deviceId === identity.deviceId || seen.has(p.deviceId)) return false;
      const member = memberMap[p.deviceId];
      if (member && !member.kicked) return false;
      const dec = declineMap[p.deviceId];
      if (dec && dec.ts >= p.requestTs) return false;
      seen.add(p.deviceId);
      return true;
    });
  }, [online, status, memberMap, declineMap, identity.deviceId]);

  const participants = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string }>();
    online.forEach(p => {
      if (p.status !== 'approved') return;
      // one entry per person (browser); several tabs of the same browser count once
      const prev = seen.get(p.deviceId);
      if (!prev || Number(prev.id) < p.clientId) seen.set(p.deviceId, { id: String(p.clientId), name: p.name, color: p.color });
    });
    return [...seen.values()];
  }, [online]);

  // ── Actions ───────────────────────────────────────────────────────────
  const approve = useCallback((peer: OnlinePeer) => {
    if (!doc || status !== 'approved') return;
    const now = Date.now();
    doc.transact(() => {
      doc.getMap('members').set(peer.deviceId, {
        deviceId: peer.deviceId, name: peer.name, color: peer.color, role: 'member',
        approvedBy: identity.name, joinedAt: now, lastSeen: now,
      } satisfies Member);
      doc.getMap('declines').delete(peer.deviceId);
    }, 'approve');
  }, [doc, status, identity.name]);

  const decline = useCallback((peer: OnlinePeer) => {
    if (!doc || status !== 'approved') return;
    doc.getMap('declines').set(peer.deviceId, { name: peer.name, by: identity.name, ts: Date.now() } satisfies Decline);
  }, [doc, status, identity.name]);

  const kick = useCallback((deviceId: string) => {
    if (!doc || !isHost || deviceId === identity.deviceId) return;
    const membersMap = doc.getMap('members');
    const m = membersMap.get(deviceId) as Member | undefined;
    if (m) membersMap.set(deviceId, { ...m, kicked: true, kickedBy: identity.name, kickedAt: Date.now() });
  }, [doc, isHost, identity.deviceId, identity.name]);

  const leave = useCallback(() => {
    if (doc) {
      doc.transact(() => {
        const membersMap = doc.getMap('members');
        membersMap.delete(identity.deviceId);
        const metaMap = doc.getMap('meta');
        // Hand the host role to the longest-standing remaining member
        if (metaMap.get('hostDeviceId') === identity.deviceId) {
          const next = members.filter(m => m.deviceId !== identity.deviceId && !m.kicked).sort((a, b) => a.joinedAt - b.joinedAt)[0];
          if (next) {
            metaMap.set('hostDeviceId', next.deviceId);
            metaMap.set('hostName', next.name);
            membersMap.set(next.deviceId, { ...next, role: 'host' });
          }
        }
      }, 'leave');
    }
    forgetRoom(roomId);
    setLeft(true);
  }, [doc, identity.deviceId, members, roomId]);

  const requestRejoin = useCallback(() => {
    requestTsRef.current = Date.now();
    setRejoinRequested(true);
  }, []);

  const updateMeta = useCallback((patch: Partial<Pick<RoomMeta, 'name' | 'description'>>) => {
    if (!doc || status !== 'approved') return;
    const metaMap = doc.getMap('meta');
    doc.transact(() => Object.entries(patch).forEach(([k, val]) => metaMap.set(k, val)), 'room-meta');
  }, [doc, status]);

  const createBoard = useCallback((name: string, description = '') => {
    if (!doc || status !== 'approved') return null;
    const id = randomId(8);
    doc.getMap('boards').set(id, {
      id, name: name.trim() || `Board ${boards.length + 1}`, description, docName: `${roomId}::b::${id}`,
      createdBy: identity.deviceId, createdByName: identity.name, createdAt: Date.now(),
    } satisfies BoardInfo);
    return id;
  }, [doc, status, boards.length, roomId, identity.deviceId, identity.name]);

  const updateBoard = useCallback((id: string, patch: Partial<Pick<BoardInfo, 'name' | 'description'>>) => {
    if (!doc || status !== 'approved') return;
    const map = doc.getMap('boards');
    const current = map.get(id) as BoardInfo | undefined;
    if (current) map.set(id, { ...current, ...patch });
  }, [doc, status]);

  const activeIds = useMemo(() => new Set(activeMembers.map(m => m.deviceId)), [activeMembers]);
  const votesNeeded = useCallback((p: Proposal) => votesRequired(p.threshold, activeMembers.length), [activeMembers.length]);
  const validVotes = useCallback((p: Proposal) => Object.keys(p.votes).filter(id => activeIds.has(id)).length, [activeIds]);

  const propose = useCallback((kind: ProposalKind, opts: { boardId?: string; targets?: string[]; title: string }) => {
    if (!doc || status !== 'approved') return null;
    const map = doc.getMap<Y.Map<unknown>>('proposals');
    // Same open question already? Just add my vote to it.
    const key = `${kind}|${opts.boardId ?? ''}|${(opts.targets ?? []).slice().sort().join(',')}`;
    for (const p of proposals) {
      if (p.status === 'open' && Date.now() - p.createdAt < PROPOSAL_TTL_MS
        && `${p.kind}|${p.boardId}|${p.targets.slice().sort().join(',')}` === key) {
        const pm = map.get(p.id);
        const votes = pm?.get('votes');
        if (votes instanceof Y.Map) votes.set(identity.deviceId, Date.now());
        return p.id;
      }
    }
    const id = randomId(10);
    doc.transact(() => {
      const pm = new Y.Map<unknown>();
      pm.set('id', id);
      pm.set('kind', kind);
      pm.set('boardId', opts.boardId ?? '');
      pm.set('targets', opts.targets ?? []);
      pm.set('title', opts.title);
      pm.set('threshold', PROPOSAL_THRESHOLD[kind]);
      pm.set('createdBy', identity.deviceId);
      pm.set('createdByName', identity.name);
      pm.set('createdAt', Date.now());
      pm.set('status', 'open');
      const votes = new Y.Map<unknown>();
      pm.set('votes', votes);
      map.set(id, pm);
      votes.set(identity.deviceId, Date.now());
    }, 'propose');
    return id;
  }, [doc, status, proposals, identity.deviceId, identity.name]);

  const vote = useCallback((proposalId: string) => {
    if (!doc || status !== 'approved') return;
    const pm = doc.getMap<Y.Map<unknown>>('proposals').get(proposalId);
    const votes = pm?.get('votes');
    if (votes instanceof Y.Map && pm?.get('status') === 'open') votes.set(identity.deviceId, Date.now());
  }, [doc, status, identity.deviceId]);

  const markApplied = useCallback((proposalId: string) => {
    const pm = doc?.getMap<Y.Map<unknown>>('proposals').get(proposalId);
    if (pm && !pm.get('applied')) pm.set('applied', true);
  }, [doc]);

  // Evaluate proposals: pass / expire, and apply room-level effects (idempotent on every peer)
  useEffect(() => {
    if (!doc || status !== 'approved') return;
    const map = doc.getMap<Y.Map<unknown>>('proposals');
    const now = Date.now();
    doc.transact(() => {
      for (const p of proposals) {
        const pm = map.get(p.id);
        if (!pm) continue;
        if (p.status === 'open') {
          if (now - p.createdAt > PROPOSAL_TTL_MS) { pm.set('status', 'expired'); continue; }
          if (validVotes(p) >= votesNeeded(p)) { pm.set('status', 'passed'); pm.set('passedAt', now); }
        }
        const passed = pm.get('status') === 'passed';
        if (passed && !pm.get('applied')) {
          if (p.kind === 'delete-board') {
            const bm = doc.getMap('boards');
            const b = bm.get(p.boardId) as BoardInfo | undefined;
            if (b && !b.deleted) bm.set(p.boardId, { ...b, deleted: true, deletedAt: now });
            pm.set('applied', true);
          } else if (p.kind === 'delete-room') {
            const mm = doc.getMap('meta');
            mm.set('deleted', true);
            mm.set('deletedAt', now);
            pm.set('applied', true);
          }
        }
      }
    }, 'proposal-eval');
  }, [doc, status, proposals, validVotes, votesNeeded, activeMembers.length]);

  const setPresence = useCallback((patch: Partial<Identity>) => {
    if (!awareness) return;
    awareness.setLocalState({ ...(awareness.getLocalState() ?? {}), ...patch });
  }, [awareness]);

  return {
    roomId,
    doc,
    awareness,
    status,
    connection,
    meta,
    members,
    activeMembers,
    boards,
    proposals,
    online,
    pendingRequests,
    isHost,
    me: identity,
    localIP,
    webrtcLinks: links.webrtc,
    tabLinks: links.bc,
    participants,
    approve,
    decline,
    kick,
    leave,
    requestRejoin,
    updateMeta,
    createBoard,
    updateBoard,
    propose,
    vote,
    markApplied,
    votesNeeded,
    validVotes,
    setPresence,
  };
}
