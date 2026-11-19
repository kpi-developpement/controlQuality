"use strict";
// Accept embed URLs only; the server never fetches this URL.
function normalizeReport(input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 120) throw new Error("Titre requis (120 caractères maximum).");
  if (typeof input.url !== "string" || input.url.length > 6000) throw new Error("Lien Power BI invalide.");
  let url;
  try { url = new URL(input.url.trim()); } catch { throw new Error("Lien Power BI invalide."); }
  if (url.protocol !== "https:" || url.hostname !== "app.powerbi.com" || url.port || url.username || url.password) {
    throw new Error("Utilisez un lien HTTPS provenant de app.powerbi.com.");
  }
  const path = url.pathname.replace(/\/$/, "").toLowerCase();
  if (path !== "/reportembed" && path !== "/view") {
    throw new Error("Copiez le lien d’intégration Power BI : Fichier > Incorporer le rapport > Site web ou portail.");
  }
  if ((path === "/reportembed" && !url.searchParams.get("reportId")) || (path === "/view" && !url.searchParams.get("r"))) {
    throw new Error("Le lien ne contient pas l’identifiant du rapport.");
  }
  const pageName = typeof input.pageName === "string" ? input.pageName.trim() : "";
  if (pageName.length > 200 || /[\x00-\x1f]/.test(pageName)) throw new Error("Identifiant de page invalide.");
  // Preserve embedded pageName when the optional field is empty.
  if (pageName) url.searchParams.set("pageName", pageName);
  url.hash = "";
  return { title, url: url.toString(), pageName: pageName || url.searchParams.get("pageName") || "" };
}
module.exports = { normalizeReport };
