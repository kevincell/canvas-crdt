import { useEffect, useState, useSyncExternalStore } from 'react';
import { readString, writeString } from './storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const listeners = new Set<() => void>();
let preference: ThemePreference = (readString('crdt-canvas-theme') as ThemePreference) || 'system';
if (!['system', 'light', 'dark'].includes(preference)) preference = 'system';

function apply() {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}
apply();

export function setThemePreference(next: ThemePreference) {
  preference = next;
  writeString('crdt-canvas-theme', next);
  apply();
  listeners.forEach(listener => listener());
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => preference,
  );
}

export function useResolvedTheme(): ResolvedTheme {
  const pref = useThemePreference();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}
