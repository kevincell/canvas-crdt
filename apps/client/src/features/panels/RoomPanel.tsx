/** Room details: info, people, boards, votes, leave / kick / delete. */
import { useMemo, useState } from 'react';
import { Box, Button, Chip, IconButton, TextField, Tooltip } from '@mui/material';
import {
  MeetingRoomOutlined, ContentCopy, PersonRemoveOutlined, Add, DeleteOutlineOutlined as DeleteOutline, Edit, Check, Close, HowToVote, Logout, OpenInNew,
} from '@mui/icons-material';
import { SidePanel, Section, Dot, timeAgo } from './SidePanel';
import { type RoomApi } from '../room/useRoom';
import { type BoardInfo, type Proposal, PROPOSAL_LABEL } from '../room/roomTypes';
import { v } from '../../theme/theme';

export function RoomPanel({ room, currentBoardId, onOpenBoard, onClose, onLeft, onToast }: {
  room: RoomApi; currentBoardId: string; onOpenBoard: (id: string) => void; onClose: () => void; onLeft: () => void; onToast: (msg: string) => void;
}) {
  const { meta, members, online, boards, proposals, isHost, me } = room;
  const [editingMeta, setEditingMeta] = useState(false);
  const [name, setName] = useState(meta?.name ?? '');
  const [desc, setDesc] = useState(meta?.description ?? '');
  const [newBoard, setNewBoard] = useState<null | { name: string; description: string }>(null);
  const [confirm, setConfirm] = useState<null | 'leave' | 'delete'>(null);

  const onlineIds = useMemo(() => new Set(online.filter(p => p.status === 'approved').map(p => p.deviceId)), [online]);
  const visibleMembers = members.filter(m => !m.kicked);
  const kicked = members.filter(m => m.kicked);
  const viewers = useMemo(() => {
    const seen = new Set<string>();
    return online.filter(p => p.status === 'viewer' && !seen.has(p.deviceId) && seen.add(p.deviceId));
  }, [online]);
  const liveBoards = boards.filter(b => !b.deleted);
  const openProposals = proposals.filter(p => p.status === 'open');
  const recent = proposals.filter(p => p.status !== 'open').slice(0, 5);

  const copy = (text: string, what: string) => { navigator.clipboard?.writeText(text).then(() => onToast(`${what} copied`)).catch(() => onToast(text)); };
  const proposalFor = (kind: Proposal['kind'], boardId: string) => openProposals.find(p => p.kind === kind && p.boardId === boardId);

  return (
    <SidePanel title="Room details" icon={<MeetingRoomOutlined />} subtitle={`${onlineIds.size} online · ${visibleMembers.length} member${visibleMembers.length === 1 ? '' : 's'}`} onClose={onClose}>
      {/* Join requests */}
      {room.pendingRequests.length > 0 && (
        <Section title={`Waiting to join (${room.pendingRequests.length})`}>
          {room.pendingRequests.map(p => (
            <Box key={p.deviceId} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.6 }}>
              <Dot color={p.color} />
              <Box sx={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{p.name}</Box>
              <Button size="small" variant="contained" onClick={() => room.approve(p)}>Allow</Button>
              <Button size="small" color="error" onClick={() => room.decline(p)}>Decline</Button>
            </Box>
          ))}
        </Section>
      )}

      <Section title="Room" right={isHost && !editingMeta ? <IconButton size="small" onClick={() => { setName(meta?.name ?? ''); setDesc(meta?.description ?? ''); setEditingMeta(true); }} aria-label="Edit room"><Edit sx={{ fontSize: 16 }} /></IconButton> : null}>
        {editingMeta ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <TextField size="small" label="Name" value={name} onChange={e => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
            <TextField size="small" label="Description" value={desc} onChange={e => setDesc(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setEditingMeta(false)}>Cancel</Button>
              <Button size="small" variant="contained" onClick={() => { room.updateMeta({ name: name.trim() || meta?.name || 'Room', description: desc.trim() }); setEditingMeta(false); }}>Save</Button>
            </Box>
          </Box>
        ) : (
          <>
            <Box sx={{ fontSize: 16, fontWeight: 700 }}>{meta?.name ?? room.roomId}</Box>
            {meta?.description && <Box sx={{ fontSize: 12.5, color: v('textMuted'), mt: 0.3, whiteSpace: 'pre-wrap' }}>{meta.description}</Box>}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
              <Box sx={{ fontSize: 12, color: v('textMuted') }}>Room ID</Box>
              <Box component="code" sx={{ fontSize: 12.5, fontWeight: 700, px: 0.8, py: 0.2, borderRadius: '6px', bgcolor: v('surface2'), border: `1px solid ${v('border')}` }}>{room.roomId}</Box>
              <Tooltip title="Copy room ID"><IconButton size="small" onClick={() => copy(room.roomId, 'Room ID')}><ContentCopy sx={{ fontSize: 15 }} /></IconButton></Tooltip>
            </Box>
            <Box sx={{ fontSize: 11.5, color: v('textFaint'), mt: 0.5 }}>
              Host: {meta?.hostName ?? '—'} · {room.connection === 'connected' ? 'signaling connected' : 'offline – changes saved locally'}
              {room.localIP ? ` · LAN ${room.localIP}` : ''} · {room.webrtcLinks} device link{room.webrtcLinks === 1 ? '' : 's'}{room.tabLinks ? `, ${room.tabLinks} tab` : ''}
            </Box>
          </>
        )}
      </Section>

      <Section title={`People (${visibleMembers.length})`}>
        {visibleMembers.map(m => {
          const isOnline = onlineIds.has(m.deviceId) || m.deviceId === me.deviceId;
          return (
            <Box key={m.deviceId} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.55 }}>
              <Dot color={m.deviceId === me.deviceId ? me.color : m.color} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.deviceId === me.deviceId ? me.name : m.name}{m.deviceId === me.deviceId ? ' (you)' : ''}
                </Box>
                <Box sx={{ fontSize: 11, color: v('textFaint') }}>{isOnline ? 'online' : `seen ${timeAgo(m.lastSeen)}`}{m.role !== 'host' ? ` · approved by ${m.approvedBy}` : ''}</Box>
              </Box>
              {m.deviceId === meta?.hostDeviceId && <Chip size="small" label="Host" sx={{ height: 20, fontSize: 10.5, bgcolor: v('accentSoft'), color: v('accent'), fontWeight: 700 }} />}
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: isOnline ? v('success') : v('border') }} />
              {isHost && m.deviceId !== me.deviceId && (
                <Tooltip title="Kick (their drawings stay)"><IconButton size="small" onClick={() => room.kick(m.deviceId)} aria-label={`Kick ${m.name}`}><PersonRemoveOutlined sx={{ fontSize: 17 }} /></IconButton></Tooltip>
              )}
            </Box>
          );
        })}
        {viewers.length > 0 && <Box sx={{ fontSize: 11.5, color: v('textFaint'), mt: 0.6 }}>Viewing (read-only): {viewers.map(p => p.name).join(', ')}</Box>}
        {kicked.length > 0 && <Box sx={{ fontSize: 11.5, color: v('textFaint'), mt: 0.6 }}>Removed: {kicked.map(k => k.name).join(', ')}</Box>}
      </Section>

      <Section title={`Boards (${liveBoards.length})`} right={!newBoard ? <Button size="small" startIcon={<Add sx={{ fontSize: 16 }} />} onClick={() => setNewBoard({ name: `Board ${liveBoards.length + 1}`, description: '' })}>New</Button> : null}>
        {newBoard && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.2, p: 1.2, borderRadius: '10px', bgcolor: v('surface2') }}>
            <TextField size="small" label="Board name" autoFocus value={newBoard.name} onChange={e => setNewBoard({ ...newBoard, name: e.target.value })} slotProps={{ htmlInput: { maxLength: 60 } }} />
            <TextField size="small" label="Description" value={newBoard.description} onChange={e => setNewBoard({ ...newBoard, description: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setNewBoard(null)}>Cancel</Button>
              <Button size="small" variant="contained" onClick={() => {
                const id = room.createBoard(newBoard.name, newBoard.description.trim());
                setNewBoard(null);
                if (id) onOpenBoard(id);
              }}>Create & open</Button>
            </Box>
          </Box>
        )}
        {liveBoards.map(b => <BoardRow key={b.id} b={b} current={b.id === currentBoardId} room={room} onOpen={() => onOpenBoard(b.id)} pending={proposalFor('delete-board', b.id)} />)}
      </Section>

      <Section title={`Votes (${openProposals.length} open)`}>
        {!openProposals.length && <Box sx={{ fontSize: 12.5, color: v('textFaint') }}>Nothing to vote on.</Box>}
        {openProposals.map(p => <ProposalRow key={p.id} p={p} room={room} boards={boards} />)}
        {recent.length > 0 && (
          <Box sx={{ mt: 1 }}>
            {recent.map(p => (
              <Box key={p.id} sx={{ fontSize: 11.5, color: v('textFaint'), py: 0.2 }}>
                {p.status === 'passed' ? '✓' : '✕'} {p.title} — {p.status}{p.passedAt ? ` ${timeAgo(p.passedAt)}` : ''}
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <Section title="Leave or delete">
        {confirm === null && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" startIcon={<Logout fontSize="small" />} onClick={() => setConfirm('leave')}>Leave room</Button>
            {isHost && (
              proposalFor('delete-room', '')
                ? <Chip icon={<HowToVote sx={{ fontSize: 15 }} />} label="Delete vote open" />
                : <Button size="small" variant="outlined" color="error" startIcon={<DeleteOutline fontSize="small" />} onClick={() => setConfirm('delete')}>Delete room…</Button>
            )}
          </Box>
        )}
        {confirm && (
          <Box sx={{ p: 1.2, borderRadius: '10px', bgcolor: v('dangerSoft') }}>
            <Box sx={{ fontSize: 12.5, mb: 1 }}>
              {confirm === 'leave'
                ? (isHost ? 'Leave this room? The host role passes to the longest-standing member. You’d need approval to come back.' : 'Leave this room? You’d need approval to come back.')
                : 'Ask the room to delete everything? It is deleted once at least a quarter of active members agree (your vote counts).'}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button size="small" variant="contained" color="error" onClick={() => {
                if (confirm === 'leave') { room.leave(); onLeft(); }
                else { room.propose('delete-room', { title: `Delete room “${meta?.name ?? room.roomId}”` }); onToast('Delete vote started'); }
                setConfirm(null);
              }}>{confirm === 'leave' ? 'Leave' : 'Start vote'}</Button>
            </Box>
          </Box>
        )}
      </Section>
    </SidePanel>
  );
}

function BoardRow({ b, current, room, onOpen, pending }: { b: BoardInfo; current: boolean; room: RoomApi; onOpen: () => void; pending?: Proposal }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(b.name);
  const [desc, setDesc] = useState(b.description);
  const mine = b.createdBy === room.me.deviceId;
  return (
    <Box sx={{ p: 1, mb: 0.6, borderRadius: '10px', border: `1px solid ${current ? v('primary') : v('border')}`, bgcolor: current ? v('primarySoft') : 'transparent' }}>
      {editing ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
          <TextField size="small" value={name} onChange={e => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
          <TextField size="small" placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
            <IconButton size="small" onClick={() => setEditing(false)}><Close sx={{ fontSize: 16 }} /></IconButton>
            <IconButton size="small" onClick={() => { room.updateBoard(b.id, { name: name.trim() || b.name, description: desc.trim() }); setEditing(false); }}><Check sx={{ fontSize: 16 }} /></IconButton>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ flex: 1, minWidth: 0, cursor: current ? 'default' : 'pointer' }} onClick={current ? undefined : onOpen}>
            <Box sx={{ fontSize: 13, fontWeight: 700 }}>{b.name}{current && <Box component="span" sx={{ fontWeight: 500, color: v('primaryStrong'), fontSize: 11 }}> · open</Box>}</Box>
            {b.description && <Box sx={{ fontSize: 11.5, color: v('textMuted') }}>{b.description}</Box>}
            <Box sx={{ fontSize: 10.5, color: v('textFaint') }}>by {b.createdByName} · {timeAgo(b.createdAt)}</Box>
          </Box>
          {!current && <Tooltip title="Open"><IconButton size="small" onClick={onOpen}><OpenInNew sx={{ fontSize: 16 }} /></IconButton></Tooltip>}
          {mine && <Tooltip title="Rename"><IconButton size="small" onClick={() => setEditing(true)}><Edit sx={{ fontSize: 16 }} /></IconButton></Tooltip>}
          {mine && (pending
            ? <Chip size="small" icon={<HowToVote sx={{ fontSize: 14 }} />} label={`${room.validVotes(pending)}/${room.votesNeeded(pending)}`} sx={{ height: 22 }} />
            : <Tooltip title="Delete board (needs ≥ ¼ of the room)"><IconButton size="small" onClick={() => room.propose('delete-board', { boardId: b.id, title: `Delete board “${b.name}”` })}><DeleteOutline sx={{ fontSize: 16 }} /></IconButton></Tooltip>)}
        </Box>
      )}
    </Box>
  );
}

