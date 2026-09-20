import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'night';

const KEY = 'eqscope.theme';

function load(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'night') return v;
  } catch {
    // ignore
  }
  return 'dark';
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(load);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // ignore
    }
  }, []);

  return [theme, setTheme];
}

/** Read a CSS custom property so canvas drawing follows the active theme. */
export function cssVar(name: string, fallback = '#fff'): string {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
