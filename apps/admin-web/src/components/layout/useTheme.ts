import { useCallback, useState } from "react";

/** Sibling of `vedafit.admin.sidebarCollapsed`. Super Admin uses a different origin/key. */
export const THEME_KEY = "vedafit.admin.theme";

export type Theme = "light" | "dark";

function readTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function writeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode / quota: the session still toggles; the next load starts dark.
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Dark is the default. First visit without the key is dark so existing e2e stays deterministic.
 * Does **not** follow `prefers-color-scheme`.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    writeTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      applyTheme(next);
      writeTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme, isLight: theme === "light" };
}
