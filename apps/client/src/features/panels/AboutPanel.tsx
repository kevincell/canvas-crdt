/** About: every icon, its name and what it does — short. */
import { type ReactNode } from 'react';
import { Box } from '@mui/material';
import {
  HelpOutlineOutlined as HelpOutline, MeetingRoomOutlined, ShareOutlined, ForumOutlined, LiveTvOutlined, ChatBubbleOutlineOutlined as ChatBubbleOutline, Flag,
  FileDownloadOutlined, ViewQuiltOutlined, LightModeOutlined, LockOutlined, HowToVote, Add, Remove, ScienceOutlined,
} from '@mui/icons-material';
import { SidePanel, Section } from './SidePanel';
import { TOOLS } from '../board/BoardToolbar';
import { ConflictIcon } from '../board/ui';
import { v } from '../../theme/theme';

const HEADER: Array<{ icon: ReactNode; name: string; text: string }> = [
  { icon: <MeetingRoomOutlined fontSize="small" />, name: 'Room details', text: 'Room id and name, who is here (with pointer colours), boards, votes, kick / leave / delete.' },
  { icon: <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: v('accent') }} />, name: 'You', text: 'Your name, pointer & laser colour, and the rooms you have joined (click to switch).' },
  { icon: <ShareOutlined fontSize="small" />, name: 'Share', text: 'Two links: view-only (just the drawing) and edit (full tools; new people wait for approval).' },
  { icon: <ConflictIcon />, name: 'Conflicts', text: 'Log of conflicts with before / after pictures and who caused them. Red number = still open.' },
  { icon: <Flag fontSize="small" />, name: 'Checkpoints', text: 'Board saved at the start and end of every edit session. View any of them; revert by vote.' },
  { icon: <ChatBubbleOutline fontSize="small" />, name: 'Comments', text: 'Notes attached to selected objects.' },
  { icon: <ForumOutlined fontSize="small" />, name: 'Chat', text: 'General room chat.' },
  { icon: <LiveTvOutlined fontSize="small" />, name: 'Watch Party', text: 'Play music / video / a file or share your screen, in sync with everyone.' },
  { icon: <ViewQuiltOutlined fontSize="small" />, name: 'Templates', text: 'Start from a ready-made layout (added to the current board).' },
  { icon: <FileDownloadOutlined fontSize="small" />, name: 'Export', text: 'Save the board (or the selection) as PNG or PDF.' },
  { icon: <LightModeOutlined fontSize="small" />, name: 'Day / night', text: 'Switch the colour theme on this device only.' },
  { icon: <HelpOutline fontSize="small" />, name: 'About', text: 'This list.' },
];

const OTHER: Array<{ icon: ReactNode; name: string; text: string }> = [
  { icon: <LockOutlined fontSize="small" />, name: 'Lock', text: 'Locked objects can’t be moved or changed. Unlocking or deleting them needs more than half of the room.' },
  { icon: <HowToVote fontSize="small" />, name: 'Votes', text: 'Deleting a board or the room needs at least a quarter of active members; unlock, delete-locked and revert need more than half.' },
  { icon: <Box sx={{ display: 'flex' }}><Remove sx={{ fontSize: 16 }} /><Add sx={{ fontSize: 16 }} /></Box>, name: 'Zoom / resize', text: 'Bottom-right + / − zoom the board. On the selection bar they shrink or grow the selection.' },
  { icon: <Box sx={{ width: 18, height: 12, border: '1.5px dashed rgba(205,160,20,.8)', bgcolor: 'rgba(240,200,40,.18)', borderRadius: '2px' }} />, name: 'Yellow outline', text: 'Area of an open conflict. Stays until resolved (or dismissed for you).' },
  { icon: <ScienceOutlined fontSize="small" />, name: 'Demo scenarios', text: 'Shows what each research scenario is about (descriptions only).' },
];

export function AboutPanel({ onClose }: { onClose: () => void }) {
  const Row = ({ icon, name, text }: { icon: ReactNode; name: string; text: string }) => (
    <Box sx={{ display: 'flex', gap: 1.2, py: 0.75, alignItems: 'flex-start' }}>
      <Box sx={{ width: 30, height: 30, borderRadius: '8px', bgcolor: v('surface2'), border: `1px solid ${v('border')}`, color: v('textMuted'), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ fontSize: 13, fontWeight: 700 }}>{name}</Box>
        <Box sx={{ fontSize: 12, color: v('textMuted'), lineHeight: 1.4 }}>{text}</Box>
      </Box>
    </Box>
  );
  return (
    <SidePanel title="About" icon={<HelpOutline />} subtitle="Peer-to-peer, offline-first whiteboard" onClose={onClose}>
      <Section title="Drawing tools">
        {TOOLS.map(t => <Row key={t.id} icon={t.icon} name={`${t.label} · ${t.key}`} text={t.about} />)}
      </Section>
      <Section title="Top bar">{HEADER.map(h => <Row key={h.name} {...h} />)}</Section>
      <Section title="Also">{OTHER.map(h => <Row key={h.name} {...h} />)}</Section>
      <Section title="Shortcuts">
        <Box sx={{ fontSize: 12, color: v('textMuted'), lineHeight: 1.7 }}>
          Space + drag or right-drag: pan · Wheel / pinch: zoom · Delete: remove selection · Ctrl+Z / Ctrl+Y: undo / redo ·
          Ctrl+A: select all · Esc: clear selection · Shift: square / circle / keep proportions
        </Box>
      </Section>
    </SidePanel>
  );
}
