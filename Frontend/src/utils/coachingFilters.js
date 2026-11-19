import { initialPeriod, periodRange } from "./period.mjs";
export const initialCoachingFilters = () => ({ q: "", cell: "", pilotIds: [], period: initialPeriod() });
export function coachingParams(filters) {
  const range = periodRange(filters.period);
  return { q: filters.q.trim(), cell: filters.cell, pilotId: filters.pilotIds.join(","), coachingDateFrom: range.dateFrom, coachingDateTo: range.dateTo };
}
