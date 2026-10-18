/**
 * Room data model — lives in its own shared Yjs document ("<roomId>::room"), separate from the
 * board documents. Everything here syncs peer-to-peer exactly like the boards do.
 *
 *   meta       Y.Map  name, description, host, created…, deleted
 *   members    Y.Map  deviceId → Member         (approved people; kicked flag)
 *   declines   Y.Map  deviceId → Decline        (join requests that were declined)
 *   boards     Y.Map  boardId  → BoardInfo
 *   proposals  Y.Map  id → Y.Map(Proposal + votes Y.Map)   (room votes)
 *   chat       Y.Text                            (room-wide chat)
 *   media-broadcasts / screen-share-signals      (Watch Party)
 */

export interface RoomMeta {
  name: string;
  description: string;
  hostDeviceId: string;
  hostName: string;
  createdAt: number;
  deleted?: boolean;
  deletedAt?: number;
}

export interface Member {
  deviceId: string;
  name: string;
  color: string;
  role: 'host' | 'member';
  approvedBy: string;
  joinedAt: number;
  lastSeen: number;
  kicked?: boolean;
  kickedBy?: string;
  kickedAt?: number;
}

export interface Decline {
  name: string;
  by: string;
  ts: number;
}

export interface BoardInfo {
  id: string;
  name: string;
  description: string;
  /** Name of the Yjs document / WebRTC channel holding this board's drawing */
  docName: string;
  createdBy: string;      // deviceId
  createdByName: string;
  createdAt: number;
  deleted?: boolean;
  deletedAt?: number;
}

export type ProposalKind = 'delete-board' | 'delete-room' | 'unlock' | 'delete-locked' | 'revert';
export type Threshold = 'quarter' | 'majority';

export interface Proposal {
  id: string;
  kind: ProposalKind;
  /** board id for delete-board / board-level actions; '' for delete-room */
  boardId: string;
  /** shape ids (unlock / delete-locked) or checkpoint id (revert) */
  targets: string[];
  title: string;
  threshold: Threshold;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  status: 'open' | 'passed' | 'expired';
  passedAt?: number;
  /** board-level effects are applied by whoever has the board open; marks it done */
  applied?: boolean;
  votes: Record<string, number>; // deviceId → ts
}

/** People who can vote: approved, not kicked, seen in the last 7 days */
export const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

export function votesRequired(threshold: Threshold, activeMembers: number): number {
  const n = Math.max(1, activeMembers);
  return threshold === 'quarter' ? Math.max(1, Math.ceil(n / 4)) : Math.floor(n / 2) + 1;
}

export const PROPOSAL_LABEL: Record<ProposalKind, string> = {
  'delete-board': 'Delete board',
  'delete-room': 'Delete room',
  'unlock': 'Unlock objects',
  'delete-locked': 'Delete locked objects',
  'revert': 'Revert board to checkpoint',
};

export const PROPOSAL_THRESHOLD: Record<ProposalKind, Threshold> = {
  'delete-board': 'quarter',
  'delete-room': 'quarter',
  'unlock': 'majority',
  'delete-locked': 'majority',
  'revert': 'majority',
};
