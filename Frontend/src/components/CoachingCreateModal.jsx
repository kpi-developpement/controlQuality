import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import Select from "../ui/Select.jsx";
import { fmtDate, scorePercent } from "../utils/evalMeta.js";

/**
 * Création d'un coaching.
 * - « Objet du coaching » obligatoire (remplace l'EPS) ;
 * - l'évaluation liée est facultative : un coaching n'est pas bloqué sur une évaluation existante.
 * Props : score (évaluation pré-sélectionnée, ex. depuis Performance agents), pilots (liste des agents),
 *         onClose, onCreated(coaching)
 */
export default function CoachingCreateModal({ score = null, pilots = [], onClose, onCreated }) {
  const presetPilot = String(score?.pilot?._id || score?.pilotId || score?.pilot || "");
  const [pilotId, setPilotId] = useState(presetPilot);
  const [scoreId, setScoreId] = useState(score?._id ? String(score._id) : "");
  const [subject, setSubject] = useState(score ? `Évaluation ${score.eps ? `${score.eps} ` : ""}à ${Number(scorePercent(score)).toFixed(1)} %` : "");
  const [notes, setNotes] = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const [status, setStatus] = useState("open");
  const [followUpDate, setFollowUpDate] = useState("");
  const [scoreOptions, setScoreOptions] = useState([]);
  const [loadingScores, setLoadingScores] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Évaluations de l'agent (facultatif) — inutile si l'évaluation est imposée
  useEffect(() => {
    if (score || !pilotId) { setScoreOptions([]); return undefined; }
    let m = true;
    setLoadingScores(true);
    const role = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}").role; } catch { return ""; } })();
    const endpoint = ["cq", "formateur"].includes(role) ? "/scores/mine" : "/scores";
    api.get(endpoint, { params: { limit: 100, page: 1, pilotId, evaluationType: "standard,picking,coaching,sample" } })
      .then((r) => m && setScoreOptions((r.data?.items || []).map((s) => ({ value: String(s._id), label: `${fmtDate(s.createdAt)} — ${s.eps || "sans EPS"} — ${Number(scorePercent(s)).toFixed(1)} %` }))))
      .catch(() => m && setScoreOptions([]))
      .finally(() => m && setLoadingScores(false));
    return () => { m = false; };
  }, [pilotId, score]);

  const pilotOpts = useMemo(() => (pilots || []).map((p) => ({ value: String(p._id), label: `${p.name || ""}${p.cell ? ` — ${p.cell}` : ""}` })), [pilots]);

  async function submit() {
    setErr("");
    if (!pilotId && !scoreId) return setErr("Choisissez un agent.");
    if (!subject.trim()) return setErr("Renseignez l'objet du coaching.");
    try {
      setBusy(true);
      const { data } = await api.post("/coaching", { pilotId: pilotId || undefined, scoreId: scoreId || undefined, subject: subject.trim(), notes, actionPlan, status, followUpDate: followUpDate || null }, { toast: false });
      onCreated?.(data);
    } catch (e) {
      setErr(e?.response?.data?.message || "Création du coaching impossible.");
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="coaching-create-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div id="coaching-create-title" style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: 16 }}>Nouveau coaching</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="label">Agent *
            {score ? <input className="input nep__locked" readOnly value={score.pilotName || score.pilot?.name || "Agent"} />
              : <Select className="input" value={pilotId} onChange={(e) => { setPilotId(e.target.value); setScoreId(""); }}>
                  <option value="">Choisir un agent…</option>
                  {pilotOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>}
          </label>
          <label className="label">Objet du coaching *
            <input className="input" value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} placeholder="Ex. : Reformulation du besoin client, découverte…" />
          </label>
          {!score && (
            <label className="label">Évaluation liée (facultatif)
              <Select className="input" value={scoreId} onChange={(e) => setScoreId(e.target.value)} disabled={!pilotId}>
                <option value="">{!pilotId ? "Choisissez d'abord un agent" : loadingScores ? "Chargement…" : "Aucune évaluation liée"}</option>
                {scoreOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </label>
          )}
          <label className="label">Notes / Observations
            <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Points observés…" />
          </label>
          <label className="label">Plan d'action
            <textarea className="input" rows={3} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} placeholder="Actions correctives à mettre en place…" />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label className="label">Statut
              <Select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="open">Ouvert</option>
                <option value="in_progress">En cours</option>
                <option value="done">Terminé</option>
              </Select>
            </label>
            <label className="label">Date de relance
              <input className="input" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
            </label>
          </div>
        </div>
        {err && <div role="alert" style={{ marginTop: 10, color: "var(--danger)", fontSize: "0.85rem", fontWeight: 600 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn btn--ghost" type="button" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn" type="button" onClick={submit} disabled={busy}>{busy ? "Création…" : "Créer le coaching"}</button>
        </div>
      </div>
    </div>
  );
}