export function ProposalRow({ p, room, boards }: { p: Proposal; room: RoomApi; boards: BoardInfo[] }) {
  const voted = !!p.votes[room.me.deviceId];
  const have = room.validVotes(p), need = room.votesNeeded(p);
  const board = boards.find(b => b.id === p.boardId);
  return (
    <Box sx={{ p: 1.1, mb: 0.7, borderRadius: '10px', bgcolor: v('surface2'), border: `1px solid ${v('border')}` }}>
      <Box sx={{ fontSize: 13, fontWeight: 700 }}>{p.title}</Box>
      <Box sx={{ fontSize: 11.5, color: v('textMuted') }}>
        {PROPOSAL_LABEL[p.kind]}{board && p.kind !== 'delete-board' ? ` · ${board.name}` : ''} · asked by {p.createdByName} · {timeAgo(p.createdAt)}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.8 }}>
        <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: v('surface3'), overflow: 'hidden' }}>
          <Box sx={{ width: `${Math.min(100, (have / need) * 100)}%`, height: '100%', bgcolor: v('primary') }} />
        </Box>
        <Box sx={{ fontSize: 11.5, fontWeight: 700 }}>{have}/{need}</Box>
        {voted ? <Chip size="small" label="Voted" sx={{ height: 22, fontSize: 11 }} />
          : <Button size="small" variant="contained" startIcon={<HowToVote sx={{ fontSize: 15 }} />} onClick={() => room.vote(p.id)}>Agree</Button>}
      </Box>
      <Box sx={{ fontSize: 10.5, color: v('textFaint'), mt: 0.4 }}>{p.threshold === 'quarter' ? 'Needs at least ¼' : 'Needs more than ½'} of active members · expires after 24 h</Box>
    </Box>
  );
}
