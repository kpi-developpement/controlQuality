import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import PageHeader from "../../components/PageHeader.jsx";
import PerimeterFilters, { perimeterParams } from "../../components/PerimeterFilters.jsx";
import KpiCard from "../../components/KpiCard.jsx";
import { fmtRate, toneFor, monthRange, currentMonth } from "../../utils/kpiFormat.js";
import { exportToXlsx } from "../admin/components/exportXlsx.js";
import Select from "../../ui/Select.jsx";

const DIMENSIONS = [
  { value: "cell", label: "Cellule" },
  { value: "evaluator", label: "Évaluateur" },
  { value: "pilot", label: "Collaborateur (agent)" },
  { value: "contract", label: "Contrat" },
  { value: "project", label: "Projet" },
  { value: "month", label: "Mois d'appel" },
  { value: "type", label: "Type d'évaluation" },
];
const DENOM_LABEL = { active_users: "utilisateurs connectés", enabled_users: "utilisateurs habilités", expected_users: "utilisateurs attendus" };
const DONE_LABEL = { created: "coaching enregistré", status_done: "coaching au statut clôturé", acknowledged: "coaching validé par l'agent" };
const SAMPLE_STATUS = { pending: "En attente", assigned: "Affectés", in_progress: "En cours", standby: "Standby" };

/**
 * Indicateurs qualité (contrat Orange, §2) — calculés côté serveur sur le périmètre autorisé.
 * Période par mois d'appel.
 */
