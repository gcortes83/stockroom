import { useSyncExternalStore } from 'react';
import { readStorage, writeStorage } from './storage';

export type Theme = 'dark' | 'light';

const KEY = 'stockroom.theme';
const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function initTheme(): void {
  const stored = readStorage(KEY);
  document.documentElement.dataset.theme = stored === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  writeStorage(KEY, theme);
  listeners.forEach((listener) => listener());
}

export function toggleTheme(): void {
  setTheme(current() === 'dark' ? 'light' : 'dark');
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current,
    () => 'dark',
  );
}
