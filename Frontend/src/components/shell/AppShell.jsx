import React, { useEffect, useMemo, useRef, useState } from "react";
import AuroraBackground from "../fx/AuroraBackground.jsx";
import ProfileModal from "../ProfileModal.jsx";
import AssistantWidget from "../assistant/AssistantWidget.jsx";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";
import { isLite, setPerfPref, onPerfChange } from "../../ui/perf.js";

const SIDEBAR_KEY = "kcq:sidebar";

/**
 * Coquille de l'application : fond, barre latérale, barre du haut, contenu, profil et assistant.
 * Chaque morceau vit dans son propre fichier (components/shell/*, components/assistant/*).
 *
 * @param {Array} navSections [{ title, items: [{ key, label, icon, active, onClick }] }]
 */
export default function AppShell({ user, onLogout, navSections, children }) {
  // Rail d'icônes par défaut (s'ouvre au survol) ; épinglable ouvert
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) !== "open"; } catch { return true; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [lite, setLite] = useState(() => isLite());
  const contentRef = useRef(null);

  useEffect(() => onPerfChange(setLite), []);
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "open"); } catch { /* stockage indisponible */ }
  }, [collapsed]);

  // Écran actif (fil d'Ariane, animation d'entrée)
  const activeEntry = useMemo(() => {
    for (const sec of navSections || []) {
      const it = (sec.items || []).find((i) => i.active);
      if (it) return { section: sec.title, label: it.label, key: it.key };
    }
    return null;
  }, [navSections]);
  const activeKey = activeEntry?.key || "";

  // Cascade d'entrée du contenu à chaque changement d'écran, sans démonter la page
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;
    el.classList.remove("is-entering");
    void el.offsetWidth; // relance l'animation
    el.classList.add("is-entering");
    window.scrollTo({ top: 0, behavior: "auto" });
    const t = setTimeout(() => el.classList.remove("is-entering"), 900);
    return () => clearTimeout(t);
  }, [activeKey]);

  // Commandes de la recherche = entrées du menu du rôle
  const commands = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const sec of navSections || []) {
      for (const it of sec.items || []) {
        if (seen.has(it.key)) continue;
        seen.add(it.key);
        out.push({ key: it.key, label: it.label, icon: it.icon, section: sec.title, onClick: it.onClick });
      }
    }
    return out;
  }, [navSections]);

  // Changement d'écran instantané ; l'entrée du nouvel écran est animée en CSS (cascade « ressort »).
  // (Les View Transitions du navigateur figent l'écran le temps de la capture : réservées au changement de thème.)
  function select(item) {
    setMobileOpen(false);
    if (item.active) return;
    item.onClick?.();
  }
  function navigateTo(key) {
    const cmd = commands.find((c) => c.key === key);
    if (cmd) select({ ...cmd, active: cmd.key === activeKey });
    else window.dispatchEvent(new CustomEvent("kcq:navigate", { detail: { role: user?.role, view: key } }));
  }

  const shellClass = ["shell", collapsed && "shell--collapsed", mobileOpen && "shell--mobile-open"].filter(Boolean).join(" ");

  return (
    <div className={shellClass}>
      <AuroraBackground />
      <Sidebar
        navSections={navSections}
        user={user}
        collapsed={collapsed}
        onTogglePin={() => setCollapsed((v) => !v)}
        onSelect={select}
        onOpenProfile={() => setProfileOpen(true)}
        onLogout={onLogout}
      />
      <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />

      <div className="main">
        <Topbar
          activeEntry={activeEntry}
          commands={commands}
          onNavigate={navigateTo}
          onToggleMenu={() => setMobileOpen((v) => !v)}
          lite={lite}
          onToggleLite={() => setPerfPref(lite ? "full" : "lite")}
        />
        <main ref={contentRef} className="content">{children}</main>
      </div>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      {user?.role !== "pilote" && <AssistantWidget />}
    </div>
  );
}
