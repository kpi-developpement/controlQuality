import React, { useEffect, useState } from "react";
import Ico from "../../ui/Ico.jsx";
import api from "../../api";
import Select from "../../ui/Select.jsx";
const empty = { title: "", url: "", pageName: "" };
export default function PowerBIView() {
  const [reports, setReports] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [frameKey, setFrameKey] = useState(0);
  const selected = reports.find((r) => r._id === selectedId);
  useEffect(() => {
    let active = true;
    api.get("/powerbi").then(({ data }) => { if (active) { setReports(data); setSelectedId(data[0]?._id || ""); } })
      .catch(() => { if (active) setError("Impossible de charger les rapports."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const { data } = editId ? await api.put(`/powerbi/${editId}`, form) : await api.post("/powerbi", form);
      setReports((rs) => editId ? rs.map((r) => r._id === editId ? data : r) : [...rs, data]);
      setSelectedId(data._id); setEditId(""); setForm(empty); setFrameKey((k) => k + 1);
    } catch (e) { setError(e.response?.data?.message || "Enregistrement impossible."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !window.confirm(`Supprimer « ${selected.title} » de l’application ?`)) return;
    setBusy(true); setError("");
    try {
      await api.delete(`/powerbi/${selected._id}`);
      const remaining = reports.filter((r) => r._id !== selected._id);
      setReports(remaining); setSelectedId(remaining[0]?._id || ""); setEditId(""); setForm(empty);
    } catch (e) { setError(e.response?.data?.message || "Suppression impossible."); }
    finally { setBusy(false); }
  }
  return <div className="page">
    <div className="page-head"><div><div className="page-title"><Ico n="chart" /> Power BI</div><div>Ajoutez vos rapports et choisissez la page à afficher dans l’application. Accès réservé aux administrateurs.</div></div></div>
    {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    <form onSubmit={save} className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h3>{editId ? "Modifier le rapport" : "Ajouter un rapport"}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <label>Titre<input className="input" required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>Lien d’intégration Power BI<input className="input" type="url" required maxLength={6000} placeholder="https://app.powerbi.com/reportEmbed?reportId=…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
        <label>Page à ouvrir (facultatif)<input className="input" maxLength={200} placeholder="Identifiant pageName, ex. ReportSection…" value={form.pageName} onChange={(e) => setForm({ ...form, pageName: e.target.value })} /></label>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>Dans Power BI : Fichier → Incorporer le rapport → Site web ou portail. Copiez le lien, puis l’identifiant pageName de la page souhaitée. Les droits Microsoft restent nécessaires pour les rapports privés. Un lien « Publier sur le web » rend le rapport public.</p>
      <button className="btn" disabled={busy || loading}>{busy ? "Enregistrement…" : "Enregistrer et afficher"}</button>
      {editId && <button type="button" className="btn btn--ghost" onClick={() => { setEditId(""); setForm(empty); }}>Annuler</button>}
    </form>
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ flex: 1 }}>Rapport affiché<Select aria-label="Rapport affiché" className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={loading || busy}>
          <option value="">{loading ? "Chargement…" : "Choisir un rapport"}</option>
          {reports.map((r) => <option key={r._id} value={r._id}>{r.title}{r.pageName ? ` — ${r.pageName}` : ""}</option>)}
        </Select></label>
        {selected && <>
          <button className="btn btn--ghost" disabled={busy} onClick={() => { setEditId(selected._id); setForm({ title: selected.title, url: selected.url, pageName: selected.pageName || "" }); }}>Modifier</button>
          <button className="btn btn--ghost" onClick={() => setFrameKey((k) => k + 1)}>Recharger</button>
          <a className="btn btn--ghost" href={selected.url} target="_blank" rel="noopener noreferrer">Ouvrir dans Power BI</a>
          <button className="btn btn--ghost" disabled={busy} onClick={remove}>Supprimer</button>
        </>}
      </div>
      {selected ? <>
        <iframe key={`${selected._id}-${frameKey}`} title={selected.title} src={selected.url} allowFullScreen style={{ width: "100%", height: "75vh", minHeight: 500, border: 0 }} />
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Si une connexion Microsoft est demandée, utilisez « Ouvrir dans Power BI », connectez-vous puis rechargez le rapport.</p>
      </> : <p>Aucun rapport sélectionné.</p>}
    </div>
  </div>;
}
