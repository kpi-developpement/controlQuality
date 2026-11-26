import React, { useEffect, useState, useRef } from "react";
import api from "../../api";
import PageHeader from "../../components/PageHeader.jsx";
import MultiSelect from "../../components/MultiSelect.jsx";

import CoachingFilters from "../../components/CoachingFilters.jsx";
import { initialCoachingFilters, coachingParams } from "../../utils/coachingFilters.js";
import Ico from "../../ui/Ico.jsx";
import Select from "../../ui/Select.jsx";
import CoachingCreateModal from "../../components/CoachingCreateModal.jsx";
function toISO(d) { if (!d) return ""; const x = new Date(d); return isNaN(x.getTime()) ? "" : `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; }
function fmtDate(d) { if (!d) return "—"; const x = new Date(d); return isNaN(x.getTime()) ? "—" : x.toLocaleDateString("fr-FR"); }
function isOverdue(d) { if (!d) return false; return new Date(d) < new Date(new Date().toDateString()); }

const STATUS_LABELS = { open: "Ouvert", in_progress: "En cours", done: "Terminé" };
const STATUS_COLORS = { open: "badge--warning", in_progress: "badge--primary", done: "badge--success" };

export default function CQCoaching() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [statusFilter, setStatusFilter] = useState(["open", "in_progress"]);
  const [filters, setFilters] = useState(initialCoachingFilters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const requestId = useRef(0);
  const [pilots, setPilots] = useState([]);

  // Création
  const [creating, setCreating] = useState(false);

  // Edit modal
  const [editing, setEditing] = useState(null);
  const [editSubject, setEditSubject] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editActionPlan, setEditActionPlan] = useState("");
  const [editStatus, setEditStatus] = useState("open");
  const [editFollowUp, setEditFollowUp] = useState("");


  useEffect(() => {
    api.get("/coaching/filter-options").then((r) => setPilots(r.data?.pilots || [])).catch(() => {});
  }, []);

  async function loadCoachings(p = 1) {
    const id = ++requestId.current;
    setLoading(true); setErr("");
    try {
      const params = { ...coachingParams(filters), limit: 50, page: p, status: statusFilter.join(",") };
      const res = await api.get("/coaching/mine", { params });
      if (id !== requestId.current) return;
      setItems(res.data?.items || []); setTotal(res.data?.total || 0);
      setPage(p); setSummary(res.data?.summary || null);
    } catch (e) { if (id === requestId.current) { setItems([]); setSummary(null); setTotal(0); setErr(e?.response?.data?.message || "Erreur chargement coachings."); } }
    finally { if (id === requestId.current) setLoading(false); }
  }
  useEffect(() => {
    ++requestId.current; setLoading(true);
    const timer = setTimeout(() => loadCoachings(1), 250);
    return () => { clearTimeout(timer); ++requestId.current; };
  }, [filters, statusFilter]);

  async function handleStatusChange(id, newStatus) {
    try {
      await api.patch(`/coaching/${id}`, { status: newStatus });
      loadCoachings(page);
    } catch (e) { setErr(e?.response?.data?.message || "Erreur mise à jour."); }
  }

  function openEdit(c) {
    setEditing(c);
    setEditSubject(c.subject || "");
    setEditNotes(c.notes || "");
    setEditActionPlan(c.actionPlan || "");
    setEditStatus(c.status || "open");
    setEditFollowUp(toISO(c.followUpDate));
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api.patch(`/coaching/${editing._id}`, {
        ...(editSubject.trim() ? { subject: editSubject.trim() } : {}), notes: editNotes, actionPlan: editActionPlan, status: editStatus, followUpDate: editFollowUp || null,
      });
      loadCoachings(page);
      setEditing(null);
    } catch (e) { setErr(e?.response?.data?.message || "Erreur sauvegarde."); }
  }

  const filtered = items;
  const counts = { open: summary?.open || 0, in_progress: summary?.inProgress || 0, done: summary?.done || 0, overdue: summary?.overdue || 0 };

  return (
    <div className="page">
      <PageHeader title="Coaching" subtitle="Suivi des plans d'action, relances et progression des agents." />

      <CoachingFilters filters={filters} onChange={setFilters} />
      {/* Pipeline KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Ouverts", count: counts.open, color: "var(--warning)", icon: <Ico n="clipboard" /> },
          { label: "En cours", count: counts.in_progress, color: "var(--primary)", icon: <Ico n="refresh" /> },
          { label: "Terminés", count: counts.done, color: "var(--success)", icon: <Ico n="checkCircle" /> },
          { label: "En retard", count: counts.overdue, color: "var(--danger)", icon: <Ico n="alarm" /> },
        ].map((k) => (
          <div key={k.label} className="card" style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => k.label === "En retard" ? setStatusFilter(["open", "in_progress"]) : setStatusFilter([k.label === "Ouverts" ? "open" : k.label === "En cours" ? "in_progress" : "done"])}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>{k.icon}</span>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>{k.label}</span>
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: k.color, marginTop: 4 }}>{k.count}</div>
          </div>
        ))}
      </div>

      {/* Filters + Create */}
      <div className="card filters-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, flex: 1, minWidth: 300 }}>
          <div style={{ flex: 1 }}>
            <div className="label">Statut</div>
            <MultiSelect
              options={[{ value: "open", label: "Ouvert" }, { value: "in_progress", label: "En cours" }, { value: "done", label: "Terminé" }]}
              value={statusFilter} onChange={setStatusFilter} placeholder="Tous"
            />
          </div>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>+ Nouveau coaching</button>
      </div>

      {err && <div className="card" style={{ padding: 12, color: "var(--danger)", background: "var(--danger-bg)", borderColor: "rgba(220,38,38,0.2)", marginBottom: 12 }}>{err}</div>}

      {/* Coaching List */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Coachings</span>
          <span style={{ color: "var(--muted)", fontSize: "0.8rem", fontWeight: 600 }}>{total} résultat{total > 1 ? "s" : ""}</span>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Agent</th><th>Cellule</th><th>Objet du coaching</th><th>Statut</th><th>Validation agent</th><th>Relance</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((c) => {
                const pilot = c.pilot?.name || c.score?.pilot?.name || "—";
                const overdueFlag = c.status !== "done" && isOverdue(c.followUpDate);
                return (
                  <tr key={c._id}>
                    <td style={{ fontSize: "0.85rem" }}>{fmtDate(c.createdAt)}</td>
                    <td style={{ fontWeight: 600 }}>{pilot}</td><td>{c.pilot?.cell || c.score?.pilot?.cell || "—"}</td>
                    <td style={{ fontSize: "0.85rem", maxWidth: 240 }}>{c.subject || (c.score?.eps ? <span style={{ color: "var(--muted)" }}>Évaluation {c.score.eps} ({fmtDate(c.score?.createdAt)})</span> : "—")}</td>
                    <td>
                      <Select className="input" value={c.status} onChange={(e) => handleStatusChange(c._id, e.target.value)} style={{ padding: "3px 8px", fontSize: "0.8rem", width: 120 }}>
                        <option value="open">Ouvert</option>
                        <option value="in_progress">En cours</option>
                        <option value="done">Terminé</option>
                      </Select>
                    </td>
                    <td>
                      {c.pilotAcknowledged ? (
                        <div>
                          <span className="badge badge--success" style={{ fontSize: "0.72rem" }}><Ico n="checkCircle" /> Validé</span>
                          {c.pilotComment && <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 2, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.pilotComment}><Ico n="message" /> {c.pilotComment}</div>}
                        </div>
                      ) : (
                        <span className="badge badge--warning" style={{ fontSize: "0.72rem" }}><Ico n="clock" /> En attente</span>
                      )}
                    </td>
                    <td>
                      {c.followUpDate ? (
                        <span className={`badge ${overdueFlag ? "badge--danger" : "badge--muted"}`}>
                          {overdueFlag ? <Ico n="alarm" /> : ""}{fmtDate(c.followUpDate)}
                        </span>
                      ) : <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>—</span>}
                    </td>
                    <td><button className="btn btn--ghost btn--sm" onClick={() => openEdit(c)}>Détail</button></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Aucun coaching trouvé.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button className="btn btn--ghost" disabled={loading || page <= 1} onClick={() => loadCoachings(page-1)}>Précédent</button>
        <span>{loading ? "Recherche…" : `Page ${page} / ${Math.max(1, Math.ceil(total/50))}`}</span>
        <button className="btn btn--ghost" disabled={loading || page*50 >= total} onClick={() => loadCoachings(page+1)}>Suivant</button>
      </div>
      {/* Create Modal */}
      {creating && <CoachingCreateModal pilots={pilots} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); loadCoachings(); }} />}

      {/* Edit Modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: 4 }}>Coaching — {editing.pilot?.name || "Agent"}</div>
            <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: 16 }}>
              {editing.score ? <>Évaluation liée : {editing.score?.eps || "—"} • {fmtDate(editing.score?.createdAt)}</> : "Aucune évaluation liée"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Objet du coaching</div>
                <input className="input" value={editSubject} maxLength={300} onChange={(e) => setEditSubject(e.target.value)} />
              </div>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Notes / Observations</div>
                <textarea className="input" rows={4} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              </div>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Plan d'action</div>
                <textarea className="input" rows={4} value={editActionPlan} onChange={(e) => setEditActionPlan(e.target.value)} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>Statut</div>
                  <Select className="input" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                    <option value="open">Ouvert</option>
                    <option value="in_progress">En cours</option>
                    <option value="done">Terminé</option>
                  </Select>
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>Date de relance</div>
                  <input className="input" type="date" value={editFollowUp} onChange={(e) => setEditFollowUp(e.target.value)} />
                </div>
              </div>
            </div>
            {/* Pilot acknowledgment */}
            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: editing.pilotAcknowledged ? "var(--success-bg)" : "var(--warning-bg)" }}>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 4 }}>
                {editing.pilotAcknowledged ? <><Ico n="checkCircle" /> Validé par l'agent</> : <><Ico n="clock" /> En attente de validation agent</>}
              </div>
              {editing.pilotAcknowledged ? (
                <>
                  <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>Validé le {editing.pilotAcknowledgedAt ? new Date(editing.pilotAcknowledgedAt).toLocaleString("fr-FR") : "—"}</div>
                  {editing.pilotComment && (
                    <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: "var(--panel)", border: "1px solid var(--border)", fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
                      <span style={{ fontWeight: 700 }}>Commentaire agent :</span> {editing.pilotComment}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>L'agent n'a pas encore validé ce coaching.</div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="btn btn--ghost" onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn" onClick={saveEdit}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
