import { useState } from 'react';
import { Box, Button, Chip, Divider, Typography } from '@mui/material';
import { type Shape, ShapeKind } from '@crdt-canvas/engine';

// ─── Stage definitions with contextual collaborative guidance ─────────────────

const RETRO_STAGES = [
  {
    title: 'Gather',
    emoji: '💬',
    prompt: 'Add one sticky note per thought. Give everyone quiet time to contribute.',
    facilitatorGuidance: 'Switch to the Note tool (N) and ask each participant to add ideas silently for 5–7 minutes. Avoid grouping yet.',
    participantHint: 'Select the Note tool (N) or double-click the canvas to add a sticky note.',
    suggestedTool: 'note' as const,
    autoAction: null,
    color: '#a78bfa',
  },
  {
    title: 'Group',
    emoji: '🗂️',
    prompt: 'Move related notes together. Invite the group to name each theme with a frame.',
    facilitatorGuidance: 'Use the Select tool to drag notes into clusters. Add a Frame (F) around each theme cluster and give it a descriptive title.',
    participantHint: 'Use Select (V) to drag notes into theme clusters. Add a frame with F to name each cluster.',
    suggestedTool: 'select' as const,
    autoAction: null,
    color: '#38bdf8',
  },
  {
    title: 'Vote',
    emoji: '🗳️',
    prompt: 'Start dot voting and let each participant choose the most useful themes.',
    facilitatorGuidance: 'Click "Start voting" below to open a round. Each person clicks objects to cast their votes. Limit to 3 dots per person by default.',
    participantHint: 'Click on a sticky note or theme frame to cast a vote.',
    suggestedTool: 'select' as const,
    autoAction: 'start-voting' as const,
    color: '#fbbf24',
  },
  {
    title: 'Commit',
    emoji: '✅',
    prompt: 'Turn the top theme into one clear action with an owner and a next step.',
    facilitatorGuidance: 'Discuss the top-voted theme aloud. Add a Note or Text shape that names the action item, an owner, and a deadline.',
    participantHint: 'Add a green sticky note (N) with: Action · Owner · By when.',
    suggestedTool: 'note' as const,
    autoAction: null,
    color: '#34d399',
  },
] as const;

// ─── FacilitationPanel ────────────────────────────────────────────────────────

