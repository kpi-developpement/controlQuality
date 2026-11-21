import React, { useMemo, useState } from "react";
import Ico from "../../../ui/Ico.jsx";

// Couleurs des notations : NA gris, PC/C vert, PNC/NC orange, NP rouge
const TONE = { NA: "na", PC: "ok", C: "ok", PNC: "warn", NC: "warn", NP: "bad" };

function notationOptionsFor(items) {
  const hasPresence = (items || []).some((it) => ["PC", "PNC", "NP"].includes(String(it?.status || "").toUpperCase()));
  return hasPresence
    ? [
        { value: "PC", label: "PC", title: "Présent Conforme" },
        { value: "PNC", label: "PNC", title: "Présent Non Conforme" },
        { value: "NP", label: "NP", title: "Non Présent" },
        { value: "NA", label: "NA", title: "Non Applicable" },
      ]
    : [
        { value: "C", label: "C", title: "Conforme" },
        { value: "NC", label: "NC", title: "Non Conforme" },
        { value: "NA", label: "NA", title: "Non Applicable" },
      ];
}

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("fr-FR");
};

/**
 * Détail / édition de la notation d'une évaluation.
 * - readOnly : consultation seule (rôles sans droit d'édition)
 * - onOpen : bouton « Ouvrir l'évaluation » (redirection vers l'écran d'évaluation)
 */
export default function EditScoreModal({ score, onClose, onSave, isSaving, readOnly = false, onOpen }) {
  const initialItems = useMemo(() => {
    const baseItems = Array.isArray(score?.items) ? score.items : [];
    return baseItems
      .filter((it) => (it?.label || "").toString().trim().length > 0)
      .map((it) => ({
        label: (it?.label || "").toString(),
        status: (it?.status || "").toString().toUpperCase(),
        value: typeof it?.value === "number" ? it.value : 0,
      }));
  }, [score]);

  const [items, setItems] = useState(initialItems);
  const options = useMemo(() => notationOptionsFor(items), [items]);

  if (!score) return null;

  const pilotName = score?.pilotName || score?.pilot?.name || (typeof score?.pilot === "string" ? score.pilot : "");
  const evaluatorName = score?.evaluatorName || score?.evaluator?.name || "";
  const pct = Number(score?.compliancePercent ?? score?.avgPercent ?? 0);
  const counts = items.reduce((acc, it) => { acc[it.status || "—"] = (acc[it.status || "—"] || 0) + 1; return acc; }, {});

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="scorem" role="dialog" aria-modal="true" aria-label="Détail de l'évaluation" onClick={(e) => e.stopPropagation()}>
        <div className="scorem__head">
          <div>
            <div className="scorem__title">{readOnly ? "Détail de l'évaluation" : "Éditer la notation"}</div>
            <div className="scorem__sub">
              {pilotName || "Agent"} — {score?.eps || "Sans EPS"} · évaluée le {fmtDate(score?.evaluationDate || score?.createdAt)}
              {evaluatorName ? ` par ${evaluatorName}` : ""}
            </div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Fermer"><Ico n="x" /></button>
        </div>

        <div className="scorem__meta">
          <span className={`badge ${pct >= 80 ? "badge--success" : pct >= 50 ? "badge--warning" : "badge--danger"}`}>Score {pct.toFixed(1)} %</span>
          <span className={`badge ${score?.pilotValidated ? "badge--success" : "badge--muted"}`}>
            {score?.pilotValidated ? `Signée le ${fmtDate(score?.pilotValidatedAt)}` : "Non signée"}
          </span>
          {Object.entries(counts).map(([k, n]) => (
            <span key={k} className={`scorem__count scorem__count--${TONE[k] || "none"}`}>{k === "—" ? "Non noté" : k} × {n}</span>
          ))}
        </div>

        <div className="scorem__comment">
          <div className="label">Commentaire de l'évaluateur</div>
          <p>{score?.comment?.trim() ? score.comment : "Aucun commentaire laissé lors de la création."}</p>
        </div>

        <div className="scorem__items">
          {items.map((it, idx) => (
            <div key={`${it.label}-${idx}`} className={`scorem__row scorem__row--${TONE[it.status] || "none"}`}>
              <div className="scorem__label">{it.label}</div>
              <div className="scorem__seg" role="radiogroup" aria-label={it.label}>
                {options.map((o) => {
                  const on = it.status === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={o.title}
                      disabled={readOnly && !on}
                      className={`scorem__opt scorem__opt--${TONE[o.value]}${on ? " is-on" : ""}`}
                      onClick={() => !readOnly && setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, status: o.value } : x)))}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!items.length && <p className="muted">Aucun critère enregistré pour cette évaluation.</p>}
        </div>

        <div className="scorem__foot">
          {onOpen && <button className="btn btn--ghost" onClick={onOpen}><Ico n="external" /> Ouvrir l'évaluation</button>}
          <span style={{ flex: 1 }} />
          <button className="btn btn--ghost" onClick={onClose} disabled={isSaving}>{readOnly ? "Fermer" : "Annuler"}</button>
          {!readOnly && <button className="btn" onClick={() => onSave?.(items)} disabled={isSaving}>{isSaving ? "Enregistrement…" : "Enregistrer"}</button>}
        </div>
      </div>
    </div>
  );
}
