import React, { useState } from "react";
import { FiMail, FiLock, FiEye, FiEyeOff, FiArrowRight, FiAlertTriangle, FiCheckCircle, FiBarChart2, FiHeadphones } from "react-icons/fi";
import api from "../api.js";
import "./login.css";
import LuxeBackground from "../components/LuxeBackground.jsx";
import Ico from "../ui/Ico.jsx";

function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(""); setLoading(true);
    try {
      const res = await api.post("/auth/login", { email, password }, { toast: false });
      const { token, user } = res.data;
      onLoginSuccess(user, token);
    } catch (err) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      setStatus(err.response?.data?.message || "Email ou mot de passe incorrect.");
    } finally { setLoading(false); }
  };

  return (
    <div className="login">
      {/* ===== Panneau de marque ===== */}
      <aside className="login__brand" aria-hidden="true">
        <div className="login__orb login__orb--1" />
        <div className="login__orb login__orb--2" />
        <div className="login__orb login__orb--3" />
        <div className="login__grid" />

        <div className="login__brandTop">
          <div className="login__logo"><img src="/kyntus.svg" alt="" /></div>
          <span>Kyntus</span>
        </div>

        <div className="login__pitch">
          <h1>La qualité de vos appels,<br /><span>pilotée en temps réel.</span></h1>
          <p>Évaluations, coaching, calibrages et indicateurs qualité réunis dans un seul espace.</p>

          <div className="login__floats">
            <div className="login__float login__float--a">
              <div className="login__floatIcon" style={{ background: "rgba(52,211,153,0.16)", color: "#34d399" }}><FiCheckCircle /></div>
              <div>
                <div className="login__floatValue">Évaluations</div>
                <div className="login__floatLabel">Grilles, scores &amp; contestations</div>
              </div>
              <svg className="login__spark" viewBox="0 0 80 28" fill="none"><path d="M1 22 L14 18 L26 20 L38 11 L50 14 L62 6 L79 3" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="login__float login__float--b">
              <div className="login__floatIcon" style={{ background: "rgba(122,162,255,0.18)", color: "#9dbcff" }}><FiBarChart2 /></div>
              <div>
                <div className="login__floatValue">Indicateurs qualité</div>
                <div className="login__floatLabel">KPI, calibrages &amp; échantillons</div>
              </div>
            </div>
            <div className="login__float login__float--c">
              <div className="login__floatIcon" style={{ background: "rgba(251,191,36,0.16)", color: "#fbbf24" }}><FiHeadphones /></div>
              <div>
                <div className="login__floatValue">Coaching</div>
                <div className="login__floatLabel">Suivi et accompagnement des pilotes</div>
              </div>
            </div>
          </div>
        </div>

        <div className="login__brandFoot">© LK - Kyntus Morocco</div>
      </aside>

      {/* ===== Formulaire ===== */}
      <main className="login__panel">
        <LuxeBackground variant="login" />
        <div className={`login__card${shake ? " is-shaking" : ""}`}>
          <div className="login__mobileLogo"><img src="/kyntus.svg" alt="" /></div>
          <div className="login__eyebrow">Espace Qualité</div>
          <h2 className="login__title">Bon retour</h2>
          <p className="login__subtitle">Connectez-vous pour accéder à la plateforme</p>

          <form onSubmit={handleSubmit} className="login__form">
            <label className="login__field">
              <span className="login__label">Adresse email</span>
              <span className="login__inputWrap">
                <FiMail className="login__inputIcon" />
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  required className="login__input" placeholder="nom@entreprise.com" autoComplete="username" autoFocus
                />
              </span>
            </label>

            <label className="login__field">
              <span className="login__label">Mot de passe</span>
              <span className="login__inputWrap">
                <FiLock className="login__inputIcon" />
                <input
                  type={showPassword ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required className="login__input" placeholder="••••••••" autoComplete="current-password"
                />
                <button
                  type="button" onClick={() => setShowPassword(!showPassword)}
                  className="login__eye" tabIndex={-1}
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                >
                  {showPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              </span>
            </label>

            <button type="submit" className="btn login__submit" disabled={loading}>
              {loading ? (<><span className="login__spinner" /> Connexion en cours…</>) : (<>Se connecter <FiArrowRight className="login__arrow" /></>)}
            </button>

            {status && (
              <div className="login__alert" role="alert">
                <FiAlertTriangle style={{ flexShrink: 0 }} />{status}
              </div>
            )}
          </form>

          <div className="login__footer">
            <span>© LK - Kyntus Morocco</span>
            <span className="login__version">V 3.1.15</span>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Login;
