import React from "react";
import MgmtHome from "./management/MgmtHome.jsx";
import EvaluationsList from "./shared/EvaluationsList.jsx";
import MgmtCoaching from "./management/MgmtCoaching.jsx";
import TrainingPage from "./TrainingPage.jsx";
import NewEvaluationPage from "./shared/NewEvaluationPage.jsx";
import PickingListPage from "./shared/PickingListPage.jsx";
import CalibrationsPage from "./shared/CalibrationsPage.jsx";
import PickingPage from "./shared/PickingPage.jsx";
import KpiDashboard from "./kpi/KpiDashboard.jsx";
import DashboardIndicators from "./kpi/DashboardIndicators.jsx";
import ContestationsPage from "./shared/ContestationsPage.jsx";
import TeamPage from "./shared/TeamPage.jsx";
import CQProgressView from "./cq/CQProgressView.jsx";

export default function ManagementDashboard({ forcedView, onViewChange, editScoreId }) {
  const view = forcedView || "overview";
  const role = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}").role || "management"; } catch { return "management"; } })();

  if (view === "picking") {
    return <PickingListPage />;
  }

  if (view === "new") {
    return <NewEvaluationPage title="Nouvelle évaluation" editScoreId={editScoreId} />;
  }

  // Contrat Orange
  if (view === "calibrations") return <CalibrationsPage />;
  if (view === "calibration_new") return <NewEvaluationPage title="Nouveau calibrage" mode="calibration" />;
  if (view === "samples") return <PickingPage />;
  if (view === "picking_new") return <NewEvaluationPage title={editScoreId ? "Modifier le picking" : "Nouveau picking"} mode="picking" editScoreId={editScoreId} />;
  if (view === "sample_eval") return <NewEvaluationPage title="Évaluation d'échantillon" mode="sample" />;
  if (view === "kpi") return <KpiDashboard />;
  if (view === "cqprogress") return <CQProgressView />;

  if (view === "team") return <TeamPage />;
  if (view === "contestations") return <ContestationsPage />;
  if (view === "form") return <EvaluationsList role={role} />;
  if (view === "coaching") return <MgmtCoaching />;
  if (view === "training") return <TrainingPage />;

  return <><DashboardIndicators role={role} /><MgmtHome /></>;
}
