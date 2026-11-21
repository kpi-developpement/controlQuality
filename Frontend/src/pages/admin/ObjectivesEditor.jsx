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
  { key: "cq", label: "CQ", hint: "CQ et formateurs" },
  { key: "referent", label: "Référent technique", hint: "Référents techniques" },
  { key: "management", label: "Management", hint: "Management et superviseurs" },
];

const emptyCounts = () => Object.fromEntries(OBJ_ACTIVITIES.map((a) => [a.key, 0]));
const toRow = (cell, doc) => ({
  cell: cell.name,
  contract: cell.contract || doc?.contract || "",
  _id: doc?._id || "",
  base: doc?.base || "cell",
  cq: { ...emptyCounts(), ...(doc?.cq || {}) },
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
  const [group, setGroup] = useState("cq");
  const [contract, setContract] = useState("");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [c, o] = await Promise.all([
      api.get("/admin/cells").then((r) => r.data).catch(() => []),
      api.get("/referentials/objectives").then((r) => r.data).catch(() => []),
    ]);
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

  const setVal = (cell, key, value) => {
    setRows((prev) => {
      const r = prev[cell];
      const next = key === "base" ? { ...r, base: value } : { ...r, [group]: { ...r[group], [key]: value } };
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
        await api.put("/referentials/objectives", { cell: name, base: r.base, cq: clean(r.cq), referent: clean(r.referent), management: clean(r.management) }, { toast: false });
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
  const g = OBJ_GROUPS.find((x) => x.key === group);

  return (
    <Card
      title="Objectifs mensuels par cellule"
      right={<button className="btn btn--sm" type="button" onClick={saveAll} disabled={!dirtyCount || saving}>{saving ? "Enregistrement…" : dirtyCount ? `Enregistrer (${dirtyCount})` : "Enregistrer"}</button>}
    >
      <div className="obj-help">
        Volume attendu chaque mois pour chaque cellule. Base « par cellule » : objectif total de la cellule ; « par agent » : objectif multiplié par le nombre d'agents actifs.
        Le suivi est visible dans <b>Avancement CQ</b>.
      </div>
      <div className="obj-toolbar">
        <div className="seg" role="tablist" aria-label="Population">
          {OBJ_GROUPS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={group === x.key} className={group === x.key ? "seg__btn is-on" : "seg__btn"} onClick={() => setGroup(x.key)} title={x.hint}>{x.label}</button>
          ))}
        </div>
        <Select className="input" value={contract} onChange={(e) => setContract(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Toutes les activités</option>
          {contracts.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <input className="input" placeholder="Rechercher une cellule…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table obj-table">
          <thead>
            <tr>
              <th>Activité</th><th>Cellule</th><th>Base</th>
              {OBJ_ACTIVITIES.map((a) => <th key={a.key} className="num">{a.label} {g.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const r = rows[c.name];
              if (!r) return null;
              return (
                <tr key={c.name} className={dirty[c.name] ? "is-dirty" : undefined}>
                  <td>{r.contract || "—"}</td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>
                    <Select className="input input--sm" value={r.base} onChange={(e) => setVal(c.name, "base", e.target.value)}>
                      <option value="cell">Par cellule</option>
                      <option value="agent">Par agent</option>
                    </Select>
                  </td>
                  {OBJ_ACTIVITIES.map((a) => (
                    <td key={a.key} className="num">
                      <input className="input obj-num" type="number" min="0" max="100000" inputMode="numeric" aria-label={`${a.label} ${g.label} — ${c.name}`}
                        value={r[group][a.key]} onChange={(e) => setVal(c.name, a.key, e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} />
                    </td>
                  ))}
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={8} style={{ color: "var(--muted)" }}>Aucune cellule.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
