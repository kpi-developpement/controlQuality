import React, { useId } from "react";
import { FiCheck } from "react-icons/fi";

/**
 * Champ à libellé flottant avec micro-validation.
 * - le libellé démarre dans le champ puis glisse au-dessus en rétrécissant (focus ou valeur saisie)
 * - valid=true : une coche verte apparaît avec un ressort
 * - invalid=true : bordure rouge + légère secousse, message dans `hint`
 * Styles : styles/components/inputs.css (.ffield)
 */
export default function FloatingField({ label, icon, valid = false, invalid = false, hint, trailing, id, className = "", ...inputProps }) {
  const autoId = useId();
  const inputId = id || autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const cls = ["ffield", valid && !invalid && "is-valid", invalid && "is-invalid", className].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <div className="ffield__box">
        {icon ? <span className="ffield__icon" aria-hidden="true">{icon}</span> : null}
        <span className="ffield__inner">
          <input id={inputId} className="ffield__control" placeholder=" " aria-invalid={invalid || undefined} aria-describedby={hintId} {...inputProps} />
          <label htmlFor={inputId} className="ffield__label">{label}</label>
        </span>
        <span className="ffield__ok" aria-hidden="true"><FiCheck size={13} strokeWidth={3} /></span>
        {trailing ? <span className="ffield__trail">{trailing}</span> : null}
      </div>
      {hint ? <div id={hintId} className="ffield__hint">{hint}</div> : null}
    </div>
  );
}
