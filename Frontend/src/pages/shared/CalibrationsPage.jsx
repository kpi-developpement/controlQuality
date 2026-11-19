import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import KpiCard, { fmtRate } from "../../components/KpiCard.jsx";
import { fetchComplete } from "../../utils/fetchComplete.js";
import { exportToXlsx } from "../admin/components/exportXlsx.js";
import { DIRECTIONS, directionLabel, scorePercent, fmtDate, evalExportRow, evalCriteriaRows, getCurrentUser, navigate } from "../../utils/evalMeta.js";
import Ico from "../../ui/Ico.jsx";
import Select from "../../ui/Select.jsx";

const GAP_OK = 10; // écart max (points) pour considérer un appel « aligné »
const GAP_WARN = 20;
const curYM = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

/**
 * Onglet Calibrages (contrat Orange, §3.1) : appels entrants / sortants évalués par plusieurs
 * évaluateurs pour mesurer leur alignement. Les calibrages sont exclus des indicateurs agents.
 */
export default function CalibrationsPage() {
  const user = getCurrentUser();
  const role = user?.role || "";
  const canCreate = ["cq", "formateur", "management"].includes(role);
  const endpoint = ["cq", "formateur"].includes(role) ? "/scores/mine" : "/scores";
  const [ym, setYm] = useState(curYM());
  const [direction, setDirection] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true); setErr("");
    const [y, m] = ym.split("-");
    fetchComplete(endpoint, { evaluationType: "calibration", year: y, month: m, callDirection: direction || undefined }, ctrl.signal)
      .then((rows) => !ctrl.signal.aborted && setItems(rows))
      .catch((e) => !ctrl.signal.aborted && setErr(e?.response?.data?.message || e.message || "Chargement impossible."))
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [endpoint, ym, direction]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const s of items) {
      const key = s.eps || String(s._id);
      if (!map.has(key)) map.set(key, { eps: s.eps || "—", direction: s.callDirection || "", pilot: s.pilotName || s.pilot?.name || "", cell: s.pilotCell || s.pilot?.cell || "", callDate: s.callDate, evals: [] });
      map.get(key).evals.push(s);
    }
    const text = q.trim().toLowerCase();
    return [...map.values()]
      .map((g) => {
        const pcts = g.evals.map((e) => Number(scorePercent(e)) || 0);
        const min = Math.min(...pcts);
        const max = Math.max(...pcts);
        return { ...g, count: g.evals.length, min, max, avg: pcts.reduce((a, b) => a + b, 0) / pcts.length, gap: max - min, last: g.evals.reduce((d, e) => (new Date(e.createdAt) > d ? new Date(e.createdAt) : d), new Date(0)) };
      })
      .filter((g) => !text || `${g.eps} ${g.pilot} ${g.cell}`.toLowerCase().includes(text))
      .sort((a, b) => b.last - a.last);
  }, [items, q]);

  const multi = groups.filter((g) => g.count >= 2);
  const aligned = multi.filter((g) => g.gap <= GAP_OK).length;
  const avgGap = multi.length ? multi.reduce((n, g) => n + g.gap, 0) / multi.length : null;

  function calibrate(g) {
    const first = g?.evals?.[0];
    if (first) {
      try {
        sessionStorage.setItem("pending_calibration_prefill", JSON.stringify({
          eps: first.eps, pilotId: first.pilot?._id || first.pilotId || first.pilot, callDate: first.callDate,
          callDirection: first.callDirection, gridId: first.gridId?._id || first.gridId, callDuration: first.callDuration,
        }));
      } catch {}
    }
    navigate("calibration_new");
  }

  function onExport() {
    exportToXlsx(`Calibrages_${ym}.xlsx`, {
      "Synthèse par appel": groups.map((g) => ({ EPS: g.eps, "Sens d'appel": directionLabel(g.direction), Agent: g.pilot, Cellule: g.cell, "Date appel": fmtDate(g.callDate), Évaluateurs: g.count, "Score min (%)": g.min.toFixed(1), "Score max (%)": g.max.toFixed(1), "Moyenne (%)": g.avg.toFixed(1), "Écart (pts)": g.gap.toFixed(1), Alignement: g.count < 2 ? "Un seul évaluateur" : g.gap <= GAP_OK ? "Aligné" : g.gap <= GAP_WARN ? "À surveiller" : "Écart important" })),
      Calibrages: items.map(evalExportRow),
      "Grilles (critères)": evalCriteriaRows(items),
    });
  }

  // Matrice critères × évaluateurs pour l'appel sélectionné
  const matrix = useMemo(() => {
    if (!detail) return null;
    const labels = [];
    for (const e of detail.evals) for (const it of e.items || []) if (it.label && !labels.includes(it.label)) labels.push(it.label);
    return labels.map((label) => {
      const cells = detail.evals.map((e) => (e.items || []).find((it) => it.label === label)?.status || "—");
      const set = new Set(cells.filter((c) => c !== "—" && c !== "NA"));
      return { label, cells, divergent: set.size > 1 };
    });
  }, [detail]);

  return (
    <div className="page">
      <PageHeader
        title="Calibrages"
        subtitle="Appels entrants et sortants évalués par plusieurs évaluateurs. Exclus des indicateurs de performance agents."
        right={canCreate ? <button className="btn" type="button" onClick={() => calibrate(null)}>+ Nouveau calibrage</button> : null}
      />

      <div className="card filters-card" style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" }}>
          <label className="label">Mois (réalisation)<input className="input" type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>
          <label className="label">Sens d'appel
            <Select className="input" value={direction} onChange={(e) => setDirection(e.target.value)}>
              {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.value ? d.label : "Entrants et sortants"}</option>)}
            </Select>
          </label>
          <label className="label">Recherche<input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="EPS, agent, cellule…" /></label>
          <button className="btn btn--ghost" type="button" onClick={onExport} disabled={!items.length}>Exporter Excel</button>
        </div>
      </div>

      {err && <div className="card" style={{ padding: 12, color: "var(--danger)", background: "var(--danger-bg)", marginBottom: 12 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
        <KpiCard title="Appels calibrés" value={groups.length} detail={`${items.length} évaluations de calibrage`} />
        <KpiCard title="Appels multi-évaluateurs" value={multi.length} detail="Au moins 2 évaluateurs" />
        <KpiCard title="Appels alignés" value={multi.length ? fmtRate((aligned / multi.length) * 100) : "—"} detail={`Écart ≤ ${GAP_OK} points`} tone={multi.length ? (aligned / multi.length >= 0.8 ? "good" : "warn") : undefined} />
        <KpiCard title="Écart moyen" value={avgGap === null ? "—" : `${avgGap.toFixed(1)} pts`} detail="Score max − score min par appel" />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>EPS</th><th>Sens</th><th>Agent</th><th>Cellule</th><th>Date appel</th><th>Évaluateurs</th><th>Min</th><th>Max</th><th>Écart</th><th>Alignement</th><th></th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.eps}>
                  <td style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "0.82rem" }}>{g.eps}</td>
                  <td>{directionLabel(g.direction) || "—"}</td>
                  <td>{g.pilot || "—"}</td>
                  <td>{g.cell ? <span className="badge badge--muted">{g.cell}</span> : "—"}</td>
                  <td>{fmtDate(g.callDate) || "—"}</td>
                  <td>{g.count}</td>
                  <td>{g.min.toFixed(1)} %</td>
                  <td>{g.max.toFixed(1)} %</td>
                  <td>{g.count > 1 ? `${g.gap.toFixed(1)} pts` : "—"}</td>
                  <td>{g.count < 2 ? <span className="badge badge--muted">1 évaluateur</span> : g.gap <= GAP_OK ? <span className="badge badge--success">Aligné</span> : g.gap <= GAP_WARN ? <span className="badge badge--warning">À surveiller</span> : <span className="badge badge--danger">Écart important</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => setDetail(g)}>Détail</button>{" "}
                    {canCreate && <button className="btn btn--sm" type="button" onClick={() => calibrate(g)}>Calibrer</button>}
                  </td>
                </tr>
              ))}
              {!loading && groups.length === 0 && <tr><td colSpan={11} className="empty-state"><div className="empty-state__text">Aucun calibrage sur la période.</div></td></tr>}
              {loading && <tr><td colSpan={11} style={{ padding: 16, color: "var(--muted)" }}>Chargement…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: "96vw", maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800 }}>Calibrage — {detail.eps} {detail.direction ? `(${directionLabel(detail.direction)})` : ""}</div>
              <button className="btn btn--ghost btn--sm" onClick={() => setDetail(null)}>Fermer</button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr><th>Critère</th>{detail.evals.map((e) => <th key={e._id}>{e.evaluatorName || e.evaluator?.name || "—"}</th>)}</tr>
                </thead>
                <tbody>
                  <tr><td style={{ fontWeight: 700 }}>Score</td>{detail.evals.map((e) => <td key={e._id} style={{ fontWeight: 700 }}>{Number(scorePercent(e)).toFixed(1)} %</td>)}</tr>
                  <tr><td>Code de clôture</td>{detail.evals.map((e) => <td key={e._id}>{e.closureCode || "—"}</td>)}</tr>
                  {(matrix || []).map((r) => (
                    <tr key={r.label} style={r.divergent ? { background: "var(--warning-bg)" } : undefined}>
                      <td>{r.label}{r.divergent ? <Ico n="alert" /> : ""}</td>
                      {r.cells.map((c, i) => <td key={i}>{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 8 }}>Les lignes surlignées signalent un désaccord entre évaluateurs sur le critère.</div>
          </div>
        </div>
      )}
    </div>
  );
}
