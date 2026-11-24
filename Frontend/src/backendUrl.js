// src/backendUrl.js — adresse du backend vue par le navigateur
// Par défaut : même hôte que la page, port 5000 (ex. page http://10.10.10.50:5173 → API http://10.10.10.50:5000/api).
// Surcharge possible au build : VITE_API_URL (avec /api) et VITE_API_BASE_URL (sans /api).
const env = import.meta.env || {};
const sameHost = typeof window !== "undefined" && window.location?.hostname
  ? `${window.location.protocol === "https:" ? "https:" : "http:"}//${window.location.hostname}:5000`
  : "http://localhost:5000";

export const API_URL = env.VITE_API_URL || `${(env.VITE_API_BASE_URL || sameHost).replace(/\/$/, "")}/api`;
export const BACKEND_ORIGIN = (env.VITE_API_BASE_URL || API_URL.replace(/\/api\/?$/, "")).replace(/\/$/, "");
