import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';

export interface FacilitationState {
  voting: boolean;
  maxVotesPerPerson: number;
  voteCounts: Map<string, number>;
  remainingSeconds: number | null;
  timerLabel: string;
  timerRunning: boolean;
  retrospectiveStep: number;
}

const EMPTY_STATE: FacilitationState = {
  voting: false,
  maxVotesPerPerson: 3,
  voteCounts: new Map(),
  remainingSeconds: null,
  timerLabel: 'Team timer',
  timerRunning: false,
  retrospectiveStep: -1,
};

export function useFacilitation(doc: Y.Doc | null, actorName: string) {
  const [state, setState] = useState(EMPTY_STATE);

  useEffect(() => {
    if (!doc) { setState(EMPTY_STATE); return; }
    const voters = doc.getMap<unknown>('boardVotes');
    const settings = doc.getMap<unknown>('facilitation');
    let timer: ReturnType<typeof setInterval> | null = null;
    const sync = () => {
      const voteCounts = new Map<string, number>();
      for (const voterShapes of voters.values()) {
        if (!Array.isArray(voterShapes)) continue;
        for (const shapeId of voterShapes) {
          if (typeof shapeId === 'string') voteCounts.set(shapeId, (voteCounts.get(shapeId) ?? 0) + 1);
        }
      }
      const endsAt = Number(settings.get('timerEndsAt') ?? 0);
      const running = Number.isFinite(endsAt) && endsAt > 0;
      const remainingSeconds = running ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null;
      setState({
        voting: settings.get('voting') === true,
        maxVotesPerPerson: Math.max(1, Math.min(20, Number(settings.get('maxVotesPerPerson') ?? 3))),
        voteCounts,
        remainingSeconds,
        timerLabel: typeof settings.get('timerLabel') === 'string' ? String(settings.get('timerLabel')) : 'Team timer',
        timerRunning: running && (remainingSeconds ?? 0) > 0,
        retrospectiveStep: Math.max(-1, Math.min(3, Math.floor(Number(settings.get('retrospectiveStep') ?? -1)))),
      });
    };
    voters.observe(sync);
    settings.observe(sync);
    sync();
    timer = setInterval(sync, 1000);
    return () => {
      voters.unobserve(sync);
      settings.unobserve(sync);
      if (timer) clearInterval(timer);
    };
  }, [doc]);

  const setVoting = useCallback((enabled: boolean, maxVotesPerPerson = state.maxVotesPerPerson) => {
    if (!doc) return;
    const settings = doc.getMap<unknown>('facilitation');
    doc.transact(() => {
      settings.set('voting', enabled);
      settings.set('maxVotesPerPerson', Math.max(1, Math.min(20, Math.round(maxVotesPerPerson))));
      settings.set('votingStartedAt', enabled ? Date.now() : 0);
      if (enabled) doc.getMap<unknown>('boardVotes').clear();
    }, 'facilitation-voting');
  }, [doc, state.maxVotesPerPerson]);

  const toggleVote = useCallback((shapeId: string): boolean => {
    if (!doc || !state.voting) return false;
    const voters = doc.getMap<unknown>('boardVotes');
    const voterId = actorName.trim().toLocaleLowerCase();
    if (!voterId) return false;
    const current = voters.get(voterId);
    const chosen = Array.isArray(current) ? current.filter((id): id is string => typeof id === 'string') : [];
    const existing = chosen.indexOf(shapeId);
    if (existing >= 0) chosen.splice(existing, 1);
    else {
      if (chosen.length >= state.maxVotesPerPerson) return false;
      chosen.push(shapeId);
    }
    voters.set(voterId, chosen);
    return true;
  }, [doc, actorName, state.voting, state.maxVotesPerPerson]);

  const startTimer = useCallback((seconds: number, label: string) => {
    if (!doc) return;
    const settings = doc.getMap<unknown>('facilitation');
    doc.transact(() => {
      settings.set('timerLabel', label.trim().slice(0, 48) || 'Team timer');
      settings.set('timerEndsAt', Date.now() + Math.max(1, Math.min(3600, Math.round(seconds))) * 1000);
    }, 'facilitation-timer-start');
  }, [doc]);

  const stopTimer = useCallback(() => {
    if (!doc) return;
    doc.getMap<unknown>('facilitation').set('timerEndsAt', 0);
  }, [doc]);

  const setRetrospectiveStep = useCallback((step: number) => {
    if (!doc || !Number.isFinite(step)) return;
    doc.getMap<unknown>('facilitation').set('retrospectiveStep', Math.max(-1, Math.min(3, Math.round(step))));
  }, [doc]);

  return { ...state, setVoting, toggleVote, startTimer, stopTimer, setRetrospectiveStep };
}
