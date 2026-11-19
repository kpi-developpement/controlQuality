import React, { useEffect, useMemo, useState } from "react";
import Ico from "../ui/Ico.jsx";
import api from "../api";
import MultiSelect from "../components/MultiSelect.jsx";
import PeriodFilter from "../components/PeriodFilter.jsx";
import { initialPeriod, localDate, periodRange } from "../utils/period.mjs";
import { fetchComplete } from "../utils/fetchComplete.js";
import { exportToXlsx } from "./admin/components/exportXlsx.js";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import Select from "../ui/Select.jsx";

const scoreValue = (s) => Number(s.compliancePercent ?? s.avgPercent ?? 0);
export default function AgentPerformance({ role }) {
  const [period, setPeriod] = useState(() => ({ ...initialPeriod(), mode: "month" }));
  const [pilots, setPilots] = useState([]);
  const [pilotIds, setPilotIds] = useState([]);
  const [cell, setCell] = useState("");
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const endpoint = role === "cq" || role === "formateur" ? "/scores/mine" : "/scores";
  useEffect(() => {
    let active = true;
    api.get("/coaching/filter-options").then(({ data }) => { if (active) setPilots(data.pilots || []); })
      .catch(() => { if (active) setOptionsError("Impossible de charger les agents et cellules. Rechargez la page."); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetchComplete(endpoint, { ...periodRange(period), pilotId: pilotIds.join(","), cell, evaluationType: "standard,picking,coaching,sample" }, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setScores(rows); })
      .catch((e) => { if (!controller.signal.aborted) { setScores([]); setError(e.response?.data?.message || e.message || "Chargement impossible."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, pilotIds, cell, endpoint, refresh]);
  const cells = [...new Set(pilots.map((p) => p.cell).filter(Boolean))].sort();
  const visiblePilots = pilots.filter((p) => !cell || p.cell === cell);
  const byAgent = useMemo(() => {
    const map = new Map();
    for (const s of scores) {
      const id = String(s.pilot?._id || s.pilotId || s.pilot || "deleted");
      if (!map.has(id)) map.set(id, { id, name: s.pilotName || s.pilot?.name || "Agent supprimé", cell: s.pilotCell || s.pilot?.cell || "", count: 0, sum: 0, contested: 0 });
      const row = map.get(id); row.count++; row.sum += scoreValue(s); if (s.contested) row.contested++;
    }
    return [...map.values()].map((r) => ({ ...r, avg: r.sum/r.count })).sort((a,b) => b.avg-a.avg);
  }, [scores]);
  const trend = useMemo(() => {
    const map = new Map();
    for (const s of scores) {
      const d = new Date(s.createdAt); if (!Number.isFinite(d.getTime())) continue;
      const key = localDate(d);
      if (!map.has(key)) map.set(key, { day: key, count: 0, sum: 0 });
      const row = map.get(key); row.count++; row.sum += scoreValue(s);
    }
    return [...map.values()].sort((a,b) => a.day.localeCompare(b.day)).map((r) => ({ ...r, avg: Number((r.sum/r.count).toFixed(1)) }));
  }, [scores]);
  const avg = scores.length ? scores.reduce((sum,s) => sum+scoreValue(s),0)/scores.length : null;
  const contested = scores.filter((s) => s.contested).length;
  function exportRows() {
    exportToXlsx(`Performances_agents_${localDate()}.xlsx`, byAgent.map((a) => ({ Agent: a.name, Cellule: a.cell, Evaluations: a.count, "Conformité (%)": Number(a.avg.toFixed(1)), Contestées: a.contested, "Début sélection": periodRange(period).dateFrom || "Toutes dates", "Fin sélection": periodRange(period).dateTo || "Toutes dates" })));
  }
  return <div className="page">
    <div className="page-head"><div><div className="page-title"><Ico n="trend" /> Performance agents</div><div>Suivi par agent, cellule, jour, semaine ou mois. Les périodes portent sur la date de création des évaluations. Le périmètre reste celui de vos évaluations accessibles.</div></div></div>
    <div className="card filters-card">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 12 }}>
        <label>Cellule<Select className="input" value={cell} onChange={(e) => { setCell(e.target.value); setPilotIds([]); }}><option value="">Toutes les cellules</option>{cells.map((c) => <option key={c}>{c}</option>)}</Select></label>
        <div><div className="label">Agent(s) — recherche par nom</div><MultiSelect value={pilotIds} onChange={setPilotIds} options={visiblePilots.map((p) => ({ value: String(p._id), label: `${p.name} — ${p.cell || "Sans cellule"}` }))} placeholder="Tous les agents" /></div>
      </div>
      <PeriodFilter value={period} onChange={setPeriod} />
    </div>
    {(error || optionsError) && <p role="alert" style={{ color: "var(--danger)" }}>{error || optionsError}</p>}
    <div style={{ display: "flex", gap: 10, marginBottom: 12 }}><button className="btn btn--ghost" disabled={loading} onClick={() => setRefresh((x) => x+1)}>Actualiser</button><button className="btn" disabled={loading || !scores.length} onClick={exportRows}>Exporter Excel</button></div>
    {loading ? <p role="status">Chargement de la période…</p> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 16 }}>
        {[["Évaluations", scores.length], ["Score moyen", avg === null ? "—" : `${avg.toFixed(1)} %`], ["Agents évalués", byAgent.length], ["Contestées", contested]].map(([label,value]) => <div className="card" key={label} style={{ padding: 16 }}><div>{label}</div><strong style={{ fontSize: 25 }}>{value}</strong></div>)}
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3>Évolution quotidienne du score moyen</h3>
        {trend.length ? <ResponsiveContainer width="100%" height={240}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" /><YAxis domain={[0,100]} /><Tooltip /><Line dataKey="avg" name="Score moyen (%)" stroke="#2456e6" strokeWidth={2} /></LineChart></ResponsiveContainer> : <p>Aucune évaluation pour cette sélection.</p>}
      </div>
      <div className="card" style={{ overflowX: "auto" }}><table className="data-table"><thead><tr><th>Agent</th><th>Cellule</th><th>Évaluations</th><th>Score moyen</th><th>Contestées</th><th>Détail</th></tr></thead><tbody>
        {byAgent.map((a) => <tr key={a.id}><td>{a.name}</td><td>{a.cell || "—"}</td><td>{a.count}</td><td>{a.avg.toFixed(1)} %</td><td>{a.contested}</td><td><button className="btn btn--ghost btn--sm" disabled={a.id === "deleted"} onClick={() => setPilotIds([a.id])}>Voir cet agent</button></td></tr>)}
        {!byAgent.length && <tr><td colSpan={6}>Aucun résultat.</td></tr>}
      </tbody></table></div>
    </>}
  </div>;
}
