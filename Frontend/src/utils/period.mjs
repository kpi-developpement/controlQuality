export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function periodRange(period) {
  if (!period || period.mode === "all" || !period.anchor) return {};
  const start = new Date(`${period.anchor}T00:00:00`);
  if (Number.isNaN(start.getTime())) return {};
  let end = new Date(start);
  if (period.mode === "week") {
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    end = new Date(start); end.setDate(end.getDate() + 6);
  } else if (period.mode === "month") {
    start.setDate(1); end = new Date(start.getFullYear(), start.getMonth()+1, 0);
  }
  end.setHours(23,59,59,999);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}
export function inPeriod(date, period) {
  const range = periodRange(period);
  if (!range.dateFrom) return true;
  const time = new Date(date).getTime();
  return Number.isFinite(time) && time >= Date.parse(range.dateFrom) && time <= Date.parse(range.dateTo);
}
export const initialPeriod = () => ({ mode: "all", anchor: localDate() });
