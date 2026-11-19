import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../api";
import Ico from "../../ui/Ico.jsx";
import AnimatedValue from "../../components/AnimatedValue.jsx";

const getUser = () => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; } };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const pct = (v) => (typeof v === "number" ? `${Math.round(v)}%` : "—");
const ROLE_LABEL = { referent: "Référent", superviseur: "Superviseur", management: "Management", pilote: "Pilote", cdp: "Chef de projet", cq: "CQ", formateur: "Formateur", admin: "Admin" };

const TABS = [
  { key: "", label: "En attente", icon: "clock", tone: "warning" },
  { key: "accepted", label: "Acceptées · à réévaluer", icon: "checkCircle", tone: "success" },
  { key: "rejected", label: "Rejetées", icon: "xCircle", tone: "danger" },
  { key: "all", label: "Historique", icon: "fileText", tone: "primary" },
];

function StatusBadge({ s }) {
  if (s.contestStatus === "accepted") return <span className="badge badge--success">Acceptée</span>;
  if (s.contestStatus === "rejected") return <span className="badge badge--danger">Rejetée</span>;
  return <span className="badge badge--warning">En attente</span>;
}

/**
 * Contestations : arbitrage (CQ / Formateur / Admin) ou suivi (Chef de projet, Superviseur, Référent).
 */
