/** Comments attached to selected objects (the chat stays for general talk). */
import { useMemo, useState } from 'react';
import { Box, Button, IconButton, TextField, Tooltip } from '@mui/material';
import { ChatBubbleOutlineOutlined as ChatBubbleOutline, DeleteOutlineOutlined as DeleteOutline, CenterFocusStrong } from '@mui/icons-material';
import { SidePanel, Empty, timeAgo } from './SidePanel';
import { type BoardComment } from '../board/useBoardLogs';
import { v } from '../../theme/theme';

export function CommentsPanel({ comments, selectedIds, myDeviceId, onAdd, onDelete, onFocus, onClose, readOnly }: {
  comments: BoardComment[]; selectedIds: string[]; myDeviceId: string;
  onAdd: (text: string) => void; onDelete: (id: string) => void; onFocus: (shapeIds: string[]) => void; onClose: () => void; readOnly?: boolean;
}) {
  const [text, setText] = useState('');
  const sel = useMemo(() => new Set(selectedIds), [selectedIds]);
  const onSelection = comments.filter(c => c.shapeIds.some(id => sel.has(id)));
  const others = comments.filter(c => !c.shapeIds.some(id => sel.has(id)));

  const submit = () => { if (text.trim()) { onAdd(text.trim()); setText(''); } };

  const Item = ({ c }: { c: BoardComment }) => (
    <Box sx={{ mx: 1.5, my: 0.7, p: 1.2, borderRadius: '12px', bgcolor: v('surface2'), border: `1px solid ${v('border')}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box sx={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{c.author} <Box component="span" sx={{ fontWeight: 400, color: v('textFaint'), fontSize: 11 }}>· {timeAgo(c.ts)}</Box></Box>
        <Tooltip title="Show on board"><IconButton size="small" onClick={() => onFocus(c.shapeIds)}><CenterFocusStrong sx={{ fontSize: 16 }} /></IconButton></Tooltip>
        {c.authorId === myDeviceId && !readOnly && <Tooltip title="Delete"><IconButton size="small" onClick={() => onDelete(c.id)}><DeleteOutline sx={{ fontSize: 16 }} /></IconButton></Tooltip>}
      </Box>
      <Box sx={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.3 }}>{c.text}</Box>
      <Box sx={{ fontSize: 10.5, color: v('textFaint'), mt: 0.4 }}>on {c.shapeIds.length} object{c.shapeIds.length === 1 ? '' : 's'}</Box>
    </Box>
  );

  return (
    <SidePanel title="Comments" icon={<ChatBubbleOutline />} subtitle={`${comments.length} on this board`} onClose={onClose}>
      {!readOnly && (
        <Box sx={{ p: 1.5, borderBottom: `1px solid ${v('border')}` }}>
          {selectedIds.length ? (
            <>
              <TextField multiline minRows={2} maxRows={6} fullWidth size="small" placeholder={`Comment on ${selectedIds.length} selected object${selectedIds.length === 1 ? '' : 's'}…`}
                value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                <Button size="small" variant="contained" disabled={!text.trim()} onClick={submit}>Add comment</Button>
              </Box>
            </>
          ) : (
            <Box sx={{ fontSize: 12.5, color: v('textMuted') }}>Select one or more objects (cursor or hand tool) to comment on them.</Box>
          )}
        </Box>
      )}
      {selectedIds.length > 0 && <Box sx={{ px: 2, pt: 1.2, fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', color: v('textFaint') }}>ON THE SELECTION</Box>}
      {selectedIds.length > 0 && !onSelection.length && <Empty>No comments on the selection yet.</Empty>}
      {onSelection.map(c => <Item key={c.id} c={c} />)}
      {others.length > 0 && <Box sx={{ px: 2, pt: 1.2, fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', color: v('textFaint') }}>{selectedIds.length ? 'OTHER COMMENTS' : 'ALL COMMENTS'}</Box>}
      {!comments.length && !selectedIds.length && <Empty>No comments yet.</Empty>}
      {others.map(c => <Item key={c.id} c={c} />)}
    </SidePanel>
  );
}
