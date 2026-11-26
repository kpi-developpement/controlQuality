import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "../../api";
import Card from "./components/Card.jsx";
import Pager from "./components/Pager.jsx";
import { exportToXlsx } from "./components/exportXlsx.js";
import { useToast } from "../../toast/ToastProvider.jsx";
import { VISIBILITY_SCOPES, EDIT_SCOPES, ROLE_LABELS } from "../../utils/evalMeta.js";
import Ico from "../../ui/Ico.jsx";
import Select from "../../ui/Select.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";

/** Mot de passe aléatoire lisible (sans caractères ambigus) : majuscules, minuscules, chiffres, symbole. */
function generatePassword(len = 12) {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnopqrstuvwxyz", D = "23456789", S = "@#$%&*!?";
  const all = U + L + D + S;
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const chars = [U[rnd(U.length)], L[rnd(L.length)], D[rnd(D.length)], S[rnd(S.length)]];
  while (chars.length < len) chars.push(all[rnd(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

// Contrat Orange : liste déroulante d'un référentiel (garde une valeur ancienne absente de la liste)
function RefSelect({ value, onChange, items, placeholder }) {
  const names = (items || []).filter((x) => x.active !== false).map((x) => x.name);
  if (value && !names.includes(value)) names.unshift(value);
  return (
    <Select className="input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
    </Select>
  );
}
const scopeLabel = (u) => {
  const v = VISIBILITY_SCOPES.find((x) => x.value === (u.visibilityScope || ""));
  return u.visibilityScope ? v?.label || u.visibilityScope : "Défaut";
};

/**
 * Collaborateurs & Structures (Admin)
 * - Liste utilisateurs paginée + filtres
 * - Actions: modifier / supprimer / mot de passe
 * - Ajout unitaire + ajout en masse (textarea + upload Excel)
 * - Gestion cellules (structures): CRUD
 *
 * IMPORTANT: ne touche pas au dashboard/grilles; ce composant ne fait que Users & Structures.
 */

const PAGE_SIZE = 25;
const LISTEN_PAGE_SIZE = 25;

const safeText = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return String(v.name || v.label || v.title || v.email || v._id || v.id || "");
  return String(v);
};
const get = (obj, keys, fallback = "") => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).length > 0) return v;
  }
  return fallback;
};


const safeStr = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return String(v.name || v.label || v.title || v.email || v._id || v.id || "");
  return String(v);
};

const normalizeRole = (r) => (r || "").toString().trim().toLowerCase();

