import api from "../api";
// Complete exports/charts or an explicit error; never silently truncate.
export async function fetchComplete(url, params = {}, signal) {
  const result = [];
  for (let page = 1; page <= 1000; page++) {
    const { data } = await api.get(url, { params: { ...params, page, limit: 500 }, signal });
    if (Array.isArray(data)) return data;
    const rows = data?.items || [];
    result.push(...rows);
    const total = Number(data?.total);
    if (Number.isFinite(total) && result.length >= total) return result;
    if (!rows.length) {
      if (Number.isFinite(total) && result.length < total) throw new Error("Résultats incomplets. Relancez la recherche.");
      return result;
    }
    if (!Number.isFinite(total) && rows.length < Number(data?.limit || 500)) return result;
  }
  throw new Error("Trop de résultats : réduisez la période avant de réessayer.");
}
