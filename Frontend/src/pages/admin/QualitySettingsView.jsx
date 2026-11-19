import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import Card from "./components/Card.jsx";
import MultiSelect from "../../components/MultiSelect.jsx";
import { VISIBILITY_SCOPES, EDIT_SCOPES, ROLE_LABELS, resetClosureCodesCache } from "../../utils/evalMeta.js";
import Select from "../../ui/Select.jsx";

const ROLE_OPTS = Object.entries(ROLE_LABELS).filter(([k]) => k !== "admin").map(([value, label]) => ({ value, label }));
const SAMPLE_OPTS = [
  { value: "pending", label: "En attente (non affecté)" },
  { value: "assigned", label: "Affecté, non commencé" },
  { value: "in_progress", label: "En cours" },
  { value: "standby", label: "Standby (bloqué / attente d'information)" },
];

/** Référentiel simple (projets, contrats, codes de clôture). */
function RefList({ title, path, fields, onChanged }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({});
  const [showInactive, setShowInactive] = useState(false);
  const load = () => api.get(`/referentials/${path}`).then((r) => setItems(Array.isArray(r.data) ? r.data : [])).catch(() => setItems([]));
  useEffect(() => { load(); }, [path]);
  async function add() {
    try { await api.post(`/referentials/${path}`, form); setForm({}); await load(); onChanged?.(); } catch {}
  }
  async function toggle(it) {
    try { await api.patch(`/referentials/${path}/${it._id}`, { active: it.active === false }); await load(); onChanged?.(); } catch {}
  }
  const shown = items.filter((it) => showInactive || it.active !== false);
  return (
    <Card title={title} right={<label style={{ fontSize: "0.8rem" }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Afficher les inactifs</label>}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${fields.length}, minmax(0,1fr)) auto`, gap: 8, marginBottom: 10 }}>
        {fields.map((f) => <input key={f.key} className="input" placeholder={f.label} value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />)}
        <button className="btn btn--sm" type="button" onClick={add} disabled={!form[fields[0].key]}>Ajouter</button>
      </div>
      <table className="data-table">
        <thead><tr>{fields.map((f) => <th key={f.key}>{f.label}</th>)}<th>État</th><th></th></tr></thead>
        <tbody>
          {shown.map((it) => (
            <tr key={it._id} style={it.active === false ? { opacity: 0.55 } : undefined}>
              {fields.map((f) => <td key={f.key}>{it[f.key] || "—"}</td>)}
              <td>{it.active === false ? "Inactif" : "Actif"}</td>
              <td><button className="btn btn--ghost btn--sm" type="button" onClick={() => toggle(it)}>{it.active === false ? "Réactiver" : "Désactiver"}</button></td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={fields.length + 2} style={{ color: "var(--muted)" }}>Aucun élément.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * Paramètres qualité (admin, contrat Orange) : contrôle d'accès par périmètre, mise à jour
 * des profils existants, référentiels, définitions des indicateurs et objectifs.
 */
export default function QualitySettingsView() {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [incomplete, setIncomplete] = useState({ total: 0, blocking: 0, items: [], scopeCheck: [], noAgent: [] });
  const [showScope, setShowScope] = useState(false);
  const [users, setUsers] = useState([]);
  const [cells, setCells] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filter, setFilter] = useState({ role: "", cell: "", missing: "" });
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState({ project: "__keep", contract: "__keep", visibilityScope: "__keep", editScope: "__keep" });
  const [msg, setMsg] = useState("");
  const [targets, setTargets] = useState([]);
  const [tForm, setTForm] = useState({ month: "", cell: "", contract: "", project: "", target: "" });

  const loadAll = async () => {
    const [s, inc, u, c, p, k, t] = await Promise.all([
      api.get("/referentials/settings").catch(() => ({ data: {} })),
      api.get("/admin/users/incomplete").catch(() => ({ data: { total: 0, blocking: 0, items: [] } })),
      api.get("/admin/users").catch(() => ({ data: [] })),
      api.get("/admin/cells").catch(() => ({ data: [] })),
      api.get("/referentials/projects", { params: { active: "true" } }).catch(() => ({ data: [] })),
      api.get("/referentials/contracts", { params: { active: "true" } }).catch(() => ({ data: [] })),
      api.get("/referentials/targets").catch(() => ({ data: [] })),
    ]);
    setSettings(s.data?.settings || null);
    setDraft(s.data?.settings || null);
    setIncomplete(inc.data || { total: 0, blocking: 0, items: [] });
    setUsers((Array.isArray(u.data) ? u.data : []).filter((x) => x.role !== "admin" && x.active !== false));
    setCells(Array.isArray(c.data) ? c.data : []);
    setProjects(Array.isArray(p.data) ? p.data : []);
    setContracts(Array.isArray(k.data) ? k.data : []);
    setTargets(Array.isArray(t.data) ? t.data : []);
  };
  useEffect(() => { loadAll(); }, []);

  async function save(patch) {
    setSaving(true); setMsg("");
    try {
      const { data } = await api.put("/referentials/settings", { settings: patch }, { toastSuccessMessage: "Paramètres enregistrés" });
      setSettings(data.settings); setDraft(data.settings);
    } catch {} finally { setSaving(false); }
  }

  async function toggleEnforcement() {
    const next = !settings?.accessScopeEnforced;
    if (next && incomplete.blocking > 0 && !window.confirm(`${incomplete.blocking} responsable(s) Management/Supervision ne verraient AUCUN agent (voir la liste « Responsables sans agent visible »). Activer quand même ?`)) return;
    if (next && !window.confirm("Activer le contrôle d'accès par périmètre ? Les managers ne verront plus que les données de leur cellule (et projet/contrat).")) return;
    await save({ accessScopeEnforced: next });
  }

  const filteredUsers = useMemo(() => users.filter((u) => {
    if (filter.role && u.role !== filter.role) return false;
    if (filter.cell && (u.cell || "") !== (filter.cell === "__none" ? "" : filter.cell)) return false;
    if (filter.missing === "project" && u.project) return false;
    if (filter.missing === "contract" && u.contract) return false;
    if (filter.missing === "cell" && u.cell) return false;
    return true;
  }), [users, filter]);

  async function applyBulk() {
    const set = {};
    for (const [k, v] of Object.entries(bulk)) if (v !== "__keep") set[k] = v;
    if (!selected.length || !Object.keys(set).length) return;
    try {
      const { data } = await api.patch("/admin/users/bulk-scope", { userIds: selected, set }, { toastSuccessMessage: "Profils mis à jour" });
      setMsg(`${data.modified} profil(s) mis à jour.`);
      setSelected([]);
      await loadAll();
    } catch {}
  }
  async function applyCellScope() {
    if (!window.confirm("Recopier le projet et le contrat de chaque cellule vers ses membres (champs vides uniquement) ?")) return;
    try {
      const { data } = await api.post("/admin/users/apply-cell-scope", { overwrite: false }, { toastSuccessMessage: "Profils complétés" });
      setMsg(`${data.modified} champ(s) complété(s) à partir de ${data.cells} cellule(s).`);
      await loadAll();
    } catch {}
  }
  async function saveTarget() {
    try { await api.put("/referentials/targets", { ...tForm, target: Number(tForm.target) }, { toastSuccessMessage: "Objectif enregistré" }); setTForm({ ...tForm, target: "" }); await loadAll(); } catch {}
  }
  async function deleteTarget(id) {
    try { await api.delete(`/referentials/targets/${id}`); await loadAll(); } catch {}
  }

  const sel = (opts, value, onChange, keepLabel) => (
    <Select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {keepLabel && <option value="__keep">{keepLabel}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
  const nameOpts = (list, empty) => [{ value: "", label: empty }, ...list.map((x) => ({ value: x.name, label: x.name }))];
  const d = draft || {};

  return (
    <>
      <Card title="Contrôle d'accès par périmètre">
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span className={`badge ${settings?.accessScopeEnforced ? "badge--success" : "badge--warning"}`} style={{ fontSize: "0.85rem" }}>
            {settings?.accessScopeEnforced ? "Activé" : "Désactivé (comportement historique)"}
          </span>
          <button className={settings?.accessScopeEnforced ? "btn btn--ghost" : "btn"} type="button" onClick={toggleEnforcement} disabled={saving || !settings}>
            {settings?.accessScopeEnforced ? "Désactiver" : "Activer"}
          </button>
          <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            Activé : le Management ne voit que sa cellule (+ projet / contrat renseignés). La Supervision est toujours limitée à sa cellule. Admin, CQ et Formateur : inchangés (sauf périmètre explicite sur le profil).
          </span>
        </div>
        <div style={{ marginTop: 12, fontSize: "0.85rem" }}>
          <b>{incomplete.total}</b> profil(s) actif(s) incomplet(s) — <b style={{ color: incomplete.blocking ? "var(--danger)" : "inherit" }}>{incomplete.blocking}</b> responsable(s) Management/Supervision sans agent visible (bloquant).
          {" "}<button className="btn btn--ghost btn--sm" type="button" onClick={() => setShowScope((x) => !x)}>{showScope ? "Masquer" : "Voir"} les agents visibles par responsable</button>
        </div>
        {(showScope || (incomplete.noAgent || []).length > 0) && (
          <div style={{ marginTop: 10, maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
            <table className="data-table">
              <thead><tr><th>Responsable</th><th>Rôle</th><th>Cellule (+ autorisées)</th><th>Projet</th><th>Contrat</th><th>Agents visibles</th></tr></thead>
              <tbody>
                {(showScope ? incomplete.scopeCheck || [] : incomplete.noAgent || []).map((u) => (
                  <tr key={u._id} style={u.visibleAgents === 0 ? { background: "var(--danger-bg)" } : undefined}>
                    <td style={{ fontWeight: 600 }}>{u.name}</td><td>{ROLE_LABELS[u.role] || u.role}</td>
                    <td>{u.cell || <span style={{ color: "var(--danger)" }}>aucune</span>}{u.extraCells?.length ? ` (+ ${u.extraCells.join(", ")})` : ""}</td>
                    <td>{u.project || "—"}</td><td>{u.contract || "—"}</td>
                    <td><b style={{ color: u.visibleAgents ? "inherit" : "var(--danger)" }}>{u.visibleAgents}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: "0.78rem", color: "var(--muted)", padding: "6px 10px" }}>
              Un responsable voit les agents actifs de sa cellule (casse, accents et espaces ignorés), hors agents rattachés à un autre projet ou contrat que le sien. À 0 : vérifier sa cellule, ou le projet / contrat de ses agents.
            </div>
          </div>
        )}
      </Card>

      <Card title="Mise à jour des profils existants" right={<button className="btn-outline" type="button" onClick={applyCellScope}>Recopier projet/contrat des cellules</button>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginBottom: 10 }}>
          {sel([{ value: "", label: "Tous les rôles" }, ...ROLE_OPTS], filter.role, (v) => setFilter({ ...filter, role: v }))}
          {sel([{ value: "", label: "Toutes les cellules" }, { value: "__none", label: "Sans cellule" }, ...cells.map((c) => ({ value: c.name, label: c.name }))], filter.cell, (v) => setFilter({ ...filter, cell: v }))}
          {sel([{ value: "", label: "Tous les profils" }, { value: "cell", label: "Sans cellule" }, { value: "project", label: "Sans projet" }, { value: "contract", label: "Sans contrat" }], filter.missing, (v) => setFilter({ ...filter, missing: v }))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr)) auto", gap: 8, marginBottom: 10, alignItems: "center" }}>
          {sel(nameOpts(projects, "Projet : vider"), bulk.project, (v) => setBulk({ ...bulk, project: v }), "Projet : inchangé")}
          {sel(nameOpts(contracts, "Contrat : vider"), bulk.contract, (v) => setBulk({ ...bulk, contract: v }), "Contrat : inchangé")}
          {sel(VISIBILITY_SCOPES.map((o) => ({ ...o, label: `Consultation : ${o.label}` })), bulk.visibilityScope, (v) => setBulk({ ...bulk, visibilityScope: v }), "Consultation : inchangé")}
          {sel(EDIT_SCOPES.map((o) => ({ ...o, label: `Modification : ${o.label}` })), bulk.editScope, (v) => setBulk({ ...bulk, editScope: v }), "Modification : inchangé")}
          <button className="btn btn--sm" type="button" onClick={applyBulk} disabled={!selected.length}>Appliquer à {selected.length}</button>
        </div>
        {msg && <div style={{ marginBottom: 8, color: "var(--success)", fontWeight: 600 }}>{msg}</div>}
        <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
          <table className="data-table">
            <thead><tr>
              <th><input type="checkbox" checked={filteredUsers.length > 0 && filteredUsers.every((u) => selected.includes(u._id))} onChange={(e) => setSelected(e.target.checked ? filteredUsers.map((u) => u._id) : [])} /></th>
              <th>Nom</th><th>Rôle</th><th>Cellule</th><th>Projet</th><th>Contrat</th><th>Consultation</th><th>Modification</th>
            </tr></thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u._id}>
                  <td><input type="checkbox" checked={selected.includes(u._id)} onChange={() => setSelected((cur) => (cur.includes(u._id) ? cur.filter((x) => x !== u._id) : [...cur, u._id]))} /></td>
                  <td style={{ fontWeight: 600 }}>{u.name}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td>{u.cell || <span style={{ color: "var(--danger)" }}>—</span>}</td>
                  <td>{u.project || "—"}</td>
                  <td>{u.contract || "—"}</td>
                  <td style={{ fontSize: "0.8rem" }}>{VISIBILITY_SCOPES.find((o) => o.value === (u.visibilityScope || ""))?.label}</td>
                  <td style={{ fontSize: "0.8rem" }}>{EDIT_SCOPES.find((o) => o.value === (u.editScope || ""))?.label}</td>
                </tr>
              ))}
              {filteredUsers.length === 0 && <tr><td colSpan={8} style={{ color: "var(--muted)" }}>Aucun profil.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "start" }}>
        <RefList title="Projets" path="projects" fields={[{ key: "name", label: "Nom du projet" }, { key: "description", label: "Description" }]} onChanged={loadAll} />
        <RefList title="Contrats" path="contracts" fields={[{ key: "name", label: "Contrat (ex. Orange)" }, { key: "project", label: "Projet" }]} onChanged={loadAll} />
      </div>
      <RefList title="Codes de clôture" path="closure-codes" fields={[{ key: "code", label: "Code" }, { key: "label", label: "Libellé" }, { key: "contract", label: "Contrat (vide = tous)" }]} onChanged={resetClosureCodesCache} />

      {d && settings && (
        <Card title="Définitions des indicateurs" right={<button className="btn btn--sm" type="button" disabled={saving} onClick={() => save(Object.fromEntries(Object.entries(d).filter(([k]) => k !== "accessScopeEnforced")))}>Enregistrer</button>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            <label className="label">Validation des évaluations par l'agent
              <Select className="input" value={d.pilotEvaluationValidationEnabled ? "1" : "0"} onChange={(e) => setDraft({ ...d, pilotEvaluationValidationEnabled: e.target.value === "1" })}>
                <option value="1">Activée (bouton « Valider » dans l'espace agent)</option><option value="0">Désactivée</option>
              </Select>
            </label>
            <label className="label">Taux d'utilisation — dénominateur
              <Select className="input" value={d.usageDenominator} onChange={(e) => setDraft({ ...d, usageDenominator: e.target.value })}>
                <option value="enabled_users">Utilisateurs habilités (comptes actifs)</option>
                <option value="active_users">Utilisateurs actifs (connectés sur la période)</option>
                <option value="expected_users">Utilisateurs attendus (nombre saisi)</option>
              </Select>
            </label>
            <label className="label">Utilisateurs attendus
              <input className="input" type="number" min="0" value={d.usageExpectedUsers} onChange={(e) => setDraft({ ...d, usageExpectedUsers: e.target.value })} />
            </label>
            <div><div className="label">Rôles comptés dans l'utilisation</div><MultiSelect options={ROLE_OPTS} value={d.usageRoles || []} onChange={(v) => setDraft({ ...d, usageRoles: v })} /></div>
            <label className="label">Réalisation des coachings — lecture principale
              <Select className="input" value={d.coachingTargetMode} onChange={(e) => setDraft({ ...d, coachingTargetMode: e.target.value })}>
                <option value="annual_target">Taux d'atteinte d'un objectif annuel</option>
                <option value="monthly_average">Moyenne mensuelle sur la période</option>
                <option value="rolling_12">Moyenne sur les 12 derniers mois (÷ 12)</option>
              </Select>
            </label>
            <label className="label">Objectif annuel de coachings
              <input className="input" type="number" min="0" value={d.coachingAnnualTarget} onChange={(e) => setDraft({ ...d, coachingAnnualTarget: e.target.value })} />
            </label>
            <label className="label">Objectif exprimé
              <Select className="input" value={d.coachingTargetPerAgent ? "1" : "0"} onChange={(e) => setDraft({ ...d, coachingTargetPerAgent: e.target.value === "1" })}>
                <option value="1">Par agent</option><option value="0">Global (périmètre)</option>
              </Select>
            </label>
            <label className="label">Un coaching est « réalisé » quand
              <Select className="input" value={d.coachingDoneDefinition} onChange={(e) => setDraft({ ...d, coachingDoneDefinition: e.target.value })}>
                <option value="created">il est enregistré</option><option value="status_done">son statut est « clôturé »</option><option value="acknowledged">l'agent l'a validé</option>
              </Select>
            </label>
            <label className="label">Évaluations attendues par agent et par mois (défaut)
              <input className="input" type="number" min="0" value={d.evaluationTargetPerAgentPerMonth} onChange={(e) => setDraft({ ...d, evaluationTargetPerAgentPerMonth: e.target.value })} />
            </label>
            <div><div className="label">Échantillons « en attente ou standby » = statuts</div><MultiSelect options={SAMPLE_OPTS} value={d.sampleWaitingStatuses || []} onChange={(v) => setDraft({ ...d, sampleWaitingStatuses: v })} /></div>
          </div>
        </Card>
      )}

      <Card title="Objectifs mensuels d'évaluations (par agent, mois d'appel)">
        <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 8 }}>
          Priorité : cellule &gt; contrat &gt; projet &gt; global (tout vide) &gt; valeur par défaut ci-dessus. Volume attendu = objectif × agents actifs.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr)) auto", gap: 8, marginBottom: 10 }}>
          <input className="input" type="month" value={tForm.month} onChange={(e) => setTForm({ ...tForm, month: e.target.value })} />
          {sel([{ value: "", label: "Toutes cellules" }, ...cells.map((c) => ({ value: c.name, label: c.name }))], tForm.cell, (v) => setTForm({ ...tForm, cell: v }))}
          {sel(nameOpts(contracts, "Tous contrats"), tForm.contract, (v) => setTForm({ ...tForm, contract: v }))}
          {sel(nameOpts(projects, "Tous projets"), tForm.project, (v) => setTForm({ ...tForm, project: v }))}
          <input className="input" type="number" min="0" placeholder="Objectif / agent" value={tForm.target} onChange={(e) => setTForm({ ...tForm, target: e.target.value })} />
          <button className="btn btn--sm" type="button" onClick={saveTarget} disabled={!tForm.month || tForm.target === ""}>Enregistrer</button>
        </div>
        <table className="data-table">
          <thead><tr><th>Mois</th><th>Cellule</th><th>Contrat</th><th>Projet</th><th>Objectif / agent</th><th></th></tr></thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t._id}><td>{t.month}</td><td>{t.cell || "Toutes"}</td><td>{t.contract || "Tous"}</td><td>{t.project || "Tous"}</td><td>{t.target}</td>
                <td><button className="btn btn--ghost btn--sm" type="button" onClick={() => deleteTarget(t._id)}>Supprimer</button></td></tr>
            ))}
            {targets.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>Aucun objectif : la valeur par défaut s'applique.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
