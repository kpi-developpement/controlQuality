import React, { useEffect, useRef, useState } from "react";
import { FiX, FiSend, FiMessageCircle } from "react-icons/fi";
import api from "../../api";
import Ico from "../../ui/Ico.jsx";
import Select from "../../ui/Select.jsx";
import AssistantBubble from "./AssistantBubble.jsx";

const SUGGESTIONS = [
  "Quels agents ont le plus bas score ?",
  "Comment améliorer le taux de contestation ?",
  "Conseils coaching pour un agent NC sur l'accueil",
];

/**
 * Assistant QA flottant : bouton lumineux en bas à droite, fenêtre de conversation en verre,
 * suggestions rapides, choix du format de sortie (texte, Word, Excel).
 * Styles : styles/components/assistant.css
 */
export default function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [outputFormat, setOutputFormat] = useState("auto");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 200); }, [open]);

  async function send(text) {
    const q = String(text ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setLoading(true);
    try {
      const history = messages.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const res = await api.post("/admin/ai/chat", { message: q, history, format: outputFormat }, { toast: false });
      setMessages((prev) => [...prev, { role: "ai", text: res.data?.reply || "Pas de réponse.", model: res.data?.model || "" }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "ai", text: e?.response?.data?.message || "Erreur. Vérifiez la clé API IA dans Santé > Configuration.", error: true }]);
    } finally { setLoading(false); }
  }

  return (
    <>
      <button className={open ? "ai-fab is-open" : "ai-fab"} onClick={() => setOpen((v) => !v)} title="Assistant IA" aria-label={open ? "Fermer l'assistant" : "Ouvrir l'assistant IA"} aria-expanded={open}>
        <span key={open ? "x" : "m"} className="ai-fab__icon">{open ? <FiX size={22} /> : <FiMessageCircle size={22} />}</span>
      </button>

      {open && (
        <div className="ai-panel" role="dialog" aria-label="Assistant QA">
          <div className="ai-panel__head">
            <div className="ai-panel__brand">
              <span className="ai-panel__logo"><Ico n="bot" /></span>
              <div>
                <div className="ai-panel__title">Assistant QA</div>
                <div className="ai-panel__sub">Kyntus IA</div>
              </div>
            </div>
            <button className="iconbtn" onClick={() => setOpen(false)} aria-label="Fermer"><FiX size={16} /></button>
          </div>

          <div className="ai-panel__body">
            {messages.length === 0 && (
              <div className="ai-empty">
                <span className="ai-empty__icon"><Ico n="bot" /></span>
                <div className="ai-empty__title">Que voulez-vous savoir ?</div>
                <div className="ai-empty__text">Qualité, scores, agents, coaching… posez votre question.</div>
              </div>
            )}
            {messages.map((m, i) => <AssistantBubble key={i} message={m} />)}
            {loading && <div className="ai-bubble ai-bubble--ai ai-typing" aria-label="Réflexion en cours"><span /><span /><span /></div>}
            <div ref={bottomRef} />
          </div>

          {/* Barre de saisie « prompt » : grande, lumineuse au focus, puces de suggestions */}
          <div className="ai-prompt">
            {messages.length === 0 && (
              <div className="ai-prompt__chips">
                {SUGGESTIONS.map((s) => <button key={s} type="button" className="cmd-chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            <div className="ai-prompt__box">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                maxLength={12000}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Votre question…"
                aria-label="Votre question"
              />
              <button className="ai-prompt__send" onClick={() => send()} disabled={loading || !input.trim()} aria-label="Envoyer"><FiSend size={16} /></button>
            </div>
            <label className="ai-prompt__format">Sortie
              <Select aria-label="Sortie souhaitée" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} disabled={loading}>
                <option value="auto">Automatique</option><option value="text">Réponse simple</option><option value="docx">Document Word</option><option value="xlsx">Tableau Excel</option>
              </Select>
              <span>Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne</span>
            </label>
          </div>
        </div>
      )}
    </>
  );
}
