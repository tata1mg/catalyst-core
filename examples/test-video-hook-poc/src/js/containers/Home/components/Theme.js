import { useState, useEffect, useCallback } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('catalyst-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {
      // Ignore localStorage errors in environments where it is blocked/unavailable
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  useEffect(() => {
    try { localStorage.setItem('catalyst-theme', theme); } catch (e) {
      // Ignore localStorage errors in environments where it is blocked/unavailable
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return [theme, toggle, setTheme];
}
