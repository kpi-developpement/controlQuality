import React from "react";
import BrandMark from "../shell/BrandMark.jsx";
import { FiCheckCircle, FiBarChart2, FiHeadphones, FiTarget } from "react-icons/fi";

/**
 * Vitrine de l'écran de connexion : accroche + mini grille « bento » de cartes en verre
 * qui s'inclinent sous le curseur (.card--tilt, src/ui/tilt.js).
 */
export default function LoginShowcase() {
  return (
    <section className="login-show" aria-hidden="true">
      <div className="login-show__brand">
        <span className="login-show__logo"><BrandMark size={26} /></span>
        <span>Kyntus</span>
        <span className="live-pill"><span className="live-pill__dot" /> Contrôle qualité</span>
      </div>

      <h1 className="login-show__title">
        La qualité de vos appels,<br /><span>pilotée en temps réel.</span>
      </h1>
      <p className="login-show__text">Évaluations, coaching, calibrages et indicateurs qualité réunis dans un seul espace.</p>

      <div className="login-bento">
        <div className="card card--tilt login-bento__tile login-bento__tile--score">
          <div className="login-bento__label" data-depth="1"><FiBarChart2 /> Score qualité</div>
          <div className="login-bento__value" data-depth="3">87,4 %</div>
          <svg className="login-bento__spark" data-depth="2" viewBox="0 0 160 48" fill="none" preserveAspectRatio="none">
            <defs><linearGradient id="lsg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#5b8cff" stopOpacity="0.45" /><stop offset="1" stopColor="#5b8cff" stopOpacity="0" /></linearGradient></defs>
            <path d="M0 40 L20 34 L40 37 L60 24 L80 28 L100 16 L120 20 L140 8 L160 10 L160 48 L0 48 Z" fill="url(#lsg)" />
            <path d="M0 40 L20 34 L40 37 L60 24 L80 28 L100 16 L120 20 L140 8 L160 10" stroke="#7ea4ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="card card--tilt login-bento__tile">
          <span className="login-bento__icon login-bento__icon--green" data-depth="2"><FiCheckCircle /></span>
          <div data-depth="1"><b>Évaluations</b><small>Grilles, scores &amp; contestations</small></div>
        </div>
        <div className="card card--tilt login-bento__tile">
          <span className="login-bento__icon login-bento__icon--amber" data-depth="2"><FiHeadphones /></span>
          <div data-depth="1"><b>Coaching</b><small>Suivi des pilotes</small></div>
        </div>
        <div className="card card--tilt login-bento__tile login-bento__tile--wide">
          <span className="login-bento__icon" data-depth="2"><FiTarget /></span>
          <div data-depth="1"><b>Calibrages &amp; picking</b><small>Alignement des évaluateurs, contrôle process</small></div>
          <div className="login-bento__bars" data-depth="3"><span style={{ "--h": "62%" }} /><span style={{ "--h": "86%" }} /><span style={{ "--h": "48%" }} /><span style={{ "--h": "74%" }} /></div>
        </div>
      </div>
    </section>
  );
}
