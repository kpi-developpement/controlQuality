import React from "react";
import DashboardIndicators from "./kpi/DashboardIndicators.jsx";
import CQProgressView from "./cq/CQProgressView.jsx";
import EvaluationsList from "./shared/EvaluationsList.jsx";
import CalibrationsPage from "./shared/CalibrationsPage.jsx";
import PickingPage from "./shared/PickingPage.jsx";
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
  if (view === "evaluations") return <EvaluationsList role="supervision" readOnly />;
  if (view === "calibrations") return <CalibrationsPage />;
  if (view === "samples") return <PickingPage />;
  if (view === "coaching") return <CoachingView readOnly />;
  if (view === "performance") return <AgentPerformance role={(JSON.parse(localStorage.getItem("user") || "{}").role) || "supervision"} />;
  if (view === "training") return <TrainingPage />;
  return <DashboardIndicators role="supervision" title="Indicateurs qualité" />;
}
