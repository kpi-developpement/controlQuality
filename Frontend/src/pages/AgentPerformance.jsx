import { withViewTransition } from "../ui/viewTransition.js";
import React, { useEffect, useMemo, useState } from "react";
import { CHART } from "../ui/chartColors.js";
import Ico from "../ui/Ico.jsx";
import api from "../api";
import ScopeFilters from "../components/ScopeFilters.jsx";
import { initialScopeFilters, scopeParams } from "../utils/scopeFilters.js";
import CoachingCreateModal from "../components/CoachingCreateModal.jsx";
import { localDate, periodRange } from "../utils/period.mjs";
import { fetchComplete } from "../utils/fetchComplete.js";
import { exportToXlsx } from "./admin/components/exportXlsx.js";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import EditScoreModal from "./admin/components/EditScoreModal.jsx";
import { useToast } from "../toast/ToastProvider.jsx";
import { scoreBadgeClass, coachingState, coachingLabel, coachingBadgeClass, COACHING_REQUIRED_BELOW } from "../utils/evalMeta.js";

// Rôles qui disposent de l'écran « Nouvelle évaluation » (ouverture d'une évaluation existante)
const CAN_OPEN = ["cq", "formateur", "management", "superviseur", "referent", "cdp"];
const TYPE_LABEL = { standard: "Standard", picking: "Picking", coaching: "Coaching", sample: "Échantillon", calibration: "Calibrage" };
const fmtDay = (d) => { const x = new Date(d); return Number.isNaN(x.getTime()) ? "—" : x.toLocaleDateString("fr-FR"); };
const me = () => { try { const u = JSON.parse(localStorage.getItem("user") || "{}"); return String(u._id || u.id || ""); } catch { return ""; } };

