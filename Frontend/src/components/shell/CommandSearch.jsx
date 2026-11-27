import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiSearch } from "react-icons/fi";
import Ico from "../../ui/Ico.jsx";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

/**
 * Barre de commande (⌘K / Ctrl+K) : recherche des écrans du rôle connecté,
 * navigation au clavier (↑ ↓ Entrée Échap) et suggestions rapides en puces.
 *
 * @param {Array} commands  [{ key, label, icon, section }]
 * @param {(key) => void} onNavigate
 */
export default function CommandSearch({ commands, onNavigate }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return focused ? commands : [];
    return commands.filter((c) => c.label.toLowerCase().includes(q) || (c.section || "").toLowerCase().includes(q));
  }, [query, focused, commands]);
  const chips = useMemo(() => commands.slice(0, 4), [commands]);

  useEffect(() => { setActiveIdx(0); }, [query, focused]);

  // Fermeture au clic extérieur
  useEffect(() => {
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setFocused(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Raccourci Ctrl/⌘ + K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(key) {
    onNavigate(key);
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") { setFocused(false); inputRef.current?.blur(); }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0))); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results.length > 0) go((results[activeIdx] || results[0]).key);
  }

  return (
    <div ref={wrapRef} className="search-wrapper">
      <div className="search">
        <FiSearch className="search__icon" />
        <input
          ref={inputRef}
          className="search__input"
          placeholder="Rechercher un écran, une action…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={focused && results.length > 0}
          aria-controls="kcq-cmd-list"
          aria-label="Rechercher un écran"
        />
        <span className="kbd" aria-hidden="true">{isMac ? <Ico n="command" /> : "Ctrl"} K</span>
      </div>

      {focused && (results.length > 0 || query.trim()) && (
        <div className="cmd-menu" id="kcq-cmd-list" role="listbox">
          {results.map((c, i) => (
            <div
              key={c.key + c.label}
              role="option"
              aria-selected={i === activeIdx}
              className={i === activeIdx ? "cmd-menu__item cmd-menu__item--active" : "cmd-menu__item"}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(c.key)}
            >
              <span className="cmd-menu__icon">{c.icon}</span>
              <span>{c.label}</span>
              <span className="cmd-menu__section">{c.section}</span>
              <span className="cmd-menu__hint"><Ico n="enter" /></span>
            </div>
          ))}
          {!results.length && <div className="cmd-menu__empty">Aucun écran pour « {query} »</div>}
          {!query.trim() && chips.length > 0 && (
            <div className="cmd-chips" aria-label="Accès rapides">
              {chips.map((c) => (
                <button key={c.key} type="button" className="cmd-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => go(c.key)}>{c.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
