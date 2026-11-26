import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import PageHeader from "../../components/PageHeader.jsx";
import MultiSelect from "../../components/MultiSelect.jsx";
import ScopeFilters from "../../components/ScopeFilters.jsx";
import { initialScopeFilters, scopeParams } from "../../utils/scopeFilters.js";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import CoachingCreateModal from "../../components/CoachingCreateModal.jsx";
import EditScoreModal from "../admin/components/EditScoreModal.jsx";
import Select from "../../ui/Select.jsx";
import { exportToXlsx } from "../admin/components/exportXlsx.js";
import { fetchAllPaged } from "../../utils/fetchAllPaged.js";
import { isInCurrentEditCycle } from "../../utils/editCycle.js";
import { localDate } from "../../utils/period.mjs";
import { toast } from "../../toast/toastBus.js";
import {
  evalWorkbook, fmtDate, scorePercent, scoreBadgeClass, primeMonthText, ROLE_LABELS,
  coachingState, coachingLabel, coachingBadgeClass, PRODUCTION_TYPES_CSV,
} from "../../utils/evalMeta.js";

const PAGE_SIZE = 25;
const MANAGEMENT_LIKE = ["management", "superviseur", "referent", "cdp"];
const MOIS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

/** Mois de prime proposés : 12 mois passés → mois suivant. */
function primeMonthOptions() {
  const now = new Date();
  const out = [];
  for (let i = 1; i >= -12; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: `${MOIS[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
}
const me = () => { try { const u = JSON.parse(localStorage.getItem("user") || "{}"); return { id: String(u._id || u.id || ""), role: u.role || "" }; } catch { return { id: "", role: "" }; } };
const evaluatorIdOf = (s) => String(s?.evaluator?._id || s?.evaluator || "");

/**
 * Onglet « Évaluations » — un seul tableau (CQ et Management regroupés).
 * Filtres : Période | Contrat | Projet | Cellule | Agent | Évaluateur (par rôle) | Mois de prime | Picking prime.
 * Droits : Admin édite la notation et supprime ; CQ / Formateur modifient leurs évaluations (ou réévaluent une contestée) ;
 * Management et rôles calqués ne modifient que les évaluations faites par eux-mêmes.
 */
export default function EvaluationsList({ role, readOnly = false, embedded = false }) {
  const user = useMemo(me, []);
  const isAdmin = role === "admin";
  const isCq = ["cq", "formateur"].includes(role);
  const isMgmt = MANAGEMENT_LIKE.includes(role);
  const endpoint = isCq ? "/scores/mine" : "/scores";

  const [filters, setFilters] = useState(() => initialScopeFilters({ mode: "month", anchor: localDate() }));
  const [primeSel, setPrimeSel] = useState([]);
  const [pickingPrime, setPickingPrime] = useState("");
  const [contestedOnly, setContestedOnly] = useState(false);
  const [closureQ, setClosureQ] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [pilots, setPilots] = useState([]);

  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [contest, setContest] = useState(null);
  const [contestComment, setContestComment] = useState("");
  const [contestErr, setContestErr] = useState("");
  const [coachingFor, setCoachingFor] = useState(null);

  useEffect(() => {
    api.get("/coaching/filter-options").then((r) => setPilots(r.data?.pilots || [])).catch(() => {});
  }, []);

  const params = useMemo(() => ({
    ...scopeParams(filters),
    evaluationType: PRODUCTION_TYPES_CSV,
    primeMonth: primeSel.length ? primeSel.join(",") : undefined,
    pickingPrime: pickingPrime || undefined,
    contested: contestedOnly ? "yes" : undefined,
    closureCode: closureQ.trim() || undefined,
  }), [filters, primeSel, pickingPrime, contestedOnly, closureQ]);

  useEffect(() => { setPage(1); }, [params]);

  useEffect(() => {
    let m = true;
    setLoading(true); setErr("");
    const t = setTimeout(() => {
      api.get(endpoint, { params: { ...params, page, limit: PAGE_SIZE } })
        .then((r) => { if (m) { setItems(r.data?.items || []); setTotal(r.data?.total || 0); } })
        .catch((e) => { if (m) { setItems([]); setTotal(0); setErr(e?.response?.data?.message || "Chargement des évaluations impossible."); } })
        .finally(() => m && setLoading(false));
    }, 200);
    return () => { m = false; clearTimeout(t); };
  }, [endpoint, params, page, tick]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function onExport() {
    try {
      toast.info("Export en cours…", { durationMs: 1800 });
      const all = await fetchAllPaged(async ({ page: p, limit: l }) => {
        const r = await api.get(endpoint, { params: { ...params, page: p, limit: l } });
        return { items: r.data?.items || [], total: r.data?.total || 0 };
      }, { pageSize: 200 });
      exportToXlsx(`Evaluations_${localDate()}.xlsx`, evalWorkbook(all || []));
    } catch {
      setErr("Impossible d'exporter en Excel.");
    }
  }

  const isOwn = (s) => evaluatorIdOf(s) === user.id;
  const canModify = (s) => {
    if (readOnly || isAdmin) return false;
    if (!isInCurrentEditCycle(s.createdAt)) return false;
    if (isCq) return isOwn(s) || !!s.contested;
    return isOwn(s); // Management & rôles calqués : uniquement leurs propres évaluations
  };
  const canContest = (s) => !readOnly && isMgmt && !isOwn(s) && !s.contested && isInCurrentEditCycle(s.createdAt);
  const canCoach = (s) => !readOnly && role !== "supervision" && coachingState(s) === "required" && (isAdmin || isOwn(s));

  function openEdit(s) {
    window.dispatchEvent(new CustomEvent("kcq:navigate", { detail: { role, view: "new", editScoreId: String(s._id) } }));
  }

  async function saveNotation(itemsToSave) {
    if (!viewing?._id) return;
    try {
      setSaving(true);
      await api.patch(`/scores/${viewing._id}`, { items: itemsToSave });
      setViewing(null);
      setTick((x) => x + 1);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Enregistrement impossible.");
    } finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!toDelete?._id) return;
    try {
      setDeleting(true);
      await api.delete(`/admin/evaluations/${toDelete._id}`);
      setToDelete(null);
      setTick((x) => x + 1);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Suppression impossible.");
    } finally { setDeleting(false); }
  }

  async function submitContest() {
    try {
      setContestErr("");
      await api.post(`/scores/${contest._id}/contest`, { contestComment: String(contestComment || "").trim() });
      setContest(null); setContestComment("");
      setTick((x) => x + 1);
    } catch (e) { setContestErr(e?.response?.data?.message || "Contestation impossible."); }
  }

  const body = (
    <>
      <ScopeFilters value={filters} onChange={setFilters}>
        <div><div className="label">Mois de prime</div><MultiSelect options={primeMonthOptions()} value={primeSel} onChange={setPrimeSel} placeholder="Tous les mois" /></div>
        <div><div className="label">Picking prime</div>
          <Select className="input" value={pickingPrime} onChange={(e) => setPickingPrime(e.target.value)}>
            <option value="">Tous</option><option value="yes">Oui</option><option value="no">Non</option>
          </Select>
        </div>
        <div><div className="label">Code de clôture</div><input className="input" value={closureQ} onChange={(e) => setClosureQ(e.target.value)} placeholder="Rechercher un code…" /></div>
        <div><div className="label">Contestées</div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 38 }}>
            <input type="checkbox" checked={contestedOnly} onChange={(e) => setContestedOnly(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} />
            <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>Uniquement contestées</span>
          </label>
        </div>
      </ScopeFilters>

      {err && <div className="card" role="alert" style={{ padding: 12, color: "var(--danger)", background: "var(--danger-bg)", marginBottom: 12 }}>{err}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Évaluations {loading ? "" : `(${total})`}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setTick((x) => x + 1)} disabled={loading}>Actualiser</button>
            <button className="btn btn--sm" type="button" onClick={onExport} disabled={loading || !total}>Exporter Excel</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th><th>Agent</th><th>Contrat</th><th>Projet</th><th>Cellule</th><th>Évaluateur</th><th>EPS</th>
                <th>Prime</th><th>Mois prime</th><th>Score</th><th>Coaching</th><th>Signature</th><th>Contestée</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const pct = Number(scorePercent(s) || 0);
                const cs = coachingState(s);
                return (
                  <tr key={String(s._id)}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(s.createdAt)}</td>
                    <td style={{ fontWeight: 600 }}>{s.pilotName || s.pilot?.name || "—"}</td>
                    <td>{s.pilot?.contract || s.contractAtEvaluation || "—"}</td>
                    <td>{s.pilot?.project || s.projectAtEvaluation || "—"}</td>
                    <td><span className="badge badge--muted">{s.pilotCell || s.pilot?.cell || s.cellAtEvaluation || "—"}</span></td>
                    <td>{s.evaluatorName || s.evaluator?.name || "—"}<div style={{ color: "var(--muted)", fontSize: "0.72rem" }}>{ROLE_LABELS[s.evaluatorRole || s.evaluator?.role] || ""}</div></td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.eps || ""}>{s.eps || "—"}</td>
                    <td>{s.pickingPrime ? <span className="badge badge--primary">Oui</span> : <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Non</span>}</td>
                    <td style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>{primeMonthText(s.primeMonth) || "—"}</td>
                    <td><span className={scoreBadgeClass(pct)}>{pct.toFixed(1)} %</span></td>
                    <td>{cs ? <span className={coachingBadgeClass(cs)}>{coachingLabel(s)}</span> : <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>—</span>}</td>
                    <td>{s.pilotValidated ? <span className="badge badge--success">Signée</span> : <span className="badge badge--muted">En attente</span>}</td>
                    <td>{s.contested ? <span className="badge badge--warning">Contestée</span> : <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Non</span>}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn--ghost btn--sm" type="button" onClick={() => setViewing(s)}>{isAdmin ? "Éditer" : "Voir"}</button>
                        {canModify(s) && <button className="btn btn--sm" type="button" onClick={() => openEdit(s)}>{isCq && s.contested ? "Réévaluer" : "Modifier"}</button>}
                        {canContest(s) && <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setContest(s); setContestComment(""); setContestErr(""); }}>Contester</button>}
                        {canCoach(s) && <button className="btn btn--ghost btn--sm" type="button" onClick={() => setCoachingFor(s)}>Créer le coaching</button>}
                        {isAdmin && <button className="btn-danger btn--sm" type="button" onClick={() => setToDelete(s)}>Supprimer</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && items.length === 0 && <tr><td colSpan={14} className="empty-state"><div className="empty-state__text">Aucune évaluation pour ces filtres.</div></td></tr>}
              {loading && <tr><td colSpan={14} style={{ color: "var(--muted)", padding: 16 }}>Chargement…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination" style={{ padding: "12px 16px" }}>
          <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Précédent</button>
          <div className="pagination__info">Page {page} / {totalPages}</div>
          <button className="btn btn--ghost btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Suivant</button>
        </div>
      </div>

      {viewing && <EditScoreModal key={viewing._id} score={viewing} readOnly={!isAdmin} isSaving={saving} onClose={() => setViewing(null)} onSave={saveNotation}
        onOpen={canModify(viewing) ? () => { setViewing(null); openEdit(viewing); } : undefined} />}

      <ConfirmDialog open={!!toDelete} danger title="Supprimer l'évaluation ?" busy={deleting}
        message={<>L'évaluation de <b>{toDelete?.pilotName || toDelete?.pilot?.name || "l'agent"}</b> du {fmtDate(toDelete?.createdAt)} sera supprimée définitivement de la base de données.</>}
        confirmLabel="Supprimer définitivement" onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />

      {contest && (
        <div className="modal-overlay" onClick={() => setContest(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: 8 }}>Contester l'évaluation</div>
            <div style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: 12 }}>Le commentaire est facultatif. L'évaluation sera marquée comme contestée et le CQ sera notifié.</div>
            <textarea className="input" rows={4} value={contestComment} onChange={(e) => setContestComment(e.target.value)} placeholder="Motif / détails (facultatif)…" />
            {contestErr && <div role="alert" style={{ marginTop: 10, color: "var(--danger)", fontSize: "0.85rem", fontWeight: 600 }}>{contestErr}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="btn btn--ghost" type="button" onClick={() => setContest(null)}>Annuler</button>
              <button className="btn" type="button" onClick={submitContest}>Contester</button>
            </div>
          </div>
        </div>
      )}

      {coachingFor && <CoachingCreateModal score={coachingFor} pilots={pilots} onClose={() => setCoachingFor(null)}
        onCreated={() => { setCoachingFor(null); toast.success("Coaching créé."); setTick((x) => x + 1); }} />}
    </>
  );

  if (embedded) return body;
  return (
    <div className="page">
      <PageHeader title="Évaluations" subtitle={readOnly ? "Évaluations de votre périmètre (consultation)." : "Toutes les évaluations (CQ et Management) dans un seul tableau, avec filtres et export."} />
      {body}
    </div>
  );
}
