import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import MultiSelect from "./MultiSelect.jsx";
import PeriodFilter from "./PeriodFilter.jsx";
import { EVALUATOR_ROLE_OPTIONS, initialScopeFilters } from "../utils/scopeFilters.js";

/**
 * Filtres communs (liste des besoins v3) : Période | Contrat | Projet | Cellule | Agent | Évaluateur (par rôle).
 * Les listes se restreignent en cascade (contrat → projet → cellule → agent). Le serveur applique
 * de toute façon le périmètre autorisé du rôle.
 */
export default function ScopeFilters({ value, onChange, hide = [], children }) {
  const [refs, setRefs] = useState({ cells: [], contracts: [], projects: [], pilots: [] });
  useEffect(() => {
    let m = true;
    const safe = (p) => p.then((r) => (Array.isArray(r.data) ? r.data : r.data?.pilots || [])).catch(() => []);
    Promise.all([
      safe(api.get("/admin/cells")),
      safe(api.get("/referentials/contracts", { params: { active: "true" } })),
      safe(api.get("/referentials/projects", { params: { active: "true" } })),
      safe(api.get("/coaching/filter-options")),
    ]).then(([cells, contracts, projects, pilots]) => { if (m) setRefs({ cells, contracts, projects, pilots }); });
    return () => { m = false; };
  }, []);

  const v = value || initialScopeFilters();
  const set = (k) => (val) => {
    const next = { ...v, [k]: val };
    // Cascade : un niveau supérieur modifié retire les choix devenus incohérents
    if (k === "contract" || k === "project") next.cell = (next.cell || []).filter((c) => cellOk(c, next));
    if (k !== "pilotId" && k !== "evaluatorRole") next.pilotId = (next.pilotId || []).filter((id) => pilotOk(refs.pilots.find((p) => String(p._id) === id), next));
    onChange(next);
  };
  const cellDoc = (name) => refs.cells.find((c) => c.name === name);
  function cellOk(name, f) {
    const c = cellDoc(name);
    if (f.contract?.length && c?.contract && !f.contract.includes(c.contract)) return false;
    if (f.project?.length && c?.project && !f.project.includes(c.project)) return false;
    return true;
  }
  function pilotOk(p, f) {
    if (!p) return true;
    if (f.contract?.length && p.contract && !f.contract.includes(p.contract)) return false;
    if (f.project?.length && p.project && !f.project.includes(p.project)) return false;
    if (f.cell?.length && !f.cell.includes(p.cell)) return false;
    return true;
  }

  const contractOpts = useMemo(() => refs.contracts.map((c) => ({ value: c.name, label: c.name })), [refs.contracts]);
  const projectOpts = useMemo(() => refs.projects
    .filter((p) => !v.contract?.length || !p.contract || v.contract.includes(p.contract))
    .map((p) => ({ value: p.name, label: p.name })), [refs.projects, v.contract]);
  const cellOpts = refs.cells.filter((c) => cellOk(c.name, v)).map((c) => ({ value: c.name, label: c.name }));
  const pilotOpts = refs.pilots.filter((p) => pilotOk(p, v))
    .map((p) => ({ value: String(p._id), label: `${p.name}${p.cell ? ` — ${p.cell}` : ""}` }));

  const show = (k) => !hide.includes(k);
  return (
    <div className="card filters-card">
      <div className="filters-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: show("period") ? 12 : 0 }}>
        {show("contract") && <div><div className="label">Contrat</div><MultiSelect options={contractOpts} value={v.contract} onChange={set("contract")} placeholder="Tous les contrats" /></div>}
        {show("project") && <div><div className="label">Projet</div><MultiSelect options={projectOpts} value={v.project} onChange={set("project")} placeholder="Tous les projets" /></div>}
        {show("cell") && <div><div className="label">Cellule</div><MultiSelect options={cellOpts} value={v.cell} onChange={set("cell")} placeholder="Toutes les cellules" /></div>}
        {show("pilotId") && <div><div className="label">Agent</div><MultiSelect options={pilotOpts} value={v.pilotId} onChange={set("pilotId")} placeholder="Tous les agents" /></div>}
        {show("evaluatorRole") && <div><div className="label">Évaluateur (par rôle)</div><MultiSelect options={EVALUATOR_ROLE_OPTIONS} value={v.evaluatorRole} onChange={set("evaluatorRole")} placeholder="Tous les évaluateurs" /></div>}
        {children}
      </div>
      {show("period") && <PeriodFilter value={v.period} onChange={(period) => onChange({ ...v, period })} />}
    </div>
  );
}
