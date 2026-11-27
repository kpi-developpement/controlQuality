import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import ScopeFilters from "../../components/ScopeFilters.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { initialScopeFilters, scopeParams } from "../../utils/scopeFilters.js";
import PeriodFilter from "../../components/PeriodFilter.jsx";
import KpiCard from "../../components/KpiCard.jsx";
import { fmtRate, toneFor } from "../../utils/kpiFormat.js";
import KpiDashboard from "./KpiDashboard.jsx";
import { FiAward, FiClipboard, FiTarget, FiLayers, FiCheckCircle, FiThumbsUp, FiCheckSquare, FiAlertTriangle, FiAlertOctagon, FiBookOpen, FiUsers, FiHeadphones, FiLogIn } from "react-icons/fi";

// Icône de chaque indicateur (tuiles du tableau de bord)
const ICONS = {
  qualityScore: <FiAward />, evaluations: <FiClipboard />, calibrations: <FiTarget />, pickings: <FiLayers />,
  coachingValidation: <FiCheckCircle />, evaluationValidation: <FiThumbsUp />, calibrationValidation: <FiCheckSquare />,
  evaluationContestation: <FiAlertTriangle />, calibrationContestation: <FiAlertOctagon />, quizCompletion: <FiBookOpen />,
  coverage: <FiUsers />, coachingRate: <FiHeadphones />, connection: <FiLogIn />,
};
import { exportToXlsx } from "../admin/components/exportXlsx.js";
import { localDate } from "../../utils/period.mjs";

// Rôles qui disposent aussi de la vue détaillée des indicateurs qualité (ventilations, quiz…)
const DETAIL_ROLES = ["admin", "superviseur", "supervision"];
const SCOPE_TEXT = {
  admin: "tous les contrats",
  cdp: "votre contrat",
  superviseur: "vos cellules affectées",
  referent: "vos cellules affectées",
  pilote: "vos propres évaluations, coachings et calibrages",
};

function display(ind) {
  if (ind.kind === "count") return ind.value ?? 0;
  if (ind.value === null || ind.value === undefined) return "—";
  return fmtRate(ind.value);
}
function tone(ind) {
  if (ind.kind === "count") return undefined;
  if (ind.key === "coachingRate") return undefined; // ratio sans seuil fixé
  return ind.inverse ? toneFor(ind.value, 90, 75, true) : toneFor(ind.value, 80, 50);
}
function detail(ind) {
  if (ind.kind === "count") return null;
  if (ind.kind === "percent") return ind.num ? `${ind.num} évaluation${ind.num > 1 ? "s" : ""}` : "Aucune évaluation";
  return `${ind.num ?? 0} / ${ind.den ?? 0}`;
}

/**
 * Tableau de bord — « Indicateurs qualité » intégrés, filtres et affichage selon le rôle.
 * Le serveur ne renvoie que les indicateurs autorisés pour le rôle, calculés sur son périmètre.
 */
export default function DashboardIndicators({ role, title = "Tableau de bord" }) {
  const isAgent = role === "pilote";
  const [filters, setFilters] = useState(() => initialScopeFilters({ mode: "month", anchor: localDate() }));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [showDetail, setShowDetail] = useState(false);

  const params = useMemo(() => scopeParams(filters), [filters]);
  const invalid = filters.period.mode === "custom" && filters.period.from && filters.period.to && filters.period.from > filters.period.to;

  useEffect(() => {
    if (invalid) return undefined;
    let m = true;
    setLoading(true); setErr("");
    api.get("/kpi/dashboard", { params })
      .then((r) => m && setData(r.data))
      .catch((e) => m && setErr(e?.response?.data?.message || "Impossible de calculer les indicateurs."))
      .finally(() => m && setLoading(false));
    return () => { m = false; };
  }, [params, tick, invalid]);

  const indicators = data?.indicators || [];
  const counts = indicators.filter((i) => i.kind !== "rate");
  const rates = indicators.filter((i) => i.kind === "rate");

  function onExport() {
    exportToXlsx(`Tableau_de_bord_${localDate()}.xlsx`, indicators.map((i) => ({
      Indicateur: i.label, Valeur: i.kind === "count" ? i.value : i.value ?? "", Numérateur: i.num ?? "", Dénominateur: i.den ?? "", Formule: i.formula,
    })));
  }

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={`Indicateurs qualité sur ${SCOPE_TEXT[role] || "votre périmètre"}. Période : date de l'évaluation.`}
        right={<>
          <button className="btn btn--ghost" type="button" onClick={() => setTick((x) => x + 1)} disabled={loading}>Actualiser</button>
          <button className="btn" type="button" onClick={onExport} disabled={loading || !indicators.length}>Exporter Excel</button>
        </>}
      />

      {isAgent
        ? <div className="card filters-card"><PeriodFilter value={filters.period} onChange={(period) => setFilters({ ...filters, period })} /></div>
        : <ScopeFilters value={filters} onChange={setFilters} />}

      {err && <div className="card" role="alert" style={{ padding: 12, color: "var(--danger)", background: "var(--danger-bg)", marginBottom: 12 }}>{err}</div>}

      {loading && !data ? (
        <div className="card" style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Calcul des indicateurs…</div>
      ) : (
        <>
          {!isAgent && data && <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: 10 }}><b style={{ color: "var(--text)" }}>{data.population?.activeAgents ?? 0}</b> agents actifs dans le périmètre{loading ? " · mise à jour…" : ""}</div>}
          {indicators.length > 0 && (
            <div className="bento">
              {counts.map((i) => (
                <KpiCard key={i.key} title={i.label} value={display(i)} detail={detail(i)} formula={i.formula}
                  size={i.key === "qualityScore" ? "hero" : undefined}
                  tone={i.kind === "percent" ? toneFor(i.value, 80, 50) : undefined}
                  meter={i.kind === "percent" ? i.value : undefined}
                  icon={ICONS[i.key]} />
              ))}
              {rates.map((i) => (
                <KpiCard key={i.key} title={i.label} value={display(i)} tone={tone(i)} detail={detail(i)} formula={i.formula}
                  meter={i.key === "coachingRate" ? undefined : i.value} icon={ICONS[i.key]} />
              ))}
            </div>
          )}
          {!loading && !indicators.length && <div className="card empty-state"><div className="empty-state__text">Aucun indicateur disponible pour votre rôle.</div></div>}
        </>
      )}

      {DETAIL_ROLES.includes(role) && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn--ghost" type="button" onClick={() => setShowDetail((x) => !x)} aria-expanded={showDetail}>
            {showDetail ? "Masquer la vue détaillée des indicateurs" : "Afficher la vue détaillée des indicateurs (ventilations, quiz, utilisation)"}
          </button>
          {showDetail && <div style={{ marginTop: 12 }}><KpiDashboard /></div>}
        </div>
      )}
    </div>
  );
}