export function FacilitationPanel({
  shapes, voting, maxVotesPerPerson, voteCounts, remainingSeconds, timerLabel, timerRunning,
  retrospectiveStep, onSetVoting, onStartTimer, onStopTimer, onSetRetrospectiveStep, onClose,
  actorName,
}: {
  shapes: Shape[];
  voting: boolean;
  maxVotesPerPerson: number;
  voteCounts: Map<string, number>;
  remainingSeconds: number | null;
  timerLabel: string;
  timerRunning: boolean;
  retrospectiveStep: number;
  onSetVoting: (enabled: boolean, maxVotes: number) => void;
  onStartTimer: (seconds: number, label: string) => void;
  onStopTimer: () => void;
  onSetRetrospectiveStep: (step: number) => void;
  onClose: () => void;
  actorName?: string;
}) {
  const [maxVotes, setMaxVotes] = useState(String(maxVotesPerPerson));
  const [minutes, setMinutes] = useState('5');
  const [label, setLabel] = useState('Team timer');

  const voteRows = [...voteCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => {
      const shape = shapes.find(item => item.id === id);
      const data = shape?.data;
      const title = data?.kind === ShapeKind.Note || data?.kind === ShapeKind.Text
        ? data.text.replace(/\s+/g, ' ').slice(0, 40)
        : data?.kind === ShapeKind.Rect && data.frameTitle
          ? data.frameTitle
          : `Object ${id.slice(0, 6)}`;
      return { id, count, title };
    });

  const clock = remainingSeconds === null
    ? '—'
    : `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 8px',
    borderRadius: 6,
    background: 'rgba(255,255,255,.05)',
    border: '1px solid rgba(255,255,255,.1)',
    color: '#e2e2f0',
    fontSize: 12,
  };

  const activeStage = retrospectiveStep >= 0 && retrospectiveStep < RETRO_STAGES.length
    ? RETRO_STAGES[retrospectiveStep]
    : null;

  // Active note count for stage awareness
  const activeNotes = shapes.filter(s => !s.deleted && s.data.kind === ShapeKind.Note).length;
  const activeFrames = shapes.filter(s => !s.deleted && s.data.kind === ShapeKind.Rect && !!(s.data as any).frameTitle).length;

  return (
    <Box role="region" aria-label="Facilitation tools" sx={{ height: '100%', display: 'flex', flexDirection: 'column', color: '#e2e2f0' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1.25 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Facilitation</Typography>
        <Button size="small" onClick={onClose} aria-label="Close facilitation panel">Close</Button>
      </Box>
      <Divider sx={{ borderColor: 'rgba(255,255,255,.08)' }} />

      {/* ── Guided retrospective ── */}
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#c4b5fd' }}>Guided retrospective</Typography>

        {retrospectiveStep < 0 ? (
          <>
            <Typography sx={{ fontSize: 10, color: '#85859b' }}>
              A shared four-step flow: gather, group, vote, and commit to an action.
            </Typography>
            <Button variant="outlined" size="small" onClick={() => onSetRetrospectiveStep(0)}>
              Start retrospective
            </Button>
          </>
        ) : activeStage ? (
          <>
            {/* Stage progress dots */}
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              {RETRO_STAGES.map((stage, i) => (
                <Box
                  key={stage.title}
                  title={stage.title}
                  sx={{
                    width: i === retrospectiveStep ? 20 : 8,
                    height: 8,
                    borderRadius: 4,
                    bgcolor: i === retrospectiveStep ? activeStage.color : i < retrospectiveStep ? '#4ade80' : 'rgba(255,255,255,.15)',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer',
                  }}
                  onClick={() => onSetRetrospectiveStep(i)}
                />
              ))}
              <Typography sx={{ fontSize: 10, color: '#8888a8', ml: 0.5 }}>
                {retrospectiveStep + 1} / {RETRO_STAGES.length}
              </Typography>
            </Box>

            {/* Stage header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography sx={{ fontSize: 18 }}>{activeStage.emoji}</Typography>
              <Typography aria-live="polite" sx={{ fontSize: 13, fontWeight: 800, color: activeStage.color }}>
                {activeStage.title}
              </Typography>
              {retrospectiveStep === 2 && (
                <Chip
                  label={voting ? 'Voting open' : 'Voting closed'}
                  size="small"
                  sx={{ fontSize: 9, height: 18, bgcolor: voting ? 'rgba(251,191,36,.2)' : 'rgba(255,255,255,.06)', color: voting ? '#fbbf24' : '#8888a8' }}
                />
              )}
            </Box>

            {/* Prompt */}
            <Typography sx={{ fontSize: 11, color: '#c4c4d8', lineHeight: 1.6 }}>
              {activeStage.prompt}
            </Typography>

            {/* Facilitator guidance */}
            <Box sx={{ bgcolor: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 1.5, p: 1 }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, color: '#8888a8', textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
                Facilitator guidance
              </Typography>
              <Typography sx={{ fontSize: 10, color: '#a0a0b8', lineHeight: 1.5 }}>
                {activeStage.facilitatorGuidance}
              </Typography>
            </Box>

            {/* Participant hint */}
            <Box sx={{ bgcolor: 'rgba(167,139,250,.08)', border: '1px solid rgba(167,139,250,.18)', borderRadius: 1.5, p: 1 }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
                Participant hint
              </Typography>
              <Typography sx={{ fontSize: 10, color: '#c4b5fd', lineHeight: 1.5 }}>
                {activeStage.participantHint}
              </Typography>
            </Box>

            {/* Board status summary for the stage */}
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              <Chip
                label={`${activeNotes} note${activeNotes !== 1 ? 's' : ''}`}
                size="small"
                sx={{ fontSize: 9, height: 18, bgcolor: 'rgba(250,204,21,.1)', color: '#fde68a' }}
              />
              <Chip
                label={`${activeFrames} theme${activeFrames !== 1 ? 's' : ''}`}
                size="small"
                sx={{ fontSize: 9, height: 18, bgcolor: 'rgba(56,189,248,.1)', color: '#7dd3fc' }}
              />
              {voteCounts.size > 0 && (
                <Chip
                  label={`${[...voteCounts.values()].reduce((a, b) => a + b, 0)} votes`}
                  size="small"
                  sx={{ fontSize: 9, height: 18, bgcolor: 'rgba(251,191,36,.1)', color: '#fbbf24' }}
                />
              )}
            </Box>

            {/* Auto-action: start voting button on Vote stage */}
            {activeStage.autoAction === 'start-voting' && !voting && (
              <Button
                variant="contained"
                size="small"
                onClick={() => onSetVoting(true, Number(maxVotes) || 3)}
                sx={{ bgcolor: '#fbbf24', color: '#1e1e30', '&:hover': { bgcolor: '#f59e0b' }, fontWeight: 700, fontSize: 11 }}
              >
                Start voting now
              </Button>
            )}
            {activeStage.autoAction === 'start-voting' && voting && (
              <Button variant="outlined" size="small" color="warning" onClick={() => onSetVoting(false, 3)}>
                End voting
              </Button>
            )}

            {/* Navigation */}
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button size="small" disabled={retrospectiveStep === 0} onClick={() => onSetRetrospectiveStep(retrospectiveStep - 1)}>
                ← Back
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={retrospectiveStep === RETRO_STAGES.length - 1}
                onClick={() => onSetRetrospectiveStep(retrospectiveStep + 1)}
                sx={{ flex: 1 }}
              >
                Next →
              </Button>
              <Button size="small" onClick={() => onSetRetrospectiveStep(-1)}>End</Button>
            </Box>
          </>
        ) : null}
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,.08)' }} />

      {/* ── Dot voting ── */}
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#c4b5fd' }}>Dot voting</Typography>
        <label style={{ fontSize: 10, color: '#9898ae' }}>
          Votes per person (1–20)
          <input type="number" min="1" max="20" value={maxVotes} onChange={event => setMaxVotes(event.target.value)} style={inputStyle} />
        </label>
        <Button variant={voting ? 'contained' : 'outlined'} size="small" onClick={() => onSetVoting(!voting, Number(maxVotes) || 3)} aria-pressed={voting}>
          {voting ? 'End voting' : 'Start voting'}
        </Button>
        <Typography sx={{ fontSize: 10, color: '#85859b' }}>
          {voting ? 'Click notes or objects to add or remove a vote.' : 'Start a round, then click an object to vote.'}
        </Typography>
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,.08)' }} />

      {/* ── Shared timer ── */}
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#c4b5fd' }}>Shared timer</Typography>
        {remainingSeconds !== null && (
          <Box aria-live="off" sx={{ textAlign: 'center', py: 0.5 }}>
            <Typography sx={{ color: '#e2e2f0', fontSize: 12 }}>{timerLabel}</Typography>
            <Typography
              aria-label={`${Math.floor((remainingSeconds ?? 0) / 60)} minutes ${String((remainingSeconds ?? 0) % 60).padStart(2, '0')} seconds remaining`}
              sx={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: (remainingSeconds ?? 0) < 60 ? '#fb7185' : '#a78bfa' }}
            >
              {clock}
            </Typography>
          </Box>
        )}
        <label style={{ fontSize: 10, color: '#9898ae' }}>
          Timer label
          <input value={label} maxLength={48} onChange={event => setLabel(event.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: 10, color: '#9898ae' }}>
          Minutes (1–60)
          <input type="number" min="1" max="60" value={minutes} onChange={event => setMinutes(event.target.value)} style={inputStyle} />
        </label>
        <Button variant="outlined" size="small" onClick={() => onStartTimer((Number(minutes) || 5) * 60, label)}>
          {timerRunning ? 'Restart timer' : 'Start timer'}
        </Button>
        {timerRunning && <Button size="small" onClick={onStopTimer}>Stop timer</Button>}
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,.08)' }} />

      {/* ── Vote leaderboard ── */}
      <Box sx={{ p: 1.5, minHeight: 0, overflowY: 'auto', flex: 1 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#c4b5fd', mb: 0.75 }}>Votes</Typography>
        {voteRows.length ? (
          voteRows.map((row, i) => (
            <Box key={row.id} sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid rgba(255,255,255,.05)', alignItems: 'center' }}>
              {i === 0 && <Typography sx={{ fontSize: 12 }}>🥇</Typography>}
              {i === 1 && <Typography sx={{ fontSize: 12 }}>🥈</Typography>}
              {i === 2 && <Typography sx={{ fontSize: 12 }}>🥉</Typography>}
              {i > 2 && <Box sx={{ width: 20 }} />}
              <Typography sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, flex: 1 }}>
                {row.title}
              </Typography>
              <Typography aria-label={`${row.count} votes`} sx={{ flexShrink: 0, color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>
                ● {row.count}
              </Typography>
            </Box>
          ))
        ) : (
          <Typography sx={{ fontSize: 10, color: '#85859b' }}>No votes yet.</Typography>
        )}
      </Box>
    </Box>
  );
}
