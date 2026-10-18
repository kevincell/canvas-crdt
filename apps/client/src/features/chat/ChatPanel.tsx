/**
 * Chat Panel — room-wide chat stored in a Yjs Text (one line per message: id|ts|name|text).
 * Synced peer-to-peer with the rest of the room document.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { Box, IconButton, TextField, Tooltip } from '@mui/material';
import { Send, ForumOutlined } from '@mui/icons-material';
import { SidePanel, Empty } from '../panels/SidePanel';
import { v } from '../../theme/theme';

export interface ChatMessage {
  id: string;
  actor: string;
  text: string;
  ts: number;
}

interface ChatPanelProps {
  doc: Y.Doc | null;
  actorName: string;
  actorColor: string;
  /** name → pointer colour, so other people's names show in their colour */
  colorOf?: (name: string) => string | undefined;
  onClose: () => void;
  readOnly?: boolean;
}

export function parseChat(raw: string): ChatMessage[] {
  if (!raw.trim()) return [];
  return raw.split('\n').filter(line => line.trim()).map(line => {
    const a = line.indexOf('|');
    const b = line.indexOf('|', a + 1);
    const c = line.indexOf('|', b + 1);
    if (a === -1 || b === -1 || c === -1) return null;
    return { id: line.slice(0, a), ts: parseInt(line.slice(a + 1, b), 10), actor: line.slice(b + 1, c), text: line.slice(c + 1) };
  }).filter((m): m is ChatMessage => m !== null);
}

export function ChatPanel({ doc, actorName, actorColor, colorOf, onClose, readOnly }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!doc) return;
    const chatText = doc.getText('chat');
    const update = () => setMessages(parseChat(chatText.toString()));
    chatText.observe(update);
    update();
    return () => chatText.unobserve(update);
  }, [doc]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(() => {
    const text = inputValue.replace(/\n/g, ' ').trim();
    if (!text || !doc) return;
    const chatText = doc.getText('chat');
    const msgId = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8);
    chatText.insert(chatText.length, `${msgId}|${Date.now()}|${actorName}|${text}\n`);
    setInputValue('');
  }, [inputValue, doc, actorName]);

  const fmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <SidePanel title="Chat" icon={<ForumOutlined />} subtitle={`${messages.length} message${messages.length === 1 ? '' : 's'} · whole room`} onClose={onClose} width={340}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {!messages.length && <Empty>No messages yet — say hello 👋</Empty>}
          {messages.map(msg => {
            const isMe = msg.actor === actorName;
            const color = isMe ? actorColor : (colorOf?.(msg.actor) ?? '#8B6A4F');
            return (
              <Box key={msg.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.2 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
                  <Box sx={{ fontSize: 11, fontWeight: 700, color: v('textMuted') }}>{msg.actor}</Box>
                  <Box sx={{ fontSize: 10, color: v('textFaint') }}>{fmt(msg.ts)}</Box>
                </Box>
                <Box sx={{
                  maxWidth: '85%', px: 1.2, py: 0.75, fontSize: 13, lineHeight: 1.4, wordBreak: 'break-word',
                  borderRadius: isMe ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                  bgcolor: isMe ? v('primarySoft') : v('surface2'), border: `1px solid ${v('border')}`, color: v('text'),
                }}>{msg.text}</Box>
              </Box>
            );
          })}
        </Box>
        {!readOnly && (
          <Box sx={{ p: 1.2, borderTop: `1px solid ${v('border')}`, display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            <TextField size="small" fullWidth multiline maxRows={4} placeholder="Message the room…" value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
            <Tooltip title="Send (Enter)">
              <span><IconButton color="primary" disabled={!inputValue.trim()} onClick={sendMessage} aria-label="Send"><Send fontSize="small" /></IconButton></span>
            </Tooltip>
          </Box>
        )}
      </Box>
    </SidePanel>
  );
}
