import React, { useState } from "react";
import { FiMail, FiLock, FiEye, FiEyeOff, FiArrowRight, FiAlertTriangle } from "react-icons/fi";
import api from "../api.js";
import AuroraBackground from "../components/fx/AuroraBackground.jsx";
import LoginShowcase from "../components/login/LoginShowcase.jsx";
import FloatingField from "../ui/FloatingField.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Écran de connexion : fond aurore, vitrine bento à gauche, carte en verre à droite.
 * Micro-validation : coche verte quand l'email est valide, secousse si l'identification échoue.
 * Styles : styles/features/login.css
 */
export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);

  const emailValid = EMAIL_RE.test(email.trim());
  const emailInvalid = touched && email.trim() !== "" && !emailValid;

  const fail = (msg) => {
    setStatus(msg);
    setShake(true);
    setTimeout(() => setShake(false), 460);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!emailValid) return fail("Saisissez une adresse email valide.");
    setStatus(""); setLoading(true);
    try {
      const res = await api.post("/auth/login", { email, password }, { toast: false });
      const { token, user } = res.data;
      onLoginSuccess(user, token);
    } catch (err) {
      fail(err.response?.data?.message || "Email ou mot de passe incorrect.");
    } finally { setLoading(false); }
  };

  return (
    <div className="login">
      <AuroraBackground />
      <div className="login__theme"><ThemeToggle /></div>

      <LoginShowcase />

      <main className="login__panel">
        <div className={`login__card${shake ? " is-shaking" : ""}`}>
          <div className="login__eyebrow">Espace Qualité</div>
          <h2 className="login__title">Bon retour</h2>
          <p className="login__subtitle">Connectez-vous pour accéder à la plateforme.</p>

          <form onSubmit={handleSubmit} className="login__form" noValidate>
            <FloatingField
              label="Adresse email" type="email" icon={<FiMail />}
              value={email} onChange={(e) => { setEmail(e.target.value); if (status) setStatus(""); }}
              onBlur={() => setTouched(true)}
              valid={emailValid} invalid={emailInvalid}
              hint={emailInvalid ? "Format attendu : nom@entreprise.com" : undefined}
              required autoComplete="username" autoFocus
            />
            <FloatingField
              label="Mot de passe" type={showPassword ? "text" : "password"} icon={<FiLock />}
              value={password} onChange={(e) => { setPassword(e.target.value); if (status) setStatus(""); }}
              required autoComplete="current-password"
              trailing={(
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="login__eye" tabIndex={-1}
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
                  {showPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              )}
            />

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