export default function UsersStructuresView() {
  const toast = useToast();
  // data
  const [users, setUsers] = useState([]);
  const [cells, setCells] = useState([]);

  // --- Écoutes (CQ + Management) pour export/visibilité (date = createdAt validation) ---
  const [cqEvals, setCqEvals] = useState([]);
  const [mgEvals, setMgEvals] = useState([]);
  const [pageCq, setPageCq] = useState(1);
  const [pageMg, setPageMg] = useState(1);


  // filters + pagination
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [active, setActive] = useState("all");
  const [page, setPage] = useState(1);

  // add user
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [newRole, setNewRole] = useState("cq");
  // Cellules : la 1re sélectionnée = cellule principale, les suivantes = cellules supplémentaires autorisées
  const [cellSelection, setCellSelection] = useState([]);
  // Contrat Orange : périmètre du nouveau profil
  const [newProject, setNewProject] = useState("");
  const [newContract, setNewContract] = useState("");
  const [newVisibility, setNewVisibility] = useState("");
  const [newEditScope, setNewEditScope] = useState("");
  const [newReferent, setNewReferent] = useState("");
  const [newSuperviseur, setNewSuperviseur] = useState("");
  const referentsList = useMemo(() => users.filter((u) => u.role === "referent" && u.active !== false), [users]);
  const superviseursList = useMemo(() => users.filter((u) => u.role === "superviseur" && u.active !== false), [users]);
  const nameById = useMemo(() => new Map(users.map((u) => [String(u._id), u.name])), [users]);
  const byIdName = (id) => nameById.get(String(id?._id || id || "")) || "";
  const [projects, setProjects] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [cellProject, setCellProject] = useState("");
  const [cellContract, setCellContract] = useState("");

  // edit user / password
  const [editing, setEditing] = useState(null); // full user object
  const [pwd, setPwd] = useState({ id: null, value: "", show: false, saved: "" });
  const [confirmDel, setConfirmDel] = useState(null); // { kind: "user"|"cell", id, name }
  const [deleting, setDeleting] = useState(false);
  const [activities, setActivities] = useState([]);
  const [cellActivity, setCellActivity] = useState("");
  const cellNameRef = useRef(null);

  // bulk import
  const [bulkText, setBulkText] = useState("");
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const bulkFileRef = useRef(null);

  // cells CRUD
  const [cellName, setCellName] = useState("");
  const [cellDescription, setCellDescription] = useState("");
  const [editCell, setEditCell] = useState(null);

  const load = async () => {
    const [u, c] = await Promise.all([axios.get("/admin/users"), axios.get("/admin/cells")]);
    setUsers(Array.isArray(u.data) ? u.data : []);
    setCells(Array.isArray(c.data) ? c.data : []);
    // Référentiels projets / contrats (absents = listes vides, aucune erreur bloquante)
    const [pr, ct] = await Promise.all([
      axios.get("/referentials/projects").catch(() => ({ data: [] })),
      axios.get("/referentials/contracts").catch(() => ({ data: [] })),
    ]);
    axios.get("/referentials/activities").then((r) => setActivities(Array.isArray(r.data) ? r.data : [])).catch(() => setActivities([]));
    setProjects(Array.isArray(pr.data) ? pr.data : []);
    setContracts(Array.isArray(ct.data) ? ct.data : []);
  };

  useEffect(() => {
    load().catch(() => {
      setUsers([]);
      setCells([]);
    });
  

    // Écoutes (pour consultation rapide + exports depuis cette vue)
    axios.get("/admin/evaluations/cq")
      .then((r) => setCqEvals(Array.isArray(r.data) ? r.data : []))
      .catch(() => setCqEvals([]));

    axios.get("/admin/evaluations/management")
      .then((r) => setMgEvals(Array.isArray(r.data) ? r.data : []))
      .catch(() => setMgEvals([]));
}, []);

  // ---------- Filters ----------
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return users.filter((u) => {
      const uRole = normalizeRole(u.role);
      if (role !== "all" && uRole !== role) return false;

      if (active !== "all") {
        const isActive = u.active !== false;
        if (active === "active" && !isActive) return false;
        if (active === "inactive" && isActive) return false;
      }

      if (!qq) return true;
      const t = `${safeStr(u.name)} ${safeStr(u.email)} ${safeStr(u.role)} ${safeStr(u.cell)} ${safeStr(u.project)} ${safeStr(u.contract)}`.toLowerCase();
      return t.includes(qq);
    });
  }, [users, q, role, active]);

  useEffect(() => {
    setPage(1);
  }, [q, role, active]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // ---------- Users actions ----------
  const createUser = async (e) => {
    e?.preventDefault?.();
    if (!name.trim() || !email.trim() || !password.trim()) return;

    await axios.post("/admin/users", {
      name: name.trim(),
      email: email.trim(),
      password: password.trim(),
      role: newRole,
      cell: cellSelection[0] || "",
      extraCells: cellSelection.slice(1),
      project: newProject,
      contract: newContract,
      visibilityScope: newVisibility,
      editScope: newEditScope,
      referent: newRole === "pilote" ? newReferent || null : null,
      superviseur: ["pilote", "referent"].includes(newRole) ? newSuperviseur || null : null,
    });
    setNewReferent("");
    setNewSuperviseur("");

    setName("");
    setEmail("");
    setPasswordValue("");
    setNewRole("cq");
    setCellSelection([]);
    setNewProject("");
    setNewContract("");
    setNewVisibility("");
    setNewEditScope("");
    await load();
  };

  const upsertUser = async () => {
    if (!editing?._id) return;

    await axios.patch(`/admin/users/${editing._id}`, {
      name: editing.name,
      email: editing.email,
      role: editing.role,
      cell: editing.cell,
      active: editing.active,
      project: editing.project || "",
      contract: editing.contract || "",
      visibilityScope: editing.visibilityScope || "",
      editScope: editing.editScope || "",
      extraCells: Array.isArray(editing.extraCells) ? editing.extraCells : [],
      referent: editing.role === "pilote" ? (editing.referent || null) : null,
      superviseur: ["pilote", "referent"].includes(editing.role) ? (editing.superviseur || null) : null,
      poles: ["superviseur", "referent"].includes(editing.role) && Array.isArray(editing.poles) ? editing.poles : [],
    });

    setEditing(null);
    await load();
  };

  const confirmDelete = async () => {
    if (!confirmDel?.id) return;
    setDeleting(true);
    try {
      if (confirmDel.kind === "cell") await axios.delete(`/admin/cells/${confirmDel.id}`, { toastSuccessMessage: `Cellule « ${confirmDel.name} » supprimée.` });
      else await axios.delete(`/admin/users/${confirmDel.id}`, { toastSuccessMessage: `Utilisateur « ${confirmDel.name} » supprimé.` });
      setConfirmDel(null);
      await load();
    } catch { /* toast d'erreur automatique */ } finally { setDeleting(false); }
  };

  const setPassword = async () => {
    if (!pwd.id) return;
    const value = String(pwd.value || "");
    if (value.length < 6) { toast.error("Le mot de passe doit contenir au moins 6 caractères."); return; }
    try {
      await axios.patch(`/admin/users/${pwd.id}`, { password: value }, { toastSuccessMessage: "Mot de passe modifié. Pensez à le transmettre à l'utilisateur." });
      setPwd((p) => ({ ...p, saved: value, show: true, current: p.current ? { available: true, password: value } : p.current }));
      await load();
    } catch { /* toast d'erreur automatique */ }
  };
  const showCurrentPassword = async () => {
    if (!pwd.id) return;
    setPwd((p) => ({ ...p, loadingCurrent: true }));
    try {
      const { data } = await axios.get(`/admin/users/${pwd.id}/password`);
      setPwd((p) => ({ ...p, current: data, loadingCurrent: false }));
    } catch {
      setPwd((p) => ({ ...p, loadingCurrent: false }));
    }
  };
  const copyPassword = async (v) => {
    try { await navigator.clipboard.writeText(v); toast.success("Mot de passe copié."); } catch { toast.error("Copie impossible : sélectionnez le texte manuellement."); }
  };

  // ---------- Bulk import (textarea) ----------
  const parseBulkText = () => {
    const lines = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const out = [];
    for (const line of lines) {
      const sep = line.includes(";") ? ";" : ",";
      const parts = line.split(sep).map((x) => x.trim());
      const [n, em, pw, rl, cl, pj, ct] = parts;
      if (!n || !em || !pw || !rl) continue;
      out.push({ name: n, email: em, password: pw, role: rl, cell: cl || "", project: pj || "", contract: ct || "" });
    }
    return out;
  };

  const bulkCreateFromList = async (list) => {
    if (!Array.isArray(list) || list.length === 0) return;
    const res = await axios.post("/admin/users/bulk", { users: list }, { toast: false });
    const created = res?.data?.created?.length || 0;
    const errors = Array.isArray(res?.data?.errors) ? res.data.errors : [];
    // Bilan explicite : auparavant les lignes en erreur étaient ignorées sans message
    if (errors.length) {
      const detail = errors.slice(0, 15).map((e) => `• ${e.entry?.email || e.entry?.name || "?"} : ${e.error}`).join("\n");
      alert(`${created} utilisateur(s) créé(s), ${errors.length} ligne(s) en erreur :\n${detail}${errors.length > 15 ? "\n…" : ""}`);
    } else {
      toast?.success?.(`${created} utilisateur(s) créé(s)`);
    }
    await load();
  };

  const bulkCreate = async () => {
    const list = parseBulkText();
    if (!list.length) return;
    await bulkCreateFromList(list);
    setBulkText("");
  };

  // ---------- Bulk import (Excel upload) ----------
  const handleBulkFileChange = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;

    setIsBulkUploading(true);
    try {
      // Lazy-load to avoid forcing xlsx into initial bundle
      const XLSX = (await import("xlsx")).default || (await import("xlsx"));
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });

      // read first sheet by default
      const sheetName = wb.SheetNames?.[0];
      const ws = wb.Sheets?.[sheetName];
      if (!ws) throw new Error("Aucune feuille dans le fichier.");

      const jsonRows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      // Expected columns: name | email | password | role | cell (case-insensitive)
      const list = jsonRows
        .map((r) => {
          const obj = {};
          for (const k of Object.keys(r || {})) obj[k.toString().trim().toLowerCase()] = r[k];
          const n = safeStr(obj.name || obj.nom || obj.username || obj.user || "");
          const em = safeStr(obj.email || obj.mail || "");
          const pw = safeStr(obj.password || obj.motdepasse || obj.mdp || "");
          const rl = safeStr(obj.role || obj.rôle || "");
          const cl = safeStr(obj.cell || obj.cellule || "");
          const pj = safeStr(obj.project || obj.projet || "");
          const ct = safeStr(obj.contract || obj.contrat || "");
          if (!n || !em || !pw || !rl) return null;
          return { name: n, email: em, password: pw, role: rl, cell: cl || "", project: pj, contract: ct };
        })
        .filter(Boolean);

      await bulkCreateFromList(list);

      // reset input
      if (bulkFileRef.current) bulkFileRef.current.value = "";
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert("Import Excel impossible. Vérifie le format (colonnes: name, email, password, role, cell).");
    } finally {
      setIsBulkUploading(false);
    }
  };

  // ---------- Cells actions ----------
  const createCell = async () => {
    if (!cellName.trim()) {
      toast.error("Saisissez d'abord le nom de la nouvelle cellule.");
      cellNameRef.current?.focus();
      return;
    }
    try {
      await axios.post("/admin/cells", { name: cellName.trim(), description: cellDescription || "", project: cellProject, contract: cellContract, activity: cellActivity }, { toastSuccessMessage: `Cellule « ${cellName.trim()} » créée.` });
      setCellName("");
      setCellDescription("");
      setCellProject("");
      setCellContract("");
      setCellActivity("");
      await load();
    } catch { /* toast d'erreur automatique (ex. nom déjà utilisé) */ }
  };

  const updateCell = async () => {
    if (!editCell?._id) return;
    await axios.patch(`/admin/cells/${editCell._id}`, {
      name: editCell.name,
      description: editCell.description,
      active: editCell.active,
      project: editCell.project || "",
      contract: editCell.contract || "",
      activity: editCell.activity || "",
    });
    setEditCell(null);
    await load();
  };

  const deleteCell = (c) => setConfirmDel({ kind: "cell", id: c._id, name: c.name });

  const closeAll = () => {
    setEditing(null);
    setPwd({ id: null, value: "", show: false, saved: "" });
    setEditCell(null);
  };

  // ---------- UI helpers ----------
  const th = {
    textAlign: "left",
    padding: "0.6rem",
    fontSize: "0.82rem",
    opacity: 0.85,
    whiteSpace: "nowrap",
  };
  const td = {
    padding: "0.55rem",
    borderTop: "1px solid var(--border)",
    verticalAlign: "top",
  };

  // ---------- Écoutes (tables + export) ----------
  const listensCq = useMemo(() => {
    const rows = Array.isArray(cqEvals) ? cqEvals : [];
    return rows.map((r) => ({
      date: safeText(get(r, ["createdAt", "validatedAt", "updatedAt"], "")), // date validation
      pilot: safeText(get(r, ["pilotName", "pilot", "pilotUserName", "pilotUser", "agent"], "")),
      cell: safeText(get(r, ["cell", "cellName", "pilotCell"], "")),
      evaluator: safeText(get(r, ["cqName", "evaluatorName", "evaluator", "userName"], "")),
      score: Number(get(r, ["finalScore", "score", "percentage", "percent", "compliancePercent"], 0)) || 0,
      status: safeText(get(r, ["status", "result", "state"], "")),
      comment: safeText(get(r, ["comment", "commentaire", "notes"], "")),
      __raw: r,
    }));
  }, [cqEvals]);

  const listensMg = useMemo(() => {
    const rows = Array.isArray(mgEvals) ? mgEvals : [];
    return rows.map((r) => ({
      date: safeText(get(r, ["createdAt", "validatedAt", "updatedAt"], "")),
      pilot: safeText(get(r, ["pilotName", "pilot", "pilotUserName", "pilotUser", "agent"], "")),
      cell: safeText(get(r, ["cell", "cellName", "pilotCell"], "")),
      evaluator: safeText(get(r, ["managerName", "evaluatorName", "evaluator", "userName"], "")),
      score: Number(get(r, ["finalScore", "score", "percentage", "percent", "compliancePercent"], 0)) || 0,
      status: safeText(get(r, ["status", "result", "state"], "")),
      comment: safeText(get(r, ["comment", "commentaire", "notes"], "")),
      __raw: r,
    }));
  }, [mgEvals]);

  const toExportRow = (r) => ({
    Date: r.date,
    Pilote: r.pilot,
    Cellule: r.cell,
    "CQ/manager évaluateur": r.evaluator,
    Score: r.score,
    Statut: r.status,
    Commentaire: r.comment,
  });

  const exportListens = () => {
    exportToXlsx("Ecoutes_export_multi_feuilles.xlsx", {
      "Écoutes CQ": listensCq.map(toExportRow),
      "Écoutes Management": listensMg.map(toExportRow),
    });
  };

  const slice = (rows, page) => rows.slice((page - 1) * LISTEN_PAGE_SIZE, page * LISTEN_PAGE_SIZE);
  const listensCqPage = useMemo(() => slice(listensCq, pageCq), [listensCq, pageCq]);
  const listensMgPage = useMemo(() => slice(listensMg, pageMg), [listensMg, pageMg]);

  return (
    <>
      <Card
        title="Collaborateurs"
        right={
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Recherche…"
              style={{
                padding: "0.45rem 0.7rem",
                borderRadius: "999px",
                border: "1px solid var(--border-strong)",
                background: "var(--panel)",
                color: "var(--text)",
                minWidth: 220,
              }}
            />

            <Select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{
                padding: "0.45rem 0.7rem",
                borderRadius: "999px",
                border: "1px solid var(--border-strong)",
                background: "var(--panel)",
                color: "var(--text)",
              }}
            >
              <option value="all">Tous rôles</option>
<option value="pilote">Pilote</option>
                <option value="referent">Référent technique</option>
                <option value="superviseur">Superviseur</option>
                <option value="cq">CQ</option>
                <option value="formateur">Formateur</option>
                <option value="cdp">Chef de projet</option>
                <option value="admin">Admin</option>
                <option value="management">Management (historique)</option>
                <option value="supervision">Supervision (historique)</option>
            </Select>

            <Select
              value={active}
              onChange={(e) => setActive(e.target.value)}
              style={{
                padding: "0.45rem 0.7rem",
                borderRadius: "999px",
                border: "1px solid var(--border-strong)",
                background: "var(--panel)",
                color: "var(--text)",
              }}
            >
              <option value="all">Actifs + inactifs</option>
              <option value="active">Actifs</option>
              <option value="inactive">Inactifs</option>
            </Select>
          </div>
        }
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Nom</th>
                <th style={th}>Email</th>
                <th style={th}>Rôle</th>
                <th style={th}>Cellule</th>
                <th style={th}>Projet</th>
                <th style={th}>Contrat</th>
                <th style={th}>Périmètre</th>
                <th style={th}>Actif</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((u) => (
                <tr key={u._id}>
                  <td style={td}>{safeStr(u.name)}</td>
                  <td style={td}>{safeStr(u.email)}</td>
                  <td style={td}>{ROLE_LABELS[u.role] || safeStr(u.role)}{u.referent && byIdName(u.referent) ? <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Réf. {byIdName(u.referent)}</div> : null}{u.role === "referent" && u.superviseur && byIdName(u.superviseur) ? <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Sup. {byIdName(u.superviseur)}</div> : null}</td>
                  <td style={td}>{safeStr(u.cell) || "-"}{Array.isArray(u.extraCells) && u.extraCells.length ? <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}> (+{u.extraCells.join(", ")})</span> : null}</td>
                  <td style={td}>{safeStr(u.project) || "-"}</td>
                  <td style={td}>{safeStr(u.contract) || "-"}</td>
                  <td style={td}><span style={{ fontSize: "0.8rem" }}>{scopeLabel(u)}{u.editScope === "none" ? " • lecture seule" : ""}</span></td>
                  <td style={td}>{u.active === false ? "Non" : "Oui"}</td>
                  <td style={{ ...td, display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button className="btn-outline" onClick={() => setEditing({ ...u })}>
                      Modifier
                    </button>
                    <button className="btn-outline" onClick={() => setPwd({ id: u._id, name: u.name, value: "", show: false, saved: "" })}>
                      Mot de passe
                    </button>
                    <button className="btn-danger" onClick={() => setConfirmDel({ kind: "user", id: u._id, name: u.name })}>
                      <Ico n="trash" /> Supprimer
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td style={td} colSpan={9}>
                    <span style={{ opacity: 0.8 }}>Aucun utilisateur</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "1rem", alignItems: "start" }}>
        <Card title="Ajouter un utilisateur">
          <form onSubmit={createUser} style={{ display: "grid", gap: "0.6rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
              <input className="input" placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} required />
              <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.6rem" }}>
              <input className="input" placeholder="Mot de passe" value={password} onChange={(e) => setPasswordValue(e.target.value)} required />
              <Select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value)} required>
