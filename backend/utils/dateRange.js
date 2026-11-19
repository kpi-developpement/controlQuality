"use strict";
function dateRange(from, to) {
  const result = {};
  for (const [key, raw] of [["$gte", from], ["$lte", to]]) {
    if (!raw) continue;
    if (typeof raw !== "string") throw Object.assign(new Error("Date invalide."), { status: 400 });
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw Object.assign(new Error("Date invalide."), { status: 400 });
    if (key === "$lte" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) d.setUTCHours(23,59,59,999);
    result[key] = d;
  }
  if (result.$gte && result.$lte && result.$gte > result.$lte) throw Object.assign(new Error("La date de début dépasse la date de fin."), { status: 400 });
  return Object.keys(result).length ? result : null;
}
module.exports = { dateRange };
