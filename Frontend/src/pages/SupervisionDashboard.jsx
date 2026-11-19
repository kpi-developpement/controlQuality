import React from "react";
import KpiDashboard from "./kpi/KpiDashboard.jsx";
import CQProgressView from "./cq/CQProgressView.jsx";
import MgmtEvaluations from "./management/MgmtEvaluations.jsx";
import CalibrationsPage from "./shared/CalibrationsPage.jsx";
import SamplesPage from "./shared/SamplesPage.jsx";
import CoachingView from "./admin/CoachingView.jsx";
import AgentPerformance from "./AgentPerformance.jsx";
import TrainingPage from "./TrainingPage.jsx";
import ContestationsPage from "./shared/ContestationsPage.jsx";
import TeamPage from "./shared/TeamPage.jsx";

/**
 * Rôle Supervision (contrat Orange) : consultation, en lecture seule, des données de la
 * cellule (et du projet / contrat) associée au profil. Le filtrage est appliqué côté serveur.
 */
export default function SupervisionDashboard({ view }) {
  if (view === "cqprogress") return <CQProgressView />;
  if (view === "team") return <TeamPage />;
  if (view === "contestations") return <ContestationsPage />;
  if (view === "evaluations") return <MgmtEvaluations readOnly />;
  if (view === "calibrations") return <CalibrationsPage />;
  if (view === "samples") return <SamplesPage />;
  if (view === "coaching") return <CoachingView readOnly />;
  if (view === "performance") return <AgentPerformance role={(JSON.parse(localStorage.getItem("user") || "{}").role) || "supervision"} />;
  if (view === "training") return <TrainingPage />;
  return <KpiDashboard />;
}
