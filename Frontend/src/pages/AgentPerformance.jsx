import React, { useEffect, useMemo, useRef, useState } from "react";
import Ico from "../ui/Ico.jsx";
import api from "../api";
import MultiSelect from "../components/MultiSelect.jsx";
import PeriodFilter from "../components/PeriodFilter.jsx";
import { initialPeriod, localDate, periodRange } from "../utils/period.mjs";
import { fetchComplete } from "../utils/fetchComplete.js";
import { exportToXlsx } from "./admin/components/exportXlsx.js";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import Select from "../ui/Select.jsx";
import EditScoreModal from "./admin/components/EditScoreModal.jsx";
import { useToast } from "../toast/ToastProvider.jsx";

// Rôles qui disposent de l'écran « Nouvelle évaluation » (ouverture d'une évaluation existante)
const CAN_OPEN = ["cq", "formateur", "management", "superviseur", "referent", "cdp"];
const TYPE_LABEL = { standard: "Standard", picking: "Picking", coaching: "Coaching", sample: "Échantillon", calibration: "Calibrage" };
const fmtDay = (d) => { const x = new Date(d); return Number.isNaN(x.getTime()) ? "—" : x.toLocaleDateString("fr-FR"); };

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
  const [agentId, setAgentId] = useState("");
  const [openScore, setOpenScore] = useState(null);
  const [saving, setSaving] = useState(false);
  const detailRef = useRef(null);
  const toast = useToast();
  const invalidRange = period.mode === "custom" && period.from && period.to && period.from > period.to;
  const endpoint = role === "cq" || role === "formateur" ? "/scores/mine" : "/scores";
  useEffect(() => {
    let active = true;
    api.get("/coaching/filter-options").then(({ data }) => { if (active) setPilots(data.pilots || []); })
      .catch(() => { if (active) setOptionsError("Impossible de charger les agents et cellules. Rechargez la page."); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (invalidRange) return undefined;
    setLoading(true); setError("");
    fetchComplete(endpoint, { ...periodRange(period), pilotId: pilotIds.join(","), cell, evaluationType: "standard,picking,coaching,sample" }, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setScores(rows); })
      .catch((e) => { if (!controller.signal.aborted) { setScores([]); setError(e.response?.data?.message || e.message || "Chargement impossible."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, pilotIds, cell, endpoint, refresh, invalidRange]);
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
  const agent = byAgent.find((a) => a.id === agentId) || null;
  const agentScores = useMemo(() => scores
    .filter((s) => String(s.pilot?._id || s.pilotId || s.pilot) === agentId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [scores, agentId]);
  const agentStats = useMemo(() => {
    const t = {}; let signed = 0;
    for (const s of agentScores) { const k = s.evaluationType || "standard"; t[k] = (t[k] || 0) + 1; if (s.pilotValidated) signed++; }
    return { types: t, signed };
  }, [agentScores]);
  const showAgent = (id) => {
    setAgentId((cur) => (cur === id ? "" : id));
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const openEvaluation = (s) => {
    setOpenScore(null);
    window.dispatchEvent(new CustomEvent("kcq:navigate", { detail: { role, view: "new", editScoreId: String(s._id) } }));
  };
  async function saveNotation(items) {
    if (!openScore?._id) return;
    try {
      setSaving(true);
      const { data } = await api.patch(`/scores/${openScore._id}`, { items }, { toast: false });
      setScores((prev) => prev.map((x) => (String(x._id) === String(openScore._id) ? { ...x, ...data, compliancePercent: data?.compliancePercent ?? x.compliancePercent } : x)));
      setOpenScore(null);
      toast?.success?.("Notation enregistrée.");
      setRefresh((x) => x + 1);
    } catch (e) {
      toast?.error?.(e.response?.data?.message || "Enregistrement impossible.");
    } finally { setSaving(false); }
  }
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
        {byAgent.map((a) => <tr key={a.id} className={agentId === a.id ? "is-selected" : undefined}><td>{a.name}</td><td>{a.cell || "—"}</td><td>{a.count}</td><td>{a.avg.toFixed(1)} %</td><td>{a.contested}</td><td><button className="btn btn--ghost btn--sm" disabled={a.id === "deleted"} onClick={() => showAgent(a.id)}>{agentId === a.id ? "Masquer" : "Voir cet agent"}</button></td></tr>)}
        {!byAgent.length && <tr><td colSpan={6}>Aucun résultat.</td></tr>}
      </tbody></table></div>
      {agent && <div className="card agent-detail" ref={detailRef}>
        <div className="agent-detail__head">
          <div>
            <h3 style={{ margin: 0 }}><Ico n="user" /> {agent.name}</h3>
            <div className="muted" style={{ fontSize: 13 }}>{agent.cell || "Sans cellule"} · {agent.count} évaluation{agent.count > 1 ? "s" : ""} sur la période · score moyen {agent.avg.toFixed(1)} %</div>
          </div>
          <button className="iconbtn" onClick={() => setAgentId("")} aria-label="Fermer le détail"><Ico n="x" /></button>
        </div>
        <div className="agent-detail__chips">
          {Object.entries(agentStats.types).map(([k, n]) => <span key={k} className="badge badge--primary">{TYPE_LABEL[k] || k} : {n}</span>)}
          <span className="badge badge--success">Signées : {agentStats.signed}</span>
          <span className="badge badge--muted">Non signées : {agentScores.length - agentStats.signed}</span>
          {agent.contested > 0 && <span className="badge badge--warning">Contestées : {agent.contested}</span>}
        </div>
        <div style={{ overflowX: "auto" }}><table className="data-table agent-detail__table"><thead><tr><th>Date</th><th>Type</th><th>EPS</th><th>Évaluateur</th><th>Score</th><th>Signature</th><th>Contestée</th><th></th></tr></thead><tbody>
          {agentScores.map((s) => { const v = scoreValue(s); return <tr key={s._id} className="is-clickable" tabIndex={0} onClick={() => setOpenScore(s)} onKeyDown={(e) => { if (e.key === "Enter") setOpenScore(s); }}>
            <td>{fmtDay(s.evaluationDate || s.createdAt)}</td>
            <td><span className="badge badge--muted">{TYPE_LABEL[s.evaluationType] || "Standard"}</span></td>
            <td style={{ fontFamily: "monospace", fontSize: 12 }}>{s.eps || "—"}</td>
            <td>{s.evaluatorName || s.evaluator?.name || "—"}</td>
            <td><span className={`badge ${v >= 80 ? "badge--success" : v >= 50 ? "badge--warning" : "badge--danger"}`}>{v.toFixed(1)} %</span></td>
            <td>{s.pilotValidated ? <span className="badge badge--success">Signée</span> : <span className="badge badge--muted">En attente</span>}</td>
            <td>{s.contested ? <span className="badge badge--warning">Oui</span> : "Non"}</td>
            <td style={{ textAlign: "right" }}><span className="agent-detail__go">Voir <Ico n="chevR" /></span></td>
          </tr>; })}
          {!agentScores.length && <tr><td colSpan={8}>Aucune évaluation.</td></tr>}
        </tbody></table></div>
      </div>}
    </>}
    {openScore && <EditScoreModal key={openScore._id} score={openScore} readOnly={role !== "admin"} isSaving={saving}
      onClose={() => setOpenScore(null)} onSave={saveNotation}
      onOpen={CAN_OPEN.includes(role) ? () => openEvaluation(openScore) : undefined} />}
  </div>;
}
