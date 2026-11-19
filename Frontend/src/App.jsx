import React, { useEffect, useState } from "react";
import Login from "./pages/Login.jsx";
import CQDashboard from "./pages/CQDashboard.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import PilotDashboard from "./pages/PilotDashboard.jsx";
import PilotEvaluations from "./pages/PilotEvaluations.jsx";
import PilotCoachingsPage from "./pages/PilotCoachingsPage.jsx";
import ManagementDashboard from "./pages/ManagementDashboard.jsx";
import AgentPerformance from "./pages/AgentPerformance.jsx";
import TrainingPage from "./pages/TrainingPage.jsx";
import SupervisionDashboard from "./pages/SupervisionDashboard.jsx";
import ContestationsPage from "./pages/shared/ContestationsPage.jsx";
import TeamPage from "./pages/shared/TeamPage.jsx";

import { ThemeProvider } from "./theme/theme.js";
import { ToastProvider } from "./toast/ToastProvider.jsx";
import AppShell from "./components/AppShell.jsx";
import { resetSocketAuth } from "./socket.js";
import {
  FiBarChart2,
  FiList,
  FiHeadphones,
  FiSettings,
  FiGrid,
  FiUsers,
  FiPlus,
  FiActivity,
  FiFileText,
  FiPhone,
  FiBookOpen,
  FiTarget,
  FiTrendingUp,
  FiLayers,
  FiSliders,
  FiPieChart,
  FiAlertTriangle,
  FiUserPlus,
  FiShare2,
} from "react-icons/fi";

