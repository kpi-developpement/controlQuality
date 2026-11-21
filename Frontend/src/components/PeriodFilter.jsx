import React from "react";
import { localDate, periodRange } from "../utils/period.mjs";
import Select from "../ui/Select.jsx";

const fr = (iso) => new Date(iso).toLocaleDateString("fr-FR");

export default function PeriodFilter({ value, onChange, label = "Période" }) {
  const range = periodRange(value);
  const setMode = (mode) => {
    if (mode === "custom") {
      const r = periodRange(value);
      const today = localDate();
      onChange({ ...value, mode, from: value.from || (r.dateFrom ? localDate(new Date(r.dateFrom)) : today.slice(0, 8) + "01"), to: value.to || (r.dateTo ? localDate(new Date(r.dateTo)) : today) });
    } else onChange({ ...value, mode, anchor: value.anchor || localDate() });
  };
  const invalid = value.mode === "custom" && value.from && value.to && value.from > value.to;
  return <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
    <label>{label}<Select aria-label={label} className="input" value={value.mode} onChange={(e) => setMode(e.target.value)}>
      <option value="all">Toutes les dates</option><option value="day">Jour</option><option value="week">Semaine (lundi–dimanche)</option><option value="month">Mois</option><option value="custom">Période personnalisée</option>
    </Select></label>
    {value.mode === "custom" ? <>
      <label>Du<input className="input" type="date" value={value.from || ""} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
      <label>Au<input className="input" type="date" value={value.to || ""} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
    </> : value.mode !== "all" && <label>{value.mode === "month" ? "Mois choisi" : value.mode === "week" ? "Un jour de la semaine" : "Date choisie"}
      <input className="input" type={value.mode === "month" ? "month" : "date"} value={value.mode === "month" ? value.anchor.slice(0,7) : value.anchor} onChange={(e) => { if (e.target.value) onChange({ ...value, anchor: e.target.value + (value.mode === "month" ? "-01" : "") }); }} />
    </label>}
    {invalid ? <span style={{ color: "var(--danger)", fontSize: 12, paddingBottom: 8 }}>La date de début doit précéder la date de fin.</span>
      : (range.dateFrom || range.dateTo) && <span style={{ color: "var(--muted)", fontSize: 12, paddingBottom: 8 }}>{range.dateFrom ? `Du ${fr(range.dateFrom)}` : "Jusqu'"}{range.dateTo ? ` au ${fr(range.dateTo)}` : " à aujourd'hui"}</span>}
    <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ mode: "all", anchor: localDate() })}>Toutes les dates</button>
  </div>;
}
