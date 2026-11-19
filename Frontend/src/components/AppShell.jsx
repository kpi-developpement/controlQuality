import React, { useMemo, useState, useRef, useEffect } from "react";
import { FiMenu, FiSearch, FiLogOut, FiSettings, FiX, FiSend, FiMessageCircle } from "react-icons/fi";
import ThemeToggle from "./ThemeToggle.jsx";
import NotificationsBell from "./NotificationsBell.jsx";
import ProfileModal from "./ProfileModal.jsx";
import LuxeBackground from "./LuxeBackground.jsx";
import SidebarBackdrop from "./SidebarBackdrop.jsx";
import api from "../api";
import { downloadChatDocument } from "../utils/chatDocuments.mjs";
import Ico from "../ui/Ico.jsx";
import Select from "../ui/Select.jsx";

/* Simple Markdown to HTML */
function md(text) {
  let h = String(text || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.+)$/gm, '<div style="font-weight:800;font-size:0.95rem;margin:8px 0 4px">$1</div>')
    .replace(/^## (.+)$/gm, '<div style="font-weight:800;font-size:1rem;margin:10px 0 4px">$1</div>')
    .replace(/^# (.+)$/gm, '<div style="font-weight:800;font-size:1.05rem;margin:10px 0 6px">$1</div>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // Italic
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    // Inline code
    .replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,0.06);padding:1px 4px;border-radius:4px;font-size:0.82em">$1</code>')
    // Bullet lists
    .replace(/^[\-\*] (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">• $1</div>')
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, (match, p1, offset, str) => `<div style="padding-left:12px;margin:2px 0">${match.split('.')[0]}. ${p1}</div>`)
    // Remove markdown table separators (|---|---|)
    .replace(/^\|[\s\-\|]+\|$/gm, '')
    // Simple table rows: | a | b | c |
    .replace(/^\|(.+)\|$/gm, (match, inner) => {
      const cells = inner.split('|').map(c => c.trim()).filter(Boolean);
      return '<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid rgba(0,0,0,0.06)">' +
        cells.map(c => `<span style="flex:1;font-size:0.82rem">${c}</span>`).join('') + '</div>';
    })
    // Line breaks
    .replace(/\n/g, '<br/>');
  // Clean up double <br/> from removed lines
  h = h.replace(/(<br\/>){3,}/g, '<br/><br/>');
  return h;
}

function AIBubble({ m }) {
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  async function download(format) {
    setExporting(format); setExportError("");
    try { await downloadChatDocument(m.text, format); }
    catch (e) { setExportError(e.message || "Téléchargement impossible. Réessayez."); }
    finally { setExporting(""); }
  }
  if (m.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ maxWidth: "85%", padding: "9px 13px", borderRadius: "14px 14px 4px 14px", background: "var(--grad-primary)", color: "#fff", animation: "slideUp 260ms cubic-bezier(0.22,1,0.36,1)", fontSize: "0.85rem", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {m.text}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div style={{
        maxWidth: "85%", padding: "9px 13px", borderRadius: "14px 14px 14px 4px",
        animation: "slideUp 260ms cubic-bezier(0.22,1,0.36,1)",
        background: m.error ? "var(--danger-bg)" : "var(--chip)",
        color: m.error ? "var(--danger)" : "var(--text)",
        fontSize: "0.85rem", lineHeight: 1.6, wordBreak: "break-word",
      }}>
        <div dangerouslySetInnerHTML={{ __html: md(m.text) }} />
        {!m.error && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          <button className="btn btn--ghost btn--sm" disabled={!!exporting} onClick={() => download("docx")}>{exporting === "docx" ? "Création…" : <><Ico n="download" /> Word (.docx)</>}</button>
          <button className="btn btn--ghost btn--sm" disabled={!!exporting} onClick={() => download("xlsx")}>{exporting === "xlsx" ? "Création…" : <><Ico n="download" /> Excel (.xlsx)</>}</button>
        </div>}
        {exportError && <div role="alert" style={{ color: "var(--danger)", marginTop: 6 }}>{exportError}</div>}
      </div>
    </div>
  );
}
function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [outputFormat, setOutputFormat] = useState("auto");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setLoading(true);
    try {
      const history = messages.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const res = await api.post("/admin/ai/chat", { message: q, history, format: outputFormat }, { toast: false });
      setMessages((prev) => [...prev, { role: "ai", text: res.data?.reply || "Pas de réponse.", model: res.data?.model || "" }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "ai", text: e?.response?.data?.message || "Erreur. Vérifiez la clé API IA dans Santé > Configuration.", error: true }]);
    } finally { setLoading(false); }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Assistant IA"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 250,
          width: 56, height: 56, borderRadius: 18,
          background: "var(--grad-brand)", color: "#fff", border: "1px solid rgba(255,255,255,0.18)",
          display: "grid", placeItems: "center", cursor: "pointer",
          boxShadow: "0 10px 30px -6px rgba(36,86,230,0.65), inset 0 1px 0 rgba(255,255,255,0.25)",
          transition: "transform 320ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 220ms",
          animation: open ? "none" : "aiPulse 2.8s ease-in-out infinite",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.08) rotate(-4deg)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        <span key={open ? "x" : "m"} style={{ display: "grid", placeItems: "center", animation: "themeIconIn 360ms cubic-bezier(0.34,1.56,0.64,1)" }}>
          {open ? <FiX size={22} /> : <FiMessageCircle size={22} />}
        </span>
        <style>{`@keyframes aiPulse{0%,100%{box-shadow:0 10px 30px -6px rgba(36,86,230,0.65),0 0 0 0 rgba(59,111,245,0.35)}50%{box-shadow:0 10px 30px -6px rgba(36,86,230,0.65),0 0 0 10px rgba(59,111,245,0)}}@keyframes themeIconIn{from{opacity:0;transform:rotate(-90deg) scale(0.5)}to{opacity:1;transform:none}}`}</style>
      </button>

      {/* Chat window */}
      {open && (
        <div style={{
          position: "fixed", bottom: 88, right: 24, zIndex: 250,
          width: 380, maxWidth: "calc(100vw - 48px)", height: 480, maxHeight: "calc(100vh - 120px)",
          background: "var(--panel)", border: "1px solid var(--border-strong)",
          borderRadius: 22, boxShadow: "var(--shadow-lg)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          transformOrigin: "bottom right",
          animation: "modalIn 380ms cubic-bezier(0.22,1,0.36,1)",
        }}>
          {/* Header */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg, var(--primary-bg), transparent 70%)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "1.1rem" }}><Ico n="bot" /></span>
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>Assistant QA</div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Kyntus IA</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0 }}><FiX size={18} /></button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--muted)", textAlign: "center", padding: 16 }}>
                <span style={{ fontSize: "2rem" }}><Ico n="bot" /></span>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Assistant QA</div>
                <div style={{ fontSize: "0.8rem", lineHeight: 1.5 }}>
                  Posez vos questions sur la qualité, les scores, les agents, le coaching…
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, width: "100%" }}>
                  {["Quels agents ont le plus bas score ?", "Comment améliorer le taux de contestation ?", "Conseils coaching pour un agent NC sur l'accueil"].map((s) => (
                    <button key={s} onClick={() => { setInput(s); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", cursor: "pointer", fontSize: "0.78rem", textAlign: "left", fontWeight: 500, color: "var(--text-secondary)" }}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <AIBubble key={i} m={m} />
            ))}
            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ padding: "8px 12px", borderRadius: 12, background: "var(--chip)", fontSize: "0.85rem", color: "var(--muted)" }}>
                  <Ico n="clock" /> Réflexion…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: "6px 12px", borderTop: "1px solid var(--border)" }}>
            <label style={{ fontSize: 12 }}>Sortie souhaitée <Select aria-label="Sortie souhaitée" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} disabled={loading}>
              <option value="auto">Automatique</option><option value="text">Réponse simple</option><option value="docx">Document Word</option><option value="xlsx">Tableau Excel</option>
            </Select></label>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Téléchargez chaque réponse avec les boutons Word ou Excel.</div>
          </div>
          {/* Input */}
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <input
              value={input}
              maxLength={12000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Votre question…"
              style={{ flex: 1, border: "1px solid var(--border-strong)", borderRadius: 10, padding: "8px 12px", fontSize: "0.85rem", outline: "none", background: "var(--panel-2)", color: "var(--text)" }}
            />
            <button onClick={send} disabled={loading || !input.trim()} style={{
              width: 38, height: 38, borderRadius: 10, border: "none",
              background: "var(--grad-primary)", color: "#fff", cursor: "pointer",
              display: "grid", placeItems: "center", flexShrink: 0, transition: "transform 200ms", opacity: loading || !input.trim() ? 0.5 : 1,
            }}>
              <FiSend size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* =============== AppShell =============== */
const ROLE_LABELS = {
  admin: "Administrateur",
  cq: "Contrôle qualité",
  formateur: "Formateur",
  management: "Management",
  supervision: "Supervision",
  pilote: "Pilote",
  referent: "Référent technique",
  superviseur: "Superviseur",
  cdp: "Chef de projet",
};

export default function AppShell({ user, onLogout, navSections, children }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("kcq:sidebar") === "collapsed"; } catch { return false; }
  });
  const [profileOpen, setProfileOpen] = useState(false);

  // Inline search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const searchRef = useRef(null);
  const contentRef = useRef(null);

  const role = user?.role || "";

  useEffect(() => {
    try { localStorage.setItem("kcq:sidebar", collapsed ? "collapsed" : "open"); } catch { /* ignore */ }
  }, [collapsed]);

  // Page active (pour le fil d'Ariane et la transition de page)
  const activeEntry = useMemo(() => {
    for (const sec of navSections || []) {
      const it = (sec.items || []).find((i) => i.active);
      if (it) return { section: sec.title, label: it.label, key: it.key };
    }
    return null;
  }, [navSections]);
  const activeKey = activeEntry?.key || "";

  // Rejoue l'animation d'entrée à chaque changement de page, sans démonter la page
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;
    el.classList.remove("is-entering");
    void el.offsetWidth; // force reflow pour relancer l'animation
    el.classList.add("is-entering");
    window.scrollTo({ top: 0, behavior: "auto" });
    const t = setTimeout(() => el.classList.remove("is-entering"), 900);
    return () => clearTimeout(t);
  }, [activeKey]);

  // Palette de commandes = entrées du menu du rôle connecté
  const allCommands = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const sec of navSections || []) {
      for (const it of sec.items || []) {
        if (seen.has(it.key)) continue;
        seen.add(it.key);
        out.push({ label: it.label, key: it.key, icon: it.icon, section: sec.title, onClick: it.onClick });
      }
    }
    return out;
  }, [navSections]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return searchFocused ? allCommands : [];
    const q = searchQuery.toLowerCase();
    return allCommands.filter((c) => c.label.toLowerCase().includes(q));
  }, [searchQuery, searchFocused, allCommands]);

  useEffect(() => { setActiveIdx(0); }, [searchQuery, searchFocused]);

  function navigate(key) {
    const cmd = allCommands.find((c) => c.key === key);
    if (cmd?.onClick) cmd.onClick();
    else window.dispatchEvent(new CustomEvent("kcq:navigate", { detail: { role, view: key } }));
    setSearchQuery("");
    setSearchFocused(false);
    searchRef.current?.blur();
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest(".search-wrapper")) setSearchFocused(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Raccourci Ctrl/⌘ + K pour la recherche
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const initials = useMemo(() => {
    const n = (user?.name || "").trim();
    if (!n) return "U";
    const parts = n.split(/\s+/).filter(Boolean);
    return (parts[0]?.[0] || "U").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
  }, [user?.name]);

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

  return (
    <div className={collapsed ? "shell shell--collapsed" : "shell"}>
      <LuxeBackground />
      <aside className="sidebar">
        <SidebarBackdrop />
        <div className="sidebar__top">
          <div className="brand">
            <div className="brand__mark" aria-hidden="true">
              <img src="/kyntus.svg" alt="" style={{ width: 30, height: 30, display: "block" }} />
            </div>
            <div className="brand__text">
              <div className="brand__name">Kyntus</div>
              <div className="brand__sub">Contrôle qualité</div>
            </div>
          </div>
        </div>

        <nav className="nav">
          {(navSections || []).map((sec) => (
            <div key={sec.title} className="nav__section">
              <div className="nav__title">{sec.title}</div>
              <div className="nav__items">
                {sec.items.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    className={it.active ? "nav__item nav__item--active" : "nav__item"}
                    onClick={it.onClick}
                    title={it.label}
                    aria-current={it.active ? "page" : undefined}
                  >
                    <span className="nav__icon">{it.icon}</span>
                    <span className="nav__label">{it.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar__bottom">
          <div className="usercard">
            <div className="usercard__avatar">{initials}</div>
            <div className="usercard__meta" style={{ cursor: "pointer" }} onClick={() => setProfileOpen(true)} title="Paramètres du profil">
              <div className="usercard__name" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {user?.name || "Utilisateur"}
                <FiSettings style={{ fontSize: 12, opacity: 0.55, flexShrink: 0 }} />
              </div>
              <div className="usercard__role">{ROLE_LABELS[role] || role.toUpperCase()}</div>
            </div>
            <button className="iconbtn" onClick={onLogout} title="Déconnexion" aria-label="Déconnexion"><FiLogOut /></button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="iconbtn" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Déplier le menu" : "Replier le menu"} aria-label="Menu"><FiMenu /></button>
          {activeEntry && (
            <div className="topbar__crumbs">
              <span className="topbar__section">{activeEntry.section}</span>
              <span key={activeEntry.key} className="topbar__title">{activeEntry.label}</span>
            </div>
          )}
          <div className="topbar__center">
            <div className="search-wrapper" style={{ position: "relative", flex: 1, maxWidth: 520, minWidth: 200 }}>
              <div className="search">
                <FiSearch className="search__icon" />
                <input
                  ref={searchRef}
                  className="search__input"
                  placeholder="Rechercher une page…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearchFocused(false); searchRef.current?.blur(); }
                    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0))); }
                    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
                    if (e.key === "Enter" && filtered.length > 0) navigate((filtered[activeIdx] || filtered[0]).key);
                  }}
                />
                <span className="kbd" aria-hidden="true">{isMac ? <Ico n="command" /> : "Ctrl"} K</span>
              </div>

              {/* Dropdown */}
              {searchFocused && filtered.length > 0 && (
                <div className="cmd-menu" role="listbox">
                  {filtered.map((c, i) => (
                    <div
                      key={c.key + c.label}
                      role="option"
                      aria-selected={i === activeIdx}
                      className={i === activeIdx ? "cmd-menu__item cmd-menu__item--active" : "cmd-menu__item"}
                      onMouseEnter={() => setActiveIdx(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => navigate(c.key)}
                    >
                      <span className="cmd-menu__icon">{c.icon}</span>
                      <span>{c.label}</span>
                      <span className="cmd-menu__hint"><Ico n="enter" /> Ouvrir</span>
                    </div>
                  ))}
                </div>
              )}
              {searchFocused && searchQuery.trim() && filtered.length === 0 && (
                <div className="cmd-menu">
                  <div className="cmd-menu__empty">Aucun résultat pour « {searchQuery} »</div>
                </div>
              )}
            </div>
          </div>
          <div className="topbar__actions">
            <ThemeToggle />
            <NotificationsBell />
          </div>
        </header>
        <main ref={contentRef} className="content">{children}</main>
      </div>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      {user?.role !== "pilote" && <AIChatWidget />}
    </div>
  );
}
