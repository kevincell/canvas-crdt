import { describe, it, expect, vi } from 'vitest';
import {
  extractTasksFromShapes,
  formatAsGitHubMarkdown,
  formatAsCsv,
  dispatchTaskHandoffWebhook,
} from '../taskHandoff';
import { ShapeKind, type Shape } from '@crdt-canvas/engine';

// Helper to build test Shape fixtures without needing CRDT metadata fields
function makeShape(id: string, data: Shape['data']): Shape {
  return { id, deleted: false, data } as unknown as Shape;
}

describe('taskHandoff', () => {
  const sampleFrame = makeShape('frame-1', {
    kind: ShapeKind.Rect,
    x: 0,
    y: 0,
    w: 800,
    h: 600,
    color: '#ffffff',
    frameTitle: 'Sprint Backlog',
  });

  const sampleNote1 = makeShape('note-1', {
    kind: ShapeKind.Note,
    x: 100,
    y: 100,
    w: 160,
    h: 140,
    text: 'Implement CRDT Sync\nAdd WebRTC peer synchronization',
    color: '#1e293b',
    bgColor: '#fef08a',
    frameId: 'frame-1',
  });

  const sampleNote2 = makeShape('note-2', {
    kind: ShapeKind.Note,
    x: 300,
    y: 100,
    w: 160,
    h: 140,
    text: 'Design Stencil System',
    color: '#1e293b',
    bgColor: '#bfdbfe',
  });

  const deletedNote: Shape = {
    ...makeShape('note-deleted', {
      kind: ShapeKind.Note,
      x: 0,
      y: 0,
      w: 160,
      h: 140,
      text: 'Old Task Should Not Appear',
      color: '#000',
      bgColor: '#fff',
    }),
    deleted: true,
  };

  const strokeShape = makeShape('stroke-1', {
    kind: ShapeKind.Stroke,
    points: [{ x: 10, y: 10 }],
    color: '#f00',
    width: 2,
  });

  it('extracts tasks with explicit data boundaries (excluding deleted shapes and non-task items)', () => {
    const payload = extractTasksFromShapes(
      [sampleFrame, sampleNote1, sampleNote2, deletedNote, strokeShape],
      'all',
      [],
      'Product Launch Board'
    );

    expect(payload.boardTitle).toBe('Product Launch Board');
    expect(payload.totalTasks).toBe(2);
    expect(payload.dataBoundaries.includesDeletedShapes).toBe(false);
    expect(payload.dataBoundaries.includesCrdtVectorClocks).toBe(false);
    expect(payload.dataBoundaries.includesPrivateKeys).toBe(false);

    expect(payload.tasks[0]).toEqual({
      id: 'note-1',
      title: 'Implement CRDT Sync',
      description: 'Add WebRTC peer synchronization',
      category: 'Sprint Backlog',
      color: '#fef08a',
      sourceShapeKind: ShapeKind.Note,
      tags: ['sprint-backlog'],
    });

    expect(payload.tasks[1]).toEqual({
      id: 'note-2',
      title: 'Design Stencil System',
      description: '',
      category: 'General',
      color: '#bfdbfe',
      sourceShapeKind: ShapeKind.Note,
      tags: ['general'],
    });
  });

  it('filters tasks by selected scope', () => {
    const payload = extractTasksFromShapes(
      [sampleFrame, sampleNote1, sampleNote2],
      'selected',
      ['note-1'],
      'Selected Only'
    );

    expect(payload.totalTasks).toBe(1);
    expect(payload.tasks[0].id).toBe('note-1');
  });

  it('filters tasks by specific frame container', () => {
    const payload = extractTasksFromShapes(
      [sampleFrame, sampleNote1, sampleNote2],
      'frame-1',
      [],
      'Frame Only'
    );

    expect(payload.totalTasks).toBe(1);
    expect(payload.tasks[0].category).toBe('Sprint Backlog');
  });

  it('formats tasks into GitHub Issues Markdown with checkboxes and categories', () => {
    const payload = extractTasksFromShapes(
      [sampleFrame, sampleNote1, sampleNote2],
      'all',
      [],
      'Sprint Roadmap'
    );

    const md = formatAsGitHubMarkdown(payload);
    expect(md).toContain('# Tasks from Sprint Roadmap');
    expect(md).toContain('## Sprint Backlog');
    expect(md).toContain('- [ ] **Implement CRDT Sync**');
    expect(md).toContain('Add WebRTC peer synchronization');
    expect(md).toContain('## General');
    expect(md).toContain('- [ ] **Design Stencil System**');
  });

  it('formats tasks into standard CSV escaping quotes and commas', () => {
    const noteWithQuotes = makeShape('note-quotes', {
      kind: ShapeKind.Note,
      x: 0,
      y: 0,
      w: 160,
      h: 140,
      text: 'Fix "Critical" Bug\nLine 1, Line 2',
      color: '#000',
      bgColor: '#fff',
    });

    const payload = extractTasksFromShapes([noteWithQuotes], 'all', [], 'CSV Board');
    const csv = formatAsCsv(payload);

    expect(csv).toContain('"Title","Description","Category","Source","Board"');
    expect(csv).toContain('"Fix ""Critical"" Bug","Line 1, Line 2","General","note","CSV Board"');
  });

  it('rejects invalid webhook URLs and dispatches fetch with valid ones', async () => {
    const payload = extractTasksFromShapes([], 'all', [], 'Empty');

    // Reject non-http(s)
    const invalidResult = await dispatchTaskHandoffWebhook('file:///etc/passwd', payload);
    expect(invalidResult.success).toBe(false);
    expect(invalidResult.message).toContain('Only HTTP and HTTPS');

    // Mock fetch
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = mockFetch;

    try {
      const result = await dispatchTaskHandoffWebhook('https://webhook.site/test-endpoint', payload);
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://webhook.site/test-endpoint',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
