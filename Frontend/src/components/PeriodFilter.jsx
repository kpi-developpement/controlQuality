import React from "react";
import { localDate, periodRange } from "../utils/period.mjs";
import Select from "../ui/Select.jsx";
export default function PeriodFilter({ value, onChange, label = "Période" }) {
  const range = periodRange(value);
  return <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
    <label>{label}<Select aria-label={label} className="input" value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value, anchor: value.anchor || localDate() })}>
      <option value="all">Toutes les dates</option><option value="day">Jour</option><option value="week">Semaine (lundi–dimanche)</option><option value="month">Mois</option>
    </Select></label>
    {value.mode !== "all" && <label>{value.mode === "month" ? "Mois choisi" : value.mode === "week" ? "Un jour de la semaine" : "Date choisie"}
      <input className="input" type={value.mode === "month" ? "month" : "date"} value={value.mode === "month" ? value.anchor.slice(0,7) : value.anchor} onChange={(e) => { if (e.target.value) onChange({ ...value, anchor: e.target.value + (value.mode === "month" ? "-01" : "") }); }} />
    </label>}
    {range.dateFrom && <span style={{ color: "var(--muted)", fontSize: 12, paddingBottom: 8 }}>Du {new Date(range.dateFrom).toLocaleDateString("fr-FR")} au {new Date(range.dateTo).toLocaleDateString("fr-FR")}</span>}
    <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ mode: "all", anchor: localDate() })}>Toutes les dates</button>
  </div>;
}
