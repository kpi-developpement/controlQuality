// Formatage des indicateurs : taux, couleur selon les seuils, bornes de mois.
export const fmtRate = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)} %`);
export const toneFor = (v, good = 80, warn = 50, inverse = false) => {
  if (v === null || v === undefined) return undefined;
  if (inverse) return v <= 100 - good ? "good" : v <= 100 - warn ? "warn" : "bad";
  return v >= good ? "good" : v >= warn ? "warn" : "bad";
};

/** Bornes UTC d'une plage de mois (AAAA-MM). */
export function monthRange(fromMonth, toMonth) {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return {
    dateFrom: new Date(Date.UTC(fy, fm - 1, 1)).toISOString(),
    dateTo: new Date(Date.UTC(ty, tm, 0, 23, 59, 59, 999)).toISOString(),
  };
}
export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
