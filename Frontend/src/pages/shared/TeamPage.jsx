import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../api";
import Ico from "../../ui/Ico.jsx";
import Select from "../../ui/Select.jsx";
import AnimatedValue from "../../components/AnimatedValue.jsx";
import { fetchAllPaged } from "../../utils/fetchAllPaged.js";

const getUser = () => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; } };
const idOf = (v) => String(v?._id || v || "");
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—");
const tone = (v) => (v === null ? "badge--muted" : v >= 80 ? "badge--success" : v >= 50 ? "badge--warning" : "badge--danger");

/**
 * Mon équipe / Mon activité :
 *  - Référent technique : suivi des scores de tous ses pilotes (lecture)
 *  - Superviseur : + changement de cellule et affectation des pilotes à ses référents
 *  - Chef de projet / Admin : + affectation des référents aux superviseurs
 */
export default function TeamPage() {
  const me = getUser();
  const role = me.role || "";
  const canEditCell = ["superviseur", "cdp", "admin"].includes(role);
  const canAssignRef = ["superviseur", "cdp", "admin"].includes(role);
  const canAssignSup = ["cdp", "admin"].includes(role);
  const title = role === "referent" ? "Mon équipe" : role === "cdp" ? "Mon activité" : role === "admin" ? "Hiérarchie des équipes" : "Ma ligne";

  const [users, setUsers] = useState([]);
  const [cells, setCells] = useState([]);
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [refFilter, setRefFilter] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(); since.setMonth(since.getMonth() - 3);
    try {
      const [u, c, s] = await Promise.all([
        api.get("/admin/users"),
        api.get("/admin/cells").catch(() => ({ data: [] })),
        fetchAllPaged("/scores", { dateFrom: since.toISOString().slice(0, 10) }, { pageSize: 500, maxPages: 20 }).catch(() => []),
      ]);
      setUsers(Array.isArray(u.data) ? u.data : []);
      setCells((Array.isArray(c.data) ? c.data : []).filter((x) => x.active !== false));
      setScores(Array.isArray(s) ? s : []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map(users.map((u) => [idOf(u), u])), [users]);
  const pilots = useMemo(() => users.filter((u) => u.role === "pilote" && u.active !== false), [users]);
  const referents = useMemo(() => users.filter((u) => u.role === "referent" && u.active !== false), [users]);
  const superviseurs = useMemo(() => users.filter((u) => u.role === "superviseur" && u.active !== false), [users]);

  // Statistiques par pilote (3 derniers mois)
  const stats = useMemo(() => {
    const m = new Map();
    for (const s of scores) {
      const pid = idOf(s.pilot);
      const v = typeof s.compliancePercent === "number" ? s.compliancePercent : null;
      const cur = m.get(pid) || { n: 0, sum: 0, cnt: 0, last: null, contested: 0 };
      cur.n += 1;
      if (v !== null) { cur.sum += v; cur.cnt += 1; }
      const d = s.evaluationDate || s.createdAt;
      if (d && (!cur.last || new Date(d) > new Date(cur.last))) cur.last = d;
      if (s.contested) cur.contested += 1;
      m.set(pid, cur);
    }
    return m;
  }, [scores]);
  const avgOf = (st) => (st && st.cnt ? st.sum / st.cnt : null);

  const team = useMemo(() => {
    const t = q.trim().toLowerCase();
    return pilots
      .filter((p) => !refFilter || idOf(p.referent) === refFilter)
      .filter((p) => !t || `${p.name} ${p.email} ${p.cell}`.toLowerCase().includes(t))
      .map((p) => ({ p, st: stats.get(idOf(p._id)) }))
      .sort((a, b) => (avgOf(a.st) ?? 101) - (avgOf(b.st) ?? 101));
  }, [pilots, stats, q, refFilter]);

  const overall = useMemo(() => {
    let sum = 0, cnt = 0, n = 0, contested = 0;
    for (const { st } of team) { if (!st) continue; sum += st.sum; cnt += st.cnt; n += st.n; contested += st.contested; }
    return { avg: cnt ? Math.round(sum / cnt) : null, n, contested, below: team.filter(({ st }) => avgOf(st) !== null && avgOf(st) < 70).length };
  }, [team]);

  const refStats = useMemo(() => referents.map((r) => {
    const mine = pilots.filter((p) => idOf(p.referent) === idOf(r._id));
    let sum = 0, cnt = 0;
    for (const p of mine) { const st = stats.get(idOf(p._id)); if (st) { sum += st.sum; cnt += st.cnt; } }
    return { r, count: mine.length, avg: cnt ? sum / cnt : null };
  }), [referents, pilots, stats]);

  async function changeCell(u, cell) {
    setBusy(`cell-${u._id}`);
    try { await api.patch(`/admin/users/${u._id}/cell`, { cell }); setUsers((prev) => prev.map((x) => (idOf(x) === idOf(u) ? { ...x, cell } : x))); }
    finally { setBusy(""); }
  }
  async function assign(u, field, value) {
    setBusy(`${field}-${u._id}`);
    try { await api.patch(`/admin/users/${u._id}/hierarchy`, { [field]: value || null }); setUsers((prev) => prev.map((x) => (idOf(x) === idOf(u) ? { ...x, [field]: value || null } : x))); }
    finally { setBusy(""); }
  }

  const refOptions = role === "superviseur" ? referents.filter((r) => idOf(r.superviseur) === idOf(me._id || me.id)) : referents;

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div className="page-title"><Ico n="users" /> {title}</div>
          <div>Scores qualité des 3 derniers mois{role === "referent" ? " de vos pilotes" : ""} · {pilots.length} agent{pilots.length > 1 ? "s" : ""}</div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}><Ico n="refresh" /> Actualiser</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
        {[
          { icon: "award", label: "Note moyenne", value: overall.avg === null ? "—" : `${overall.avg}%`, color: overall.avg === null ? "var(--muted)" : overall.avg >= 80 ? "var(--success)" : overall.avg >= 50 ? "var(--warning)" : "var(--danger)" },
          { icon: "users", label: "Agents", value: String(team.length), color: "var(--primary)" },
          { icon: "chart", label: "Évaluations", value: String(overall.n), color: "var(--primary)" },
          { icon: "alert", label: "Agents sous 70 %", value: String(overall.below), color: overall.below ? "var(--danger)" : "var(--success)" },
          { icon: "message", label: "Contestations en cours", value: String(overall.contested), color: overall.contested ? "var(--warning)" : "var(--success)" },
        ].map((k) => (
          <div key={k.label} className="card stat-card" style={{ "--stat-accent": k.color }}>
            <span className="stat-card__icon"><Ico n={k.icon} /></span>
            <div className="stat-card__label">{k.label}</div>
            <div className="stat-card__value" style={{ color: k.color }}><AnimatedValue value={loading ? "…" : k.value} /></div>
          </div>
        ))}
      </div>

      {role !== "referent" && refStats.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 12 }}>Référents techniques</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
            {refStats.map(({ r, count, avg }) => (
              <div key={r._id} className="card card--interactive" onClick={() => setRefFilter(refFilter === idOf(r._id) ? "" : idOf(r._id))}
                style={{ padding: 14, outline: refFilter === idOf(r._id) ? "2px solid var(--primary)" : "none", outlineOffset: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    <div style={{ fontSize: "0.76rem", color: "var(--muted)" }}>{r.cell || "Sans cellule"} · {count} pilote{count > 1 ? "s" : ""}</div>
                  </div>
                  <span className={`badge ${tone(avg)}`}>{avg === null ? "—" : `${Math.round(avg)}%`}</span>
                </div>
                {canAssignSup && (
                  <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                    <Select className="input" value={idOf(r.superviseur)} disabled={busy === `superviseur-${r._id}`} onChange={(e) => assign(r, "superviseur", e.target.value)}>
                      <option value="">Aucun superviseur</option>
                      {superviseurs.map((s) => <option key={s._id} value={idOf(s._id)}>{s.name}</option>)}
                    </Select>
                  </div>
                )}
                {!canAssignSup && r.superviseur && <div style={{ marginTop: 8, fontSize: "0.76rem", color: "var(--muted)" }}><Ico n="user" /> {idOf(r.superviseur) === idOf(me._id || me.id) ? "Sous votre responsabilité" : (byId.get(idOf(r.superviseur))?.name || "Superviseur")}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 16px", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Pilotes {refFilter && <span className="badge badge--primary" style={{ marginLeft: 6, cursor: "pointer" }} onClick={() => setRefFilter("")}>{byId.get(refFilter)?.name} <Ico n="x" /></span>}</div>
          <input className="input" style={{ maxWidth: 260 }} placeholder="Rechercher un agent…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr><th>Agent</th><th>Cellule</th><th>Référent</th><th>Évaluations</th><th>Note moyenne</th><th>Dernière éval.</th><th>Contest.</th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7}><div className="skeleton" style={{ height: 14, margin: "8px 0" }} /><div className="skeleton" style={{ height: 14, width: "60%" }} /></td></tr>}
              {!loading && team.length === 0 && <tr><td colSpan={7}><div className="empty-state"><div className="empty-state__text">Aucun agent dans votre périmètre.</div></div></td></tr>}
              {!loading && team.map(({ p, st }) => {
                const avg = avgOf(st);
                return (
                  <tr key={p._id}>
                    <td><div style={{ fontWeight: 650 }}>{p.name}</div><div style={{ fontSize: "0.74rem", color: "var(--muted)" }}>{p.email}</div></td>
                    <td style={{ minWidth: 200 }}>
                      {canEditCell ? (
                        <Select className="input" value={p.cell || ""} disabled={busy === `cell-${p._id}`} onChange={(e) => changeCell(p, e.target.value)}>
                          <option value="">Sans cellule</option>
                          {cells.filter((c) => !me.project || role === "admin" || !c.project || c.project === me.project).map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
                        </Select>
                      ) : (p.cell || "—")}
                    </td>
                    <td style={{ minWidth: 190 }}>
                      {canAssignRef ? (
                        <Select className="input" value={idOf(p.referent)} disabled={busy === `referent-${p._id}`} onChange={(e) => assign(p, "referent", e.target.value)}>
                          <option value="">Aucun référent</option>
                          {refOptions.map((r) => <option key={r._id} value={idOf(r._id)}>{r.name}</option>)}
                        </Select>
                      ) : (byId.get(idOf(p.referent))?.name || (role === "referent" ? me.name : "—"))}
                    </td>
                    <td>{st?.n || 0}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 140 }}>
                        <span className={`badge ${tone(avg)}`}>{avg === null ? "—" : `${Math.round(avg)}%`}</span>
                        {avg !== null && <div style={{ flex: 1, height: 6, borderRadius: 99, background: "var(--chip)", overflow: "hidden" }}><div style={{ width: `${Math.max(3, avg)}%`, height: "100%", borderRadius: 99, background: avg >= 80 ? "var(--success)" : avg >= 50 ? "var(--warning)" : "var(--danger)", transition: "width 900ms cubic-bezier(0.22,1,0.36,1)" }} /></div>}
                      </div>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(st?.last)}</td>
                    <td>{st?.contested ? <span className="badge badge--warning">{st.contested}</span> : <span style={{ color: "var(--muted)" }}>0</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
