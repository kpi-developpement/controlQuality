import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import Card from "./components/Card.jsx";
import Select from "../../ui/Select.jsx";
import { useToast } from "../../toast/ToastProvider.jsx";

export const OBJ_ACTIVITIES = [
  { key: "evaluations", label: "Évaluations" },
  { key: "pickings", label: "Pickings" },
  { key: "coachings", label: "Coachings" },
  { key: "samples", label: "Échantillons" },
  { key: "calibrations", label: "Calibrages" },
];
export const OBJ_GROUPS = [
  { key: "cq", label: "CQ", hint: "Contrôleurs qualité" },
  { key: "formateur", label: "Formateur", hint: "Formateurs" },
  { key: "referent", label: "Référent technique", hint: "Référents techniques" },
  { key: "management", label: "Management", hint: "Management, superviseurs et chefs de projet" },
];

const emptyCounts = () => Object.fromEntries(OBJ_ACTIVITIES.map((a) => [a.key, 0]));
const toRow = (cell, doc) => ({
  cell: cell.name,
  contract: cell.contract || doc?.contract || "",
  _id: doc?._id || "",
  base: doc?.base || "cell",
  cq: { ...emptyCounts(), ...(doc?.cq || {}) },
  formateur: { ...emptyCounts(), ...(doc?.formateur || {}) },
  referent: { ...emptyCounts(), ...(doc?.referent || {}) },
  management: { ...emptyCounts(), ...(doc?.management || {}) },
});

/**
 * Paramètres qualité → objectifs mensuels par cellule : évaluations, pickings, coachings,
 * échantillons et calibrages attendus de la part des CQ, des référents techniques et du management.
 */
