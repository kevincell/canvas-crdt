import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';

export interface BoardComment {
  id: string;
  shapeId: string | null;
  anchor: { x: number; y: number } | null;
  actor: string;
  text: string;
  ts: number;
  resolved: boolean;
  reactions: Record<string, number>;
  myReaction: string | null;
}

const ALLOWED_REACTIONS = new Set(['👍', '❤️', '👀']);

export function useBoardComments(doc: Y.Doc | null, actorName: string, actorId = actorName) {
  const [comments, setComments] = useState<BoardComment[]>([]);

  useEffect(() => {
    if (!doc) { setComments([]); return; }
    const sharedComments = doc.getArray<Y.Map<unknown>>('comments');
    const sync = () => {
      const actorKey = actorId.trim().toLocaleLowerCase();
      const next = sharedComments.toArray().map(item => {
        const reactions = item.get('reactions');
        const reactionCounts: Record<string, number> = {};
        let myReaction: string | null = null;
        if (reactions instanceof Y.Map) {
          for (const reaction of reactions.values()) if (typeof reaction === 'string' && ALLOWED_REACTIONS.has(reaction)) reactionCounts[reaction] = (reactionCounts[reaction] ?? 0) + 1;
          const mine = reactions.get(actorKey);
          if (typeof mine === 'string' && ALLOWED_REACTIONS.has(mine)) myReaction = mine;
        }
        return {
          id: String(item.get('id') ?? ''),
          shapeId: (item.get('shapeId') as string | null) ?? null,
          anchor: (item.get('anchor') as BoardComment['anchor']) ?? null,
          actor: String(item.get('actor') ?? 'Someone'),
          text: String(item.get('text') ?? ''),
          ts: Number(item.get('ts') ?? 0),
          resolved: Boolean(item.get('resolved')),
          reactions: reactionCounts,
          myReaction,
        };
      }).filter(comment => comment.id && comment.text);
      setComments(next.sort((a, b) => a.ts - b.ts));
    };
    sharedComments.observeDeep(sync);
    sync();
    return () => sharedComments.unobserveDeep(sync);
  }, [doc, actorId]);

  const addComment = useCallback((input: Omit<BoardComment, 'id' | 'ts' | 'resolved' | 'reactions' | 'myReaction'>) => {
    if (!doc || !input.text.trim()) return;
    const comment = new Y.Map<unknown>();
    comment.set('id', crypto.randomUUID());
    comment.set('shapeId', input.shapeId);
    comment.set('anchor', input.anchor);
    comment.set('actor', input.actor);
    comment.set('text', input.text.trim());
    comment.set('ts', Date.now());
    comment.set('resolved', false);
    comment.set('reactions', new Y.Map<string>());
    doc.getArray<Y.Map<unknown>>('comments').push([comment]);
  }, [doc]);

  const resolveComment = useCallback((id: string, resolved: boolean) => {
    if (!doc) return;
    const comment = doc.getArray<Y.Map<unknown>>('comments').toArray().find(item => item.get('id') === id);
    comment?.set('resolved', resolved);
  }, [doc]);

  const toggleReaction = useCallback((id: string, actor: string, emoji: string) => {
    if (!doc || !ALLOWED_REACTIONS.has(emoji)) return;
    const comment = doc.getArray<Y.Map<unknown>>('comments').toArray().find(item => item.get('id') === id);
    if (!comment) return;
    const reactions = comment.get('reactions');
    const map = reactions instanceof Y.Map ? reactions as Y.Map<string> : new Y.Map<string>();
    if (!(reactions instanceof Y.Map)) comment.set('reactions', map);
    const key = actor.trim().toLocaleLowerCase();
    if (!key) return;
    doc.transact(() => map.get(key) === emoji ? map.delete(key) : map.set(key, emoji), 'comment-reaction');
  }, [doc]);

  return { comments, addComment, resolveComment, toggleReaction };
}