function App() {
  const [user, setUser] = useState(null);
  const [adminTab, setAdminTab] = useState("dashboard");
  const [cqView, setCqView] = useState("list");
  const [mgmtView, setMgmtView] = useState("overview");
  const pilotViewState = useState("dashboard");
  const [formateurView, setFormateurView] = useState("stats");
  const [supervisionView, setSupervisionView] = useState("kpi");
  const [editScoreId, setEditScoreId] = useState("");

  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) setUser(JSON.parse(savedUser));
  }, []);

  useEffect(() => {
    const handler = (ev) => {
      try {
        const d = ev?.detail || {};
        let role = d.role;
        try { role = JSON.parse(localStorage.getItem("user") || "{}").role || role; } catch {}
        const view = d.view;
        const id = d.editScoreId || "";
        if (typeof id === "string") setEditScoreId(id);
        if (view) {
          if (role === "admin") setAdminTab(view);
          if (role === "cq") setCqView(view);
          if (role === "formateur") setFormateurView(view);
          if (["management", "superviseur", "referent"].includes(role)) setMgmtView(view);
          if (role === "pilote") pilotViewState[1](view);
          if (["supervision", "cdp"].includes(role)) setSupervisionView(view);
        }
      } catch {}
    };
    window.addEventListener("kcq:navigate", handler);
    return () => window.removeEventListener("kcq:navigate", handler);
  }, []);

  const handleLoginSuccess = (userData, token) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userData));
    resetSocketAuth();
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  const content = (() => {
    if (!user) {
      return <Login onLoginSuccess={handleLoginSuccess} />;
    }

    // ADMIN => aucun droit appels
    if (user.role === "admin") {
      const navSections = [
        {
          title: "WORKSPACE",
          items: [
            {
              key: "dashboard",
              label: "Tableau de bord",
              icon: <FiBarChart2 />,
              active: adminTab === "dashboard",
              onClick: () => setAdminTab("dashboard"),
            },
            { key: "performance", label: "Performance agents", icon: <FiBarChart2 />, active: adminTab === "performance", onClick: () => setAdminTab("performance") },
            {
              key: "evaluations",
              label: "Évaluations",
              icon: <FiList />,
              active: adminTab === "evaluations",
              onClick: () => setAdminTab("evaluations"),
            },
            {
              key: "coaching",
              label: "Coaching",
              icon: <FiHeadphones />,
              active: adminTab === "coaching",
              onClick: () => setAdminTab("coaching"),
            },
            { key: "calibrations", label: "Calibrages", icon: <FiTarget />, active: adminTab === "calibrations", onClick: () => setAdminTab("calibrations") },
            { key: "samples", label: "Échantillons", icon: <FiLayers />, active: adminTab === "samples", onClick: () => setAdminTab("samples") },
            { key: "kpi", label: "Indicateurs qualité", icon: <FiPieChart />, active: adminTab === "kpi", onClick: () => setAdminTab("kpi") },
            { key: "cqprogress", label: "Avancement CQ", icon: <FiTrendingUp />, active: adminTab === "cqprogress", onClick: () => setAdminTab("cqprogress") },
            { key: "contestations", label: "Contestations", icon: <FiAlertTriangle />, active: adminTab === "contestations", onClick: () => setAdminTab("contestations") },
          ],
        },
        {
          title: "MANAGEMENT",
          items: [
            {
              key: "grids",
              label: "Grilles",
              icon: <FiGrid />,
              active: adminTab === "grids",
              onClick: () => setAdminTab("grids"),
            },
            { key: "team", label: "Hiérarchie des équipes", icon: <FiShare2 />, active: adminTab === "team", onClick: () => setAdminTab("team") },
            {
              key: "notifications",
              label: "Notifications",
              icon: <FiUsers />,
              active: adminTab === "notifications",
              onClick: () => setAdminTab("notifications"),
            },
            {
              key: "health",
              label: "Santé",
              icon: <FiActivity />,
              active: adminTab === "health",
              onClick: () => setAdminTab("health"),
            },
            {
              key: "audit",
              label: "Audit log",
              icon: <FiFileText />,
              active: adminTab === "audit",
              onClick: () => setAdminTab("audit"),
            },
            {
              key: "training",
              label: "Formations",
              icon: <FiBookOpen />,
              active: adminTab === "training",
              onClick: () => setAdminTab("training"),
            },
            {
              key: "settings",
              label: "Panneau Admin",
              icon: <FiSettings />,
              active: adminTab === "settings",
              onClick: () => setAdminTab("settings"),
            },
            { key: "powerbi", label: "Power BI", icon: <FiBarChart2 />, active: adminTab === "powerbi", onClick: () => setAdminTab("powerbi") },
            { key: "quality", label: "Paramètres qualité", icon: <FiSliders />, active: adminTab === "quality", onClick: () => setAdminTab("quality") },
          ],
        },
      ];

      return (
        <AppShell user={user} onLogout={handleLogout} navSections={navSections}>
          {adminTab === "performance" ? <AgentPerformance role="admin" />
            : adminTab === "contestations" ? <ContestationsPage />
            : adminTab === "team" ? <TeamPage />
            : <AdminDashboard controlledTab={adminTab} />}
        </AppShell>
      );
    }

    // CQ
    if (user.role === "cq") {
      const navSections = [
        {
          title: "WORKSPACE",
          items: [
            { key: "cqprogress", label: "Avancement CQ", icon: <FiTrendingUp />, active: cqView === "cqprogress", onClick: () => setCqView("cqprogress") },
            { key: "performance", label: "Performance agents", icon: <FiBarChart2 />, active: cqView === "performance", onClick: () => setCqView("performance") },
            {
              key: "list",
              label: "Évaluations",
              icon: <FiList />,
              active: cqView === "list",
              onClick: () => setCqView("list"),
            },
            {
              key: "new",
              label: "Nouvelle évaluation",
              icon: <FiPlus />,
              active: cqView === "new",
              onClick: () => {
                setEditScoreId("");
                setCqView("new");
              },
            },
            {
              key: "picking",
              label: "Appels à évaluer",
              icon: <FiPhone />,
              active: cqView === "picking",
              onClick: () => setCqView("picking"),
            },
            { key: "contestations", label: "Contestations", icon: <FiAlertTriangle />, active: cqView === "contestations", onClick: () => setCqView("contestations") },
            { key: "calibrations", label: "Calibrages", icon: <FiTarget />, active: cqView === "calibrations" || cqView === "calibration_new", onClick: () => setCqView("calibrations") },
            { key: "samples", label: "Échantillons", icon: <FiLayers />, active: cqView === "samples" || cqView === "sample_eval", onClick: () => setCqView("samples") },
            { key: "kpi", label: "Indicateurs qualité", icon: <FiPieChart />, active: cqView === "kpi", onClick: () => setCqView("kpi") },
            {
              key: "coaching",
              label: "Coaching",
              icon: <FiHeadphones />,
              active: cqView === "coaching",
              onClick: () => setCqView("coaching"),
            },
            {
              key: "grids",
              label: "Grilles",
              icon: <FiGrid />,
              active: cqView === "grids",
              onClick: () => setCqView("grids"),
            },
            {
              key: "training",
              label: "Formations",
              icon: <FiBookOpen />,
              active: cqView === "training",
              onClick: () => setCqView("training"),
            },
          ],
        },
        {
          title: "PREFERENCES",
          items: [
            {
              key: "settings",
              label: "Paramètres CQ",
              icon: <FiSettings />,
              active: cqView === "settings",
              onClick: () => setCqView("settings"),
            },
          ],
        },
      ];

      return (
        <AppShell user={user} onLogout={handleLogout} navSections={navSections}>
          {cqView === "performance" ? <AgentPerformance role="cq" /> : <CQDashboard forcedView={cqView} onViewChange={setCqView} editScoreId={editScoreId} />}
        </AppShell>
      );
    }

    // FORMATEUR
    if (user.role === "formateur") {
      const navSections = [
        {
          title: "WORKSPACE",
          items: [
            { key: "performance", label: "Performance agents", icon: <FiBarChart2 />, active: formateurView === "performance", onClick: () => setFormateurView("performance") },
            { key: "stats", label: "Tableau de bord", icon: <FiBarChart2 />, active: formateurView === "stats", onClick: () => setFormateurView("stats") },
            { key: "list", label: "Évaluations", icon: <FiList />, active: formateurView === "list", onClick: () => setFormateurView("list") },
            { key: "new", label: "Nouvelle évaluation", icon: <FiPlus />, active: formateurView === "new", onClick: () => { setEditScoreId(""); setFormateurView("new"); } },
            { key: "picking", label: "Appels à évaluer", icon: <FiPhone />, active: formateurView === "picking", onClick: () => setFormateurView("picking") },
            { key: "contestations", label: "Contestations", icon: <FiAlertTriangle />, active: formateurView === "contestations", onClick: () => setFormateurView("contestations") },
            { key: "calibrations", label: "Calibrages", icon: <FiTarget />, active: formateurView === "calibrations" || formateurView === "calibration_new", onClick: () => setFormateurView("calibrations") },
            { key: "samples", label: "Échantillons", icon: <FiLayers />, active: formateurView === "samples" || formateurView === "sample_eval", onClick: () => setFormateurView("samples") },
            { key: "kpi", label: "Indicateurs qualité", icon: <FiPieChart />, active: formateurView === "kpi", onClick: () => setFormateurView("kpi") },
            { key: "cqprogress", label: "Avancement CQ", icon: <FiTrendingUp />, active: formateurView === "cqprogress", onClick: () => setFormateurView("cqprogress") },
            { key: "coaching", label: "Coaching", icon: <FiHeadphones />, active: formateurView === "coaching", onClick: () => setFormateurView("coaching") },
            { key: "grids", label: "Grilles", icon: <FiGrid />, active: formateurView === "grids", onClick: () => setFormateurView("grids") },
          ],
        },
        {
          title: "FORMATION",
          items: [
            { key: "training", label: "Formations", icon: <FiBookOpen />, active: formateurView === "training", onClick: () => setFormateurView("training") },
            { key: "onboarding", label: "Pilotes & formations", icon: <FiUserPlus />, active: formateurView === "onboarding", onClick: () => setFormateurView("onboarding") },
          ],
        },
        {
          title: "PREFERENCES",
          items: [
            { key: "settings", label: "Paramètres", icon: <FiSettings />, active: formateurView === "settings", onClick: () => setFormateurView("settings") },
          ],
        },
      ];

      return (
        <AppShell user={user} onLogout={handleLogout} navSections={navSections}>
          {formateurView === "performance" ? <AgentPerformance role="formateur" /> : <CQDashboard forcedView={formateurView} onViewChange={setFormateurView} editScoreId={editScoreId} />}
        </AppShell>
      );
    }

    // PILOTE => aucun droit appels
    if (user.role === "pilote") {
      const [pilotView, setPilotView] = pilotViewState;
      return (
        <AppShell
          user={user}
          onLogout={handleLogout}
          navSections={[
            {
              title: "MON ESPACE",
              items: [
                {
                  key: "dashboard",
                  label: "Mon tableau de bord",
                  icon: <FiBarChart2 />,
                  active: pilotView === "dashboard",
                  onClick: () => setPilotView("dashboard"),
                },
                {
                  key: "evaluations",
                  label: "Mes évaluations",
                  icon: <FiList />,
                  active: pilotView === "evaluations",
                  onClick: () => setPilotView("evaluations"),
                },
                {
                  key: "coachings",
                  label: "Mes coachings",
                  icon: <FiHeadphones />,
                  active: pilotView === "coachings",
                  onClick: () => setPilotView("coachings"),
                },
                {
                  key: "training",
                  label: "Formations",
                  icon: <FiBookOpen />,
                  active: pilotView === "training",
                  onClick: () => setPilotView("training"),
                },
              ],
            },
          ]}
        >
          {pilotView === "training" ? <TrainingPage />
            : pilotView === "evaluations" ? <PilotEvaluations />
            : pilotView === "coachings" ? <PilotCoachingsPage />
            : <PilotDashboard />}
        </AppShell>
      );
    }

    // MANAGEMENT
    if (user.role === "management") {
      const navSections = [
        {
          title: "WORKSPACE",
          items: [
            {
              key: "overview",
              label: "Tableau de bord",
              icon: <FiBarChart2 />,
              active: mgmtView === "overview",
              onClick: () => setMgmtView("overview"),
            },
            { key: "performance", label: "Performance agents", icon: <FiBarChart2 />, active: mgmtView === "performance", onClick: () => setMgmtView("performance") },
            {
              key: "form",
              label: "Évaluations",
              icon: <FiList />,
              active: mgmtView === "form",
              onClick: () => setMgmtView("form"),
            },
            {
              key: "new",
              label: "Nouvelle évaluation",
              icon: <FiPlus />,
              active: mgmtView === "new",
              onClick: () => {
                setEditScoreId("");
                setMgmtView("new");
              },
            },
            {
              key: "picking",
              label: "Appels à évaluer",
              icon: <FiPhone />,
              active: mgmtView === "picking",
              onClick: () => setMgmtView("picking"),
            },
            { key: "calibrations", label: "Calibrages", icon: <FiTarget />, active: mgmtView === "calibrations" || mgmtView === "calibration_new", onClick: () => setMgmtView("calibrations") },
            { key: "samples", label: "Échantillons", icon: <FiLayers />, active: mgmtView === "samples" || mgmtView === "sample_eval", onClick: () => setMgmtView("samples") },
            { key: "kpi", label: "Indicateurs qualité", icon: <FiPieChart />, active: mgmtView === "kpi", onClick: () => setMgmtView("kpi") },
            {
              key: "coaching",
              label: "Coaching",
              icon: <FiHeadphones />,
              active: mgmtView === "coaching",
              onClick: () => setMgmtView("coaching"),
            },
            {
              key: "training",
              label: "Formations",
              icon: <FiBookOpen />,
              active: mgmtView === "training",
              onClick: () => setMgmtView("training"),
            },
          ],
        },
      ];

      return (
        <AppShell user={user} onLogout={handleLogout} navSections={navSections}>
          {mgmtView === "performance" ? <AgentPerformance role="management" /> : <ManagementDashboard forcedView={mgmtView} onViewChange={setMgmtView} editScoreId={editScoreId} />}
        </AppShell>
      );
    }

    // RÉFÉRENT TECHNIQUE / SUPERVISEUR : évaluation et suivi de l'équipe
    if (user.role === "referent" || user.role === "superviseur") {
      const isSup = user.role === "superviseur";
      const item = (key, label, icon, extra = {}) => ({ key, label, icon, active: mgmtView === key || (extra.also || []).includes(mgmtView), onClick: () => { if (key === "new") setEditScoreId(""); setMgmtView(key); } });
      const navSections = [
        {
          title: "MON ÉQUIPE",
          items: [
            item("overview", "Tableau de bord", <FiBarChart2 />),
            item("team", isSup ? "Ma ligne" : "Mon équipe", <FiUsers />),
            item("performance", "Performance agents", <FiTrendingUp />),
            item("kpi", "Indicateurs qualité", <FiPieChart />),
          ],
        },
        {
          title: "QUALITÉ",
          items: [
            item("form", "Évaluations", <FiList />),
            item("new", "Nouvelle évaluation", <FiPlus />),
            item("picking", "Appels à évaluer", <FiPhone />),
            item("contestations", "Contestations", <FiAlertTriangle />),
            ...(isSup ? [item("coaching", "Coaching", <FiHeadphones />), item("samples", "Échantillons", <FiLayers />, { also: ["sample_eval"] })] : []),
            item("training", "Formations", <FiBookOpen />),
          ],
        },
      ];
      return (
        <AppShell user={user} onLogout={handleLogout} navSections={navSections}>
          {mgmtView === "performance" ? <AgentPerformance role={user.role} /> : <ManagementDashboard forcedView={mgmtView} onViewChange={setMgmtView} editScoreId={editScoreId} />}
        </AppShell>
      );
    }

    // CHEF DE PROJET : visibilité sur toute son activité
    if (user.role === "cdp") {
      const item = (key, label, icon) => ({ key, label, icon, active: supervisionView === key, onClick: () => setSupervisionView(key) });
      const navSections = [
        {
          title: "MON ACTIVITÉ",
          items: [
            item("kpi", "Indicateurs qualité", <FiPieChart />),
            item("team", "Équipes & cellules", <FiUsers />),
            item("performance", "Performance agents", <FiBarChart2 />),
            item("cqprogress", "Couverture CQ", <FiTrendingUp />),
          ],
        },
        {
          title: "QUALITÉ",
          items: [
            item("evaluations", "Évaluations", <FiList />),
            item("contestations", "Contestations", <FiAlertTriangle />),
            item("samples", "Échantillons", <FiLayers />),
            item("coaching", "Coaching", <FiHeadphones />),
            item("training", "Formations", <FiBookOpen />),
          ],
        },
      ];
      return (
        <AppShell user={user} onLogout={handleLogout} navSections={navSections}>
          <SupervisionDashboard view={supervisionView} />
        </AppShell>
      );
    }

    // SUPERVISION (contrat Orange) : consultation du périmètre affecté, lecture seule
    if (user.role === "supervision") {
      const item = (key, label, icon) => ({ key, label, icon, active: supervisionView === key, onClick: () => setSupervisionView(key) });
      const navSections = [
        {
          title: "SUPERVISION",
          items: [
            item("kpi", "Indicateurs qualité", <FiPieChart />),
            item("cqprogress", "Avancement CQ", <FiTrendingUp />),
            item("evaluations", "Évaluations", <FiList />),
            item("calibrations", "Calibrages", <FiTarget />),
            item("samples", "Échantillons", <FiLayers />),
            item("coaching", "Coaching", <FiHeadphones />),
            item("performance", "Performance agents", <FiBarChart2 />),
            item("training", "Formations", <FiBookOpen />),
          ],
        },
      ];
      return (
        <AppShell user={user} onLogout={handleLogout} navSections={navSections}>
          <SupervisionDashboard view={supervisionView} />
        </AppShell>
      );
    }

    return (
      <AppShell user={user} onLogout={handleLogout} navSections={[]}>
        <div className="page">
          <div className="card">
            <p>Rôle non reconnu : {user.role}</p>
          </div>
        </div>
      </AppShell>
    );
  })();

  return (
    <ThemeProvider defaultTheme="light">
      <ToastProvider>
        {content}
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;

