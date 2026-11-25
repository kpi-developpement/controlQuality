import React, { useMemo, useState } from "react";
import Ico from "../../ui/Ico.jsx";
import { gridAppliesToCell, isClassified, gridContracts, gridActivities } from "../../utils/gridScope.js";

const USAGE_LABELS = { evaluation: "Évaluation", calibration: "Calibrage", sample: "Échantillons", all: "Tous usages" };
const NO_ACTIVITY = "__none";
const UNCLASSIFIED = "__unclassified";

/**
 * Navigation des grilles par cartes : Contrat → Activité → Cellule → grilles correspondantes.
 * path = { contract, activity, cell } (chaînes vides = niveau non choisi).
 */
export default function GridBrowser({ grids, contracts, activities, cells, path, onPath, onEdit, onDelete, canDelete, onCreate }) {
  const [q, setQ] = useState("");

  const cellsOf = (contract, activity) => cells.filter((c) => (c.contract || "") === contract && (activity === undefined || (activity === NO_ACTIVITY ? !c.activity : c.activity === activity)));
  const gridsInContract = (name) => grids.filter((g) => gridContracts(g).includes(name) || cellsOf(name).some((c) => gridAppliesToCell(g, c)));
  const gridsInActivity = (contract, activity) => grids.filter((g) => {
    const ctrs = gridContracts(g);
    return (activity !== NO_ACTIVITY && gridActivities(g).includes(activity) && (!ctrs.length || ctrs.includes(contract))) || cellsOf(contract, activity).some((c) => gridAppliesToCell(g, c));
  });
  const unclassified = useMemo(() => grids.filter((g) => !isClassified(g)), [grids]);

  const contractNames = useMemo(() => {
    const names = new Set(contracts.filter((c) => c.active !== false).map((c) => c.name));
    cells.forEach((c) => c.contract && names.add(c.contract));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [contracts, cells]);

  // Niveau courant
  let level = "contract";
  if (path.contract === UNCLASSIFIED) level = "list";
  else if (path.cell) level = "list";
  else if (path.activity) level = "cell";
  else if (path.contract) level = "activity";

  const crumbs = [{ label: "Contrats", to: { contract: "", activity: "", cell: "" } }];
  if (path.contract) crumbs.push({ label: path.contract === UNCLASSIFIED ? "Grilles non classées" : path.contract, to: { contract: path.contract, activity: "", cell: "" } });
  if (path.activity) crumbs.push({ label: path.activity === NO_ACTIVITY ? "Sans activité" : path.activity, to: { ...path, cell: "" } });
  if (path.cell) crumbs.push({ label: path.cell, to: path });

  const search = q.trim().toLowerCase();
  const searchResults = search ? grids.filter((g) => `${g.name} ${g.description || ""} ${gridContracts(g).join(" ")} ${gridActivities(g).join(" ")} ${(g.cells || []).join(" ")}`.toLowerCase().includes(search)) : null;

  let listGrids = [];
  let listTitle = "";
  if (level === "list") {
    if (path.contract === UNCLASSIFIED) { listGrids = unclassified; listTitle = "Grilles non classées"; }
    else {
      const cell = cells.find((c) => c.name === path.cell);
      listGrids = grids.filter((g) => gridAppliesToCell(g, cell));
      listTitle = `Grilles de la cellule ${path.cell}`;
    }
  }

  const card = (key, title, sub, count, onClick, icon = "folder", tone = "") => (
    <button key={key} type="button" className={`drill-card ${tone}`} onClick={onClick}>
      <span className="drill-card__icon"><Ico n={icon} size={20} /></span>
      <span className="drill-card__body">
        <span className="drill-card__title">{title}</span>
        {sub && <span className="drill-card__sub">{sub}</span>}
      </span>
      <span className="drill-card__count">{count} grille{count > 1 ? "s" : ""}</span>
      <Ico n="chevR" className="drill-card__chev" />
    </button>
  );

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="drill-head">
        <nav className="crumbs" aria-label="Fil d'Ariane">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Ico n="chevR" className="crumbs__sep" />}
              {i < crumbs.length - 1 ? <button type="button" className="crumbs__link" onClick={() => onPath(c.to)}>{c.label}</button> : <span className="crumbs__here">{c.label}</span>}
            </React.Fragment>
          ))}
        </nav>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input" placeholder="Rechercher une grille…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <button type="button" className="btn" onClick={onCreate}><Ico n="plus" /> Créer une grille</button>
        </div>
      </div>

      {searchResults ? (
        <GridList title={`Résultats pour « ${q.trim()} »`} grids={searchResults} onEdit={onEdit} onDelete={onDelete} canDelete={canDelete} />
      ) : level === "contract" ? (
        <div className="drill-grid">
          {contractNames.map((name) => card(name, name, `${cellsOf(name).length} cellule${cellsOf(name).length > 1 ? "s" : ""}`, gridsInContract(name).length, () => onPath({ contract: name, activity: "", cell: "" }), "building"))}
          {unclassified.length > 0 && card(UNCLASSIFIED, "Grilles non classées", "À ranger par contrat / activité / cellule", unclassified.length, () => onPath({ contract: UNCLASSIFIED, activity: "", cell: "" }), "inbox", "drill-card--muted")}
        </div>
      ) : level === "activity" ? (
        <div className="drill-grid">
          {activities.filter((a) => a.contract === path.contract && a.active !== false).map((a) => card(a._id || a.name, a.name, `${cellsOf(path.contract, a.name).length} cellule(s)`, gridsInActivity(path.contract, a.name).length, () => onPath({ ...path, activity: a.name, cell: "" }), "layers"))}
          {cellsOf(path.contract, NO_ACTIVITY).length > 0 && card(NO_ACTIVITY, "Sans activité", "Cellules à rattacher à une activité", gridsInActivity(path.contract, NO_ACTIVITY).length, () => onPath({ ...path, activity: NO_ACTIVITY, cell: "" }), "inbox", "drill-card--muted")}
          {!activities.some((a) => a.contract === path.contract) && !cellsOf(path.contract).length && <p className="muted">Aucune activité définie pour {path.contract}. Ajoutez-en dans Paramètres qualité → Activités.</p>}
        </div>
      ) : level === "cell" ? (
        <div className="drill-grid">
          {cellsOf(path.contract, path.activity).map((c) => card(c._id || c.name, c.name, c.active === false ? "Inactive" : "", grids.filter((g) => gridAppliesToCell(g, c)).length, () => onPath({ ...path, cell: c.name }), "users"))}
          {!cellsOf(path.contract, path.activity).length && <p className="muted">Aucune cellule rattachée à cette activité (Panneau Admin → Structures).</p>}
        </div>
      ) : (
        <GridList title={listTitle} grids={listGrids} onEdit={onEdit} onDelete={onDelete} canDelete={canDelete} />
      )}
    </div>
  );
}

