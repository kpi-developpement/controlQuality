import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import Ico from "../../ui/Ico.jsx";
import Select from "../../ui/Select.jsx";

const genPassword = () => {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  const arr = new Uint32Array(10);
  (window.crypto || {}).getRandomValues?.(arr);
  for (let i = 0; i < 10; i++) s += chars[(arr[i] || Math.floor(Math.random() * 1e9)) % chars.length];
  return `${s}!7`;
};

function TrainingPicker({ trainings, value, onChange }) {
  if (!trainings.length) return <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Aucune formation active.</div>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {trainings.map((t) => {
        const on = value.includes(t._id);
        return (
          <label key={t._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, border: `1px solid ${on ? "var(--primary-border)" : "var(--border)"}`, background: on ? "var(--primary-bg)" : "var(--panel)", transition: "all 200ms" }}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== t._id) : [...value, t._id])} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 650, color: "var(--text)" }}>{t.title}</span>
              <span style={{ display: "block", fontSize: "0.76rem", color: "var(--muted)", fontWeight: 500 }}>{t.category || "Formation"}{(t.questions || []).length ? ` · quiz ${(t.questions || []).length} Q` : ""}{t.dueDate ? ` · échéance ${new Date(t.dueDate).toLocaleDateString("fr-FR")}` : ""}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Formateur : crée un nouveau pilote et l'affecte à des formations ; affecte des pilotes existants. */
