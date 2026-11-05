import { useSyncExternalStore } from 'react';

/*
 * Light / dark theme.
 * The theme is a `data-theme` attribute on <html>; every color in styles/App.css is a token that switches on it.
 * Light is the default. The choice is saved per browser. index.html applies the saved theme before React loads,
 * so the page never flashes the wrong theme.
 */

const STORAGE_KEY = 'ah-theme';
const META_COLOR = { light: '#eef2f0', dark: '#0e1512' };
const listeners = new Set();

function readSaved() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'dark' || saved === 'light' ? saved : 'light';
  } catch {
    return 'light';
  }
}

let current = document.documentElement.dataset.theme || readSaved();

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme]);
}
apply(current);

export function setTheme(theme) {
  if (theme === current) return;
  current = theme;
  apply(theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage blocked: theme still applies for this visit */ }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Returns the current theme ('light' | 'dark') and re-renders when it changes.
export function useTheme() {
  return useSyncExternalStore(subscribe, () => current);
}
