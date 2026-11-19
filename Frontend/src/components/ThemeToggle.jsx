import React, { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { FiSun, FiMoon } from "react-icons/fi";
import { withThemeTransition } from "../ui/motion.js";

function applyTheme(theme) {
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.classList.add(theme);
  try { localStorage.setItem("theme", theme); } catch { /* ignore */ }
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem("theme");
      return stored === "light" || stored === "dark" ? stored : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => { applyTheme(theme); }, [theme]);

  const toggleTheme = (e) => {
    const next = theme === "dark" ? "light" : "dark";
    withThemeTransition(e, () => {
      applyTheme(next);
      flushSync(() => setTheme(next));
    });
  };

  const isDark = theme === "dark";
  return (
    <button
      onClick={toggleTheme}
      className="iconbtn theme-toggle"
      title={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
      aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
    >
      <span key={theme} style={{ display: "grid", placeItems: "center", animation: "themeIconIn 420ms cubic-bezier(0.34,1.56,0.64,1)" }}>
        {isDark ? <FiSun size={18} /> : <FiMoon size={18} />}
      </span>
      <style>{`@keyframes themeIconIn{from{opacity:0;transform:rotate(-90deg) scale(0.5)}to{opacity:1;transform:none}}`}</style>
    </button>
  );
}

export default ThemeToggle;
