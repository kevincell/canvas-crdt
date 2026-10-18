/**
 * RoomScreen — opens a room (useRoom) and shows either the waiting / declined / removed screens
 * or the board.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Button, CircularProgress } from '@mui/material';
import { HourglassTop, Block, PersonOff, DeleteForever } from '@mui/icons-material';
import { useRoom, type JoinMode } from '../features/room/useRoom';
import { useMediaSync, useScreenShare, MediaSyncDock } from '../features/media';
import { BoardView } from './BoardView';
import { panelSx } from '../features/board/ui';
import { v } from '../theme/theme';

export function RoomScreen({ roomId, mode, createInfo, boardId, identity, onBoardChange, onHome, onSwitchRoom, onRename, onColor }: {
  roomId: string; mode: JoinMode; createInfo?: { name: string; description: string }; boardId?: string;
  identity: { deviceId: string; name: string; color: string };
  onBoardChange: (boardId: string) => void; onHome: (notice?: string) => void; onSwitchRoom: (roomId: string) => void;
  onRename: (name: string) => void; onColor: (color: string) => void;
}) {
  const room = useRoom(roomId, mode, identity, createInfo);
  const { status } = room;

  // ── Watch Party: one per room, so it keeps playing while you switch boards in this room ──
  const inRoom = status === 'approved';
  const media = useMediaSync(inRoom ? room.doc : null, identity.name, room.participants);
  const localPeerId = room.doc ? String(room.doc.clientID) : '';
  const screenShare = useScreenShare(inRoom ? room.doc : null, localPeerId, room.participants);
  const [showMedia, setShowMedia] = useState(false);
  useEffect(() => { if (screenShare.incomingStream) setShowMedia(true); }, [screenShare.incomingStream]);
  const toggleMedia = useCallback(() => {
    setShowMedia(open => {
      if (open && screenShare.isSharing) screenShare.stopSharing();
      return !open;
    });
  }, [screenShare]);
  // Leaving the room (home / another room) ends anything I'm hosting, so it doesn't follow anyone elsewhere
  const mediaRef = useRef({ media, screenShare });
  mediaRef.current = { media, screenShare };
  const stopMyMedia = useCallback(() => {
    const { media: m, screenShare: ss } = mediaRef.current;
    if (ss.isSharing) ss.stopSharing();
    if (m.isHost) m.stopBroadcast();
  }, []);
  const goHome = useCallback((notice?: string) => { stopMyMedia(); onHome(notice); }, [stopMyMedia, onHome]);
  const goRoom = useCallback((id: string) => { stopMyMedia(); onSwitchRoom(id); }, [stopMyMedia, onSwitchRoom]);

  // Diagnostics for the waiting screen
  const othersOnline = useMemo(() => new Set(room.online.filter(p => p.status === 'approved' && p.deviceId !== identity.deviceId).map(p => p.deviceId)).size, [room.online, identity.deviceId]);
  const sameBrowserTab = useMemo(() => room.online.some(p => p.deviceId === identity.deviceId && room.doc && p.clientId !== room.doc.clientID), [room.online, identity.deviceId, room.doc]);
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => {
    if (status !== 'pending') { setWaitedLong(false); return; }
    const t = setTimeout(() => setWaitedLong(true), 12000);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => { if (status === 'left') goHome('You left the room.'); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveBoards = useMemo(() => room.boards.filter(b => !b.deleted), [room.boards]);
  const board = liveBoards.find(b => b.id === boardId) ?? liveBoards[0];
  useEffect(() => { if (board && board.id !== boardId) onBoardChange(board.id); }, [board?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = room.meta?.name ?? roomId;

  if (status === 'approved' || status === 'viewer') {
    if (!board) return <Gate icon={<CircularProgress size={28} />} title={status === 'viewer' ? 'Waiting for the room…' : 'Loading boards…'} text={status === 'viewer' ? 'The drawing appears as soon as someone from the room is online.' : 'Syncing the room with peers.'} onHome={() => goHome()} />;
    return (
      <>
        <BoardView key={board.id} room={room} board={board} readOnly={status === 'viewer'} onOpenBoard={onBoardChange}
          onHome={() => goHome()} onSwitchRoom={goRoom} onRename={onRename} onColor={onColor}
          watchParty={{ open: showMedia, toggle: toggleMedia }} />
        {showMedia && inRoom && (
          <MediaSyncDock
            currentBroadcast={media.currentBroadcast}
            broadcasts={media.broadcasts}
            isHost={media.isHost}
            actorName={identity.name}
            onStartBroadcast={media.startBroadcast}
            onTuneIn={media.tuneIn}
            onPlayAll={media.playAll}
            onPauseAll={media.pauseAll}
            onSeekAll={media.seekAll}
            onToggleLoop={media.toggleLoop}
            onToggleAutoPlayNext={media.toggleAutoPlayNext}
            onUpdateTrack={media.updateTrack}
            onSetPlaybackRate={media.setPlaybackRate}
            onSetSubtitleUrl={media.setSubtitleUrl}
            onReanchor={media.reanchor}
            onStopBroadcast={media.stopBroadcast}
            onClose={() => { if (screenShare.isSharing) screenShare.stopSharing(); setShowMedia(false); }}
            isScreenSharing={screenShare.isSharing}
            localScreenStream={screenShare.localStream}
            incomingScreenStream={screenShare.incomingStream}
            screenShareHostName={screenShare.hostName}
            screenShareError={screenShare.error}
            onStartScreenShare={screenShare.startSharing}
            onStopScreenShare={screenShare.stopSharing}
          />
        )}
      </>
    );
  }
  if (status === 'pending') {
    return (
      <Gate icon={<HourglassTop sx={{ fontSize: 34, color: v('accent') }} />} title={`Waiting to join “${name}”`}
        text={<>Someone in the room needs to let you in — keep this page open.<br />Room ID <b>{roomId}</b>
          <br /><br />
          {sameBrowserTab
            ? <b>This browser is already in this room in another tab, so it counts as the same person. To test as someone else, use another browser, an incognito window, another device — or add <code>&amp;guest=1</code> to this tab’s address.</b>
            : room.connection !== 'connected'
              ? <>Can’t reach the signalling server yet — check that <code>pnpm run dev</code> is running and both devices are on the same network.</>
              : othersOnline > 0
                ? <>{othersOnline} member{othersOnline === 1 ? ' is' : 's are'} online and can see your request.</>
                : <>No member of this room is online right now{waitedLong ? ' — you’ll be let in as soon as one is.' : '…'}</>}</>}
        onHome={() => goHome()} />
    );
  }
  if (status === 'declined') {
    return <Gate icon={<Block sx={{ fontSize: 34, color: v('danger') }} />} title="Request declined" text={`Your request to join “${name}” was declined.`}
      action={<Button variant="contained" onClick={room.requestRejoin}>Ask again</Button>} onHome={() => goHome()} />;
  }
  if (status === 'kicked') {
    const by = room.members.find(m => m.deviceId === identity.deviceId)?.kickedBy;
    return <Gate icon={<PersonOff sx={{ fontSize: 34, color: v('danger') }} />} title="You were removed from the room" text={`${by ? `${by} removed you from` : 'You were removed from'} “${name}”. Your drawings are still there.`}
      action={<Button variant="contained" onClick={room.requestRejoin}>Ask to rejoin</Button>} onHome={() => goHome()} />;
  }
  if (status === 'deleted') {
    return <Gate icon={<DeleteForever sx={{ fontSize: 34, color: v('danger') }} />} title="This room was deleted" text={`“${name}” was deleted by a room vote.`} onHome={() => goHome()} />;
  }
  return <Gate icon={<CircularProgress size={28} />} title="Opening room…" text={`Room ${roomId}`} onHome={() => goHome()} />;
}

function Gate({ icon, title, text, action, onHome }: { icon: ReactNode; title: string; text: ReactNode; action?: ReactNode; onHome: () => void }) {
  return (
    <Box className="app-bg" sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, color: v('text') }}>
      <Box sx={{ ...panelSx, borderRadius: '18px', p: 4, maxWidth: 440, width: '100%', textAlign: 'center' }}>
        <Box sx={{ mb: 1.5, display: 'flex', justifyContent: 'center' }}>{icon}</Box>
        <Box sx={{ fontWeight: 800, fontSize: 19, mb: 1 }}>{title}</Box>
        <Box sx={{ fontSize: 13.5, color: v('textMuted'), lineHeight: 1.55, mb: 2.5 }}>{text}</Box>
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
          {action}
          <Button variant="outlined" onClick={onHome}>Home</Button>
        </Box>
      </Box>
    </Box>
  );
}