function GridList({ title, grids, onEdit, onDelete, canDelete }) {
  return (
    <div>
      <div className="drill-list__title">{title} <span className="badge badge--muted">{grids.length}</span></div>
      <div className="grid-rows">
        {grids.map((g) => {
          const items = (g.items || []).filter((i) => i.type === "item").length;
          const acts = gridActivities(g), ctrs = gridContracts(g);
          const place = g.cells?.length ? g.cells.join(", ") : acts.length ? `Activités : ${acts.join(", ")}` : ctrs.length ? `Contrats : ${ctrs.join(", ")}` : "Non classée";
          return (
            <div key={g._id} className="grid-row">
              <div style={{ minWidth: 0 }}>
                <div className="grid-row__name">
                  {g.name}
                  <span className="badge badge--muted">{USAGE_LABELS[g.usage || "evaluation"]}{g.callDirection === "inbound" ? " • entrant" : g.callDirection === "outbound" ? " • sortant" : ""}</span>
                  {g.active === false && <span className="badge badge--warning">Inactive</span>}
                </div>
                <div className="grid-row__desc">{g.description || "—"}</div>
                <div className="grid-row__meta"><Ico n="mapPin" /> {place} · {items} critère{items > 1 ? "s" : ""}</div>
              </div>
              <div className="grid-row__actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit(g)}><Ico n="pencil" /> Modifier</button>
                {canDelete && <button type="button" className="btn btn-danger btn--sm" onClick={() => onDelete(g)}><Ico n="trash" /> Supprimer</button>}
              </div>
            </div>
          );
        })}
        {!grids.length && <p className="muted">Aucune grille ici. Utilisez « Créer une grille » pour en ajouter une à cet emplacement.</p>}
      </div>
    </div>
  );
}

export { NO_ACTIVITY, UNCLASSIFIED };
