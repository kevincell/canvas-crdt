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
          width: 'min(980px, 95vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'rgba(20, 20, 32, 0.98)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 3,
          boxShadow: '0 24px 72px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          overflow: 'hidden',
          color: '#e2e2f0',
        }}
      >
        {/* Header */}
        <Box sx={{ p: 2.5, pb: 1.75, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AutoAwesomeIcon sx={{ color: '#a78bfa', fontSize: 22 }} />
              <Typography sx={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: '#f3e8ff' }}>
                Curated Board Templates
              </Typography>
            </Box>
            <Typography sx={{ color: '#94a3b8', fontSize: 12, mt: 0.5 }}>
              Production-tested visual structures. Preview layout, select versions, and insert editable native components or spawn a new board.
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close templates dialog" sx={{ color: '#94a3b8', '&:hover': { color: '#fff' } }}>
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
                bgcolor: selectedCategory === cat ? 'rgba(124, 58, 237, 0.35)' : 'rgba(255, 255, 255, 0.04)',
                color: selectedCategory === cat ? '#c4b5fd' : '#8888a8',
                borderColor: selectedCategory === cat ? 'rgba(167, 139, 250, 0.5)' : 'rgba(255, 255, 255, 0.08)',
                borderWidth: 1,
                borderStyle: 'solid',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'capitalize',
                '&:hover': {
                  bgcolor: 'rgba(124, 58, 237, 0.22)',
                  color: '#e2e2f0',
                },
              }}
            />
          ))}
        </Box>

        <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.08)' }} />

        {/* Template Grid */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 2 }}>
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
        bgcolor: 'rgba(255, 255, 255, 0.025)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        transition: 'all 0.2s ease',
        '&:hover': {
          bgcolor: 'rgba(255, 255, 255, 0.04)',
          borderColor: 'rgba(167, 139, 250, 0.3)',
        },
      }}
    >
      {/* Title & Category Badge */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#f3e8ff' }}>
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
            bgcolor: 'rgba(124, 58, 237, 0.15)',
            color: '#a78bfa',
            border: '1px solid rgba(124, 58, 237, 0.3)',
          }}
        />
      </Box>

      {/* Description */}
      <Typography sx={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.5, minHeight: 32 }}>
        {template.description}
      </Typography>

      {/* Visual SVG Layout Preview */}
      <Box sx={{ width: '100%', height: 140, borderRadius: 1.5, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
        <TemplatePreview name={template.title} shapes={currentVersion.shapes} />
      </Box>

      {/* Version Selector & Changelog */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id={versionSelectId} sx={{ fontSize: 10, color: '#a78bfa' }}>Version</InputLabel>
          <Select
            labelId={versionSelectId}
            value={currentVersion.version}
            label="Version"
            onChange={e => onSelectVersion(Number(e.target.value))}
            sx={{
              height: 28,
              fontSize: 10,
              color: '#ddd6fe',
              bgcolor: 'rgba(15, 15, 24, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              '& .MuiSelect-icon': { color: '#a78bfa', fontSize: 16 },
            }}
          >
            {template.versions.map(v => (
              <MenuItem key={v.version} value={v.version} sx={{ fontSize: 11 }}>
                {v.versionName}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Typography sx={{ fontSize: 9, color: '#71717a', textAlign: 'right', flex: 1 }} noWrap title={currentVersion.changelog}>
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
            background: 'linear-gradient(135deg, rgba(124,58,237,0.85) 0%, rgba(59,130,246,0.7) 100%)',
            boxShadow: '0 2px 10px rgba(124, 58, 237, 0.25)',
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
            borderColor: 'rgba(255, 255, 255, 0.16)',
            color: '#c4b5fd',
            '&:hover': {
              borderColor: '#a78bfa',
              bgcolor: 'rgba(124, 58, 237, 0.12)',
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
      style={{ width: '100%', height: '100%', background: 'rgba(8, 8, 14, 0.95)' }}
    >
      {boxes.map(({ id, data, box }) => {
        const color = 'color' in data ? data.color : '#a78bfa';
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
              fill={data.kind === ShapeKind.Rect ? color : '#475569'}
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
