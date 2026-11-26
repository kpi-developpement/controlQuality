import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import ScopeFilters from "../../components/ScopeFilters.jsx";
import { initialScopeFilters, scopeParams } from "../../utils/scopeFilters.js";
import EditScoreModal from "../admin/components/EditScoreModal.jsx";
import SamplesPage from "./SamplesPage.jsx";
import { exportToXlsx } from "../admin/components/exportXlsx.js";
import { fetchComplete } from "../../utils/fetchComplete.js";
import { localDate } from "../../utils/period.mjs";
import { fmtDate, scorePercent, scoreBadgeClass, coachingState, coachingLabel, coachingBadgeClass, getCurrentUser, navigate, nonConformText } from "../../utils/evalMeta.js";

// Rôles qui réalisent des pickings (mêmes droits que la création d'une évaluation)
const WRITERS = ["cq", "formateur", "management", "superviseur", "referent", "cdp"];
const MIN_PICKING_EPS = 5;

/**
 * Onglet « Picking » (ex « Échantillons & suivi ») :
 *  - Pickings : contrôles de conformité au process, saisis comme une évaluation, sans prime,
 *    portant sur plusieurs EPS (5 minimum) ;
 *  - Échantillons & suivi : sélection d'appels, affectation et suivi (inchangé).
 */
export default function PickingPage() {
  const user = getCurrentUser();
  const role = user?.role || "";
  const canWrite = WRITERS.includes(role);
  const [tab, setTab] = useState("pickings");
  const [filters, setFilters] = useState(() => initialScopeFilters({ mode: "month", anchor: localDate() }));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [viewing, setViewing] = useState(null);
  const endpoint = ["cq", "formateur"].includes(role) ? "/scores/mine" : "/scores";

  useEffect(() => {
    if (tab !== "pickings") return undefined;
    const controller = new AbortController();
    setLoading(true); setErr("");
    fetchComplete(endpoint, { ...scopeParams(filters), evaluationType: "picking", multiEps: "1" }, controller.signal)
      .then((r) => { if (!controller.signal.aborted) setRows(r); })
      .catch((e) => { if (!controller.signal.aborted) { setRows([]); setErr(e?.response?.data?.message || "Chargement des pickings impossible."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, endpoint, tab]);

  const avg = useMemo(() => (rows.length ? rows.reduce((n, s) => n + Number(scorePercent(s) || 0), 0) / rows.length : null), [rows]);
  const epsCount = useMemo(() => rows.reduce((n, s) => n + (s.epsList?.length || 0), 0), [rows]);

  function onExport() {
    exportToXlsx(`Pickings_${localDate()}.xlsx`, rows.map((s) => ({
      Date: fmtDate(s.createdAt), Agent: s.pilotName || s.pilot?.name || "", Contrat: s.pilot?.contract || s.contractAtEvaluation || "",
      Projet: s.pilot?.project || s.projectAtEvaluation || "", Cellule: s.pilotCell || s.pilot?.cell || s.cellAtEvaluation || "",
      Évaluateur: s.evaluatorName || s.evaluator?.name || "", "Nombre d'EPS": s.epsList?.length || 0, EPS: (s.epsList || []).join(", "),
      "Conformité process (%)": Number(scorePercent(s) || 0).toFixed(1), "Éléments PNC / NP": nonConformText(s.items, ["PNC", "NP"]),
      "Éléments NC": nonConformText(s.items, ["NC"]), Coaching: coachingLabel(s), Commentaire: s.comment || "",
    })));
  }

  const tabs = (
    <div className="seg" role="tablist" aria-label="Picking" style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 10, background: "var(--chip)", marginBottom: 12 }}>
      {[["pickings", "Pickings (contrôle process)"], ["samples", "Échantillons & suivi"]].map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "btn btn--sm" : "btn btn--ghost btn--sm"} onClick={() => setTab(k)}>{label}</button>
      ))}
    </div>
  );

  if (tab === "samples") return <><div className="page" style={{ paddingBottom: 0 }}>{tabs}</div><SamplesPage /></>;

  return (
    <div className="page">
      <PageHeader
        title="Picking"
        subtitle={`Contrôles de conformité au process, saisis comme une évaluation, sans prime, sur ${MIN_PICKING_EPS} EPS minimum.`}
        right={canWrite ? <button className="btn" type="button" onClick={() => navigate("picking_new")}>+ Nouveau picking</button> : null}
      />
      {tabs}
      <ScopeFilters value={filters} onChange={setFilters} />
      {err && <div className="card" role="alert" style={{ padding: 12, color: "var(--danger)", background: "var(--danger-bg)", marginBottom: 12 }}>{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: 16 }}><div>Pickings</div><strong style={{ fontSize: 25 }}>{loading ? "…" : rows.length}</strong></div>
        <div className="card" style={{ padding: 16 }}><div>EPS contrôlés</div><strong style={{ fontSize: 25 }}>{loading ? "…" : epsCount}</strong></div>
        <div className="card" style={{ padding: 16 }}><div>Conformité moyenne</div><strong style={{ fontSize: 25, color: avg === null ? undefined : avg >= 80 ? "var(--success)" : avg >= 50 ? "var(--warning)" : "var(--danger)" }}>{loading ? "…" : avg === null ? "—" : `${avg.toFixed(1)} %`}</strong></div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Pickings</div>
          <button className="btn btn--sm" type="button" onClick={onExport} disabled={loading || !rows.length}>Exporter Excel</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Agent</th><th>Cellule</th><th>Évaluateur</th><th>EPS contrôlés</th><th>Conformité</th><th>Coaching</th><th></th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const pct = Number(scorePercent(s) || 0);
                const cs = coachingState(s);
                return (
                  <tr key={String(s._id)} className="is-clickable" tabIndex={0} onClick={() => setViewing(s)} onKeyDown={(e) => { if (e.key === "Enter") setViewing(s); }}>
                    <td>{fmtDate(s.createdAt)}</td>
                    <td style={{ fontWeight: 600 }}>{s.pilotName || s.pilot?.name || "—"}</td>
                    <td><span className="badge badge--muted">{s.pilotCell || s.pilot?.cell || s.cellAtEvaluation || "—"}</span></td>
                    <td>{s.evaluatorName || s.evaluator?.name || "—"}</td>
                    <td title={(s.epsList || []).join(", ")}><span className="badge badge--primary">{s.epsList?.length || 0} EPS</span> <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--muted)" }}>{(s.epsList || []).slice(0, 3).join(", ")}{(s.epsList || []).length > 3 ? "…" : ""}</span></td>
                    <td><span className={scoreBadgeClass(pct)}>{pct.toFixed(1)} %</span></td>
                    <td>{cs ? <span className={coachingBadgeClass(cs)}>{coachingLabel(s)}</span> : "—"}</td>
                    <td style={{ textAlign: "right" }}><span className="agent-detail__go">Voir</span></td>
                  </tr>
                );
              })}
              {!loading && !rows.length && <tr><td colSpan={8} className="empty-state"><div className="empty-state__text">Aucun picking sur la période.{canWrite ? " Utilisez « + Nouveau picking »." : ""}</div></td></tr>}
              {loading && <tr><td colSpan={8} style={{ color: "var(--muted)", padding: 16 }}>Chargement…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {viewing && <EditScoreModal key={viewing._id} score={viewing} readOnly onClose={() => setViewing(null)}
        onOpen={canWrite && String(viewing.evaluator?._id || viewing.evaluator) === String(user?._id || user?.id) ? () => { setViewing(null); navigate("picking_new", { editScoreId: String(viewing._id) }); } : undefined} />}
    </div>
  );
}
