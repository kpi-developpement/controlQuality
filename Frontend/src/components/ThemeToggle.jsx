import React, { useState } from "react";
import { flushSync } from "react-dom";
import { FiSun, FiMoon } from "react-icons/fi";
import { withThemeTransition } from "../ui/motion.js";
import { readTheme, applyTheme } from "../ui/themeStore.js";

/** Bascule clair / sombre avec un dévoilement circulaire depuis le bouton. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  const isDark = theme === "dark";

  const toggle = (e) => {
    const next = isDark ? "light" : "dark";
    withThemeTransition(e, () => {
      applyTheme(next);
      flushSync(() => setTheme(next));
    });
  };

  return (
    <button
      onClick={toggle}
      className="iconbtn theme-toggle"
      title={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
      aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
    >
      <span key={theme} style={{ display: "grid", placeItems: "center", animation: "themeIconIn 460ms var(--spring-bouncy)" }}>
        {isDark ? <FiSun size={18} /> : <FiMoon size={18} />}
      </span>
    </button>
  );
}
