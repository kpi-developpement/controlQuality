import React, { useState } from "react";
import Ico from "../../ui/Ico.jsx";
import { downloadChatDocument } from "../../utils/chatDocuments.mjs";
import { markdownToHtml } from "./markdown.js";

/** Bulle de conversation ; les réponses de l'assistant se téléchargent en Word ou Excel. */
export default function AssistantBubble({ message }) {
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");

  async function download(format) {
    setExporting(format); setExportError("");
    try { await downloadChatDocument(message.text, format); }
    catch (e) { setExportError(e.message || "Téléchargement impossible. Réessayez."); }
    finally { setExporting(""); }
  }

  if (message.role === "user") {
    return <div className="ai-bubble ai-bubble--user">{message.text}</div>;
  }
  return (
    <div className={message.error ? "ai-bubble ai-bubble--ai is-error" : "ai-bubble ai-bubble--ai"}>
      <div dangerouslySetInnerHTML={{ __html: markdownToHtml(message.text) }} />
      {!message.error && (
        <div className="ai-bubble__actions">
          <button className="btn btn--ghost btn--sm" disabled={!!exporting} onClick={() => download("docx")}>{exporting === "docx" ? "Création…" : <><Ico n="download" /> Word (.docx)</>}</button>
          <button className="btn btn--ghost btn--sm" disabled={!!exporting} onClick={() => download("xlsx")}>{exporting === "xlsx" ? "Création…" : <><Ico n="download" /> Excel (.xlsx)</>}</button>
        </div>
      )}
      {exportError && <div role="alert" className="ai-bubble__error">{exportError}</div>}
    </div>
  );
}
