import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "resurgo-theme";
const listeners = new Set<() => void>();
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** The theme in effect: the visitor's saved choice, else the system preference, else light. */
export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return media?.matches ? "dark" : "light";
}

export function setTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode or blocked storage: the choice just doesn't persist */
  }
  listeners.forEach((l) => l());
}

media?.addEventListener("change", () => listeners.forEach((l) => l()));

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => "light");
}

// Keep a saved choice applied even if the inline script in index.html did not run.
{
  const s = saved();
  if (s) document.documentElement.setAttribute("data-theme", s);
}