export default function ObjectivesEditor() {
  const toast = useToast();
  const [cells, setCells] = useState([]);
  const [rows, setRows] = useState({});
  const [dirty, setDirty] = useState({});
  const [agentCount, setAgentCount] = useState({});
  const [shownActs, setShownActs] = useState(() => OBJ_ACTIVITIES.map((a) => a.key));
  const [contract, setContract] = useState("");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [c, o, u] = await Promise.all([
      api.get("/admin/cells").then((r) => r.data).catch(() => []),
      api.get("/referentials/objectives").then((r) => r.data).catch(() => []),
      api.get("/admin/users").then((r) => r.data).catch(() => []),
    ]);
    const counts = {};
    for (const x of Array.isArray(u) ? u : []) if (x.role === "pilote" && x.active !== false && x.cell) counts[x.cell] = (counts[x.cell] || 0) + 1;
    setAgentCount(counts);
    const list = (Array.isArray(c) ? c : c?.items || []).filter((x) => x.active !== false);
    const byCell = new Map((Array.isArray(o) ? o : []).map((d) => [d.cell, d]));
    setCells(list);
    setRows(Object.fromEntries(list.map((cell) => [cell.name, toRow(cell, byCell.get(cell.name))])));
    setDirty({});
  }
  useEffect(() => { load(); }, []);

  const contracts = useMemo(() => [...new Set(cells.map((c) => c.contract).filter(Boolean))].sort(), [cells]);
  const shown = useMemo(() => cells
    .filter((c) => (!contract || c.contract === contract) && (!q || c.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.contract || "").localeCompare(b.contract || "") || a.name.localeCompare(b.name)), [cells, contract, q]);

  const setVal = (cell, key, value, grp) => {
    setRows((prev) => {
      const r = prev[cell];
      const next = key === "base" ? { ...r, base: value } : { ...r, [grp]: { ...r[grp], [key]: value } };
      return { ...prev, [cell]: next };
    });
    setDirty((d) => ({ ...d, [cell]: true }));
  };

  async function saveAll() {
    const names = Object.keys(dirty).filter((k) => dirty[k]);
    if (!names.length) return;
    setSaving(true);
    let ok = 0;
    for (const name of names) {
      const r = rows[name];
      const clean = (o) => Object.fromEntries(OBJ_ACTIVITIES.map((a) => [a.key, Math.max(0, Number(o[a.key]) || 0)]));
      try {
        await api.put("/referentials/objectives", { cell: name, base: "agent", ...Object.fromEntries(OBJ_GROUPS.map((g) => [g.key, clean(r[g.key])])) }, { toast: false });
        ok++;
      } catch (e) {
        toast.error(`${name} : ${e?.response?.data?.message || "enregistrement impossible"}`);
      }
    }
    setSaving(false);
    if (ok) toast.success(`${ok} cellule${ok > 1 ? "s" : ""} enregistrée${ok > 1 ? "s" : ""}.`);
    await load();
  }

  const dirtyCount = Object.values(dirty).filter(Boolean).length;
  // Matrice : chaque type de tâche est décliné par population (CQ | Référent | Management)
  const acts = OBJ_ACTIVITIES.filter((a) => shownActs.includes(a.key));
  const toggleAct = (k) => setShownActs((cur) => (cur.includes(k) ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur) : OBJ_ACTIVITIES.map((a) => a.key).filter((x) => x === k || cur.includes(x))));

  return (
    <Card
      title="Objectifs mensuels par cellule"
      right={<button className="btn btn--sm" type="button" onClick={saveAll} disabled={!dirtyCount || saving}>{saving ? "Enregistrement…" : dirtyCount ? `Enregistrer (${dirtyCount})` : "Enregistrer"}</button>}
    >
      <div className="obj-help">
        Objectif mensuel <b>par agent</b> : le volume attendu de chaque cellule = objectif × nombre d'agents actifs de la cellule.
        Le suivi est visible dans <b>Avancement écoutes</b>.
      </div>
      <div className="obj-toolbar">
        <div className="obj-chips" role="group" aria-label="Types de tâches affichés">
          {OBJ_ACTIVITIES.map((a) => (
            <button key={a.key} type="button" aria-pressed={shownActs.includes(a.key)} className={shownActs.includes(a.key) ? "obj-chip is-on" : "obj-chip"} onClick={() => toggleAct(a.key)}>{a.label}</button>
          ))}
        </div>
        <Select className="input" value={contract} onChange={(e) => setContract(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Tous les contrats</option>
          {contracts.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <input className="input" placeholder="Rechercher une cellule…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
      </div>
      <div className="obj-scroll">
        <table className="data-table obj-table">
          <thead>
            <tr>
              <th rowSpan={2}>Activité</th><th rowSpan={2} className="obj-sticky">Cellule</th><th rowSpan={2} className="num">Agents actifs</th>
              {acts.map((a) => <th key={a.key} colSpan={OBJ_GROUPS.length} className="num obj-grouphead">{a.label}</th>)}
            </tr>
            <tr>
              {acts.flatMap((a) => OBJ_GROUPS.map((g) => <th key={a.key + g.key} className="num obj-subhead" title={g.hint}>{g.key === "referent" ? "Référent" : g.label}</th>))}
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const r = rows[c.name];
              if (!r) return null;
              return (
                <tr key={c.name} className={dirty[c.name] ? "is-dirty" : undefined}>
                  <td><div style={{ fontWeight: 600 }}>{c.activity || "—"}</div><div className="muted" style={{ fontSize: 11 }}>{r.contract || "Sans contrat"}</div></td>
                  <td className="obj-sticky" style={{ fontWeight: 600 }}>{c.name}</td>
                  <td className="num">{agentCount[c.name] ?? "—"}</td>
                  {acts.flatMap((a) => OBJ_GROUPS.map((g) => (
                    <td key={a.key + g.key} className={`num obj-cellgrp obj-cellgrp--${g.key}`}>
                      <input className="input obj-num" type="number" min="0" max="100000" inputMode="numeric" aria-label={`${a.label} ${g.label} — ${c.name}`}
                        value={r[g.key][a.key]} onChange={(e) => setVal(c.name, a.key, e.target.value === "" ? "" : Math.max(0, Number(e.target.value)), g.key)} />
                    </td>
                  )))}
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={3 + acts.length * OBJ_GROUPS.length} style={{ color: "var(--muted)" }}>Aucune cellule.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
