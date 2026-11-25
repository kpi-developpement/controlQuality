import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import PageHeader from "../../components/PageHeader.jsx";
import PerimeterFilters, { perimeterParams } from "../../components/PerimeterFilters.jsx";
import KpiCard, { fmtRate, toneFor, currentMonth } from "../../components/KpiCard.jsx";
import { exportToXlsx } from "../admin/components/exportXlsx.js";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import Select from "../../ui/Select.jsx";
import ObjectivesProgress from "./ObjectivesProgress.jsx";

const MONTH_NAMES = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const monthLabel = (m) => { const [y, mm] = String(m || "").split("-"); return y ? `${MONTH_NAMES[Number(mm) - 1]} ${y.slice(2)}` : m; };

function GroupTable({ title, rows, firstCol }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: "0.9rem" }}>{title}</div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead><tr><th>{firstCol}</th><th>Agents actifs</th><th>Réalisées</th><th>Attendues</th><th>Restantes</th><th>Couverture</th><th>Taux d'évaluation</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key || r.label}>
                <td style={{ fontWeight: 600 }}>{r.label}</td><td>{r.activeAgents}</td><td>{r.done}</td><td>{r.expected}</td><td>{r.remaining}</td>
                <td><span className={`badge ${r.rate >= 95 ? "badge--success" : r.rate >= 70 ? "badge--warning" : "badge--danger"}`}>{fmtRate(r.rate)}</span></td>
                <td>{fmtRate(r.evaluationRate)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="empty-state"><div className="empty-state__text">Aucune donnée.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Vue CQ (contrat Orange, §4) : état d'avancement des évaluations.
 * Toutes les statistiques sont calculées par MOIS D'APPEL (et non de réalisation).
 */
export default function CQProgressView() {
  const [endMonth, setEndMonth] = useState(currentMonth());
  const [months, setMonths] = useState(6);
  const [perim, setPerim] = useState({});
  const [groupBy, setGroupBy] = useState("cell");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const params = useMemo(() => ({ endMonth, months, ...perimeterParams(perim) }), [endMonth, months, perim]);
  useEffect(() => {
    let m = true;
    setLoading(true); setErr("");
    api.get("/kpi/cq-progress", { params })
      .then((r) => m && setData(r.data))
      .catch((e) => m && setErr(e?.response?.data?.message || "Chargement impossible."))
      .finally(() => m && setLoading(false));
    return () => { m = false; };
  }, [params]);

  const cur = data?.current || {};
  const trend = (data?.trend || []).map((t) => ({ ...t, label: monthLabel(t.month), coveragePct: t.rate ?? 0 }));
  const groups = { cell: { rows: data?.byCell || [], title: "Résultats par cellule", col: "Cellule" }, contract: { rows: data?.byContract || [], title: "Résultats par contrat", col: "Contrat" }, project: { rows: data?.byProject || [], title: "Résultats par projet", col: "Projet" } };

  function onExport() {
    const g = (rows, col) => rows.map((r) => ({ [col]: r.label, "Agents actifs": r.activeAgents, Réalisées: r.done, Attendues: r.expected, Restantes: r.remaining, "Couverture (%)": r.rate ?? "", "Taux d'évaluation (%)": r.evaluationRate ?? "" }));
    exportToXlsx(`Avancement_CQ_${endMonth}.xlsx`, {
      Tendance: trend.map((t) => ({ "Mois d'appel": t.month, Réalisées: t.done, Attendues: t.expected, Restantes: t.remaining, "Couverture (%)": t.rate ?? "", "Agents évalués": t.evaluatedAgents, "Agents actifs": t.activeAgents, "Taux d'évaluation (%)": t.evaluationRate ?? "" })),
      "Par cellule": g(data?.byCell || [], "Cellule"),
      "Par contrat": g(data?.byContract || [], "Contrat"),
      "Par projet": g(data?.byProject || [], "Projet"),
      "Par évaluateur": (data?.byEvaluator || []).map((r) => ({ Évaluateur: r.label, Rôle: r.role, Réalisées: r.done, "Agents évalués": r.evaluatedAgents, "Part (%)": r.share ?? "" })),
    });
  }

  return (
    <div className="page">
      <PageHeader title="Avancement écoutes" subtitle="État d'avancement des évaluations par mois d'appel : réalisé, restant, couverture et tendance."
        right={<button className="btn" type="button" onClick={onExport} disabled={loading || !data}>Exporter Excel</button>} />

      <div className="card filters-card" style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, alignItems: "end" }}>
          <label className="label">Mois<input className="input" type="month" value={endMonth} onChange={(e) => e.target.value && setEndMonth(e.target.value)} /></label>
          <label className="label">Tendance
            <Select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={3}>3 mois</option><option value={6}>6 mois</option><option value={12}>12 mois</option>
            </Select>
          </label>
          <PerimeterFilters value={perim} onChange={setPerim} />
        </div>
      </div>

      <ObjectivesProgress month={endMonth} />

      {err && <div className="card" style={{ padding: 12, color: "var(--danger)", background: "var(--danger-bg)", marginBottom: 12 }}>{err}</div>}
      {loading && !data && <div className="card" style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Chargement…</div>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
            <KpiCard title="Évaluations réalisées" value={cur.done ?? 0} detail={`Mois d'appel ${monthLabel(endMonth)}`} />
            <KpiCard title="Évaluations restantes" value={cur.remaining ?? 0} detail={`${cur.expected ?? 0} attendues`} tone={(cur.remaining || 0) > 0 ? "warn" : "good"} />
            <KpiCard title="Taux de couverture" value={fmtRate(cur.rate)} tone={toneFor(cur.rate, 95, 70)} formula="Réalisées / attendues" />
            <KpiCard title="Taux d'évaluation" value={fmtRate(cur.evaluationRate)} tone={toneFor(cur.evaluationRate, 95, 70)} detail={`${cur.evaluatedAgents ?? 0} agents évalués / ${cur.activeAgents ?? 0} actifs`} formula="Agents évalués au moins une fois / agents actifs" />
          </div>

          <div className="card" style={{ padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 8 }}>Tendance mensuelle (mois d'appel) — réalisé vs attendu</div>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="n" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="p" orientation="right" domain={[0, (max) => Math.max(100, Math.ceil(max / 10) * 10)]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)" }} />
                  <Legend />
                  <Bar yAxisId="n" dataKey="done" name="Réalisées" fill="#2456e6" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="n" dataKey="expected" name="Attendues" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="p" type="monotone" dataKey="coveragePct" name="Couverture (%)" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {Object.entries({ cell: "Par cellule", contract: "Par contrat", project: "Par projet" }).map(([k, l]) => (
              <button key={k} type="button" className={groupBy === k ? "btn btn--sm" : "btn btn--ghost btn--sm"} onClick={() => setGroupBy(k)}>{l}</button>
            ))}
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            <GroupTable title={groups[groupBy].title} rows={groups[groupBy].rows} firstCol={groups[groupBy].col} />
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: "0.9rem" }}>Résultats par évaluateur — {monthLabel(endMonth)}</div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead><tr><th>Évaluateur</th><th>Rôle</th><th>Évaluations réalisées</th><th>Agents évalués</th><th>Part du volume</th></tr></thead>
                  <tbody>
                    {(data.byEvaluator || []).map((r) => <tr key={r.key}><td style={{ fontWeight: 600 }}>{r.label}</td><td>{r.role || "—"}</td><td>{r.done}</td><td>{r.evaluatedAgents}</td><td>{fmtRate(r.share)}</td></tr>)}
                    {(data.byEvaluator || []).length === 0 && <tr><td colSpan={5} className="empty-state"><div className="empty-state__text">Aucune évaluation ce mois d'appel.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.75rem", marginTop: 10 }}>
            {data.definitions?.expected}. Objectif par défaut : {data.definitions?.defaultPerAgent} évaluation(s) par agent et par mois. Les agents actifs sont ceux d'aujourd'hui (pas d'historique d'effectif).
          </p>
        </>
      )}
    </div>
  );
}
