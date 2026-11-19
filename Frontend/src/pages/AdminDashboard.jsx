import React from "react";
import PowerBIView from "./admin/PowerBIView.jsx";
import DashboardView from "./admin/DashboardView.jsx";
import CoachingView from "./admin/CoachingView.jsx";
import UsersStructuresView from "./admin/UsersStructuresView.jsx";
import GridsView from "./admin/GridsView.jsx";
import NotificationsView from "./admin/NotificationsView.jsx";
import AdminHealth from "./admin/AdminHealth.jsx";
import AdminAudit from "./admin/AdminAudit.jsx";
import EvaluationsView from "./admin/EvaluationsView.jsx";
import TrainingPage from "./TrainingPage.jsx";
import CalibrationsPage from "./shared/CalibrationsPage.jsx";
import SamplesPage from "./shared/SamplesPage.jsx";
import KpiDashboard from "./kpi/KpiDashboard.jsx";
import CQProgressView from "./cq/CQProgressView.jsx";
import QualitySettingsView from "./admin/QualitySettingsView.jsx";

export default function AdminDashboard({ controlledTab }) {
  const tab = controlledTab || "dashboard";
  if (tab === "powerbi") return <PowerBIView />;
  // Contrat Orange
  if (tab === "calibrations") return <CalibrationsPage />;
  if (tab === "samples") return <SamplesPage />;
  if (tab === "kpi") return <KpiDashboard />;
  if (tab === "cqprogress") return <CQProgressView />;
  if (tab === "quality") return <QualitySettingsView />;
  if (tab === "coaching") return <CoachingView />;
  if (tab === "grids") return <GridsView />;
  if (tab === "notifications") return <NotificationsView />;
  if (tab === "health") return <AdminHealth />;
  if (tab === "audit") return <AdminAudit />;
  if (tab === "training") return <TrainingPage />;
  if (tab === "settings") return <UsersStructuresView />;
  if (tab === "evaluations") return <EvaluationsView />;
  return <DashboardView />;
}
