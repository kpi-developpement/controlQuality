// src/api.js
import { API_URL } from "./backendUrl.js";
import axios from "axios";
import { toast } from "./toast/toastBus";

// BACKEND URL (with /api)
const API_BASE_URL = API_URL;

const api = axios.create({
  baseURL: API_BASE_URL,
});

// 🔒 JWT token injection
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 🔁 Auto logout if token invalid
// Patch: avoid hard redirect on background GET calls (can happen while user is filling a form)
// - Keep existing behavior for non-GET (save actions), so security/UX remains consistent.
// - Ignore /auth/login and /auth/ping to prevent redirect loops.
api.interceptors.response.use(
  (res) => {
    // Automatic success toasts for mutating actions (POST/PATCH/PUT/DELETE).
    // Opt-out: config.toast = false
    const method = (res.config?.method || "get").toLowerCase();
    const wantsToast = res.config?.toast !== false;
    if (wantsToast && ["post", "put", "patch", "delete"].includes(method)) {
      const msg = res.config?.toastSuccessMessage;
      toast.success(msg || "Action effectuée avec succès");
    }
    return res;
  },
  (err) => {
    const status = err.response?.status;
    const method = (err.config?.method || "get").toLowerCase();
    const url = (err.config?.url || "").toString();

    // Automatic error toasts (except when explicitly silenced)
    const wantsToast = err.config?.toast !== false;
    if (wantsToast) {
      const serverMsg = err.response?.data?.message;
      const msg = err.config?.toastErrorMessage || serverMsg || "Une erreur est survenue";
      // Avoid spamming on background GETs unless explicitly enabled
      const shouldToast = ["post", "put", "patch", "delete"].includes(method) || err.config?.toastOnGet === true;
      if (shouldToast) toast.error(msg);
    }

    if (status === 401) {
      // always clear stored auth (existing behavior)
      localStorage.removeItem("token");
      localStorage.removeItem("user");

      const isAuthRoute = url.includes("/auth/login") || url.includes("/auth/ping");

      // Only redirect on non-GET requests (user-triggered actions),
      // and avoid redirect loops on auth endpoints.
      if (!isAuthRoute && method !== "get") {
        toast.error("Session expirée. Merci de vous reconnecter.", { durationMs: 4200 });
        window.location.href = "/";
      }
    }

    return Promise.reject(err);
  }
);

export default api;
