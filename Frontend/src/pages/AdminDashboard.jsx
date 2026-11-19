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
import Ico from "../ui/Ico.jsx";

/** En-tête commun pour les vues admin qui n'en avaient pas. */
function Frame({ icon, title, subtitle, children }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Ico n={icon} /> {title}</div>
          {subtitle ? <div>{subtitle}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function AdminDashboard({ controlledTab }) {
  const tab = controlledTab || "dashboard";
  if (tab === "powerbi") return <PowerBIView />;
  // Contrat Orange
  if (tab === "calibrations") return <CalibrationsPage />;
  if (tab === "samples") return <SamplesPage />;
  if (tab === "kpi") return <KpiDashboard />;
  if (tab === "cqprogress") return <CQProgressView />;
  if (tab === "quality") return <Frame icon="settings" title="Paramètres qualité" subtitle="Contrôle d'accès, profils, projets, contrats et codes de clôture."><QualitySettingsView /></Frame>;
  if (tab === "coaching") return <CoachingView />;
  if (tab === "grids") return <Frame icon="grid" title="Grilles d'évaluation" subtitle="Création, paramétrage et validation des grilles."><GridsView /></Frame>;
  if (tab === "notifications") return <Frame icon="bell" title="Notifications" subtitle="Messages envoyés aux équipes, cellules ou utilisateurs."><NotificationsView /></Frame>;
  if (tab === "health") return <AdminHealth />;
  if (tab === "audit") return <AdminAudit />;
  if (tab === "training") return <TrainingPage />;
  if (tab === "settings") return <Frame icon="users" title="Utilisateurs & structures" subtitle="Collaborateurs, rôles, cellules et équipes."><UsersStructuresView /></Frame>;
  if (tab === "evaluations") return <Frame icon="clipboard" title="Évaluations" subtitle="Toutes les évaluations CQ et terrain, avec filtres et exports."><EvaluationsView /></Frame>;
  return <DashboardView />;
}
