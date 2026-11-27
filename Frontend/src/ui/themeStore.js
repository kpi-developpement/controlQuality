// src/ui/themeStore.js — thème mémorisé (« dark » par défaut, comme la charte « dark mode first »)
const KEY = "theme";
export const DEFAULT_THEME = "dark";

export function readTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme) {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  html.classList.add(theme);
  html.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* stockage indisponible */ }
}