export default function PilotOnboardingPage() {
  const [cells, setCells] = useState([]);
  const [users, setUsers] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", password: genPassword(), cell: "", referent: "", trainingIds: [] });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [assign, setAssign] = useState({ pilot: "", trainingIds: [] });
  const [assignMsg, setAssignMsg] = useState("");

  async function load() {
    const [c, u, t] = await Promise.all([
      api.get("/admin/cells").catch(() => ({ data: [] })),
      api.get("/admin/users").catch(() => ({ data: [] })),
      api.get("/training/admin").catch(() => ({ data: [] })),
    ]);
    setCells((c.data || []).filter((x) => x.active !== false));
    setUsers(Array.isArray(u.data) ? u.data : []);
    setTrainings(Array.isArray(t.data) ? t.data : []);
  }
  useEffect(() => { load(); }, []);

  const pilots = useMemo(() => users.filter((u) => u.role === "pilote" && u.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [users]);
  const referents = useMemo(() => users.filter((u) => u.role === "referent" && u.active !== false), [users]);
  const cellObj = cells.find((c) => c.name === form.cell);
  const refsForCell = referents.filter((r) => !form.cell || !r.cell || r.cell === form.cell);

  async function submit(e) {
    e.preventDefault();
    setError(""); setCreated(null);
    if (!form.name.trim() || !form.email.trim()) { setError("Le nom et l'email sont obligatoires."); return; }
    setSaving(true);
    try {
      const res = await api.post("/admin/pilots", {
        ...form,
        project: cellObj?.project || "",
        contract: cellObj?.contract || "",
      });
      setCreated({ ...res.data, password: form.password });
      setForm({ name: "", email: "", password: genPassword(), cell: form.cell, referent: form.referent, trainingIds: [] });
      load();
    } catch (err) {
      setError(err?.response?.data?.message || "Création impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function submitAssign() {
    setAssignMsg("");
    if (!assign.pilot || !assign.trainingIds.length) { setAssignMsg("Choisissez un pilote et au moins une formation."); return; }
    try {
      await api.post(`/admin/pilots/${assign.pilot}/trainings`, { trainingIds: assign.trainingIds });
      setAssign({ pilot: "", trainingIds: [] });
      setAssignMsg("ok");
    } catch (err) {
      setAssignMsg(err?.response?.data?.message || "Affectation impossible.");
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="page">
      <div style={{ marginBottom: 18 }}>
        <div className="page-title"><Ico n="user" /> Pilotes &amp; formations</div>
        <div>Créez un nouveau pilote et inscrivez-le directement à ses formations.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <form className="card" style={{ padding: 18 }} onSubmit={submit}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 14 }}>Nouveau pilote</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="label">Nom complet<input className="input" value={form.name} onChange={set("name")} placeholder="Prénom Nom" required /></label>
            <label className="label">Email<input className="input" type="email" value={form.email} onChange={set("email")} placeholder="prenom.nom@kyntus.com" required /></label>
            <label className="label">Cellule
              <Select className="input" value={form.cell} onChange={(e) => setForm((f) => ({ ...f, cell: e.target.value, referent: "" }))}>
                <option value="">Choisir une cellule</option>
                {cells.map((c) => <option key={c._id} value={c.name}>{c.name}{c.project ? ` — ${c.project}` : ""}</option>)}
              </Select>
            </label>
            <label className="label">Référent technique
              <Select className="input" value={form.referent} onChange={set("referent")}>
                <option value="">Aucun pour l'instant</option>
                {refsForCell.map((r) => <option key={r._id} value={r._id}>{r.name}{r.cell ? ` — ${r.cell}` : ""}</option>)}
              </Select>
            </label>
            <label className="label" style={{ gridColumn: "1 / -1" }}>Mot de passe provisoire
              <span style={{ display: "flex", gap: 8 }}>
                <input className="input" value={form.password} onChange={set("password")} style={{ fontFamily: "var(--font-mono)" }} minLength={6} required />
                <button type="button" className="btn btn--ghost" onClick={() => setForm((f) => ({ ...f, password: genPassword() }))} title="Générer"><Ico n="refresh" /></button>
              </span>
            </label>
          </div>

          <div className="label" style={{ marginTop: 16, marginBottom: 8 }}>Formations à suivre</div>
          <TrainingPicker trainings={trainings} value={form.trainingIds} onChange={(ids) => setForm((f) => ({ ...f, trainingIds: ids }))} />

          {error && <div role="alert" style={{ marginTop: 12, color: "var(--danger)", fontWeight: 600, fontSize: "0.85rem" }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn" type="submit" disabled={saving}><Ico n="plus" /> {saving ? "Création…" : "Créer le pilote"}</button>
          </div>

          {created && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 14, background: "var(--success-bg)", border: "1px solid color-mix(in srgb, var(--success) 25%, transparent)", animation: "slideUp 300ms" }}>
              <div style={{ fontWeight: 700, color: "var(--success)", display: "flex", alignItems: "center", gap: 8 }}><Ico n="checkCircle" /> Pilote créé : {created.name}</div>
              <div style={{ marginTop: 6, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Identifiant <b>{created.email}</b> · mot de passe provisoire <code style={{ fontFamily: "var(--font-mono)" }}>{created.password}</code>
                {created.assignedTrainings ? ` · inscrit à ${created.assignedTrainings} formation${created.assignedTrainings > 1 ? "s" : ""}` : ""}
              </div>
            </div>
          )}
        </form>

        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 14 }}>Inscrire un pilote existant</div>
          <label className="label">Pilote
            <Select className="input" value={assign.pilot} onChange={(e) => setAssign((a) => ({ ...a, pilot: e.target.value }))}>
              <option value="">Choisir un pilote</option>
              {pilots.map((p) => <option key={p._id} value={p._id}>{p.name}{p.cell ? ` — ${p.cell}` : ""}</option>)}
            </Select>
          </label>
          <div className="label" style={{ marginTop: 14, marginBottom: 8 }}>Formations</div>
          <TrainingPicker trainings={trainings} value={assign.trainingIds} onChange={(ids) => setAssign((a) => ({ ...a, trainingIds: ids }))} />
          {assignMsg && assignMsg !== "ok" && <div role="alert" style={{ marginTop: 10, color: "var(--danger)", fontSize: "0.85rem", fontWeight: 600 }}>{assignMsg}</div>}
          {assignMsg === "ok" && <div style={{ marginTop: 10, color: "var(--success)", fontSize: "0.85rem", fontWeight: 600 }}><Ico n="check" /> Inscription enregistrée.</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={submitAssign}><Ico n="book" /> Inscrire</button>
          </div>
        </div>
      </div>
    </div>
  );
}
