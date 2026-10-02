import { describe, it, expect } from 'vitest';
import { ShapeKind, type ShapeData } from '@crdt-canvas/engine';
import { cloneBoardShapes, generateRoomId } from '../boardDuplication';
import {
  CURATED_TEMPLATES,
  instantiateTemplate,
} from '../../templates/curatedTemplates';

describe('boardDuplication', () => {
  it('generates unique 8-character room IDs', () => {
    const id1 = generateRoomId();
    const id2 = generateRoomId();
    expect(id1).toHaveLength(8);
    expect(id2).toHaveLength(8);
    expect(id1).not.toBe(id2);
  });

  it('clones shapes and assigns fresh unique IDs', () => {
    const source: Array<{ id: string; data: ShapeData }> = [
      { id: 's1', data: { kind: ShapeKind.Rect, x: 10, y: 10, w: 100, h: 50, color: '#f00' } },
      { id: 's2', data: { kind: ShapeKind.Note, x: 120, y: 10, w: 80, h: 80, text: 'Hello', color: '#000', bgColor: '#ff0' } },
    ];
    const cloned = cloneBoardShapes(source);

    expect(cloned).toHaveLength(2);
    expect(cloned[0].id).not.toBe('s1');
    expect(cloned[1].id).not.toBe('s2');
    expect(cloned[0].id).not.toBe(cloned[1].id);
    expect(cloned[0].data.kind).toBe(ShapeKind.Rect);
    expect(cloned[1].data.kind).toBe(ShapeKind.Note);
  });

  it('remaps group IDs, frame IDs, and connector start/end shape IDs', () => {
    const source: Array<{ id: string; data: ShapeData }> = [
      // Frame container
      { id: 'frame-1', data: { kind: ShapeKind.Rect, x: 0, y: 0, w: 400, h: 300, color: '#888', frameTitle: 'Main Frame' } },
      // Child note inside frame and inside group
      { id: 'note-1', data: { kind: ShapeKind.Note, x: 20, y: 20, w: 100, h: 100, text: 'Note 1', color: '#000', bgColor: '#fff', frameId: 'frame-1', groupId: 'group-A' } },
      // Target note inside frame and inside group
      { id: 'note-2', data: { kind: ShapeKind.Note, x: 150, y: 20, w: 100, h: 100, text: 'Note 2', color: '#000', bgColor: '#fff', frameId: 'frame-1', groupId: 'group-A' } },
      // Connector linking note-1 to note-2
      { id: 'line-1', data: { kind: ShapeKind.Line, x1: 70, y1: 70, x2: 200, y2: 70, color: '#00f', width: 2, arrowEnd: true, startShapeId: 'note-1', endShapeId: 'note-2' } },
    ];

    const cloned = cloneBoardShapes(source);
    expect(cloned).toHaveLength(4);

    const [clonedFrame, clonedNote1, clonedNote2, clonedLine] = cloned;

    // Frame remapped
    expect(clonedFrame.id).not.toBe('frame-1');

    // Child note frameId points to cloned frame ID
    expect(clonedNote1.data.frameId).toBe(clonedFrame.id);
    expect(clonedNote2.data.frameId).toBe(clonedFrame.id);

    // Group ID remapped to a fresh shared group ID
    expect(clonedNote1.data.groupId).toBeDefined();
    expect(clonedNote1.data.groupId).not.toBe('group-A');
    expect(clonedNote1.data.groupId).toBe(clonedNote2.data.groupId);

    // Connector endpoints remapped to cloned note IDs
    expect(clonedLine.data.kind).toBe(ShapeKind.Line);
    if (clonedLine.data.kind === ShapeKind.Line) {
      expect(clonedLine.data.startShapeId).toBe(clonedNote1.id);
      expect(clonedLine.data.endShapeId).toBe(clonedNote2.id);
    }
  });

  it('instantiates all curated templates with valid remapped shapes', () => {
    for (const template of CURATED_TEMPLATES) {
      expect(template.versions.length).toBeGreaterThanOrEqual(1);

      // Latest version
      const latestShapes = instantiateTemplate(template);
      expect(latestShapes.length).toBeGreaterThan(0);

      // Verify all shapes have valid non-empty IDs
      const ids = new Set(latestShapes.map(s => s.id));
      expect(ids.size).toBe(latestShapes.length);

      // Version 1
      const v1Shapes = instantiateTemplate(template, 1);
      expect(v1Shapes.length).toBeGreaterThan(0);
    }
  });
});
