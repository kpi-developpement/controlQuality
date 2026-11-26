import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import PageHeader from "../../components/PageHeader.jsx";
import KpiCard, { fmtRate } from "../../components/KpiCard.jsx";
import { exportToXlsx } from "../admin/components/exportXlsx.js";
import { fetchComplete } from "../../utils/fetchComplete.js";
import { DIRECTIONS, directionLabel, fmtDate, getCurrentUser, navigate } from "../../utils/evalMeta.js";
import Ico from "../../ui/Ico.jsx";
import Select from "../../ui/Select.jsx";

const STATUS = {
  pending: { label: "En attente", cls: "badge--muted" },
  assigned: { label: "Affecté", cls: "badge--primary" },
  in_progress: { label: "En cours", cls: "badge--warning" },
  standby: { label: "Standby", cls: "badge--danger" },
  done: { label: "Finalisé", cls: "badge--success" },
  cancelled: { label: "Annulé", cls: "badge--muted" },
};
const REASONS = { blocked: "Bloqué", waiting_info: "Attente d'information", audio_missing: "Audio indisponible", other: "Autre" };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const localDay = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * Évaluations d'échantillons (contrat Orange, §3.2) : sélection d'appels, grille associée,
 * affectation, suivi (en attente / affecté / en cours / standby / finalisé) et statistiques.
 */
