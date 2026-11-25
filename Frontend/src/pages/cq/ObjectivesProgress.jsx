import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import Ico from "../../ui/Ico.jsx";
import { OBJ_ACTIVITIES, OBJ_GROUPS } from "../admin/ObjectivesEditor.jsx";

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const monthText = (m) => { const [y, mm] = String(m || "").split("-"); return y ? `${MONTHS[Number(mm) - 1]} ${y}` : ""; };
const toneOf = (rate) => (rate === null ? "var(--muted)" : rate >= 100 ? "#16a34a" : rate >= 60 ? "#ea7a0c" : "#dc2626");

function Progress({ v }) {
  if (!v || !v.target) return <span className="muted" style={{ fontSize: 12 }}>{v?.done ? `${v.done} (sans objectif)` : "—"}</span>;
  const pct = Math.min(100, (v.done / v.target) * 100);
  return (
    <div className="obj-cell" title={`${v.done} réalisé(s) sur ${v.target} — dont ${v.mine} par vous`}>
      <div className="obj-cell__nums">{v.done} / {v.target} <small>· {v.rate?.toFixed(0)} %</small></div>
      <div className="obj-bar" style={{ "--tone": toneOf(v.rate) }}><span style={{ width: `${pct}%` }} /></div>
      <div className="obj-cell__left">{v.done >= v.target ? "Objectif atteint" : `Reste ${v.target - v.done}`}</div>
    </div>
  );
}

/**
 * Avancement des tâches par rapport aux objectifs fixés par cellule (Paramètres qualité).
 * Comptage par date de réalisation du mois choisi.
 */
export default function ObjectivesProgress({ month }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [group, setGroup] = useState("");

  useEffect(() => {
    let alive = true;
    setErr("");
    api.get("/kpi/objectives-progress", { params: { month } })
      .then((r) => { if (!alive) return; setData(r.data); setGroup((g) => g || r.data?.myGroup || "cq"); })
      .catch((e) => alive && setErr(e?.response?.data?.message || "Chargement des objectifs impossible."));
    return () => { alive = false; };
  }, [month]);

  const rows = data?.rows || [];
  const g = group || "cq";
  const totals = useMemo(() => {
    const t = Object.fromEntries(OBJ_ACTIVITIES.map((a) => [a.key, { target: 0, done: 0, mine: 0 }]));
    for (const r of rows) for (const a of OBJ_ACTIVITIES) {
      const v = r.groups?.[g]?.[a.key];
      if (!v || !v.target) continue;
      t[a.key].target += v.target; t[a.key].done += v.done; t[a.key].mine += v.mine;
    }
    return t;
  }, [rows, g]);
  const isMine = data?.myGroup === g;
  // Chaque rôle a sa propre vue (pas de bascule) ; l'admin peut consulter toutes les populations
  const lockedGroup = !!data?.myGroup;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}><Ico n="target" /> Objectifs {OBJ_GROUPS.find((x) => x.key === g)?.label || ""} — {monthText(data?.month || month)}</h3>
          <div className="muted" style={{ fontSize: 13 }}>
            {lockedGroup ? "Vue commune à tous les utilisateurs de votre rôle" : "Vue par population"}
            {lockedGroup && ["referent", "management"].includes(g) ? ", limitée à vos cellules affectées" : ""}.
            Objectif = objectif par agent (Paramètres qualité) × agents actifs de la cellule ; réalisé à la date de réalisation.
          </div>
        </div>
        {!lockedGroup && <div className="seg" role="tablist" aria-label="Population">
          {OBJ_GROUPS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={g === x.key} className={g === x.key ? "seg__btn is-on" : "seg__btn"} onClick={() => setGroup(x.key)} title={x.hint}>{x.label}</button>
          ))}
        </div>}
      </div>
      {err && <p style={{ color: "var(--danger)" }}>{err}</p>}
      {!err && data && !rows.length && <p className="muted">Aucun objectif n'est encore fixé pour vos cellules (Paramètres qualité → Objectifs mensuels par cellule).</p>}
      {rows.length > 0 && <>
        <div className="obj-kpis" style={{ marginBottom: 14 }}>
          {OBJ_ACTIVITIES.map((a) => {
            const v = totals[a.key];
            const rate = v.target ? Math.round((v.done / v.target) * 1000) / 10 : null;
            return (
              <div key={a.key} className="card stat-card" style={{ padding: 14 }}>
                <div className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{a.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, margin: "4px 0" }}>{v.done}<span className="muted" style={{ fontSize: 14 }}> / {v.target || "—"}</span></div>
                {v.target ? <div className="obj-bar" style={{ "--tone": toneOf(rate) }}><span style={{ width: `${Math.min(100, rate)}%` }} /></div> : <div className="muted" style={{ fontSize: 12 }}>Pas d'objectif</div>}
                {v.target > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{v.done >= v.target ? "Objectif atteint" : `Reste à faire : ${v.target - v.done}`} · {rate?.toFixed(0)} %</div>}
                {isMine && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Dont vous : {v.mine}</div>}
              </div>
            );
          })}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Activité</th><th>Cellule</th>{OBJ_ACTIVITIES.map((a) => <th key={a.key}>{a.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cell}>
                  <td>{r.contract || "—"}</td>
                  <td style={{ fontWeight: 600 }}>{r.cell}<div className="muted" style={{ fontSize: 11 }}>{r.activeAgents} agent{r.activeAgents > 1 ? "s" : ""} actif{r.activeAgents > 1 ? "s" : ""}</div></td>
                  {OBJ_ACTIVITIES.map((a) => <td key={a.key}><Progress v={r.groups?.[g]?.[a.key]} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}