export default function ContestationsPage() {
  const user = getUser();
  const role = user.role || "";
  const canArbitrate = ["cq", "formateur", "admin"].includes(role);
  const canReevaluate = ["cq", "formateur"].includes(role);

  const [tab, setTab] = useState("");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // { score, decision }
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, ...c] = await Promise.all([
        api.get("/scores/contested", { params: { status: tab, limit: 500 } }),
        ...TABS.map((t) => api.get("/scores/contested", { params: { status: t.key, limit: 10 } })),
      ]);
      setRows(Array.isArray(list.data?.items) ? list.data.items : []);
      setCounts(Object.fromEntries(TABS.map((t, i) => [t.key || "pending", c[i].data?.total || 0])));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.pilotName} ${r.pilotCell} ${r.eps} ${r.evaluatorName} ${r.contestedBy?.name || ""}`.toLowerCase().includes(s));
  }, [rows, q]);

  function openDecision(score, decision) {
    setModal({ score, decision });
    setComment("");
    setError("");
  }

  async function submitDecision() {
    if (!modal) return;
    if (modal.decision === "reject" && !comment.trim()) { setError("Le motif du rejet est obligatoire."); return; }
    setSaving(true);
    try {
      await api.post(`/scores/${modal.score._id}/arbitrate`, { decision: modal.decision, comment: comment.trim() });
      setModal(null);
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || "Impossible d'enregistrer la décision.");
    } finally {
      setSaving(false);
    }
  }

  const reevaluate = (id) => window.dispatchEvent(new CustomEvent("kcq:navigate", { detail: { role, view: "new", editScoreId: String(id) } }));

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div className="page-title"><Ico n="alert" /> Contestations</div>
          <div>{canArbitrate ? "Arbitrez les contestations : acceptez (réévaluation) ou rejetez avec un motif." : "Suivi des contestations de votre périmètre."}</div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}><Ico n="refresh" /> Actualiser</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
        {TABS.map((t) => (
          <button
            key={t.key || "pending"}
            type="button"
            onClick={() => setTab(t.key)}
            className="card stat-card"
            style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", "--stat-accent": `var(--${t.tone})`, outline: tab === t.key ? "2px solid var(--primary)" : "none", outlineOffset: 2 }}
          >
            <span className="stat-card__icon"><Ico n={t.icon} /></span>
            <div className="stat-card__label">{t.label}</div>
            <div className="stat-card__value" style={{ color: `var(--${t.tone === "primary" ? "text" : t.tone})` }}><AnimatedValue value={counts[t.key || "pending"] ?? 0} /></div>
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 16px", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{TABS.find((t) => t.key === tab)?.label} ({filtered.length})</div>
          <input className="input" style={{ maxWidth: 280 }} placeholder="Agent, cellule, EPS, évaluateur…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Contestée le</th><th>Agent</th><th>EPS</th><th>Évaluateur</th><th>Note</th><th>Contestée par</th><th>Motif</th><th>Statut</th><th>Décision</th>
                {(canArbitrate || canReevaluate) && <th style={{ textAlign: "right" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10}><div className="skeleton" style={{ height: 14, margin: "8px 0" }} /><div className="skeleton" style={{ height: 14, width: "70%" }} /></td></tr>}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10}><div className="empty-state"><div className="empty-state__text">Aucune contestation dans cette catégorie.</div></div></td></tr>
              )}
              {!loading && filtered.map((s) => (
                <tr key={s._id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(s.contestedAt || s.createdAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}><div style={{ fontWeight: 650 }}>{s.pilotName || "—"}</div><div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{s.pilotCell}</div></td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", whiteSpace: "nowrap" }}>{s.eps || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{s.evaluatorName || "—"}</td>
                  <td><span className={`badge ${s.compliancePercent >= 80 ? "badge--success" : s.compliancePercent >= 50 ? "badge--warning" : "badge--danger"}`}>{pct(s.compliancePercent)}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>{s.contestedBy?.name ? <>{s.contestedBy.name}<div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{ROLE_LABEL[s.contestedBy.role] || s.contestedBy.role}</div></> : "—"}</td>
                  <td style={{ minWidth: 240, maxWidth: 340, fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>{s.contestComment || "—"}</td>
                  <td><StatusBadge s={s} /></td>
                  <td style={{ minWidth: 180, maxWidth: 260, fontSize: "0.8rem" }}>
                    {s.arbitratedBy?.name ? <><b>{s.arbitratedBy.name}</b> · {fmtDate(s.arbitratedAt)}<div style={{ color: "var(--muted)" }}>{s.arbitrationComment}</div></> : <span style={{ color: "var(--muted)" }}>—</span>}
                  </td>
                  {(canArbitrate || canReevaluate) && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        {canArbitrate && (s.contestStatus === "pending" || !s.contestStatus) && (
                          <>
                            <button className="btn btn--sm" onClick={() => openDecision(s, "accept")}><Ico n="check" /> Accepter</button>
                            <button className="btn btn--ghost btn--sm" style={{ color: "var(--danger)" }} onClick={() => openDecision(s, "reject")}><Ico n="x" /> Rejeter</button>
                          </>
                        )}
                        {canReevaluate && s.contestStatus === "accepted" && s.contested && (
                          <button className="btn btn--sm" onClick={() => reevaluate(s._id)}><Ico n="pencil" /> Réévaluer</button>
                        )}
                        {role === "admin" && ["accepted", "rejected"].includes(s.contestStatus) && (
                          <button className="btn btn--ghost btn--sm" onClick={() => openDecision(s, s.contestStatus === "accepted" ? "reject" : "accept")}><Ico n="repeat" /> Revoir</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setModal(null); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="arb-title" style={{ maxWidth: 520 }}>
            <div id="arb-title" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.2rem", letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 10 }}>
              <Ico n={modal.decision === "accept" ? "checkCircle" : "xCircle"} style={{ color: modal.decision === "accept" ? "var(--success)" : "var(--danger)" }} />
              {modal.decision === "accept" ? "Accepter la contestation" : "Rejeter la contestation"}
            </div>
            <div style={{ marginTop: 6, color: "var(--muted)", fontSize: "0.86rem" }}>
              {modal.score.pilotName} · {modal.score.eps || "EPS"} · note {pct(modal.score.compliancePercent)}
            </div>
            <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: "0.85rem" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>Motif de la contestation</div>
              {modal.score.contestComment || "—"}
            </div>
            <label className="label" style={{ marginTop: 14 }}>
              {modal.decision === "reject" ? "Motif du rejet (obligatoire)" : "Commentaire (facultatif)"}
              <textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus
                placeholder={modal.decision === "reject" ? "Expliquez pourquoi l'évaluation est maintenue…" : "L'évaluation va être corrigée…"} />
            </label>
            {modal.decision === "accept" && <div style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--muted)" }}>L'évaluation passe en réévaluation ; l'agent devra valider la nouvelle version.</div>}
            {error && <div role="alert" style={{ marginTop: 10, color: "var(--danger)", fontSize: "0.85rem", fontWeight: 600 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button className="btn btn--ghost" onClick={() => setModal(null)} disabled={saving}>Annuler</button>
              <button className={modal.decision === "accept" ? "btn" : "btn btn--danger"} onClick={submitDecision} disabled={saving}>
                {saving ? "Enregistrement…" : modal.decision === "accept" ? "Accepter" : "Rejeter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