export default function KpiDashboard() {
  const [fromMonth, setFromMonth] = useState(currentMonth());
  const [toMonth, setToMonth] = useState(currentMonth());
  const [perim, setPerim] = useState({});
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [dimension, setDimension] = useState("cell");
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const params = useMemo(() => {
    const a = fromMonth <= toMonth ? fromMonth : toMonth;
    const b = fromMonth <= toMonth ? toMonth : fromMonth;
    return { ...monthRange(a, b), ...perimeterParams(perim) };
  }, [fromMonth, toMonth, perim]);

  useEffect(() => {
    let m = true;
    setLoading(true); setErr("");
    api.get("/kpi/summary", { params })
      .then((r) => m && setData(r.data))
      .catch((e) => m && setErr(e?.response?.data?.message || "Impossible de calculer les indicateurs."))
      .finally(() => m && setLoading(false));
    return () => { m = false; };
  }, [params, tick]);

  useEffect(() => {
    let m = true;
    setRowsLoading(true);
    api.get("/kpi/breakdown", { params: { ...params, dimension } })
      .then((r) => m && setRows(r.data?.rows || []))
      .catch(() => m && setRows([]))
      .finally(() => m && setRowsLoading(false));
    return () => { m = false; };
  }, [params, dimension, tick]);

  const d = data || {};
  const cc = d.coachingCompletion || {};
  const ccMain = cc.mode === "monthly_average"
    ? { value: cc.monthlyAverage ?? "—", unit: " / mois", label: "Moyenne mensuelle" }
    : cc.mode === "rolling_12"
      ? { value: cc.rolling12MonthlyAverage ?? "—", unit: " / mois", label: "Moyenne sur 12 mois glissants" }
      : { value: fmtRate(cc.targetAttainmentRate), unit: "", label: "Atteinte de l'objectif annuel" };

  function onExport() {
    const ind = [
      ["Taux de validation des coachings", d.coachingValidation?.rate, d.coachingValidation?.validated, d.coachingValidation?.received, "Coachings validés / coachings reçus"],
      ["Taux de validation des évaluations", d.evaluationValidation?.rate, d.evaluationValidation?.validated, d.evaluationValidation?.received, "Évaluations validées / évaluations reçues"],
      ["Taux de contestation des évaluations", d.evaluationContestation?.rate, d.evaluationContestation?.contested, d.evaluationContestation?.received, "Évaluations contestées / évaluations reçues"],
      ["Taux d'utilisation (connexions par utilisateur)", d.usage?.loginsPerUser, d.usage?.logins, d.usage?.[d.usage?.denominator === "active_users" ? "distinctLoggedUsers" : d.usage?.denominator === "expected_users" ? "expectedUsers" : "enabledUsers"], `Connexions / ${DENOM_LABEL[d.usage?.denominator] || ""}`],
      ["Taux d'adoption", d.usage?.adoptionRate, d.usage?.distinctLoggedUsers, d.usage?.enabledUsers, "Utilisateurs connectés / utilisateurs habilités"],
      ["Réalisation des coachings — objectif", cc.targetAttainmentRate, cc.doneInPeriod, cc.expectedInPeriod, "Coachings réalisés / objectif de la période"],
      ["Réalisation des coachings — moyenne mensuelle", cc.monthlyAverage, cc.doneInPeriod, d.period?.months?.length, "Coachings réalisés / nombre de mois"],
      ["Réalisation des coachings — 12 mois glissants", cc.rolling12MonthlyAverage, "", 12, "Coachings des 12 derniers mois / 12"],
      ["Taux de couverture des évaluations", d.coverage?.rate, d.coverage?.done, d.coverage?.expected, "Évaluations réalisées (mois d'appel) / évaluations attendues"],
      ["Taux d'évaluation des agents", d.coverage?.evaluationRate, d.coverage?.evaluatedAgents, d.population?.activeAgents, "Agents évalués / agents actifs"],
      ["Taux de passation des quiz", d.quiz?.rate, d.quiz?.finalized, d.quiz?.assignments, "Quiz actifs finalisés / quiz actifs attribués"],
      ["Échantillons en attente ou standby", d.samplesWaiting?.total, "", "", `Statuts : ${(d.samplesWaiting?.statuses || []).join(", ")}`],
    ].map(([Indicateur, Valeur, Numérateur, Dénominateur, Formule]) => ({ Indicateur, Valeur: Valeur ?? "", Numérateur: Numérateur ?? "", Dénominateur: Dénominateur ?? "", Formule }));
    exportToXlsx(`Indicateurs_qualite_${fromMonth}_${toMonth}.xlsx`, {
      "Indicateurs (formules)": (d.clientIndicators || []).map((x) => ({ Indicateur: x.label, "Taux (%)": x.rate ?? "", Numérateur: x.num, Dénominateur: x.den, Formule: x.formula })),
      Indicateurs: ind,
      [`Ventilation ${DIMENSIONS.find((x) => x.value === dimension)?.label || ""}`.slice(0, 31)]: rows.map((r) => ({
        [DIMENSIONS.find((x) => x.value === dimension)?.label || "Clé"]: r.label, ...(dimension === "pilot" ? { Cellule: r.cell || "" } : {}),
        Évaluations: r.count, "Moyenne (%)": r.avgPercent ?? "", Contestées: r.contested, "Taux de contestation (%)": r.contestationRate ?? "",
        Validées: r.validated, "Taux de validation (%)": r.validationRate ?? "",
      })),
      Quiz: (d.quiz?.byQuiz || []).map((q) => ({ Quiz: q.title, Échéance: q.dueDate ? new Date(q.dueDate).toLocaleDateString("fr-FR") : "", Attribués: q.assignments, Finalisés: q.finalized, "En cours": q.inProgress, "Non commencés": q.notStarted, Échus: q.overdue, "Taux (%)": q.rate ?? "" })),
    });
  }

  return (
    <div className="page">
      <PageHeader
        title="Indicateurs qualité"
        subtitle="Suivi des validations, contestations, coachings, couverture, quiz et utilisation — période par mois d'appel, sur votre périmètre autorisé."
        right={<div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--ghost" type="button" onClick={() => setTick((x) => x + 1)} disabled={loading}>Actualiser</button>
          <button className="btn" type="button" onClick={onExport} disabled={loading || !data}>Exporter Excel</button>
        </div>}
      />

      <div className="card filters-card" style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, alignItems: "end" }}>
          <label className="label">Du mois<input className="input" type="month" value={fromMonth} onChange={(e) => e.target.value && setFromMonth(e.target.value)} /></label>
          <label className="label">Au mois<input className="input" type="month" value={toMonth} onChange={(e) => e.target.value && setToMonth(e.target.value)} /></label>
          <PerimeterFilters value={perim} onChange={setPerim} />
        </div>
      </div>

      {err && <div className="card" style={{ padding: 12, color: "var(--danger)", background: "var(--danger-bg)", marginBottom: 12 }}>{err}</div>}

      {(d.clientIndicators || []).length > 0 && (
        <div className="kpi-formulas">
          {d.clientIndicators.map((x) => (
            <KpiCard key={x.key} title={x.label} value={fmtRate(x.rate)} tone={toneFor(x.rate, ...(x.key.includes("Contestation") ? [90, 75, true] : [80, 50]))}
              detail={`${x.num} / ${x.den}`} formula={x.formula} />
          ))}
        </div>
      )}

      {loading && !data ? (
        <div className="card" style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Calcul des indicateurs…</div>
      ) : data ? (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", color: "var(--muted)", fontSize: "0.82rem", marginBottom: 10 }}>
            <span><b style={{ color: "var(--text)" }}>{d.evaluations?.total ?? 0}</b> évaluations (hors calibrage)</span>
            <span>Moyenne : <b style={{ color: "var(--text)" }}>{fmtRate(d.evaluations?.avgPercent)}</b></span>
            <span><b style={{ color: "var(--text)" }}>{d.population?.activeAgents ?? 0}</b> agents actifs dans le périmètre</span>
            {loading && <span>Mise à jour…</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
            <KpiCard title="Validation des coachings" value={fmtRate(d.coachingValidation?.rate)} tone={toneFor(d.coachingValidation?.rate)}
              detail={`${d.coachingValidation?.validated ?? 0} validés / ${d.coachingValidation?.received ?? 0} reçus`} formula="Coachings validés / coachings reçus" />
            <KpiCard title="Validation des évaluations" value={fmtRate(d.evaluationValidation?.rate)} tone={toneFor(d.evaluationValidation?.rate)}
              detail={`${d.evaluationValidation?.validated ?? 0} validées / ${d.evaluationValidation?.received ?? 0} reçues`} formula={d.evaluationValidation?.enabled ? "Évaluations validées par l'agent / évaluations reçues" : "Validation agent désactivée (Paramètres qualité)"} />
            <KpiCard title="Contestation des évaluations" value={fmtRate(d.evaluationContestation?.rate)} tone={toneFor(d.evaluationContestation?.rate, 95, 85, true)}
              detail={`${d.evaluationContestation?.contested ?? 0} contestées / ${d.evaluationContestation?.received ?? 0} reçues • ${d.evaluationContestation?.open ?? 0} en cours`} formula="Évaluations contestées (y compris traitées) / reçues" />
            <KpiCard title="Utilisation de l'application" value={d.usage?.loginsPerUser ?? "—"}
              detail={`${d.usage?.logins ?? 0} connexions • ${d.usage?.distinctLoggedUsers ?? 0} / ${d.usage?.enabledUsers ?? 0} utilisateurs connectés (adoption ${fmtRate(d.usage?.adoptionRate)})`}
              formula={`Connexions / ${DENOM_LABEL[d.usage?.denominator] || "utilisateurs"} (dénominateur paramétrable)`} />
            <KpiCard title="Réalisation des coachings" value={`${ccMain.value}${ccMain.unit}`} tone={cc.mode === "annual_target" ? toneFor(cc.targetAttainmentRate) : undefined}
              detail={`${ccMain.label} • ${cc.doneInPeriod ?? 0} réalisés${cc.expectedInPeriod ? ` / ${cc.expectedInPeriod} attendus` : ""}`}
              formula={`Moy. mensuelle ${cc.monthlyAverage ?? "—"} • 12 mois glissants ${cc.rolling12MonthlyAverage ?? "—"}/mois • réalisé = ${DONE_LABEL[d.definitions?.coachingDoneDefinition] || ""}`} />
            <KpiCard title="Couverture des évaluations" value={fmtRate(d.coverage?.rate)} tone={toneFor(d.coverage?.rate, 95, 70)}
              detail={`${d.coverage?.done ?? 0} réalisées / ${d.coverage?.expected ?? 0} attendues • ${d.coverage?.remaining ?? 0} restantes`}
              formula={`Par mois d'appel • agents évalués : ${fmtRate(d.coverage?.evaluationRate)}`} />
            <KpiCard title="Passation des quiz" value={fmtRate(d.quiz?.rate)} tone={toneFor(d.quiz?.rate)}
              detail={`${d.quiz?.finalized ?? 0} finalisés / ${d.quiz?.assignments ?? 0} attribués • ${d.quiz?.activeQuizzes ?? 0} quiz actifs`}
              formula="Quiz actifs finalisés / quiz actifs attribués">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                <span className="badge badge--primary">En cours {d.quiz?.inProgress ?? 0}</span>
                <span className="badge badge--muted">Non commencés {d.quiz?.notStarted ?? 0}</span>
                <span className="badge badge--danger">Échus {d.quiz?.overdue ?? 0}</span>
              </div>
            </KpiCard>
            <KpiCard title="Échantillons en attente / standby" value={d.samplesWaiting?.total ?? 0} tone={(d.samplesWaiting?.total || 0) > 0 ? "warn" : "good"}
              formula="Définition du standby paramétrable (Paramètres qualité)">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(d.samplesWaiting?.statuses || []).map((s) => <span key={s} className="badge badge--muted">{SAMPLE_STATUS[s] || s} {d.samplesWaiting?.byStatus?.[s] || 0}</span>)}
              </div>
            </KpiCard>
          </div>

          <div className="card" style={{ padding: 0, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Ventilation des évaluations, contestations et validations</div>
              <Select className="input" style={{ maxWidth: 240 }} value={dimension} onChange={(e) => setDimension(e.target.value)}>
                {DIMENSIONS.map((x) => <option key={x.value} value={x.value}>Par {x.label.toLowerCase()}</option>)}
              </Select>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead><tr><th>{DIMENSIONS.find((x) => x.value === dimension)?.label}</th>{dimension === "pilot" && <th>Cellule</th>}<th>Évaluations</th><th>Moyenne</th><th>Contestées</th><th>Taux de contestation</th><th>Validées</th><th>Taux de validation</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key || r.label}>
                      <td style={{ fontWeight: 600 }}>{r.label}</td>
                      {dimension === "pilot" && <td>{r.cell || "—"}</td>}
                      <td>{r.count}</td>
                      <td>{fmtRate(r.avgPercent)}</td>
                      <td>{r.contested}</td>
                      <td><span className={`badge ${r.contestationRate > 15 ? "badge--danger" : r.contestationRate > 5 ? "badge--warning" : "badge--muted"}`}>{fmtRate(r.contestationRate)}</span></td>
                      <td>{r.validated}</td>
                      <td>{fmtRate(r.validationRate)}</td>
                    </tr>
                  ))}
                  {!rowsLoading && rows.length === 0 && <tr><td colSpan={8} className="empty-state"><div className="empty-state__text">Aucune évaluation sur la période.</div></td></tr>}
                  {rowsLoading && <tr><td colSpan={8} style={{ color: "var(--muted)", padding: 16 }}>Chargement…</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {(d.quiz?.byQuiz || []).length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: "0.9rem" }}>Quiz actifs</div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead><tr><th>Quiz</th><th>Échéance</th><th>Attribués</th><th>Finalisés</th><th>En cours</th><th>Non commencés</th><th>Échus</th><th>Taux</th></tr></thead>
                  <tbody>
                    {d.quiz.byQuiz.map((q) => (
                      <tr key={q.id}><td style={{ fontWeight: 600 }}>{q.title}</td><td>{q.dueDate ? new Date(q.dueDate).toLocaleDateString("fr-FR") : "—"}</td><td>{q.assignments}</td><td>{q.finalized}</td><td>{q.inProgress}</td><td>{q.notStarted}</td><td>{q.overdue}</td><td>{fmtRate(q.rate)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p style={{ color: "var(--muted)", fontSize: "0.75rem", marginTop: 10 }}>
            Le taux d'utilisation est calculé à partir des connexions enregistrées depuis la mise en service de cette version. Les définitions (dénominateurs, objectifs, statuts de standby) sont réglées dans « Paramètres qualité ».
          </p>
        </>
      ) : null}
    </div>
  );
}
