import { useState, useId } from 'react';
import {
  Box,
  Button,
  Divider,
  Typography,
  Chip,
  IconButton,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { ShapeKind, shapeBBox, type Shape, type ShapeData } from '@crdt-canvas/engine';
import {
  CURATED_TEMPLATES,
  type CuratedTemplate,
  type TemplateVersion,
  instantiateTemplate,
} from './curatedTemplates';

interface TemplatesModalProps {
  open: boolean;
  onClose: () => void;
  onInsertToCanvas?: (shapes: Array<{ id: string; data: ShapeData }>, title: string) => void;
  onCreateNewBoard?: (shapes: Array<{ id: string; data: ShapeData }>, title: string) => void;
  isCanvasEmpty?: boolean;
}

type CategoryFilter = 'all' | 'ideation' | 'agile' | 'planning' | 'engineering';

export function TemplatesModal({
  open,
  onClose,
  onInsertToCanvas,
  onCreateNewBoard,
  isCanvasEmpty = false,
}: TemplatesModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');
  const [selectedVersions, setSelectedVersions] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const t of CURATED_TEMPLATES) {
      initial[t.id] = t.versions[t.versions.length - 1].version;
    }
    return initial;
  });

  if (!open) return null;

  const filteredTemplates = CURATED_TEMPLATES.filter(
    t => selectedCategory === 'all' || t.category === selectedCategory
  );

  const handleVersionChange = (templateId: string, version: number) => {
    setSelectedVersions(prev => ({ ...prev, [templateId]: version }));
  };

  const handleInsert = (template: CuratedTemplate) => {
    const versionNum = selectedVersions[template.id];
    const shapes = instantiateTemplate(template, versionNum);
    onInsertToCanvas?.(shapes, template.title);
    onClose();
  };

  const handleCreateBoard = (template: CuratedTemplate) => {
    const versionNum = selectedVersions[template.id];
    const shapes = instantiateTemplate(template, versionNum);
    onCreateNewBoard?.(shapes, template.title);
    onClose();
  };

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Curated board templates"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'var(--panel-solid)',
        backdropFilter: 'blur(8px)',
        p: 2,
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Box
        sx={{
          width: 'min(980px, 95vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'var(--panel-solid)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          boxShadow: '0 24px 72px rgba(0,0,0,0.35), 0 0 0 1px var(--surface)',
          overflow: 'hidden',
          color: 'var(--text)',
        }}
      >
        {/* Header */}
        <Box sx={{ p: 2.5, pb: 1.75, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AutoAwesomeIcon sx={{ color: 'var(--accent)', fontSize: 22 }} />
              <Typography sx={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}>
                Curated Board Templates
              </Typography>
            </Box>
            <Typography sx={{ color: 'var(--text-muted)', fontSize: 12, mt: 0.5 }}>
              Production-tested visual structures. Preview layout, select versions, and insert editable native components or spawn a new board.
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close templates dialog" sx={{ color: 'var(--text-muted)', '&:hover': { color: '#fff' } }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Category Filters */}
        <Box sx={{ px: 2.5, pb: 1.5, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {(['all', 'ideation', 'agile', 'planning', 'engineering'] as CategoryFilter[]).map(cat => (
            <Chip
              key={cat}
              label={cat === 'all' ? 'All Templates' : cat.charAt(0).toUpperCase() + cat.slice(1)}
              clickable
              onClick={() => setSelectedCategory(cat)}
              sx={{
                bgcolor: selectedCategory === cat ? 'var(--accent-soft)' : 'var(--surface)',
                color: selectedCategory === cat ? 'var(--accent)' : 'var(--text-muted)',
                borderColor: selectedCategory === cat ? 'var(--accent)' : 'var(--border)',
                borderWidth: 1,
                borderStyle: 'solid',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'capitalize',
                '&:hover': {
                  bgcolor: 'var(--accent-soft)',
                  color: 'var(--text)',
                },
              }}
            />
          ))}
        </Box>

        <Divider sx={{ borderColor: 'var(--border)' }} />

        {/* Template Grid */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(420px, 100%), 1fr))', gap: 2 }}>
          {filteredTemplates.map(template => {
            const currentVersionNum = selectedVersions[template.id] ?? template.versions[template.versions.length - 1].version;
            const currentVersion = template.versions.find(v => v.version === currentVersionNum) ?? template.versions[template.versions.length - 1];

            return (
              <TemplateCard
                key={template.id}
                template={template}
                currentVersion={currentVersion}
                onSelectVersion={v => handleVersionChange(template.id, v)}
                onInsert={() => handleInsert(template)}
                onCreateBoard={() => handleCreateBoard(template)}
                isCanvasEmpty={isCanvasEmpty}
              />
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

function TemplateCard({
  template,
  currentVersion,
  onSelectVersion,
  onInsert,
  onCreateBoard,
  isCanvasEmpty,
}: {
  template: CuratedTemplate;
  currentVersion: TemplateVersion;
  onSelectVersion: (version: number) => void;
  onInsert: () => void;
  onCreateBoard: () => void;
  isCanvasEmpty: boolean;
}) {
  const versionSelectId = useId();
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: 'var(--surface)',
        border: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        transition: 'all 0.2s ease',
        '&:hover': {
          bgcolor: 'var(--surface)',
          borderColor: 'var(--accent-soft)',
        },
      }}
    >
      {/* Title & Category Badge */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          {template.title}
        </Typography>
        <Chip
          label={template.category}
          size="small"
          sx={{
            height: 20,
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            bgcolor: 'var(--accent-soft)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-soft)',
          }}
        />
      </Box>

      {/* Description */}
      <Typography sx={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5, minHeight: 32 }}>
        {template.description}
      </Typography>

      {/* Visual SVG Layout Preview */}
      <Box sx={{ width: '100%', height: 140, borderRadius: 1.5, overflow: 'hidden', border: '1px solid var(--surface)' }}>
        <TemplatePreview name={template.title} shapes={currentVersion.shapes} />
      </Box>

      {/* Version Selector & Changelog */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id={versionSelectId} sx={{ fontSize: 10, color: 'var(--accent)' }}>Version</InputLabel>
          <Select
            labelId={versionSelectId}
            value={currentVersion.version}
            label="Version"
            onChange={e => onSelectVersion(Number(e.target.value))}
            sx={{
              height: 28,
              fontSize: 10,
              color: 'var(--text)',
              bgcolor: 'var(--panel-solid)',
              border: '1px solid var(--border)',
              '& .MuiSelect-icon': { color: 'var(--accent)', fontSize: 16 },
            }}
          >
            {template.versions.map(v => (
              <MenuItem key={v.version} value={v.version} sx={{ fontSize: 11 }}>
                {v.versionName}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Typography sx={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'right', flex: 1 }} noWrap title={currentVersion.changelog}>
          {currentVersion.changelog}
        </Typography>
      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1, mt: 'auto', pt: 0.5 }}>
        <Button
          variant="contained"
          size="small"
          onClick={onInsert}
          sx={{
            flex: 1,
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'none',
            background: 'linear-gradient(135deg, var(--accent) 0%, rgba(59,130,246,0.7) 100%)',
            boxShadow: '0 2px 10px var(--accent-soft)',
          }}
        >
          {isCanvasEmpty ? 'Use on canvas' : 'Insert into board'}
        </Button>
        <Button
          variant="outlined"
          size="small"
          onClick={onCreateBoard}
          sx={{
            flex: 1,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'none',
            borderColor: 'var(--border)',
            color: 'var(--accent)',
            '&:hover': {
              borderColor: 'var(--accent)',
              bgcolor: 'var(--accent-soft)',
            },
          }}
        >
          Create new board
        </Button>
      </Box>
    </Box>
  );
}

function TemplatePreview({ name, shapes }: { name: string; shapes: Array<{ id: string; data: ShapeData }> }) {
  const boxes = shapes.map(({ id, data }) => ({ id, data, box: shapeBBox({ id, data } as Shape) }));
  const minX = Math.min(...boxes.map(item => item.box.minX));
  const minY = Math.min(...boxes.map(item => item.box.minY));
  const maxX = Math.max(...boxes.map(item => item.box.maxX));
  const maxY = Math.max(...boxes.map(item => item.box.maxY));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min(170 / spanX, 100 / spanY);
  const px = (x: number) => 10 + (x - minX) * scale;
  const py = (y: number) => 10 + (y - minY) * scale;

  return (
    <svg
      role="img"
      aria-label={`Preview of ${name} template layout`}
      viewBox="0 0 190 120"
      style={{ width: '100%', height: '100%', background: 'var(--panel-solid)' }}
    >
      {boxes.map(({ id, data, box }) => {
        const color = 'color' in data ? data.color : 'var(--accent)';
        const x = px(box.minX);
        const y = py(box.minY);
        const width = Math.max(1, (box.maxX - box.minX) * scale);
        const height = Math.max(1, (box.maxY - box.minY) * scale);

        if (data.kind === ShapeKind.Line) {
          return (
            <line
              key={id}
              x1={px(data.x1)}
              y1={py(data.y1)}
              x2={px(data.x2)}
              y2={py(data.y2)}
              stroke={color}
              strokeWidth="1.2"
              strokeDasharray={data.arrowEnd ? undefined : '2,2'}
            />
          );
        }

        if (data.kind === ShapeKind.Stroke) {
          return (
            <polyline
              key={id}
              points={data.points.map(point => `${px(point.x)},${py(point.y)}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          );
        }

        if (data.kind === ShapeKind.Ellipse) {
          return (
            <ellipse
              key={id}
              cx={px(data.cx)}
              cy={py(data.cy)}
              rx={Math.max(1, data.rx * scale)}
              ry={Math.max(1, data.ry * scale)}
              fill={color}
              fillOpacity={data.fillOpacity ?? 0.2}
              stroke={color}
              strokeWidth="1"
            />
          );
        }

        if (data.kind === ShapeKind.Note) {
          return (
            <g key={id}>
              <rect x={x} y={y} width={width} height={height} rx="2" fill={data.bgColor} />
              <text x={x + 2} y={y + 5} fill={data.color} fontSize="4" fontFamily="sans-serif">
                {data.text.slice(0, 16)}
              </text>
            </g>
          );
        }

        if (data.kind === ShapeKind.Text) {
          return (
            <text key={id} x={x} y={y + 4} fill={color} fontSize="4.5" fontFamily="sans-serif">
              {data.text.slice(0, 24)}
            </text>
          );
        }

        const isFrame = data.kind === ShapeKind.Rect && !!data.frameTitle;
        return (
          <g key={id}>
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={data.kind === ShapeKind.Rect ? data.cornerRadius ?? 1 : 1}
              fill={data.kind === ShapeKind.Rect ? color : 'var(--text-muted)'}
              fillOpacity={data.kind === ShapeKind.Rect ? (isFrame ? 0.04 : data.fillOpacity ?? 0.16) : 1}
              stroke={color}
              strokeWidth={isFrame ? '1.2' : '0.8'}
              strokeDasharray={isFrame ? '3,2' : undefined}
            />
            {isFrame && data.frameTitle && (
              <text x={x + 2} y={y + 5} fill={color} fontSize="4" fontWeight="bold" fontFamily="sans-serif">
                {data.frameTitle.slice(0, 18)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
