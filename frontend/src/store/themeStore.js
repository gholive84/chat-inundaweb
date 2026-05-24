import { create } from 'zustand';

const KEY = 'theme_mode';

function getInitial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  try {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch {}
  return 'dark';
}

function applyMode(mode) {
  try {
    document.body.setAttribute('data-mode', mode);
    // tema-color do browser/PWA
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#FFFFFF' : '#0A1628');
  } catch {}
}

const useThemeStore = create((set, get) => ({
  mode: getInitial(),
  toggle: () => {
    const next = get().mode === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch {}
    applyMode(next);
    set({ mode: next });
  },
  init: () => {
    applyMode(get().mode);
  },
}));

// Aplica logo no boot (antes do React montar)
applyMode(getInitial());

export default useThemeStore;
