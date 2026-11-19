import React, { useEffect, useState } from "react";
import api from "../../api";
import PageHeader from "../../components/PageHeader.jsx";
import { FiUser, FiLock, FiCheck, FiGrid, FiInfo } from "react-icons/fi";
import Ico from "../../ui/Ico.jsx";

export default function CQSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [grids, setGrids] = useState([]);

  useEffect(() => {
    let m = true;
    (async () => {
      try {
        const [profileR, gridsR] = await Promise.all([
          api.get("/auth/me"),
          api.get("/grids/my").catch(() => ({ data: [] })),
        ]);
        if (!m) return;
        setProfile(profileR.data);
        setName(profileR.data?.name || "");
        setGrids(Array.isArray(gridsR.data) ? gridsR.data : []);
      } catch (e) {
        if (m) setErr("Impossible de charger le profil.");
      } finally { if (m) setLoading(false); }
    })();
    return () => { m = false; };
  }, []);

  async function handleSave() {
    setErr(""); setOk("");
    if (newPassword && newPassword !== confirmPassword) return setErr("Les mots de passe ne correspondent pas.");
    if (newPassword && newPassword.length < 6) return setErr("Le nouveau mot de passe doit contenir au moins 6 caractères.");
    if (newPassword && !currentPassword) return setErr("Veuillez saisir votre mot de passe actuel.");
    setSaving(true);
    try {
      const payload = {};
      if (newPassword) { payload.currentPassword = currentPassword; payload.newPassword = newPassword; }
      await api.patch("/auth/profile", payload);
      setOk("Profil mis à jour avec succès.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      try { const u = JSON.parse(localStorage.getItem("user") || "{}"); u.name = name.trim(); localStorage.setItem("user", JSON.stringify(u)); } catch {}
    } catch (e) { setErr(e?.response?.data?.message || "Erreur lors de la mise à jour."); }
    finally { setSaving(false); }
  }

  return (
    <div className="page">
      <PageHeader title="Paramètres CQ" subtitle="Profil, mot de passe et configuration de votre espace." />

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Chargement…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Profile Section */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <FiUser style={{ color: "var(--primary)", fontSize: 18 }} />
              <span style={{ fontWeight: 800, fontSize: "1rem" }}>Mon profil</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Nom complet</div>
                <input className="input" value={name} readOnly style={{ background: "var(--chip)", cursor: "default" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>Email</div>
                  <input className="input" value={profile?.email || ""} readOnly style={{ background: "var(--chip)" }} />
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>Cellule</div>
                  <input className="input" value={profile?.cell || "—"} readOnly style={{ background: "var(--chip)" }} />
                </div>
              </div>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Rôle</div>
                <div style={{ padding: "8px 12px", borderRadius: "var(--radius)", background: "var(--primary-bg)", color: "var(--primary)", fontWeight: 700, fontSize: "0.875rem", display: "inline-block" }}>
                  {(profile?.role || "").toUpperCase()}
                </div>
              </div>
            </div>
          </div>

          {/* Password Section */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <FiLock style={{ color: "var(--warning)", fontSize: 18 }} />
              <span style={{ fontWeight: 800, fontSize: "1rem" }}>Mot de passe</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Mot de passe actuel</div>
                <input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Nouveau mot de passe</div>
                <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min. 6 caractères" />
              </div>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Confirmer</div>
                <input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Répétez le mot de passe" />
              </div>
            </div>
          </div>

          {/* Grids assigned */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <FiGrid style={{ color: "var(--success)", fontSize: 18 }} />
              <span style={{ fontWeight: 800, fontSize: "1rem" }}>Mes grilles d'évaluation</span>
            </div>
            {grids.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: "0.875rem" }}>Toutes les grilles actives vous sont accessibles.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {grids.map((g) => (
                  <div key={String(g._id)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{g.name || g.title || "Grille"}</span>
                    <span className="badge badge--muted">{g.gridType === "presence" ? "Présence" : "Classique"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Help */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <FiInfo style={{ color: "var(--primary)", fontSize: 18 }} />
              <span style={{ fontWeight: 800, fontSize: "1rem" }}>À propos de la plateforme</span>
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: 1.7 }}>
              <p style={{ margin: "0 0 8px" }}>
                <b>Kyntus CQ</b> est votre outil de contrôle qualité pour le suivi des interactions client. En tant que CQ, votre rôle est d'évaluer les appels des agents selon les grilles d'évaluation définies par l'administration.
              </p>
              <p style={{ margin: "0 0 8px" }}>
                <b>Workflow :</b> Évaluez un appel <Ico n="arrowR" /> L'agent voit son score <Ico n="arrowR" /> En cas de désaccord, l'agent ou le management conteste <Ico n="arrowR" /> Vous réévaluez.
              </p>
              <p style={{ margin: 0 }}>
                <b>Raccourcis :</b> Ctrl+E pour exporter, cliquez sur votre nom pour modifier votre profil.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Messages & save */}
      {err && <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: "var(--radius)", background: "var(--danger-bg)", color: "var(--danger)", fontWeight: 600, fontSize: "0.875rem", border: "1px solid rgba(220,38,38,0.2)" }}>{err}</div>}
      {ok && <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: "var(--radius)", background: "var(--success-bg)", color: "var(--success)", fontWeight: 600, fontSize: "0.875rem", border: "1px solid rgba(5,150,105,0.2)", display: "flex", alignItems: "center", gap: 6 }}><FiCheck />{ok}</div>}

      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <button className="btn" onClick={handleSave} disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer les modifications"}
        </button>
      </div>
    </div>
  );
}