export default function SamplesPage() {
  const user = getCurrentUser();
  const role = user?.role || "";
  const me = String(user?.id || user?._id || "");
  const canWrite = ["admin", "cq", "formateur", "management", "cdp"].includes(role);
  const canEvaluate = ["cq", "formateur", "management"].includes(role);
  const canPick = ["cq", "formateur", "management"].includes(role); // accès aux appels enregistrés

  const [statusSel, setStatusSel] = useState("");
  const [assignee, setAssignee] = useState("");
  const [batch, setBatch] = useState("");
  const [direction, setDirection] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, summary: {} });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [batches, setBatches] = useState([]);
  const [evaluators, setEvaluators] = useState([]);
  const [grids, setGrids] = useState([]);
  const [cells, setCells] = useState([]);
  const [pilots, setPilots] = useState([]);
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState({ assignedTo: "", gridId: "" });
  const [standby, setStandby] = useState(null);
  const [adding, setAdding] = useState(false);
  const limit = 50;

  useEffect(() => {
    api.get("/samples/batches").then((r) => setBatches(r.data || [])).catch(() => {});
    if (canWrite) {
      api.get("/users/evaluators").then((r) => setEvaluators(Array.isArray(r.data) ? r.data : [])).catch(() => {});
      api.get("/grids/my").then((r) => setGrids(Array.isArray(r.data) ? r.data : [])).catch(() => {});
      api.get("/admin/cells").then((r) => setCells(Array.isArray(r.data) ? r.data : [])).catch(() => {});
      api.get("/cq/pilots/search", { params: { limit: 200 } }).then((r) => setPilots(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }
  }, [canWrite, tick]);

  const params = useMemo(() => ({ status: statusSel || undefined, assignedTo: assignee || undefined, batch: batch || undefined, callDirection: direction || undefined, q: q.trim() || undefined }), [statusSel, assignee, batch, direction, q]);
  useEffect(() => { setPage(1); setSelected([]); }, [params]);
  useEffect(() => {
    let m = true;
    setLoading(true); setErr("");
    api.get("/samples", { params: { ...params, page, limit } })
      .then((r) => m && setData(r.data || { items: [], total: 0, summary: {} }))
      .catch((e) => m && setErr(e?.response?.data?.message || "Chargement impossible."))
      .finally(() => m && setLoading(false));
    return () => { m = false; };
  }, [params, page, tick]);

  const sm = data.summary || {};
  const totalPages = Math.max(1, Math.ceil((data.total || 0) / limit));
  const refresh = () => setTick((x) => x + 1);

  async function patch(id, body, msg) {
    try { await api.patch(`/samples/${id}`, body, { toastSuccessMessage: msg }); refresh(); }
    catch { /* toast affiché par l'intercepteur */ }
  }
  async function remove(s) {
    if (!window.confirm(`Supprimer l'échantillon ${s.eps} ?`)) return;
    try { await api.delete(`/samples/${s._id}`, { toastSuccessMessage: "Échantillon supprimé" }); refresh(); } catch {}
  }
  async function evaluate(s) {
    try {
      const { data: started } = await api.post(`/samples/${s._id}/start`, {}, { toast: false });
      const ctx = {
        _id: started._id,
        eps: started.eps,
        phone: started.phone,
        cell: started.cell,
        callDate: started.callDate,
        callDirection: started.callDirection,
        gridId: started.gridId?._id || started.gridId || "",
        pilotId: started.pilot?._id || started.pilot || "",
        audioUrl: started.audioDay && started.audioFile ? `/scores/picking-audio/${encodeURIComponent(started.audioDay)}/${encodeURIComponent(started.audioFile)}` : "",
      };
      sessionStorage.setItem("pending_sample_evaluation", JSON.stringify(ctx));
      navigate("sample_eval");
    } catch (e) {
      setErr(e?.response?.data?.message || "Impossible de démarrer l'évaluation.");
    }
  }
  async function applyBulk() {
    const body = {};
    if (bulk.assignedTo) body.assignedTo = bulk.assignedTo === "none" ? null : bulk.assignedTo;
    if (bulk.gridId) body.gridId = bulk.gridId;
    if (!Object.keys(body).length || !selected.length) return;
    let ok = 0;
    for (const id of selected) {
      try { await api.patch(`/samples/${id}`, body, { toast: false }); ok += 1; } catch {}
    }
    setErr(ok === selected.length ? "" : `${selected.length - ok} échantillon(s) non modifié(s) (finalisés ou hors périmètre).`);
    setSelected([]); setBulk({ assignedTo: "", gridId: "" }); refresh();
  }
  async function exportAll() {
    const rows = await fetchComplete("/samples", { ...params });
    exportToXlsx(`Echantillons_${today()}.xlsx`, rows.map((s) => ({
      Lot: s.batch || "", EPS: s.eps, "N° client": s.phone || "", "Date appel": fmtDate(s.callDate), "Sens d'appel": directionLabel(s.callDirection),
      Agent: s.pilot?.name || "", Cellule: s.cell || "", Projet: s.project || "", Contrat: s.contract || "", Grille: s.gridId?.name || "",
      "Évaluateur affecté": s.assignedTo?.name || "", Statut: STATUS[s.status]?.label || s.status, "Motif standby": REASONS[s.standbyReason] || "",
      "Commentaire standby": s.standbyComment || "", Échéance: fmtDate(s.dueDate), "Démarré le": fmtDate(s.startedAt), "Finalisé le": fmtDate(s.doneAt),
      "Code de clôture": s.score?.closureCode || "", "Créé par": s.createdBy?.name || "",
    })));
  }

  const toggle = (id) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const selectable = (data.items || []).filter((s) => !["done", "cancelled"].includes(s.status)).map((s) => String(s._id));

  return (
    <div className="page">
      <PageHeader
        title="Échantillons & suivi"
        subtitle="Sélection des appels à évaluer, grille associée, affectation et suivi de l'avancement."
        right={canWrite ? <button className="btn" type="button" onClick={() => setAdding(true)}>+ Ajouter des appels</button> : null}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        <KpiCard title="Échantillons" value={sm.total ?? 0} detail={`Finalisés : ${fmtRate(sm.completionRate)}`} />
        <KpiCard title="En attente ou standby" value={sm.waiting ?? 0} tone={(sm.waiting || 0) > 0 ? "warn" : "good"} detail={(sm.waitingStatuses || []).map((s) => STATUS[s]?.label).join(" + ")} />
        <KpiCard title="En attente" value={sm.pending ?? 0} detail="Non affectés" />
        <KpiCard title="Affectés" value={sm.assigned ?? 0} detail="Non commencés" />
        <KpiCard title="En cours" value={sm.in_progress ?? 0} />
        <KpiCard title="Standby" value={sm.standby ?? 0} detail={Object.entries(sm.standbyByReason || {}).map(([k, v]) => `${REASONS[k] || "?"} : ${v}`).join(" • ")} />
        <KpiCard title="Finalisés" value={sm.done ?? 0} tone="good" />
      </div>

      <div className="card filters-card" style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, alignItems: "end" }}>
          <label className="label">Statut
            <Select className="input" value={statusSel} onChange={(e) => setStatusSel(e.target.value)}>
              <option value="">Tous (hors annulés)</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              <option value="pending,assigned,standby">En attente ou standby</option>
            </Select>
          </label>
          <label className="label">Évaluateur
            <Select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Tous</option>
              {canEvaluate && <option value="me">Moi</option>}
              <option value="none">Non affectés</option>
              {evaluators.map((u) => <option key={u._id || u.id} value={u._id || u.id}>{u.name}</option>)}
            </Select>
          </label>
          <label className="label">Lot
            <Select className="input" value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">Tous</option>
              {batches.map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          </label>
          <label className="label">Sens d'appel
            <Select className="input" value={direction} onChange={(e) => setDirection(e.target.value)}>
              {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.value ? d.label : "Tous"}</option>)}
            </Select>
          </label>
          <label className="label">Recherche<input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="EPS, n° client, lot…" /></label>
          <button className="btn btn--ghost" type="button" onClick={exportAll} disabled={!data.total}>Exporter Excel</button>
        </div>
      </div>

      {canWrite && selected.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <b>{selected.length} sélectionné(s)</b>
          <Select className="input" style={{ maxWidth: 220 }} value={bulk.assignedTo} onChange={(e) => setBulk({ ...bulk, assignedTo: e.target.value })}>
            <option value="">Affecter à…</option>
            <option value="none">— Retirer l'affectation</option>
            {evaluators.map((u) => <option key={u._id || u.id} value={u._id || u.id}>{u.name}</option>)}
          </Select>
          <Select className="input" style={{ maxWidth: 240 }} value={bulk.gridId} onChange={(e) => setBulk({ ...bulk, gridId: e.target.value })}>
            <option value="">Associer la grille…</option>
            {grids.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
          </Select>
          <button className="btn btn--sm" type="button" onClick={applyBulk} disabled={!bulk.assignedTo && !bulk.gridId}>Appliquer</button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setSelected([])}>Annuler</button>
        </div>
      )}

      {err && <div className="card" style={{ padding: 12, color: "var(--danger)", background: "var(--danger-bg)", marginBottom: 12 }}>{err}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {canWrite && <th><input type="checkbox" checked={selectable.length > 0 && selectable.every((id) => selected.includes(id))} onChange={(e) => setSelected(e.target.checked ? selectable : [])} /></th>}
                <th>EPS</th><th>Date appel</th><th>Sens</th><th>Agent</th><th>Cellule</th><th>Grille</th><th>Évaluateur</th><th>Statut</th><th>Lot</th><th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((s) => {
                const id = String(s._id);
                const open = !["done", "cancelled"].includes(s.status);
                const mine = !s.assignedTo || String(s.assignedTo?._id || s.assignedTo) === me;
                return (
                  <tr key={id}>
                    {canWrite && <td>{open ? <input type="checkbox" checked={selected.includes(id)} onChange={() => toggle(id)} /> : null}</td>}
                    <td style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "0.82rem", whiteSpace: "nowrap" }}>{s.eps}</td>
                    <td>{fmtDate(s.callDate) || "—"}</td>
                    <td>{directionLabel(s.callDirection) || "—"}</td>
                    <td>{s.pilot?.name || "—"}</td>
                    <td>{s.cell ? <span className="badge badge--muted">{s.cell}</span> : "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{s.gridId?.name || "—"}</td>
                    <td>{s.assignedTo?.name || <span style={{ color: "var(--muted)" }}>Non affecté</span>}</td>
                    <td>
                      <span className={`badge ${STATUS[s.status]?.cls || "badge--muted"}`}>{STATUS[s.status]?.label || s.status}</span>
                      {s.status === "standby" && <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 2 }} title={s.standbyComment || ""}>{REASONS[s.standbyReason] || ""}</div>}
                      {s.status === "done" && s.doneAt && <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 2 }}>{fmtDate(s.doneAt)}</div>}
                    </td>
                    <td style={{ fontSize: "0.8rem" }}>{s.batch || "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canEvaluate && open && mine && <button className="btn btn--sm" type="button" onClick={() => evaluate(s)}>Évaluer</button>}{" "}
                      {canWrite && open && s.status !== "standby" && <button className="btn btn--ghost btn--sm" type="button" onClick={() => setStandby({ sample: s, reason: "waiting_info", comment: "" })}>Standby</button>}
                      {canWrite && s.status === "standby" && <button className="btn btn--ghost btn--sm" type="button" onClick={() => patch(id, { status: s.assignedTo ? "assigned" : "pending" }, "Échantillon repris")}>Reprendre</button>}{" "}
                      {canWrite && open && <button className="btn btn--ghost btn--sm" type="button" onClick={() => patch(id, { status: "cancelled" }, "Échantillon annulé")}>Annuler</button>}{" "}
                      {canWrite && open && (role === "admin" || String(s.createdBy?._id || s.createdBy) === me) && <button className="btn btn--ghost btn--sm" style={{ color: "var(--danger)" }} type="button" onClick={() => remove(s)}>Suppr.</button>}
                    </td>
                  </tr>
                );
              })}
              {!loading && (data.items || []).length === 0 && <tr><td colSpan={11} className="empty-state"><div className="empty-state__text">Aucun échantillon.</div></td></tr>}
              {loading && <tr><td colSpan={11} style={{ padding: 16, color: "var(--muted)" }}>Chargement…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination" style={{ padding: "12px 16px" }}>
          <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Précédent</button>
          <div className="pagination__info">Page {page} / {totalPages} — {data.total || 0} échantillon(s)</div>
          <button className="btn btn--ghost btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Suivant</button>
        </div>
      </div>

      {standby && (
        <div className="modal-overlay" onClick={() => setStandby(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Mettre en standby — {standby.sample.eps}</div>
            <label className="label">Motif
              <Select className="input" value={standby.reason} onChange={(e) => setStandby({ ...standby, reason: e.target.value })}>
                {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </label>
            <label className="label" style={{ marginTop: 10 }}>Commentaire
              <textarea className="input" rows={3} value={standby.comment} onChange={(e) => setStandby({ ...standby, comment: e.target.value })} placeholder="Information attendue, blocage…" />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button className="btn btn--ghost" type="button" onClick={() => setStandby(null)}>Annuler</button>
              <button className="btn" type="button" onClick={async () => { await patch(String(standby.sample._id), { status: "standby", standbyReason: standby.reason, standbyComment: standby.comment }, "Échantillon en standby"); setStandby(null); }}>Valider</button>
            </div>
          </div>
        </div>
      )}

      {adding && <AddSamplesModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} canPick={canPick} evaluators={evaluators} grids={grids} cells={cells} pilots={pilots} batches={batches} />}
    </div>
  );
}

function AddSamplesModal({ onClose, onDone, canPick, evaluators, grids, cells, pilots, batches }) {
  const [tab, setTab] = useState(canPick ? "picking" : "manual");
  const [day, setDay] = useState(today());
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState([]);
  const [search, setSearch] = useState("");
  const [common, setCommon] = useState({ batch: "", gridId: "", assignedTo: "", cell: "", dueDate: "" });
  const [manual, setManual] = useState({ eps: "", pilotId: "", callDate: today(), callDirection: "", phone: "" });
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (tab !== "picking") return;
    let m = true;
    setLoading(true); setErr(""); setPicked([]);
    const [y, mo] = day.split("-");
    api.get("/scores/picking-calls", { params: { year: y, month: mo, limit: 5000 } })
      .then((r) => { if (m) setCalls((r.data?.items || []).filter((c) => localDay(c.callDate) === day)); })
      .catch((e) => m && setErr(e?.response?.data?.message || "Impossible de charger les appels."))
      .finally(() => m && setLoading(false));
    return () => { m = false; };
  }, [tab, day]);

  const visible = calls.filter((c) => !search.trim() || `${c.eps} ${c.phone} ${c.direction || ""}`.toLowerCase().includes(search.trim().toLowerCase()));

  async function submit() {
    setErr(""); setResult(null);
    let items = [];
    if (tab === "picking") {
      items = calls.filter((c) => picked.includes(String(c._id))).map((c) => ({
        eps: c.eps, phone: c.phone, callDate: c.callDate, audioDay: c.audioDay, audioFile: c.audioFile, callRef: String(c._id || ""),
        callDirection: ["inbound", "outbound"].includes(c.directionClass) ? c.directionClass : "", cell: common.cell || undefined,
      }));
    } else {
      if (!manual.eps.trim()) return setErr("EPS obligatoire.");
      items = [{ eps: manual.eps.trim(), pilotId: manual.pilotId || undefined, callDate: manual.callDate || undefined, callDirection: manual.callDirection, phone: manual.phone, cell: common.cell || undefined }];
    }
    if (!items.length) return setErr("Sélectionnez au moins un appel.");
    try {
      const { data } = await api.post("/samples", { ...common, gridId: common.gridId || undefined, assignedTo: common.assignedTo || undefined, dueDate: common.dueDate || undefined, items }, { toast: false });
      setResult(data);
      if (data.created && !(data.skipped || []).length) onDone();
    } catch (e) {
      setErr(e?.response?.data?.message || "Création impossible.");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 960, width: "96vw", maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 800 }}>Ajouter des appels à l'échantillon</div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Fermer</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {canPick && <button type="button" className={tab === "picking" ? "btn btn--sm" : "btn btn--ghost btn--sm"} onClick={() => setTab("picking")}>Depuis les appels enregistrés</button>}
          <button type="button" className={tab === "manual" ? "btn btn--sm" : "btn btn--ghost btn--sm"} onClick={() => setTab("manual")}>Saisie manuelle</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
          <label className="label">Lot
            <input className="input" list="sample-batches" value={common.batch} onChange={(e) => setCommon({ ...common, batch: e.target.value })} placeholder="Ex : Orange S45" />
            <datalist id="sample-batches">{batches.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
          <label className="label">Grille d'évaluation
            <Select className="input" value={common.gridId} onChange={(e) => setCommon({ ...common, gridId: e.target.value })}>
              <option value="">À choisir plus tard</option>
              {grids.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
            </Select>
          </label>
          <label className="label">Évaluateur
            <Select className="input" value={common.assignedTo} onChange={(e) => setCommon({ ...common, assignedTo: e.target.value })}>
              <option value="">Non affecté</option>
              {evaluators.map((u) => <option key={u._id || u.id} value={u._id || u.id}>{u.name}</option>)}
            </Select>
          </label>
          <label className="label">Cellule (périmètre)
            <Select className="input" value={common.cell} onChange={(e) => setCommon({ ...common, cell: e.target.value })}>
              <option value="">Selon l'agent / aucune</option>
              {cells.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
            </Select>
          </label>
          <label className="label">Échéance<input className="input" type="date" value={common.dueDate} onChange={(e) => setCommon({ ...common, dueDate: e.target.value })} /></label>
        </div>

        {tab === "picking" ? (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <input className="input" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ maxWidth: 180 }} />
              <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrer (TAG, n° client, sens)…" style={{ maxWidth: 280 }} />
              <span style={{ alignSelf: "center", fontSize: "0.82rem", color: "var(--muted)" }}>{picked.length} sélectionné(s) / {visible.length} appel(s)</span>
            </div>
            <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
              <table className="data-table">
                <thead><tr><th><input type="checkbox" checked={visible.length > 0 && visible.every((c) => picked.includes(String(c._id)))} onChange={(e) => setPicked(e.target.checked ? visible.map((c) => String(c._id)) : [])} /></th><th>TAG</th><th>N° client</th><th>Heure</th><th>Sens</th><th>Audio</th></tr></thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={String(c._id)}>
                      <td><input type="checkbox" checked={picked.includes(String(c._id))} onChange={() => setPicked((cur) => (cur.includes(String(c._id)) ? cur.filter((x) => x !== String(c._id)) : [...cur, String(c._id)]))} /></td>
                      <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{c.eps || "—"}</td>
                      <td style={{ fontFamily: "monospace" }}>{c.phone || "—"}</td>
                      <td>{c.callDate ? new Date(c.callDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td>{c.direction || "—"}</td>
                      <td>{c.audioUrl ? <Ico n="headphones" /> : "—"}</td>
                    </tr>
                  ))}
                  {!loading && visible.length === 0 && <tr><td colSpan={6} className="empty-state"><div className="empty-state__text">Aucun appel ce jour.</div></td></tr>}
                  {loading && <tr><td colSpan={6} style={{ padding: 12, color: "var(--muted)" }}>Chargement…</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            <label className="label">EPS / identifiant de l'appel *<input className="input" value={manual.eps} onChange={(e) => setManual({ ...manual, eps: e.target.value })} /></label>
            <label className="label">Agent
              <Select className="input" value={manual.pilotId} onChange={(e) => setManual({ ...manual, pilotId: e.target.value })}>
                <option value="">Inconnu</option>
                {pilots.map((p) => <option key={p._id} value={p._id}>{p.name}{p.cell ? ` — ${p.cell}` : ""}</option>)}
              </Select>
            </label>
            <label className="label">Date de l'appel<input className="input" type="date" value={manual.callDate} onChange={(e) => setManual({ ...manual, callDate: e.target.value })} /></label>
            <label className="label">Sens d'appel
              <Select className="input" value={manual.callDirection} onChange={(e) => setManual({ ...manual, callDirection: e.target.value })}>
                {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </Select>
            </label>
            <label className="label">N° client<input className="input" value={manual.phone} onChange={(e) => setManual({ ...manual, phone: e.target.value })} /></label>
          </div>
        )}

        {err && <div style={{ color: "var(--danger)", marginTop: 10, fontWeight: 600 }}>{err}</div>}
        {result && (
          <div style={{ marginTop: 10, fontSize: "0.85rem" }}>
            <b>{result.created}</b> échantillon(s) créé(s).
            {(result.skipped || []).length > 0 && <div style={{ color: "var(--warning)" }}>{result.skipped.length} ignoré(s) : {result.skipped.slice(0, 8).map((x) => `${x.eps || "?"} (${x.reason})`).join(", ")}{result.skipped.length > 8 ? "…" : ""}</div>}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn btn--ghost" type="button" onClick={result ? onDone : onClose}>{result ? "Terminer" : "Annuler"}</button>
          <button className="btn" type="button" onClick={submit}>Ajouter</button>
        </div>
      </div>
    </div>
  );
}
