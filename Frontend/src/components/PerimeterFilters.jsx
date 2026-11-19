import React, { useEffect, useState } from "react";
import api from "../api";
import Select from "../ui/Select.jsx";

/**
 * Filtres de périmètre (contrat Orange) : cellule, contrat, projet.
 * Les listes proviennent des référentiels ; le serveur applique de toute façon le périmètre
 * autorisé de l'utilisateur (un filtre hors périmètre renvoie simplement zéro résultat).
 */
export default function PerimeterFilters({ value, onChange }) {
  const [cells, setCells] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [projects, setProjects] = useState([]);
  useEffect(() => {
    let m = true;
    api.get("/admin/cells").then((r) => m && setCells(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    api.get("/referentials/contracts", { params: { active: "true" } }).then((r) => m && setContracts(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    api.get("/referentials/projects", { params: { active: "true" } }).then((r) => m && setProjects(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    return () => { m = false; };
  }, []);
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <label className="label">Cellule
        <Select className="input" value={value.cell || ""} onChange={set("cell")}>
          <option value="">Toutes (selon vos droits)</option>
          {cells.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
        </Select>
      </label>
      <label className="label">Contrat
        <Select className="input" value={value.contract || ""} onChange={set("contract")}>
          <option value="">Tous</option>
          {contracts.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
        </Select>
      </label>
      <label className="label">Projet
        <Select className="input" value={value.project || ""} onChange={set("project")}>
          <option value="">Tous</option>
          {projects.map((p) => <option key={p._id} value={p.name}>{p.name}</option>)}
        </Select>
      </label>
    </>
  );
}

export function perimeterParams(v) {
  const out = {};
  for (const k of ["cell", "contract", "project"]) if (v && v[k]) out[k] = v[k];
  return out;
}
