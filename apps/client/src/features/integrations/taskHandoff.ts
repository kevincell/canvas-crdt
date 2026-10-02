import {
  type Shape,
  ShapeKind,
} from '@crdt-canvas/engine';

export interface ExportableTask {
  id: string;
  title: string;
  description: string;
  category: string;
  color: string;
  sourceShapeKind: string;
  tags: string[];
}

export interface TaskHandoffPayload {
  boardTitle: string;
  exportedAt: string;
  totalTasks: number;
  dataBoundaries: {
    includesPrivateKeys: boolean;
    includesCrdtVectorClocks: boolean;
    includesDeletedShapes: boolean;
  };
  tasks: ExportableTask[];
}

/**
 * Extracts structured tasks from shapes with explicit data boundaries:
 * excludes CRDT vector clocks, deleted objects, and private session tokens.
 */
export function extractTasksFromShapes(
  shapes: Shape[],
  selectedScope: 'all' | 'selected' | string,
  selectedIds: string[],
  boardTitle: string
): TaskHandoffPayload {
  const activeShapes = shapes.filter(s => !s.deleted);

  // Map frames for category lookup
  const frameMap = new Map<string, string>();
  for (const s of activeShapes) {
    if (s.data.kind === ShapeKind.Rect && s.data.frameTitle) {
      frameMap.set(s.id, s.data.frameTitle);
    }
  }

  // Determine which shapes to include
  let candidateShapes = activeShapes;
  if (selectedScope === 'selected' && selectedIds.length > 0) {
    candidateShapes = activeShapes.filter(s => selectedIds.includes(s.id));
  } else if (selectedScope !== 'all' && frameMap.has(selectedScope)) {
    // Specific frame selected
    candidateShapes = activeShapes.filter(s => s.id === selectedScope || s.data.frameId === selectedScope);
  }

  // Filter to notes and text shapes that represent ideas/tasks
  const tasks: ExportableTask[] = [];

  for (const shape of candidateShapes) {
    const data = shape.data;
    if (data.kind === ShapeKind.Note) {
      const lines = data.text.trim().split('\n').filter(Boolean);
      const title = lines[0] || 'Untitled Task';
      const description = lines.slice(1).join('\n');
      const category = (data.frameId && frameMap.get(data.frameId)) || 'General';

      tasks.push({
        id: shape.id,
        title,
        description,
        category,
        color: data.bgColor,
        sourceShapeKind: ShapeKind.Note,
        tags: [category.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
      });
    } else if (data.kind === ShapeKind.Text && data.text.trim().length > 0) {
      const lines = data.text.trim().split('\n').filter(Boolean);
      const title = lines[0] || 'Note';
      const description = lines.slice(1).join('\n');
      const category = (data.frameId && frameMap.get(data.frameId)) || 'General';

      tasks.push({
        id: shape.id,
        title,
        description,
        category,
        color: data.color,
        sourceShapeKind: ShapeKind.Text,
        tags: [category.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
      });
    }
  }

  return {
    boardTitle: boardTitle.trim() || 'Board Tasks',
    exportedAt: new Date().toISOString(),
    totalTasks: tasks.length,
    dataBoundaries: {
      includesPrivateKeys: false,
      includesCrdtVectorClocks: false,
      includesDeletedShapes: false,
    },
    tasks,
  };
}

/**
 * Formats tasks into GitHub Issues / Markdown format.
 */
export function formatAsGitHubMarkdown(payload: TaskHandoffPayload): string {
  const lines: string[] = [
    `# Tasks from ${payload.boardTitle}`,
    `> Exported at: ${payload.exportedAt} · ${payload.totalTasks} task${payload.totalTasks === 1 ? '' : 's'}`,
    '',
  ];

  // Group by category
  const categories = new Map<string, ExportableTask[]>();
  for (const task of payload.tasks) {
    const cat = task.category || 'General';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(task);
  }

  for (const [category, items] of categories.entries()) {
    lines.push(`## ${category}`);
    lines.push('');
    for (const item of items) {
      lines.push(`- [ ] **${item.title}**`);
      if (item.description) {
        lines.push(`  ${item.description.replace(/\n/g, '\n  ')}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Formats tasks into CSV compatible with Jira, Linear, or Excel.
 */
export function formatAsCsv(payload: TaskHandoffPayload): string {
  const header = ['"Title"', '"Description"', '"Category"', '"Source"', '"Board"'].join(',');
  const rows = payload.tasks.map(t => {
    const escapeCsv = (str: string) => `"${str.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    return [
      escapeCsv(t.title),
      escapeCsv(t.description),
      escapeCsv(t.category),
      escapeCsv(t.sourceShapeKind),
      escapeCsv(payload.boardTitle),
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Dispatches the consent-bounded payload to an external webhook endpoint.
 */
export async function dispatchTaskHandoffWebhook(
  webhookUrl: string,
  payload: TaskHandoffPayload
): Promise<{ success: boolean; message: string }> {
  try {
    const parsed = new URL(webhookUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP and HTTPS webhook endpoints are allowed.');
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook endpoint responded with status ${response.status}: ${response.statusText}`);
    }

    return {
      success: true,
      message: `Successfully dispatched ${payload.totalTasks} tasks to ${parsed.host}.`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Failed to send webhook.',
    };
  }
}
