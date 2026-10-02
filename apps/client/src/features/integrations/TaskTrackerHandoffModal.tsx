import { useState, useMemo } from 'react';
import {
  Box,
  Button,
  Divider,
  Typography,
  Chip,
  IconButton,
  Tabs,
  Tab,
  Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import SendIcon from '@mui/icons-material/Send';
import SecurityIcon from '@mui/icons-material/Security';
import { type Shape, ShapeKind } from '@crdt-canvas/engine';
import {
  extractTasksFromShapes,
  formatAsGitHubMarkdown,
  formatAsCsv,
  dispatchTaskHandoffWebhook,
} from './taskHandoff';
import { sound } from '../../utils/audio';

interface TaskTrackerHandoffModalProps {
  open: boolean;
  onClose: () => void;
  shapes: Shape[];
  selectedIds: string[];
  boardTitle: string;
}

export function TaskTrackerHandoffModal({
  open,
  onClose,
  shapes,
  selectedIds,
  boardTitle,
}: TaskTrackerHandoffModalProps) {
  const [scope, setScope] = useState<'all' | 'selected' | string>(() =>
    selectedIds.length > 0 ? 'selected' : 'all'
  );
  const [activeTab, setActiveTab] = useState<'markdown' | 'csv' | 'webhook'>('markdown');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Available frame categories
  const frames = useMemo(
    () => shapes.filter(s => !s.deleted && s.data.kind === ShapeKind.Rect && !!s.data.frameTitle),
    [shapes]
  );

  const payload = useMemo(
    () => extractTasksFromShapes(shapes, scope, selectedIds, boardTitle),
    [shapes, scope, selectedIds, boardTitle]
  );

  const markdownContent = useMemo(() => formatAsGitHubMarkdown(payload), [payload]);
  const csvContent = useMemo(() => formatAsCsv(payload), [payload]);

  if (!open) return null;

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      sound.playSuccess();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sound.playSuccess();
  };

  const handleSendWebhook = async () => {
    if (!webhookUrl.trim() || isSending) return;
    setIsSending(true);
    setWebhookStatus(null);
    const result = await dispatchTaskHandoffWebhook(webhookUrl.trim(), payload);
    setIsSending(false);
    setWebhookStatus(result);
    if (result.success) sound.playSuccess();
  };

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Task Tracker and Workflow Handoff"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(5, 5, 10, 0.82)',
        backdropFilter: 'blur(8px)',
        p: 2,
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Box
        sx={{
          width: 'min(760px, 95vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'rgba(20, 20, 32, 0.98)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 3,
          boxShadow: '0 24px 72px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
          color: '#e2e2f0',
        }}
      >
        {/* Header */}
        <Box sx={{ p: 2.5, pb: 1.5, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 800, color: '#f3e8ff' }}>
              Task Tracker & Workflow Handoff
            </Typography>
            <Typography sx={{ color: '#94a3b8', fontSize: 12, mt: 0.25 }}>
              Export structured tasks to GitHub Issues, Jira, Linear, or custom webhook endpoints.
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close dialog" sx={{ color: '#94a3b8', '&:hover': { color: '#fff' } }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Data Boundary Disclosure */}
        <Box sx={{ px: 2.5, pb: 1.5 }}>
          <Alert
            severity="info"
            icon={<SecurityIcon sx={{ color: '#a78bfa' }} />}
            sx={{
              bgcolor: 'rgba(124, 58, 237, 0.08)',
              color: '#ddd6fe',
              border: '1px solid rgba(124, 58, 237, 0.25)',
              fontSize: 11,
              py: 0.5,
              '& .MuiAlert-icon': { mr: 1, py: 0.25 },
            }}
          >
            <strong>Explicit Data Boundary:</strong> Only extracted task text and frame categories are included in the export payload.
            Cryptographic peer keys, deleted items, and raw CRDT vector clocks remain private on this local device.
          </Alert>
        </Box>

        {/* Scope Selector */}
        <Box sx={{ px: 2.5, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 11, color: '#8888a8', fontWeight: 600 }}>Scope:</Typography>
          <Chip
            label={`All Notes (${shapes.filter(s => !s.deleted && (s.data.kind === ShapeKind.Note || s.data.kind === ShapeKind.Text)).length})`}
            size="small"
            clickable
            onClick={() => setScope('all')}
            sx={{
              bgcolor: scope === 'all' ? 'rgba(124, 58, 237, 0.35)' : 'rgba(255, 255, 255, 0.04)',
              color: scope === 'all' ? '#c4b5fd' : '#8888a8',
              fontSize: 11,
            }}
          />
          {selectedIds.length > 0 && (
            <Chip
              label={`Selected (${selectedIds.length})`}
              size="small"
              clickable
              onClick={() => setScope('selected')}
              sx={{
                bgcolor: scope === 'selected' ? 'rgba(124, 58, 237, 0.35)' : 'rgba(255, 255, 255, 0.04)',
                color: scope === 'selected' ? '#c4b5fd' : '#8888a8',
                fontSize: 11,
              }}
            />
          )}
          {frames.map(f => (
            <Chip
              key={f.id}
              label={`Frame: ${(f.data as any).frameTitle}`}
              size="small"
              clickable
              onClick={() => setScope(f.id)}
              sx={{
                bgcolor: scope === f.id ? 'rgba(124, 58, 237, 0.35)' : 'rgba(255, 255, 255, 0.04)',
                color: scope === f.id ? '#c4b5fd' : '#8888a8',
                fontSize: 11,
              }}
            />
          ))}
        </Box>

        <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.08)' }} />

        {/* Format Tabs */}
        <Box sx={{ px: 2.5, pt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tabs
            value={activeTab}
            onChange={(_, val) => setActiveTab(val)}
            sx={{
              minHeight: 36,
              '& .MuiTab-root': {
                minHeight: 36,
                fontSize: 11,
                textTransform: 'none',
                color: '#8888a8',
                '&.Mui-selected': { color: '#c4b5fd', fontWeight: 700 },
              },
              '& .MuiTabs-indicator': { bgcolor: '#a78bfa' },
            }}
          >
            <Tab value="markdown" label={`GitHub Issues / Markdown (${payload.totalTasks})`} />
            <Tab value="csv" label="Jira / Linear CSV" />
            <Tab value="webhook" label="Webhook Dispatch" />
          </Tabs>
        </Box>

        {/* Tab Panels */}
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {activeTab === 'markdown' && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                  Markdown checklist ready to paste into GitHub issues, discussion boards, or release notes:
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
                    onClick={() => handleCopy(markdownContent)}
                    sx={{ textTransform: 'none', fontSize: 11, color: copied ? '#6ee7b7' : '#c4b5fd' }}
                  >
                    {copied ? 'Copied!' : 'Copy Markdown'}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
                    onClick={() => handleDownload(markdownContent, `${boardTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-tasks.md`, 'text/markdown')}
                    sx={{ textTransform: 'none', fontSize: 11 }}
                  >
                    Download .md
                  </Button>
                </Box>
              </Box>
              <Box
                component="pre"
                sx={{
                  flex: 1,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#e2e2f0',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  overflowY: 'auto',
                  maxHeight: 280,
                }}
              >
                {markdownContent || 'No tasks found in selected scope.'}
              </Box>
            </>
          )}

          {activeTab === 'csv' && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                  Standard CSV format for Jira, Linear, or Excel issue import:
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
                    onClick={() => handleCopy(csvContent)}
                    sx={{ textTransform: 'none', fontSize: 11, color: copied ? '#6ee7b7' : '#c4b5fd' }}
                  >
                    {copied ? 'Copied!' : 'Copy CSV'}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
                    onClick={() => handleDownload(csvContent, `${boardTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-tasks.csv`, 'text/csv')}
                    sx={{ textTransform: 'none', fontSize: 11 }}
                  >
                    Download .csv
                  </Button>
                </Box>
              </Box>
              <Box
                component="pre"
                sx={{
                  flex: 1,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#e2e2f0',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  overflowY: 'auto',
                  maxHeight: 280,
                }}
              >
                {csvContent}
              </Box>
            </>
          )}

          {activeTab === 'webhook' && (
            <>
              <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                Send JSON task payload directly to your CI/CD pipeline, Slack bot, or task tracker endpoint with explicit confirmation:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <input
                  type="url"
                  placeholder="https://your-service.com/api/tasks"
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#e2e2f0',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
                <Button
                  variant="contained"
                  disabled={!webhookUrl.trim() || isSending || payload.totalTasks === 0}
                  onClick={handleSendWebhook}
                  startIcon={<SendIcon sx={{ fontSize: 14 }} />}
                  sx={{ textTransform: 'none', fontSize: 11, px: 2 }}
                >
                  {isSending ? 'Sending…' : 'Send with consent'}
                </Button>
              </Box>

              {webhookStatus && (
                <Alert
                  severity={webhookStatus.success ? 'success' : 'error'}
                  sx={{ fontSize: 11, py: 0.5 }}
                >
                  {webhookStatus.message}
                </Alert>
              )}

              <Box sx={{ mt: 1 }}>
                <Typography sx={{ fontSize: 10, color: '#8888a8', mb: 0.5 }}>Payload preview ({payload.totalTasks} items):</Typography>
                <Box
                  component="pre"
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#93c5fd',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    overflowY: 'auto',
                    maxHeight: 180,
                  }}
                >
                  {JSON.stringify(payload, null, 2)}
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
