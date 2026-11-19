import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import PageHeader from "../../components/PageHeader.jsx";
import MultiSelect from "../../components/MultiSelect.jsx";
import { fetchAllPaged } from "../../utils/fetchAllPaged.js";
import { exportToXlsx } from "../../pages/admin/components/exportXlsx.js";
import { toast } from "../../toast/toastBus.js";
import ContextHelp from "../../components/ContextHelp.jsx";
import { isInCurrentEditCycle } from "../../utils/editCycle.js";
import { EVAL_TYPES, LIST_DEFAULT_TYPES, typeShort, evalWorkbook } from "../../utils/evalMeta.js";

function openEdit(scoreId) {
  window.dispatchEvent(new CustomEvent("kcq:navigate", { detail: { role: "cq", view: "new", editScoreId: String(scoreId || "") } }));
}

function scoreToPercent(s) {
  const v1 = s?.compliancePercent;
  if (typeof v1 === "number" && !Number.isNaN(v1)) return v1;
  const v2 = s?.avgPercent;
  if (typeof v2 === "number" && !Number.isNaN(v2)) return v2;
  const v3 = s?.avgScore;
  if (typeof v3 === "number" && !Number.isNaN(v3)) return v3 * 20;
  return 0;
}

function formatScorePct(s) { return `${Number(scoreToPercent(s) || 0).toFixed(1)}%`; }

function scoreBadgeClass(s) {
  const pct = scoreToPercent(s);
  if (pct >= 80) return "badge badge--success";
  if (pct >= 50) return "badge badge--warning";
  return "badge badge--danger";
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("fr-FR");
}

function fmtItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items.map((it) => `${it.label || ""}:${it.status || ""}`).join(" | ");
}

const months = [
  { value: "01", label: "Jan" }, { value: "02", label: "Fév" }, { value: "03", label: "Mar" }, { value: "04", label: "Avr" },
  { value: "05", label: "Mai" }, { value: "06", label: "Juin" }, { value: "07", label: "Juil" }, { value: "08", label: "Août" },
  { value: "09", label: "Sep" }, { value: "10", label: "Oct" }, { value: "11", label: "Nov" }, { value: "12", label: "Déc" },
];

function buildYearOptions(span = 6) {
  const y = new Date().getFullYear();
  return Array.from({ length: span }, (_, i) => ({ value: String(y - i), label: String(y - i) }));
}