<option value="pilote">Pilote</option>
                <option value="referent">Référent technique</option>
                <option value="superviseur">Superviseur</option>
                <option value="cq">CQ</option>
                <option value="formateur">Formateur</option>
                <option value="cdp">Chef de projet</option>
                <option value="admin">Admin</option>
                <option value="management">Management (historique)</option>
                <option value="supervision">Supervision (historique)</option>
              </Select>
              <Select className="input" multiple placeholder="Aucune cellule" title="Cellules (la première = cellule principale)"
                value={cellSelection} onChange={(e) => setCellSelection(e.target.selectedOptions.map((o) => o.value))}>
                {cells.map((c) => (
                  <option key={c._id} value={c.name}>
                    {c.name} {c.active === false ? "(inactive)" : ""}
                  </option>
                ))}
              </Select>
            </div>

            {["pilote", "referent"].includes(newRole) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                {newRole === "pilote" ? (
                  <Select className="input" value={newReferent} onChange={(e) => setNewReferent(e.target.value)}>
                    <option value="">Référent technique : aucun</option>
                    {referentsList.map((r) => <option key={r._id} value={r._id}>Référent : {r.name}{r.cell ? ` — ${r.cell}` : ""}</option>)}
                  </Select>
                ) : <div />}
                <Select className="input" value={newSuperviseur} onChange={(e) => setNewSuperviseur(e.target.value)}>
                  <option value="">Superviseur : aucun</option>
                  {superviseursList.map((r) => <option key={r._id} value={r._id}>Superviseur : {r.name}</option>)}
                </Select>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
              <RefSelect value={newProject} onChange={setNewProject} items={projects} placeholder="Projet (aucun)" />
              <RefSelect value={newContract} onChange={setNewContract} items={contracts} placeholder="Contrat (aucun)" />
              <Select className="input" value={newVisibility} onChange={(e) => setNewVisibility(e.target.value)} title="Périmètre de consultation">
                {VISIBILITY_SCOPES.map((o) => <option key={o.value} value={o.value}>Consultation : {o.label}</option>)}
              </Select>
              <Select className="input" value={newEditScope} onChange={(e) => setNewEditScope(e.target.value)} title="Périmètre de modification">
                {EDIT_SCOPES.map((o) => <option key={o.value} value={o.value}>Modification : {o.label}</option>)}
              </Select>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="submit" className="btn-primary">
                Ajouter
              </button>
            </div>
          </form>
        </Card>

        <Card
          title="Ajout en masse (CSV + Excel)"
          right={
            <button className="btn-outline" onClick={bulkCreate} disabled={!bulkText.trim()}>
              Importer texte
            </button>
          }
        >
          <div style={{ opacity: 0.8, marginBottom: "0.5rem" }}>
            <b>Texte</b> (1 ligne = 1 utilisateur) : <code>name,email,password,role,cell[,project,contract]</code> (virgule ou point-virgule)
          </div>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder="John Doe,john@mail.com,Pass123,cq,Cell A"
            style={{
              width: "100%",
              minHeight: 140,
              padding: "0.75rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--border-strong)",
              background: "var(--panel)",
              color: "var(--text)",
            }}
          />

          <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: "0.85rem", opacity: 0.85 }}>
              <b>Excel</b> : colonnes <code>name</code>, <code>email</code>, <code>password</code>, <code>role</code>, <code>cell</code> (+ <code>project</code>, <code>contract</code> facultatives)
            </div>
            <input
              ref={bulkFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleBulkFileChange}
              style={{ fontSize: "0.85rem" }}
            />
            {isBulkUploading && <span style={{ opacity: 0.85 }}>Import en cours…</span>}
          </div>
        </Card>
      </div>

      <Card title="Structures / Cellules & Équipes" right={<button className="btn-primary" onClick={createCell}><Ico n="plus" /> Ajouter cellule</button>}>
        <form
          onSubmit={(e) => { e.preventDefault(); createCell(); }}
          style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr)", gap: "0.5rem", alignItems: "center", marginBottom: 12 }}
        >
          <input ref={cellNameRef} className="input" placeholder="Nom de cellule *" value={cellName} onChange={(e) => setCellName(e.target.value)} />
          <input className="input" placeholder="Équipes (séparées par des virgules)" value={cellDescription} onChange={(e) => setCellDescription(e.target.value)} />
          <RefSelect value={cellProject} onChange={setCellProject} items={projects} placeholder="Projet (aucun)" />
          <RefSelect value={cellContract} onChange={(v) => { setCellContract(v); setCellActivity(""); }} items={contracts} placeholder="Contrat (aucun)" />
          <Select className="input" value={cellActivity} onChange={(e) => setCellActivity(e.target.value)} disabled={!cellContract}>
            <option value="">{cellContract ? "Activité (aucune)" : "Activité : choisir un contrat"}</option>
            {activities.filter((a) => a.contract === cellContract && a.active !== false).map((a) => <option key={a._id} value={a.name}>{a.name}</option>)}
          </Select>
          <button type="submit" hidden aria-hidden="true" />
        </form>

        {/* Cell cards with members */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cells.map((c) => {
            const cellMembers = (users || []).filter((u) => String(u.cell || "").toLowerCase() === String(c.name || "").toLowerCase());
            const pilotes = cellMembers.filter((u) => u.role === "pilote");
            const managers = cellMembers.filter((u) => ["management", "superviseur", "referent", "cdp"].includes(u.role));
            const cqs = cellMembers.filter((u) => u.role === "cq");
            const teams = (c.description || "").split(",").map((t) => t.trim()).filter(Boolean);

            return (
              <div key={c._id} style={{ border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", padding: 14, background: "var(--panel-2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: "1.1rem" }}><Ico n="building" /></span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>{safeStr(c.name)}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                        {cellMembers.length} membre{cellMembers.length > 1 ? "s" : ""} • {c.active === false ? "Inactive" : "Active"}
                        {c.project ? ` • Projet : ${c.project}` : ""}{c.contract ? ` • Contrat : ${c.contract}` : ""}{c.activity ? ` • ${c.activity}` : ""}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn-outline" style={{ fontSize: "0.8rem", padding: "4px 10px" }} onClick={() => setEditCell({ ...c })}>Modifier</button>
                    <button className="btn-danger" style={{ fontSize: "0.8rem", padding: "4px 10px" }} onClick={() => deleteCell(c)}>Suppr.</button>
                  </div>
                </div>

                {/* Teams */}
                {teams.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {teams.map((t) => (
                      <span key={t} className="badge badge--primary" style={{ fontSize: "0.75rem" }}><Ico n="users" /> {t}</span>
                    ))}
                  </div>
                )}

                {/* Members by role */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Management ({managers.length})</div>
                    {managers.length === 0 ? <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>—</div> : managers.map((u) => (
                      <div key={u._id} style={{ fontSize: "0.8rem", fontWeight: 600, padding: "2px 0" }}><Ico n="chart" /> {u.name}</div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>CQ ({cqs.length})</div>
                    {cqs.length === 0 ? <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>—</div> : cqs.map((u) => (
                      <div key={u._id} style={{ fontSize: "0.8rem", fontWeight: 600, padding: "2px 0" }}><Ico n="headphones" /> {u.name}</div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Pilotes ({pilotes.length})</div>
                    {pilotes.length === 0 ? <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>—</div> : pilotes.slice(0, 8).map((u) => (
                      <div key={u._id} style={{ fontSize: "0.8rem", fontWeight: 600, padding: "2px 0" }}><Ico n="user" /> {u.name}</div>
                    ))}
                    {pilotes.length > 8 && <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>+{pilotes.length - 8} autres</div>}
                  </div>
                </div>
              </div>
            );
          })}
          {cells.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>Aucune cellule définie.</div>
          )}
        </div>
      </Card>

      {/* ---------- Modals ---------- */}
      {(editing || pwd.id || editCell) && (
        <div
          onMouseDown={closeAll}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 50,
            padding: "1rem",
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(860px, 96vw)",
              background: "var(--panel)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-xl)",
              padding: "1.25rem",
            }}
          >
            {editing && (
              <>
                <div style={{ fontWeight: 900, fontSize: "1.05rem", marginBottom: "0.75rem" }}>Modifier utilisateur</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "0.6rem" }}>
                  <input className="input" value={safeStr(editing.name)} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <input className="input" value={safeStr(editing.email)} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                  <Select className="input" value={safeStr(editing.role)} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
<option value="pilote">Pilote</option>
                <option value="referent">Référent technique</option>
                <option value="superviseur">Superviseur</option>
                <option value="cq">CQ</option>
                <option value="formateur">Formateur</option>
                <option value="cdp">Chef de projet</option>
                <option value="admin">Admin</option>
                <option value="management">Management (historique)</option>
                <option value="supervision">Supervision (historique)</option>
                  </Select>
                  <Select className="input" multiple placeholder="Aucune cellule" title="Cellules (la première = cellule principale)"
                    value={[editing.cell, ...(Array.isArray(editing.extraCells) ? editing.extraCells : [])].filter(Boolean)}
                    onChange={(e) => {
                      const sel = e.target.selectedOptions.map((o) => o.value);
                      setEditing({ ...editing, cell: sel[0] || "", extraCells: sel.slice(1) });
                    }}>
                    {cells.map((c) => (
                      <option key={c._id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </Select>

                  {editing.role === "pilote" && (
                    <Select className="input" value={String(editing.referent || "")} onChange={(e) => setEditing({ ...editing, referent: e.target.value })} title="Référent technique">
                      <option value="">Référent technique : aucun</option>
                      {referentsList.map((r) => <option key={r._id} value={r._id}>Référent : {r.name}{r.cell ? ` — ${r.cell}` : ""}</option>)}
                    </Select>
                  )}
                  {["pilote", "referent"].includes(editing.role) && (
                    <Select className="input" value={String(editing.superviseur || "")} onChange={(e) => setEditing({ ...editing, superviseur: e.target.value })} title="Superviseur">
                      <option value="">Superviseur : aucun</option>
                      {superviseursList.map((r) => <option key={r._id} value={r._id}>Superviseur : {r.name}</option>)}
                    </Select>
                  )}
                  {["superviseur", "referent"].includes(editing.role) && (
                    <Select className="input" multiple value={Array.isArray(editing.poles) ? editing.poles : []} title="Pôle(s) affecté(s)" placeholder="Pôle : activités de ses cellules"
                      onChange={(e) => setEditing({ ...editing, poles: Array.from(e.target.selectedOptions || []).map((o) => o.value) })}>
                      {activities.filter((a) => a.active !== false).map((a) => <option key={a._id} value={a.name}>Pôle : {a.name} ({a.contract})</option>)}
                    </Select>
                  )}
                  <RefSelect value={editing.project || ""} onChange={(v) => setEditing({ ...editing, project: v })} items={projects} placeholder="Projet (aucun)" />
                  <RefSelect value={editing.contract || ""} onChange={(v) => setEditing({ ...editing, contract: v })} items={contracts} placeholder="Contrat (aucun)" />
                  <Select className="input" value={editing.visibilityScope || ""} onChange={(e) => setEditing({ ...editing, visibilityScope: e.target.value })} title="Périmètre de consultation">
                    {VISIBILITY_SCOPES.map((o) => <option key={o.value} value={o.value}>Consultation : {o.label}</option>)}
                  </Select>
                  <Select className="input" value={editing.editScope || ""} onChange={(e) => setEditing({ ...editing, editScope: e.target.value })} title="Périmètre de modification">
                    {EDIT_SCOPES.map((o) => <option key={o.value} value={o.value}>Modification : {o.label}</option>)}
                  </Select>
                  <div style={{ gridColumn: "1 / -1", fontSize: "0.78rem", color: "var(--muted)", marginTop: -2 }}>
                    Cellules : la première sélectionnée est la cellule principale, les suivantes sont des cellules supplémentaires autorisées.
                  </div>

                  <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={editing.active !== false}
                      onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                    />
                    Actif
                  </label>
                </div>

                <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button className="btn-outline" onClick={closeAll}>Annuler</button>
                  <button className="btn-primary" onClick={upsertUser}>Enregistrer</button>
                </div>
              </>
            )}

            {pwd.id && (
              <>
                <div style={{ fontWeight: 900, fontSize: "1.05rem", marginBottom: "0.25rem" }}>Modifier le mot de passe</div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.9rem" }}>{pwd.name}</div>

                <div className="pwd-field">
                  <div className="label">Mot de passe actuel</div>
                  <div className="pwd-current">
                    <Ico n="lock" />
                    {pwd.current?.available
                      ? <code className="pwd-current__value">{pwd.current.password}</code>
                      : <span>••••••••••</span>}
                    {pwd.current?.available ? (
                      <>
                        <button type="button" className="iconbtn" title="Copier" aria-label="Copier le mot de passe actuel" onClick={() => copyPassword(pwd.current.password)}><Ico n="copy" /></button>
                        <button type="button" className="iconbtn" title="Masquer" aria-label="Masquer le mot de passe actuel" onClick={() => setPwd((p) => ({ ...p, current: null }))}><Ico n="eyeOff" /></button>
                      </>
                    ) : (
                      <button type="button" className="btn btn--ghost btn--sm" disabled={pwd.loadingCurrent} onClick={showCurrentPassword}><Ico n="eye" /> {pwd.loadingCurrent ? "Chargement…" : "Afficher"}</button>
                    )}
                    <span className="pwd-current__note">
                      {pwd.current && !pwd.current.available ? pwd.current.message : "Stocké chiffré ; chaque consultation est enregistrée dans le journal d'audit."}
                    </span>
                  </div>
                </div>

                <div className="pwd-field">
                  <div className="label">Nouveau mot de passe</div>
                  <div className="pwd-input">
                    <input className="input" type={pwd.show ? "text" : "password"} autoComplete="new-password" placeholder="Au moins 6 caractères" value={pwd.value} onChange={(e) => setPwd({ ...pwd, value: e.target.value, saved: "" })} />
                    <button type="button" className="iconbtn" title={pwd.show ? "Masquer" : "Afficher"} aria-label={pwd.show ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setPwd({ ...pwd, show: !pwd.show })}><Ico n={pwd.show ? "eyeOff" : "eye"} /></button>
                    <button type="button" className="iconbtn" title="Copier" aria-label="Copier le mot de passe" disabled={!pwd.value} onClick={() => copyPassword(pwd.value)}><Ico n="copy" /></button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPwd({ ...pwd, value: generatePassword(), show: true, saved: "" })}><Ico n="shuffle" /> Générer</button>
                  </div>
                  {pwd.value && pwd.value.length < 6 && <div style={{ color: "var(--danger)", fontSize: "0.78rem", marginTop: 4 }}>Au moins 6 caractères.</div>}
                </div>

                {pwd.saved && (
                  <div className="pwd-saved">
                    <Ico n="checkCircle" /> Nouveau mot de passe enregistré : <code>{pwd.saved}</code>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => copyPassword(pwd.saved)}><Ico n="copy" /> Copier</button>
                  </div>
                )}

                <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button className="btn-outline" onClick={closeAll}>{pwd.saved ? "Fermer" : "Annuler"}</button>
                  {!pwd.saved && <button className="btn-primary" onClick={setPassword} disabled={!pwd.value || pwd.value.length < 6}>Enregistrer</button>}
                </div>
              </>
            )}

            {editCell && (
              <>
                <div style={{ fontWeight: 900, fontSize: "1.05rem", marginBottom: "0.75rem" }}>Modifier cellule</div>
                <div style={{ display: "grid", gap: "0.6rem" }}>
                  <div>
                    <div className="label" style={{ marginBottom: 4 }}>Nom de la cellule</div>
                    <input className="input" value={safeStr(editCell.name)} onChange={(e) => setEditCell({ ...editCell, name: e.target.value })} />
                  </div>
                  <div>
                    <div className="label" style={{ marginBottom: 4 }}>Équipes (séparées par des virgules)</div>
                    <input className="input" value={safeStr(editCell.description)} onChange={(e) => setEditCell({ ...editCell, description: e.target.value })} placeholder="Ex: Équipe A, Équipe B, Équipe C" />
                    <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 4 }}>Les équipes permettent d'organiser les agents à l'intérieur de la cellule.</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                    <div>
                      <div className="label" style={{ marginBottom: 4 }}>Projet</div>
                      <RefSelect value={editCell.project || ""} onChange={(v) => setEditCell({ ...editCell, project: v })} items={projects} placeholder="Aucun" />
                    </div>
                    <div>
                      <div className="label" style={{ marginBottom: 4 }}>Contrat</div>
                      <RefSelect value={editCell.contract || ""} onChange={(v) => setEditCell({ ...editCell, contract: v, activity: v === editCell.contract ? editCell.activity : "" })} items={contracts} placeholder="Aucun" />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div className="label" style={{ marginBottom: 4 }}>Activité</div>
                      <Select className="input" value={editCell.activity || ""} onChange={(e) => setEditCell({ ...editCell, activity: e.target.value })} disabled={!editCell.contract}>
                        <option value="">Aucune</option>
                        {activities.filter((a) => a.contract === editCell.contract && a.active !== false).map((a) => <option key={a._id} value={a.name}>{a.name}</option>)}
                        {editCell.activity && !activities.some((a) => a.contract === editCell.contract && a.name === editCell.activity) && <option value={editCell.activity}>{editCell.activity}</option>}
                      </Select>
                    </div>
                  </div>
                  <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={editCell.active !== false}
                      onChange={(e) => setEditCell({ ...editCell, active: e.target.checked })}
                    />
                    Cellule active
                  </label>
                </div>

                <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button className="btn-outline" onClick={closeAll}>Annuler</button>
                  <button className="btn-primary" onClick={updateCell}>Enregistrer</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDel}
        danger
        title={confirmDel?.kind === "cell" ? "Supprimer la cellule ?" : "Supprimer l'utilisateur ?"}
        message={confirmDel?.kind === "cell"
          ? <>Voulez-vous vraiment supprimer la cellule <b>{confirmDel?.name}</b> ? Ses membres seront détachés de cette cellule.</>
          : <>Voulez-vous vraiment supprimer l'utilisateur <b>{confirmDel?.name}</b> ? Cette action est définitive.</>}
        confirmLabel="Oui, supprimer"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </>
  );
}