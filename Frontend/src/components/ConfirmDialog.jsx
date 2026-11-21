import React, { useEffect, useRef } from "react";
import Ico from "../ui/Ico.jsx";

/** Popup de confirmation (suppression, action irréversible). */
export default function ConfirmDialog({ open, title = "Confirmer", message, confirmLabel = "Confirmer", cancelLabel = "Annuler", danger = false, busy = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape" && !busy) onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel?.()}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <div className={`confirm__icon${danger ? " confirm__icon--danger" : ""}`}><Ico n={danger ? "trash" : "alert"} size={22} /></div>
        <h3 id="confirm-title" className="confirm__title">{title}</h3>
        <div className="confirm__msg">{message}</div>
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className={danger ? "btn btn-danger-solid" : "btn"} onClick={onConfirm} disabled={busy}>{busy ? "Patientez…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
