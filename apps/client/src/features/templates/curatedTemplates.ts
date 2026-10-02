import {
  type ShapeData,
  ShapeKind,
} from '@crdt-canvas/engine';
import { cloneBoardShapes } from '../canvas/boardDuplication';

export interface TemplateVersion {
  version: number;
  versionName: string;
  releaseDate: string;
  changelog: string;
  shapes: Array<{ id: string; data: ShapeData }>;
}

export interface CuratedTemplate {
  id: string;
  title: string;
  description: string;
  category: 'ideation' | 'agile' | 'planning' | 'engineering';
  versions: TemplateVersion[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 1: Brainstorming & Ideation Grid
// ─────────────────────────────────────────────────────────────────────────────

const brainstormV1Shapes: Array<{ id: string; data: ShapeData }> = [
  { id: 'bs-n1', data: { kind: ShapeKind.Note, x: 100, y: 100, w: 200, h: 160, text: 'How might we improve first-run UX?', color: '#1e293b', bgColor: '#fef3c7' } },
  { id: 'bs-n2', data: { kind: ShapeKind.Note, x: 330, y: 100, w: 200, h: 160, text: 'Wild ideas: no constraints', color: '#1e293b', bgColor: '#dbeafe' } },
  { id: 'bs-n3', data: { kind: ShapeKind.Note, x: 100, y: 290, w: 200, h: 160, text: 'Themes & Patterns', color: '#1e293b', bgColor: '#dcfce7' } },
  { id: 'bs-n4', data: { kind: ShapeKind.Note, x: 330, y: 290, w: 200, h: 160, text: 'Next Steps & Owners', color: '#1e293b', bgColor: '#fce7f3' } },
];

const brainstormV2Shapes: Array<{ id: string; data: ShapeData }> = [
  // Header frame
  { id: 'bs-hdr-frame', data: { kind: ShapeKind.Rect, x: 60, y: 40, w: 900, h: 70, color: '#8b5cf6', fillOpacity: 0.05, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'Brainstorm & Ideation Canvas' } },
  { id: 'bs-hdr-text', data: { kind: ShapeKind.Text, x: 80, y: 82, text: 'Brainstorming: Define the prompt, diverge on wild ideas, cluster themes, and agree on next steps.', color: '#c4b5fd', frameId: 'bs-hdr-frame' } },

  // Quadrant 1: Problem / Prompt
  { id: 'bs-q1-frame', data: { kind: ShapeKind.Rect, x: 60, y: 130, w: 435, h: 360, color: '#f59e0b', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '1. Problem & Challenge' } },
  { id: 'bs-q1-n1', data: { kind: ShapeKind.Note, x: 85, y: 180, w: 180, h: 140, text: 'How might we simplify peer collaboration for non-technical users?', color: '#1e293b', bgColor: '#fef3c7', frameId: 'bs-q1-frame' } },
  { id: 'bs-q1-n2', data: { kind: ShapeKind.Note, x: 285, y: 180, w: 180, h: 140, text: 'What are the main friction points during board onboarding?', color: '#1e293b', bgColor: '#fef3c7', frameId: 'bs-q1-frame' } },

  // Quadrant 2: Wild Ideas
  { id: 'bs-q2-frame', data: { kind: ShapeKind.Rect, x: 525, y: 130, w: 435, h: 360, color: '#3b82f6', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '2. Wild Ideas (Diverge)' } },
  { id: 'bs-q2-n1', data: { kind: ShapeKind.Note, x: 550, y: 180, w: 180, h: 140, text: 'Instant QR code scan to join from mobile browser', color: '#1e293b', bgColor: '#dbeafe', frameId: 'bs-q2-frame' } },
  { id: 'bs-q2-n2', data: { kind: ShapeKind.Note, x: 750, y: 180, w: 180, h: 140, text: 'Live audio/laser pointers with collaborator color aura', color: '#1e293b', bgColor: '#dbeafe', frameId: 'bs-q2-frame' } },

  // Quadrant 3: Emerging Themes
  { id: 'bs-q3-frame', data: { kind: ShapeKind.Rect, x: 60, y: 510, w: 435, h: 340, color: '#10b981', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '3. Emerging Themes' } },
  { id: 'bs-q3-n1', data: { kind: ShapeKind.Note, x: 85, y: 560, w: 180, h: 130, text: 'Zero-configuration sharing without accounts', color: '#1e293b', bgColor: '#dcfce7', frameId: 'bs-q3-frame' } },
  { id: 'bs-q3-n2', data: { kind: ShapeKind.Note, x: 285, y: 560, w: 180, h: 130, text: 'Familiar gesture ergonomics from Miro/Figma', color: '#1e293b', bgColor: '#dcfce7', frameId: 'bs-q3-frame' } },

  // Quadrant 4: Next Steps & Owners
  { id: 'bs-q4-frame', data: { kind: ShapeKind.Rect, x: 525, y: 510, w: 435, h: 340, color: '#ec4899', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '4. Next Steps & Owners' } },
  { id: 'bs-q4-n1', data: { kind: ShapeKind.Note, x: 550, y: 560, w: 180, h: 130, text: 'Spike template preview and duplication flow [Done]', color: '#1e293b', bgColor: '#fce7f3', frameId: 'bs-q4-frame' } },
  { id: 'bs-q4-n2', data: { kind: ShapeKind.Note, x: 750, y: 560, w: 180, h: 130, text: 'Run 2-peer smoke test on local network', color: '#1e293b', bgColor: '#fce7f3', frameId: 'bs-q4-frame' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// Template 2: Agile Sprint Retrospective
// ─────────────────────────────────────────────────────────────────────────────

const retroV1Shapes: Array<{ id: string; data: ShapeData }> = [
  { id: 'r1-c1', data: { kind: ShapeKind.Rect, x: 80, y: 80, w: 260, h: 480, color: '#10b981', fillOpacity: 0.05, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'What Went Well' } },
  { id: 'r1-n1', data: { kind: ShapeKind.Note, x: 105, y: 130, w: 210, h: 120, text: 'CRDT conflict detection worked seamlessly', color: '#1e293b', bgColor: '#dcfce7', frameId: 'r1-c1' } },
  { id: 'r1-c2', data: { kind: ShapeKind.Rect, x: 370, y: 80, w: 260, h: 480, color: '#ef4444', fillOpacity: 0.05, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'What Could Be Better' } },
  { id: 'r1-n2', data: { kind: ShapeKind.Note, x: 395, y: 130, w: 210, h: 120, text: 'Touch panning on trackpads needed calibration', color: '#1e293b', bgColor: '#fee2e2', frameId: 'r1-c2' } },
  { id: 'r1-c3', data: { kind: ShapeKind.Rect, x: 660, y: 80, w: 260, h: 480, color: '#3b82f6', fillOpacity: 0.05, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'Action Items' } },
  { id: 'r1-n3', data: { kind: ShapeKind.Note, x: 685, y: 130, w: 210, h: 120, text: 'Tune pinch-to-zoom curves for mid-range devices', color: '#1e293b', bgColor: '#dbeafe', frameId: 'r1-c3' } },
];

const retroV2Shapes: Array<{ id: string; data: ShapeData }> = [
  // Header
  { id: 'r2-header', data: { kind: ShapeKind.Rect, x: 50, y: 40, w: 1060, h: 65, color: '#6366f1', fillOpacity: 0.06, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'Sprint Retrospective' } },
  { id: 'r2-guide', data: { kind: ShapeKind.Text, x: 70, y: 80, text: 'Stage 1: Gather notes  →  Stage 2: Cluster themes  →  Stage 3: Dot vote (3 votes/person)  →  Stage 4: Commit action items', color: '#a5b4fc', frameId: 'r2-header' } },

  // Column 1: Went Well (Green)
  { id: 'r2-c1', data: { kind: ShapeKind.Rect, x: 50, y: 125, w: 245, h: 500, color: '#10b981', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '1. What Went Well 🌟' } },
  { id: 'r2-n1', data: { kind: ShapeKind.Note, x: 70, y: 180, w: 205, h: 120, text: 'Offline-first sync survived Wi-Fi dropouts cleanly', color: '#1e293b', bgColor: '#dcfce7', frameId: 'r2-c1' } },
  { id: 'r2-n2', data: { kind: ShapeKind.Note, x: 70, y: 320, w: 205, h: 120, text: 'Frame-aware transforms keep contained notes intact', color: '#1e293b', bgColor: '#dcfce7', frameId: 'r2-c1' } },

  // Column 2: Hard / Needs Improvement (Red)
  { id: 'r2-c2', data: { kind: ShapeKind.Rect, x: 320, y: 125, w: 245, h: 500, color: '#ef4444', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '2. What Was Hard 🧩' } },
  { id: 'r2-n3', data: { kind: ShapeKind.Note, x: 340, y: 180, w: 205, h: 120, text: 'Duplicate board flow was missing from the library', color: '#1e293b', bgColor: '#fee2e2', frameId: 'r2-c2' } },
  { id: 'r2-n4', data: { kind: ShapeKind.Note, x: 340, y: 320, w: 205, h: 120, text: 'Stencil previews were missing curated starters', color: '#1e293b', bgColor: '#fee2e2', frameId: 'r2-c2' } },

  // Column 3: Ideas & Experiments (Amber)
  { id: 'r2-c3', data: { kind: ShapeKind.Rect, x: 590, y: 125, w: 245, h: 500, color: '#f59e0b', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '3. Ideas & Try 💡' } },
  { id: 'r2-n5', data: { kind: ShapeKind.Note, x: 610, y: 180, w: 205, h: 120, text: 'Add direct 1-click duplicate button to board cards', color: '#1e293b', bgColor: '#fef3c7', frameId: 'r2-c3' } },
  { id: 'r2-n6', data: { kind: ShapeKind.Note, x: 610, y: 320, w: 205, h: 120, text: 'Version curated templates with clear changelogs', color: '#1e293b', bgColor: '#fef3c7', frameId: 'r2-c3' } },

  // Column 4: Committed Action Items (Blue)
  { id: 'r2-c4', data: { kind: ShapeKind.Rect, x: 860, y: 125, w: 250, h: 500, color: '#3b82f6', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '4. Action Items 🎯' } },
  { id: 'r2-n7', data: { kind: ShapeKind.Note, x: 880, y: 180, w: 210, h: 120, text: 'Ship board duplication flow with safe ID remapping', color: '#1e293b', bgColor: '#dbeafe', frameId: 'r2-c4' } },
  { id: 'r2-n8', data: { kind: ShapeKind.Note, x: 880, y: 320, w: 210, h: 120, text: 'Add template preview dock with version selector', color: '#1e293b', bgColor: '#dbeafe', frameId: 'r2-c4' } },

  // Connectors linking hard points to committed action items
  { id: 'r2-arrow1', data: { kind: ShapeKind.Line, x1: 545, y1: 240, x2: 880, y2: 240, color: '#6366f1', width: 2, arrowEnd: true, startShapeId: 'r2-n3', endShapeId: 'r2-n7' } },
  { id: 'r2-arrow2', data: { kind: ShapeKind.Line, x1: 815, y1: 380, x2: 880, y2: 380, color: '#6366f1', width: 2, arrowEnd: true, startShapeId: 'r2-n6', endShapeId: 'r2-n8' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// Template 3: Kanban Delivery Board
// ─────────────────────────────────────────────────────────────────────────────

const kanbanV1Shapes: Array<{ id: string; data: ShapeData }> = [
  { id: 'k1-c1', data: { kind: ShapeKind.Rect, x: 80, y: 80, w: 240, h: 500, color: '#64748b', fillOpacity: 0.05, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'Backlog' } },
  { id: 'k1-n1', data: { kind: ShapeKind.Note, x: 100, y: 130, w: 200, h: 110, text: 'Research WebRTC turn fallbacks', color: '#1e293b', bgColor: '#fef3c7', frameId: 'k1-c1' } },
  { id: 'k1-c2', data: { kind: ShapeKind.Rect, x: 350, y: 80, w: 240, h: 500, color: '#f59e0b', fillOpacity: 0.05, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'In Progress' } },
  { id: 'k1-n2', data: { kind: ShapeKind.Note, x: 370, y: 130, w: 200, h: 110, text: 'Stencil library quota handling', color: '#1e293b', bgColor: '#dbeafe', frameId: 'k1-c2' } },
  { id: 'k1-c3', data: { kind: ShapeKind.Rect, x: 620, y: 80, w: 240, h: 500, color: '#10b981', fillOpacity: 0.05, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'Done' } },
  { id: 'k1-n3', data: { kind: ShapeKind.Note, x: 640, y: 130, w: 200, h: 110, text: 'Arrow endpoint magnetic snap', color: '#1e293b', bgColor: '#dcfce7', frameId: 'k1-c3' } },
];

const kanbanV2Shapes: Array<{ id: string; data: ShapeData }> = [
  // Board Header
  { id: 'kb-hdr', data: { kind: ShapeKind.Rect, x: 40, y: 40, w: 1080, h: 65, color: '#0ea5e9', fillOpacity: 0.05, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'Kanban Delivery Flow' } },
  { id: 'kb-desc', data: { kind: ShapeKind.Text, x: 60, y: 80, text: 'Columns reflect continuous delivery. WIP limits are enforced per stage to maintain throughput.', color: '#7dd3fc', frameId: 'kb-hdr' } },

  // Column 1: Backlog
  { id: 'kb-c1', data: { kind: ShapeKind.Rect, x: 40, y: 125, w: 250, h: 520, color: '#64748b', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '1. Backlog' } },
  { id: 'kb-c1-t1', data: { kind: ShapeKind.Note, x: 60, y: 180, w: 210, h: 120, text: '[STORY-104] Spatial index for off-screen rendering', color: '#1e293b', bgColor: '#f1f5f9', frameId: 'kb-c1' } },
  { id: 'kb-c1-t2', data: { kind: ShapeKind.Note, x: 60, y: 320, w: 210, h: 120, text: '[SPIKE-105] Presentation mode view-only link token', color: '#1e293b', bgColor: '#f1f5f9', frameId: 'kb-c1' } },

  // Column 2: In Progress (WIP: 3)
  { id: 'kb-c2', data: { kind: ShapeKind.Rect, x: 315, y: 125, w: 250, h: 520, color: '#f59e0b', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '2. In Progress (WIP 3)' } },
  { id: 'kb-c2-t1', data: { kind: ShapeKind.Note, x: 335, y: 180, w: 210, h: 120, text: '[FEAT-13] Duplicate board flow with clean remapping', color: '#1e293b', bgColor: '#fef3c7', frameId: 'kb-c2' } },
  { id: 'kb-c2-t2', data: { kind: ShapeKind.Note, x: 335, y: 320, w: 210, h: 120, text: '[FEAT-13] Curated template previews & versioning', color: '#1e293b', bgColor: '#fef3c7', frameId: 'kb-c2' } },

  // Column 3: In Review / QA
  { id: 'kb-c3', data: { kind: ShapeKind.Rect, x: 590, y: 125, w: 250, h: 520, color: '#8b5cf6', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '3. In Review' } },
  { id: 'kb-c3-t1', data: { kind: ShapeKind.Note, x: 610, y: 180, w: 210, h: 120, text: '[FIX-88] Stencil storage quota check & capacity alerts', color: '#1e293b', bgColor: '#ede9fe', frameId: 'kb-c3' } },

  // Column 4: Done
  { id: 'kb-c4', data: { kind: ShapeKind.Rect, x: 865, y: 125, w: 255, h: 520, color: '#10b981', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: '4. Done' } },
  { id: 'kb-c4-t1', data: { kind: ShapeKind.Note, x: 885, y: 180, w: 215, h: 120, text: '[FEAT-12] Stencil library version history (up to 10)', color: '#1e293b', bgColor: '#dcfce7', frameId: 'kb-c4' } },
  { id: 'kb-c4-t2', data: { kind: ShapeKind.Note, x: 885, y: 320, w: 215, h: 120, text: '[CORE-44] Frame child transform synchronization', color: '#1e293b', bgColor: '#dcfce7', frameId: 'kb-c4' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// Template 4: System Architecture Blueprint
// ─────────────────────────────────────────────────────────────────────────────

const archV1Shapes: Array<{ id: string; data: ShapeData }> = [
  { id: 'a1-client', data: { kind: ShapeKind.Rect, x: 80, y: 180, w: 160, h: 90, color: '#3b82f6', fillOpacity: 0.1, strokeWidth: 2, cornerRadius: 6 } },
  { id: 'a1-t1', data: { kind: ShapeKind.Text, x: 105, y: 230, text: 'Web Client', color: '#93c5fd' } },
  { id: 'a1-server', data: { kind: ShapeKind.Rect, x: 340, y: 180, w: 160, h: 90, color: '#8b5cf6', fillOpacity: 0.1, strokeWidth: 2, cornerRadius: 6 } },
  { id: 'a1-t2', data: { kind: ShapeKind.Text, x: 360, y: 230, text: 'Signaling Hub', color: '#c4b5fd' } },
  { id: 'a1-db', data: { kind: ShapeKind.Ellipse, cx: 660, cy: 225, rx: 75, ry: 45, color: '#10b981', fillOpacity: 0.1, strokeWidth: 2 } },
  { id: 'a1-t3', data: { kind: ShapeKind.Text, x: 620, y: 230, text: 'Local IDB', color: '#6ee7b7' } },
  { id: 'a1-l1', data: { kind: ShapeKind.Line, x1: 240, y1: 225, x2: 340, y2: 225, color: '#a78bfa', width: 2, arrowEnd: true, startShapeId: 'a1-client', endShapeId: 'a1-server' } },
  { id: 'a1-l2', data: { kind: ShapeKind.Line, x1: 500, y1: 225, x2: 585, y2: 225, color: '#a78bfa', width: 2, arrowEnd: true, startShapeId: 'a1-server', endShapeId: 'a1-db' } },
];

const archV2Shapes: Array<{ id: string; data: ShapeData }> = [
  // Title Frame
  { id: 'arch-hdr', data: { kind: ShapeKind.Rect, x: 50, y: 30, w: 980, h: 60, color: '#6366f1', fillOpacity: 0.05, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'P2P CRDT Collaboration Architecture' } },
  { id: 'arch-hdr-txt', data: { kind: ShapeKind.Text, x: 70, y: 68, text: 'Local-first architecture: edits commit directly to local Yjs Doc and persist to IndexedDB, syncing via WebRTC.', color: '#c7d2fe', frameId: 'arch-hdr' } },

  // Tier 1: Clients Frame
  { id: 'arch-f-client', data: { kind: ShapeKind.Rect, x: 50, y: 110, w: 260, h: 420, color: '#3b82f6', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'Client Tier (Browser)' } },
  { id: 'arch-c-peer1', data: { kind: ShapeKind.Rect, x: 75, y: 165, w: 210, h: 80, color: '#3b82f6', fillOpacity: 0.12, strokeWidth: 1.5, cornerRadius: 6, frameId: 'arch-f-client' } },
  { id: 'arch-t-peer1', data: { kind: ShapeKind.Text, x: 95, y: 210, text: 'Peer Alice (Yjs + Canvas)', color: '#93c5fd', frameId: 'arch-f-client' } },
  { id: 'arch-c-peer2', data: { kind: ShapeKind.Rect, x: 75, y: 275, w: 210, h: 80, color: '#3b82f6', fillOpacity: 0.12, strokeWidth: 1.5, cornerRadius: 6, frameId: 'arch-f-client' } },
  { id: 'arch-t-peer2', data: { kind: ShapeKind.Text, x: 95, y: 320, text: 'Peer Bob (Yjs + Canvas)', color: '#93c5fd', frameId: 'arch-f-client' } },
  { id: 'arch-c-idb', data: { kind: ShapeKind.Ellipse, cx: 180, cy: 440, rx: 90, ry: 40, color: '#10b981', fillOpacity: 0.12, strokeWidth: 1.5, frameId: 'arch-f-client' } },
  { id: 'arch-t-idb', data: { kind: ShapeKind.Text, x: 125, y: 445, text: 'IndexedDB Store', color: '#6ee7b7', frameId: 'arch-f-client' } },

  // Tier 2: Signaling & Coordination Frame
  { id: 'arch-f-network', data: { kind: ShapeKind.Rect, x: 390, y: 110, w: 280, h: 420, color: '#8b5cf6', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'Transport & Coordination' } },
  { id: 'arch-c-signal', data: { kind: ShapeKind.Rect, x: 420, y: 165, w: 220, h: 90, color: '#8b5cf6', fillOpacity: 0.14, strokeWidth: 1.5, cornerRadius: 6, frameId: 'arch-f-network' } },
  { id: 'arch-t-signal', data: { kind: ShapeKind.Text, x: 440, y: 215, text: 'WebSocket Signaling Relay', color: '#ddd6fe', frameId: 'arch-f-network' } },
  { id: 'arch-c-mesh', data: { kind: ShapeKind.Rect, x: 420, y: 300, w: 220, h: 90, color: '#a855f7', fillOpacity: 0.14, strokeWidth: 1.5, cornerRadius: 6, frameId: 'arch-f-network' } },
  { id: 'arch-t-mesh', data: { kind: ShapeKind.Text, x: 445, y: 350, text: 'Direct WebRTC DataChannels', color: '#f3e8ff', frameId: 'arch-f-network' } },

  // Tier 3: Storage & Snapshot Frame
  { id: 'arch-f-backup', data: { kind: ShapeKind.Rect, x: 750, y: 110, w: 280, h: 420, color: '#ec4899', fillOpacity: 0.04, strokeWidth: 1.5, cornerRadius: 8, frameTitle: 'Recovery & Templates' } },
  { id: 'arch-c-stencils', data: { kind: ShapeKind.Rect, x: 780, y: 165, w: 220, h: 90, color: '#ec4899', fillOpacity: 0.12, strokeWidth: 1.5, cornerRadius: 6, frameId: 'arch-f-backup' } },
  { id: 'arch-t-stencils', data: { kind: ShapeKind.Text, x: 800, y: 215, text: 'Stencil Library (10 versions)', color: '#fbcfe8', frameId: 'arch-f-backup' } },
  { id: 'arch-c-dup', data: { kind: ShapeKind.Rect, x: 780, y: 300, w: 220, h: 90, color: '#f43f5e', fillOpacity: 0.12, strokeWidth: 1.5, cornerRadius: 6, frameId: 'arch-f-backup' } },
  { id: 'arch-t-dup', data: { kind: ShapeKind.Text, x: 805, y: 350, text: 'Board Duplication Engine', color: '#fecdd3', frameId: 'arch-f-backup' } },

  // Interconnecting Lines / Arrows
  { id: 'arch-l-webrtc', data: { kind: ShapeKind.Line, x1: 285, y1: 205, x2: 420, y2: 205, color: '#8b5cf6', width: 2, arrowEnd: true, startShapeId: 'arch-c-peer1', endShapeId: 'arch-c-signal' } },
  { id: 'arch-l-p2p', data: { kind: ShapeKind.Line, x1: 285, y1: 315, x2: 420, y2: 345, color: '#38bdf8', width: 2, arrowEnd: true, startShapeId: 'arch-c-peer2', endShapeId: 'arch-c-mesh' } },
  { id: 'arch-l-save', data: { kind: ShapeKind.Line, x1: 640, y1: 210, x2: 780, y2: 210, color: '#f472b6', width: 2, arrowEnd: true, startShapeId: 'arch-c-signal', endShapeId: 'arch-c-stencils' } },
];

export const CURATED_TEMPLATES: CuratedTemplate[] = [
  {
    id: 'brainstorming-grid',
    title: 'Brainstorm & Ideation',
    description: 'Quadrants for problem statement, wild ideas, themes, and actionable next steps with pre-placed sticky notes.',
    category: 'ideation',
    versions: [
      {
        version: 1,
        versionName: 'v1.0 Basic Quadrants',
        releaseDate: '2026-08-10',
        changelog: 'Initial 4-quadrant note starter layout.',
        shapes: brainstormV1Shapes,
      },
      {
        version: 2,
        versionName: 'v2.0 Structured Frames',
        releaseDate: '2026-09-15',
        changelog: 'Added dedicated container frames, high-contrast prompt notes, and facilitation guidance.',
        shapes: brainstormV2Shapes,
      },
    ],
  },
  {
    id: 'sprint-retrospective',
    title: 'Sprint Retrospective',
    description: 'Collaborative retrospective with What Went Well, What Was Hard, Ideas, and Action Items connected by arrow lines.',
    category: 'agile',
    versions: [
      {
        version: 1,
        versionName: 'v1.0 3-Column Retro',
        releaseDate: '2026-08-01',
        changelog: 'Three columns for quick team retrospectives.',
        shapes: retroV1Shapes,
      },
      {
        version: 2,
        versionName: 'v2.0 4-Stage Guided Retro',
        releaseDate: '2026-09-20',
        changelog: 'Added stage banner, Glad/Hard/Idea columns, and magnetic connector lines attaching notes to action items.',
        shapes: retroV2Shapes,
      },
    ],
  },
  {
    id: 'kanban-flow',
    title: 'Kanban Delivery Board',
    description: 'Visual workflow with Backlog, In Progress with WIP limit 3, In Review, and Done column frames.',
    category: 'planning',
    versions: [
      {
        version: 1,
        versionName: 'v1.0 Simple 3-Column',
        releaseDate: '2026-08-15',
        changelog: 'Backlog, In Progress, Done columns.',
        shapes: kanbanV1Shapes,
      },
      {
        version: 2,
        versionName: 'v2.0 WIP-Limited Kanban',
        releaseDate: '2026-09-25',
        changelog: 'Added WIP limit indicators, In Review column, story card badges, and status colors.',
        shapes: kanbanV2Shapes,
      },
    ],
  },
  {
    id: 'system-architecture',
    title: 'System Architecture Blueprint',
    description: 'Service boundaries, API gateways, IndexedDB persistence, and peer-to-peer WebRTC data channels with directional connectors.',
    category: 'engineering',
    versions: [
      {
        version: 1,
        versionName: 'v1.0 Client-Server Simple',
        releaseDate: '2026-07-20',
        changelog: 'Basic client, server, and local database nodes.',
        shapes: archV1Shapes,
      },
      {
        version: 2,
        versionName: 'v2.0 Multi-Tier P2P Blueprint',
        releaseDate: '2026-09-28',
        changelog: 'Tiered client browser frames, WebRTC mesh coordination, and snapshot recovery engine nodes.',
        shapes: archV2Shapes,
      },
    ],
  },
];

/**
 * Instantiates a curated template with all fresh UUIDs and remapped internal
 * references (groups, frames, connector targets) so it is 100% independent.
 */
export function instantiateTemplate(
  template: CuratedTemplate,
  versionNumber?: number,
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 }
): Array<{ id: string; data: ShapeData }> {
  const version = versionNumber !== undefined
    ? template.versions.find(v => v.version === versionNumber) ?? template.versions[template.versions.length - 1]
    : template.versions[template.versions.length - 1];

  return cloneBoardShapes(version.shapes, offset);
}