const scoreValue = (s) => Number(s.compliancePercent ?? s.avgPercent ?? 0);
export default function AgentPerformance({ role }) {
  const myId = useMemo(me, []);
  const [filters, setFilters] = useState(() => initialScopeFilters({ mode: "month", anchor: localDate() }));
  const [pilots, setPilots] = useState([]);
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [agentId, setAgentId] = useState("");
  const [openScore, setOpenScore] = useState(null);
  const [coachingFor, setCoachingFor] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const period = filters.period;
  const invalidRange = period.mode === "custom" && period.from && period.to && period.from > period.to;
  const endpoint = role === "cq" || role === "formateur" ? "/scores/mine" : "/scores";
  useEffect(() => {
    api.get("/coaching/filter-options").then(({ data }) => setPilots(data.pilots || [])).catch(() => {});
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (invalidRange) return undefined;
    setLoading(true); setError("");
    fetchComplete(endpoint, { ...scopeParams(filters), evaluationType: "standard,picking,coaching,sample" }, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setScores(rows); })
      .catch((e) => { if (!controller.signal.aborted) { setScores([]); setError(e.response?.data?.message || e.message || "Chargement impossible."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, endpoint, refresh, invalidRange]);

  const byAgent = useMemo(() => {
    const map = new Map();
    for (const s of scores) {
      const id = String(s.pilot?._id || s.pilotId || s.pilot || "deleted");
      if (!map.has(id)) map.set(id, { id, name: s.pilotName || s.pilot?.name || "Agent supprimé", cell: s.pilotCell || s.pilot?.cell || "", contract: s.pilot?.contract || s.contractAtEvaluation || "", count: 0, sum: 0, contested: 0, required: 0 });
      const row = map.get(id); row.count++; row.sum += scoreValue(s); if (s.contested) row.contested++;
      if (coachingState(s) === "required") row.required++;
    }
    return [...map.values()].map((r) => ({ ...r, avg: r.sum / r.count })).sort((a, b) => b.avg - a.avg);
  }, [scores]);
  const agent = byAgent.find((a) => a.id === agentId) || null;
  // « Voir cet agent » : la vue ne montre plus que l'agent choisi (statistiques comprises)
  const shown = useMemo(() => (agent ? scores.filter((s) => String(s.pilot?._id || s.pilotId || s.pilot) === agentId) : scores), [scores, agent, agentId]);
  const trend = useMemo(() => {
    const map = new Map();
    for (const s of shown) {
      const d = new Date(s.createdAt); if (!Number.isFinite(d.getTime())) continue;
      const key = localDate(d);
      if (!map.has(key)) map.set(key, { day: key, count: 0, sum: 0 });
      const row = map.get(key); row.count++; row.sum += scoreValue(s);
    }
    return [...map.values()].sort((a, b) => a.day.localeCompare(b.day)).map((r) => ({ ...r, avg: Number((r.sum / r.count).toFixed(1)) }));
  }, [shown]);
  const avg = shown.length ? shown.reduce((sum, s) => sum + scoreValue(s), 0) / shown.length : null;
  const contested = shown.filter((s) => s.contested).length;
  const agentScores = useMemo(() => [...(agent ? shown : [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [shown, agent]);
  const agentStats = useMemo(() => {
    const t = {}; let signed = 0; let required = 0; let inProgress = 0; let done = 0;
    for (const s of agentScores) {
      const k = s.evaluationType || "standard"; t[k] = (t[k] || 0) + 1; if (s.pilotValidated) signed++;
      const cs = coachingState(s); if (cs === "required") required++; if (cs === "in_progress") inProgress++; if (cs === "done") done++;
    }
    return { types: t, signed, required, inProgress, done };
  }, [agentScores]);

  // Passage liste ↔ fiche agent animé par le navigateur (View Transitions API)
  const showAgent = (id) => { withViewTransition(() => setAgentId(id)); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const backToAll = () => withViewTransition(() => setAgentId(""));
  const openEvaluation = (s) => {
    setOpenScore(null);
    window.dispatchEvent(new CustomEvent("kcq:navigate", { detail: { role, view: "new", editScoreId: String(s._id) } }));
  };
  const canCoach = (s) => role !== "supervision" && coachingState(s) === "required" && (role === "admin" || String(s.evaluator?._id || s.evaluator || "") === myId);
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
    const r = periodRange(period);
    exportToXlsx(`Performances_agents_${localDate()}.xlsx`, (agent ? [agent] : byAgent).map((a) => ({ Agent: a.name, Contrat: a.contract, Cellule: a.cell, Evaluations: a.count, "Conformité (%)": Number(a.avg.toFixed(1)), Contestées: a.contested, "Coachings requis": a.required, "Début sélection": r.dateFrom || "Toutes dates", "Fin sélection": r.dateTo || "Toutes dates" })));
  }
  return <div className="page">
    <div className="page-head"><div><div className="page-title"><Ico n="trend" /> Performance agents</div><div>Suivi par contrat, projet, cellule, agent et évaluateur. Les périodes portent sur la date de création des évaluations ; le périmètre reste celui de vos évaluations accessibles.</div></div></div>
    <ScopeFilters value={filters} onChange={(f) => { setFilters(f); }} />
    {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
      {agent && <button className="btn btn--ghost" onClick={backToAll}><Ico n="arrowL" /> Retour à tous les agents</button>}
      <button className="btn btn--ghost" disabled={loading} onClick={() => setRefresh((x) => x + 1)}>Actualiser</button>
      <button className="btn" disabled={loading || !scores.length} onClick={exportRows}>Exporter Excel</button>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>Score : <span className="badge badge--success">80–100 %</span> <span className="badge badge--warning">50–80 %</span> <span className="badge badge--danger">&lt; 50 %</span> · coaching obligatoire sous {COACHING_REQUIRED_BELOW} %</span>
    </div>
    {loading ? <p role="status">Chargement de la période…</p> : <>
      {agent && <div className="card agent-detail" style={{ marginBottom: 16 }}>
        <div className="agent-detail__head">
          <div>
            <h3 style={{ margin: 0 }}><Ico n="user" /> {agent.name}</h3>
            <div className="muted" style={{ fontSize: 13 }}>{agent.cell || "Sans cellule"}{agent.contract ? ` · ${agent.contract}` : ""} · {agent.count} évaluation{agent.count > 1 ? "s" : ""} sur la période · score moyen <span className={scoreBadgeClass(agent.avg)}>{agent.avg.toFixed(1)} %</span></div>
          </div>
          <button className="iconbtn" onClick={backToAll} aria-label="Revenir à tous les agents"><Ico n="x" /></button>
        </div>
        <div className="agent-detail__chips">
          {Object.entries(agentStats.types).map(([k, n]) => <span key={k} className="badge badge--primary">{TYPE_LABEL[k] || k} : {n}</span>)}
          <span className="badge badge--success">Signées : {agentStats.signed}</span>
          <span className="badge badge--muted">Non signées : {agentScores.length - agentStats.signed}</span>
          {agent.contested > 0 && <span className="badge badge--warning">Contestées : {agent.contested}</span>}
          {agentStats.required > 0 && <span className="badge badge--danger">Coachings requis : {agentStats.required}</span>}
          {agentStats.inProgress > 0 && <span className="badge badge--primary">Coachings en cours : {agentStats.inProgress}</span>}
          {agentStats.done > 0 && <span className="badge badge--success">Coachings finalisés : {agentStats.done}</span>}
        </div>
      </div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 16 }}>
        {[["Évaluations", shown.length], ["Score moyen", avg === null ? "—" : `${avg.toFixed(1)} %`, avg], [agent ? "Coachings requis" : "Agents évalués", agent ? agentStats.required : byAgent.length], ["Contestées", contested]].map(([label, value, tone]) => <div className="card" key={label} style={{ padding: 16 }}><div>{label}</div><strong style={{ fontSize: 25, color: tone === undefined || tone === null ? undefined : tone >= 80 ? "var(--success)" : tone >= 50 ? "var(--warning)" : "var(--danger)" }}>{value}</strong></div>)}
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3>Évolution quotidienne du score moyen{agent ? ` — ${agent.name}` : ""}</h3>
        {trend.length ? <ResponsiveContainer width="100%" height={240}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" /><YAxis domain={[0, 100]} /><Tooltip /><Line dataKey="avg" name="Score moyen (%)" stroke={CHART.primary} strokeWidth={2} /></LineChart></ResponsiveContainer> : <p>Aucune évaluation pour cette sélection.</p>}
      </div>
      {!agent ? <div className="card" style={{ overflowX: "auto" }}><table className="data-table"><thead><tr><th>Agent</th><th>Cellule</th><th>Évaluations</th><th>Score moyen</th><th>Contestées</th><th>Coachings requis</th><th>Détail</th></tr></thead><tbody>
        {byAgent.map((a) => <tr key={a.id}><td>{a.name}</td><td>{a.cell || "—"}</td><td>{a.count}</td><td><span className={scoreBadgeClass(a.avg)}>{a.avg.toFixed(1)} %</span></td><td>{a.contested}</td><td>{a.required ? <span className="badge badge--danger">{a.required}</span> : "0"}</td><td><button className="btn btn--ghost btn--sm" disabled={a.id === "deleted"} onClick={() => showAgent(a.id)}>Voir cet agent</button></td></tr>)}
        {!byAgent.length && <tr><td colSpan={7}>Aucun résultat.</td></tr>}
      </tbody></table></div>
      : <div className="card" style={{ overflowX: "auto" }}><table className="data-table agent-detail__table"><thead><tr><th>Date</th><th>Type</th><th>EPS</th><th>Évaluateur</th><th>Score</th><th>Coaching</th><th>Signature</th><th>Contestée</th><th></th></tr></thead><tbody>
        {agentScores.map((s) => { const v = scoreValue(s); const cs = coachingState(s); return <tr key={s._id} className="is-clickable" tabIndex={0} onClick={() => setOpenScore(s)} onKeyDown={(e) => { if (e.key === "Enter") setOpenScore(s); }}>
          <td>{fmtDay(s.evaluationDate || s.createdAt)}</td>
          <td><span className="badge badge--muted">{TYPE_LABEL[s.evaluationType] || "Standard"}</span></td>
          <td style={{ fontFamily: "monospace", fontSize: 12, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.eps || ""}>{s.eps || "—"}</td>
          <td>{s.evaluatorName || s.evaluator?.name || "—"}</td>
          <td><span className={scoreBadgeClass(v)}>{v.toFixed(1)} %</span></td>
          <td onClick={(e) => e.stopPropagation()}>
            {cs ? <span className={coachingBadgeClass(cs)}>{coachingLabel(s)}</span> : <span className="muted">—</span>}
            {canCoach(s) && <button className="btn btn--sm" style={{ marginLeft: 6 }} onClick={() => setCoachingFor(s)}>Créer le coaching</button>}
          </td>
          <td>{s.pilotValidated ? <span className="badge badge--success">Signée</span> : <span className="badge badge--muted">En attente</span>}</td>
          <td>{s.contested ? <span className="badge badge--warning">Oui</span> : "Non"}</td>
          <td style={{ textAlign: "right" }}><span className="agent-detail__go">Voir <Ico n="chevR" /></span></td>
        </tr>; })}
        {!agentScores.length && <tr><td colSpan={9}>Aucune évaluation.</td></tr>}
      </tbody></table></div>}
    </>}
    {openScore && <EditScoreModal key={openScore._id} score={openScore} readOnly={role !== "admin"} isSaving={saving}
      onClose={() => setOpenScore(null)} onSave={saveNotation}
      onOpen={CAN_OPEN.includes(role) ? () => openEvaluation(openScore) : undefined} />}
    {coachingFor && <CoachingCreateModal score={coachingFor} pilots={pilots} onClose={() => setCoachingFor(null)}
      onCreated={() => { setCoachingFor(null); toast?.success?.("Coaching créé : il apparaît désormais comme « en cours »."); setRefresh((x) => x + 1); }} />}
  </div>;
}