export default function CQEvaluations() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const [page, setPage] = useState(1);
  const years = useMemo(() => buildYearOptions(8), []);
  const now = new Date();
  const [yearSel, setYearSel] = useState([String(now.getFullYear())]);
  const [monthSel, setMonthSel] = useState([String(now.getMonth() + 1).padStart(2, "0")]);
  const [pilotSel, setPilotSel] = useState([]);
  const [contestedOnly, setContestedOnly] = useState(false);
  // Contrat Orange : type d'évaluation et code de clôture
  const [typeSel, setTypeSel] = useState(LIST_DEFAULT_TYPES);
  const [closureQ, setClosureQ] = useState("");
  const orangeParams = { evaluationType: typeSel.join(","), closureCode: closureQ.trim() || undefined };
  const [pilots, setPilots] = useState([]);
  const pilotOptions = useMemo(() => (pilots || []).map((p) => ({ value: String(p._id), label: `${p.name || ""}${p.cell ? " — " + p.cell : ""}`.trim() })), [pilots]);

  useEffect(() => {
    let m = true;
    api.get("/cq/pilots/search", { params: { limit: 200 } }).then((r) => m && setPilots(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    return () => { m = false; };
  }, []);

  useEffect(() => { setPage(1); }, [yearSel.join(","), monthSel.join(","), pilotSel.join(","), contestedOnly, typeSel.join(","), closureQ]);

  useEffect(() => {
    let m = true;
    setLoading(true); setErr("");
    (async () => {
      try {
        const params = { page, limit, year: yearSel.join(","), month: monthSel.join(","), pilotId: pilotSel.join(","), ...(contestedOnly ? { contested: "yes" } : {}), ...orangeParams };
        const res = await api.get("/scores/mine", { params });
        if (!m) return;
        setItems(res.data?.items || []); setTotal(res.data?.total || 0);
      } catch (e) { if (m) setErr(e?.response?.data?.message || "Erreur lors du chargement."); }
      finally { if (m) setLoading(false); }
    })();
    return () => { m = false; };
  }, [page, limit, yearSel, monthSel, pilotSel, contestedOnly, typeSel, closureQ]);

  const totalPages = Math.max(1, Math.ceil((total || 0) / limit));

  async function onExport() {
    try {
      setErr("");
      toast.info("Export en cours…", { durationMs: 1800 });
      const all = await fetchAllPaged(async ({ page: p, limit: l }) => {
        const res = await api.get("/scores/mine", { params: { page: p, limit: l, year: yearSel.join(","), month: monthSel.join(","), pilotId: pilotSel.join(","), ...orangeParams } });
        return { items: res.data?.items || [], total: res.data?.total || 0 };
      }, { pageSize: 200 });

      // Export complet : colonnes historiques + type, code de clôture, mois d'appel, périmètre, validation
      const rows = evalWorkbook(all || []);
      exportToXlsx(`evaluations_cq_${new Date().toISOString().slice(0, 10)}.xlsx`, rows);
      toast.success("Export terminé");
    } catch (e) {
      console.error(e);
      setErr("Impossible d'exporter en Excel.");
    }
  }

  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") { e.preventDefault(); onExport(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [yearSel, monthSel, pilotSel, contestedOnly, typeSel, closureQ]);

  return (
    <div className="page">
      <PageHeader title="Évaluations" subtitle="Consultez toutes les évaluations réalisées par les profils CQ et Management." />

      <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 12px" }}>
        <button className="btn" type="button" onClick={onExport}>Exporter Excel</button>
      </div>

      <div className="card filters-card">
        <div className="filters-grid">
          <div>
            <div className="label">Année</div>
            <MultiSelect options={years} value={yearSel} onChange={setYearSel} placeholder="Années" />
          </div>
          <div>
            <div className="label">Mois</div>
            <MultiSelect options={months} value={monthSel} onChange={setMonthSel} placeholder="Mois" />
          </div>
          <div>
            <div className="label">Agent</div>
            <MultiSelect options={pilotOptions} value={pilotSel} onChange={setPilotSel} placeholder="Agents" />
          </div>
          <div>
            <div className="label">Type d'évaluation</div>
            <MultiSelect options={EVAL_TYPES} value={typeSel} onChange={setTypeSel} placeholder="Tous les types" />
          </div>
          <div>
            <div className="label">Code de clôture</div>
            <input className="input" value={closureQ} onChange={(e) => setClosureQ(e.target.value)} placeholder="Rechercher un code…" />
          </div>
          <div>
            <div className="label">Contestées</div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0.5rem 0.75rem", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", background: "var(--panel)", cursor: "pointer", fontSize: "0.875rem" }}>
              <input type="checkbox" checked={contestedOnly} onChange={(e) => setContestedOnly(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} />
              <span style={{ fontWeight: 600 }}>Uniquement contestées</span>
            </label>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}><ContextHelp pageKey="cq_evaluations" /></div>

      {err ? <div className="card" style={{ borderColor: "rgba(220,38,38,0.25)", padding: 12, color: "var(--danger)", marginBottom: 12, background: "var(--danger-bg)" }}>{err}</div> : null}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Résultats</div>
          <div style={{ color: "var(--muted)", fontSize: "0.8rem", fontWeight: 600 }}>
            {loading ? "Chargement…" : `${total} évaluations`}
          </div>
        </div>

        <div style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th><th>Agent</th><th>Cellule</th><th>EPS</th><th>Type</th><th>Code clôture</th><th>Évaluateur</th><th>Score</th><th>Prime</th><th>Contestée</th><th>Validée</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(items || []).map((s) => (
                <tr key={String(s._id || s.id)}>
                  <td>{fmtDate(s.createdAt)}</td>
                  <td style={{ fontWeight: 600 }}>{s.pilotName || s.pilot?.name || ""}</td>
                  <td><span className="badge badge--muted">{s.pilotCell || s.pilot?.cell || "—"}</span></td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{s.eps || ""}</td>
                  <td><span className="badge badge--muted">{typeShort(s.evaluationType)}</span></td>
                  <td style={{ fontSize: "0.8rem" }}>{s.closureCode || "—"}</td>
                  <td>{s.evaluatorName || s.evaluator?.name || ""}</td>
                  <td><span className={scoreBadgeClass(s)}>{formatScorePct(s)}</span></td>
                  <td>{s.pickingPrime ? <span className="badge badge--primary">Oui</span> : <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Non</span>}</td>
                  <td>
                    {s.contested ? <span className="badge badge--warning">Contestée</span> : <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Non</span>}
                  </td>
                  <td>{s.pilotValidated ? <span className="badge badge--success">Oui</span> : <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Non</span>}</td>
                  <td>
                    {isInCurrentEditCycle(s.createdAt) ? (
                      <button className="btn btn--sm" type="button" onClick={() => openEdit(s._id || s.id)}>
                        {s.contested ? "Réévaluer" : "Modifier"}
                      </button>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && (!items || items.length === 0) ? (
                <tr><td colSpan={12} className="empty-state"><div className="empty-state__text">Aucun résultat.</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="pagination" style={{ padding: "12px 16px" }}>
          <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Précédent</button>
          <div className="pagination__info">Page {page} / {totalPages}</div>
          <button className="btn btn--ghost btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Suivant</button>
        </div>
      </div>
    </div>
  );
}

