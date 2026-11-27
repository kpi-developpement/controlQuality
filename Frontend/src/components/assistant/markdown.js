// Conversion Markdown → HTML minimal pour les réponses de l'assistant.
// Le texte est d'abord échappé : aucune balise venant du modèle n'est interprétée.
export function markdownToHtml(text) {
  let h = String(text || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, '<div class="ai-md__h3">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="ai-md__h2">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="ai-md__h1">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/`(.+?)`/g, '<code class="ai-md__code">$1</code>')
    .replace(/^[-*] (.+)$/gm, '<div class="ai-md__li">• $1</div>')
    .replace(/^(\d+)\. (.+)$/gm, '<div class="ai-md__li">$1. $2</div>')
    .replace(/^\|[\s\-|]+\|$/gm, "")
    .replace(/^\|(.+)\|$/gm, (m, inner) => {
      const cells = inner.split("|").map((c) => c.trim()).filter(Boolean);
      return `<div class="ai-md__row">${cells.map((c) => `<span>${c}</span>`).join("")}</div>`;
    })
    .replace(/\n/g, "<br/>");
  return h.replace(/(<br\/>){3,}/g, "<br/><br/>");
}
