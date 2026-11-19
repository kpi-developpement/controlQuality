import React from "react";
import CQEvaluations from "./cq/CQEvaluations.jsx";
import CQCoaching from "./cq/CQCoaching.jsx";
import CQSettings from "./cq/CQSettings.jsx";
import GridsView from "./admin/GridsView.jsx";
import TrainingPage from "./TrainingPage.jsx";
import NewEvaluationPage from "./shared/NewEvaluationPage.jsx";
import PickingListPage from "./shared/PickingListPage.jsx";
import CalibrationsPage from "./shared/CalibrationsPage.jsx";
import SamplesPage from "./shared/SamplesPage.jsx";
import KpiDashboard from "./kpi/KpiDashboard.jsx";
import CQProgressView from "./cq/CQProgressView.jsx";
import ContestationsPage from "./shared/ContestationsPage.jsx";
import PilotOnboardingPage from "./formateur/PilotOnboardingPage.jsx";

export default function CQDashboard({ forcedView, onViewChange, editScoreId }) {
  // Le rôle CQ n'a plus le menu "Tableau de bord" : on tombe par défaut sur la liste des évaluations.
  const view = forcedView || "list";

  if (view === "picking") {
    return <PickingListPage />;
  }

  if (view === "new") {
    return <NewEvaluationPage title="Nouvelle évaluation" editScoreId={editScoreId} />;
  }

  // Contrat Orange
  if (view === "calibrations") return <CalibrationsPage />;
  if (view === "calibration_new") return <NewEvaluationPage title="Nouveau calibrage" mode="calibration" />;
  if (view === "samples") return <SamplesPage />;
  if (view === "sample_eval") return <NewEvaluationPage title="Évaluation d'échantillon" mode="sample" />;
  if (view === "kpi") return <KpiDashboard />;
  if (view === "cqprogress") return <CQProgressView />;

  if (view === "contestations") return <ContestationsPage />;
  if (view === "onboarding") return <PilotOnboardingPage />;
  if (view === "coaching") return <CQCoaching />;
  // CQ & Formateur : paramètrent, ajoutent et modifient les grilles directement
  if (view === "grids") return (
    <div className="page">
      <div style={{ marginBottom: 18 }}>
        <div className="page-title">Grilles d'évaluation</div>
        <div>Créez, paramétrez et modifiez les grilles. Les changements s'appliquent immédiatement.</div>
      </div>
      <GridsView />
    </div>
  );
  if (view === "training") return <TrainingPage />;
  if (view === "settings") return <CQSettings />;

  // Par défaut et pour la vue "list" : la liste des évaluations
  return <CQEvaluations />;
}

