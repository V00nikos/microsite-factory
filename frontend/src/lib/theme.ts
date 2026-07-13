// Theme control for the console. Dark-primary by intent (a mission-control
// board), but fully light/dark toggleable and persisted. The explicit
// data-theme attribute on <html> wins over the OS preference (see tokens.css).

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "mf-theme";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Resolve the theme to start with: saved choice, else dark (the default). */
function initial(): Theme {
  return stored() ?? "dark";
}

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Run once, before React mounts, so there is no flash of the wrong theme. */
export function initTheme(): void {
  apply(initial());
}

export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

// Tiny pub/sub so every mounted toggle stays in sync.
const listeners = new Set<(t: Theme) => void>();

export function setTheme(theme: Theme): void {
  apply(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore storage failures (private mode, etc.) */
  }
  listeners.forEach((fn) => fn(theme));
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/** React hook: current theme + a toggle. */
export function useTheme(): [Theme, () => void] {
  const [theme, setLocal] = useState<Theme>(() => currentTheme());
  useEffect(() => {
    const fn = (t: Theme) => setLocal(t);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return [theme, () => void toggleTheme()];
}
