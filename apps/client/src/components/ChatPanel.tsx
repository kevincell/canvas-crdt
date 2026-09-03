/**
 * Chat Panel — Real-time collaborative chat using Yjs Text CRDT.
 * Messages are stored in the Yjs document and synced across peers via WebRTC.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';

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
  onClose: () => void;
}

const NOTE_COLORS = [
  '#fef3c7', '#fce7f3', '#dbeafe', '#d1fae5', '#fee2e2', '#f3e8ff',
];

export function ChatPanel({ doc, actorName, actorColor, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedColor, setSelectedColor] = useState('#fef3c7');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Subscribe to chat text changes
  useEffect(() => {
    if (!doc) return;
    const chatText = doc.getText('chat');

    const parseMessages = (): ChatMessage[] => {
      const raw = chatText.toString();
      if (!raw.trim()) return [];
      return raw.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const pipeIdx = line.indexOf('|');
          const tsIdx = line.indexOf('|', pipeIdx + 1);
          const nameIdx = line.indexOf('|', tsIdx + 1);
          if (pipeIdx === -1 || tsIdx === -1 || nameIdx === -1) return null;
          try {
            return {
              id: line.slice(0, pipeIdx),
              actor: line.slice(tsIdx + 1, nameIdx),
              text: line.slice(nameIdx + 1),
              ts: parseInt(line.slice(pipeIdx + 1, tsIdx), 10),
            };
          } catch {
            return null;
          }
        })
        .filter((m): m is ChatMessage => m !== null);
    };

    const update = () => {
      setMessages(parseMessages());
    };

    chatText.observe(update);
    update();

    return () => {
      chatText.unobserve(update);
    };
  }, [doc]);

  // Auto-scroll to bottom using mutation observer
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    observer.observe(el, { childList: true, subtree: true });
    el.scrollTop = el.scrollHeight;
    return () => observer.disconnect();
  }, [messages]);

  const sendMessage = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !doc) return;

    const chatText = doc.getText('chat');
    const msgId = crypto.randomUUID().slice(0, 8);
    const entry = `${msgId}|${Date.now()}|${actorName}|${text}\n`;
    chatText.insert(chatText.length, entry);
    setInputValue('');
  }, [inputValue, doc, actorName]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'rgba(15, 15, 22, 0.97)',
      borderLeft: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>💬</span>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#e2e2f0' }}>Chat</span>
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 10,
            background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7',
          }}>
            {messages.length} msgs
          </span>
        </div>
        <button onClick={onClose} style={{
          color: '#8888a8', fontSize: 18, lineHeight: 1,
          width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 4,
        }}>✕</button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center', color: '#555570', fontSize: 12,
            padding: '32px 0',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💭</div>
            No messages yet.<br />Start the conversation!
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.actor === actorName;
          return (
            <div key={msg.id} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isMe ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 2,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: isMe ? actorColor : '#7c3aed',
                  flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 11,
                  color: isMe ? actorColor : '#a78bfa',
                  fontWeight: 600,
                }}>
                  {msg.actor}
                </span>
                <span style={{ fontSize: 10, color: '#555570' }}>
                  {formatTime(msg.ts)}
                </span>
              </div>
              <div style={{
                maxWidth: '85%',
                padding: '6px 10px',
                borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: isMe ? 'rgba(124, 58, 237, 0.25)' : 'rgba(255,255,255,0.06)',
                color: '#e2e2f0',
                fontSize: 13,
                lineHeight: 1.4,
                wordBreak: 'break-word',
              }}>
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* Input area */}
      <div style={{
        padding: '10px 12px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        {/* Note color picker hint */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#555570' }}>Note bg:</span>
          {NOTE_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setSelectedColor(c)}
              style={{
                width: 14, height: 14, borderRadius: '50%',
                background: c,
                border: selectedColor === c ? '2px solid #a78bfa' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'border 0.1s',
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            style={{
              flex: 1,
              padding: '7px 10px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#e2e2f0',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'Inter, sans-serif',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!inputValue.trim()}
            style={{
              padding: '7px 12px',
              background: inputValue.trim() ? 'rgba(124, 58, 237, 0.7)' : 'rgba(255,255,255,0.05)',
              border: 'none',
              borderRadius: 6,
              color: inputValue.trim() ? '#fff' : '#555570',
              fontSize: 13,
              cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            Send
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#555570' }}>
          Press Enter to send · Messages sync via Yjs CRDT
        </div>
      </div>
    </div>
  );
}
