import React, { useEffect, useState } from "react";
import api from "../api";
import MultiSelect from "./MultiSelect.jsx";
import PeriodFilter from "./PeriodFilter.jsx";
import Select from "../ui/Select.jsx";
export default function CoachingFilters({ filters, onChange }) {
  const [pilots, setPilots] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.get("/coaching/filter-options").then(({ data }) => { if (active) setPilots(data.pilots || []); })
      .catch(() => { if (active) setError("Impossible de charger les agents et cellules. Rechargez la page."); });
    return () => { active = false; };
  }, []);
  const cells = [...new Set(pilots.map((p) => p.cell).filter(Boolean))].sort();
  const visible = pilots.filter((p) => !filters.cell || p.cell === filters.cell);
  return <div className="card filters-card">
    {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 12 }}>
      <label>Recherche rapide<input className="input" placeholder="Agent, cellule, EPS, notes, plan d’action…" value={filters.q} onChange={(e) => onChange({ ...filters, q: e.target.value })} /></label>
      <label>Cellule<Select className="input" value={filters.cell} onChange={(e) => onChange({ ...filters, cell: e.target.value, pilotIds: [] })}><option value="">Toutes les cellules</option>{cells.map((c) => <option key={c}>{c}</option>)}</Select></label>
      <div><div className="label">Agent(s)</div><MultiSelect options={visible.map((p) => ({ value: String(p._id), label: `${p.name} — ${p.cell || "Sans cellule"}` }))} value={filters.pilotIds} onChange={(pilotIds) => onChange({ ...filters, pilotIds })} placeholder="Tous les agents" /></div>
    </div>
    <PeriodFilter value={filters.period} onChange={(period) => onChange({ ...filters, period })} label="Date de création du coaching" />
  </div>;
}
