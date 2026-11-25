import React, { useEffect, useMemo, useState } from "react";
import axios from "../../api";
import Card from "./components/Card.jsx";
import Ico from "../../ui/Ico.jsx";
import Select from "../../ui/Select.jsx";
import GridBrowser, { NO_ACTIVITY, UNCLASSIFIED } from "./GridBrowser.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import { gridContracts, gridActivities } from "../../utils/gridScope.js";
import { useToast } from "../../toast/ToastProvider.jsx";
const USAGE_LABELS = { evaluation: "Évaluation", calibration: "Calibrage", sample: "Échantillons", all: "Tous usages" };

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Helpers: flat items with group markers
const ensureIds = (items) =>
  (Array.isArray(items) ? items : []).map((it, idx) => ({
    ...it,
    _localId: it._localId || it._id || `${idx}-${uid()}`,
  }));

const isGroup = (it) => it?.type === "group";
const isItem = (it) => it?.type === "item";

export default function GridsView() {
  const isAdminUser = (() => { try { return ["admin", "management"].includes(JSON.parse(localStorage.getItem("user") || "{}").role); } catch { return false; } })();
  const toast = useToast();
  const [grids, setGrids] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [path, setPath] = useState({ contract: "", activity: "", cell: "" });
  const [refs, setRefs] = useState({ contracts: [], activities: [], cells: [] });
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [editorGrid, setEditorGrid] = useState(null); // { _id, name, description, active, rolesAllowed, items: [] }
  const [collapsed, setCollapsed] = useState({}); // groupLocalId -> bool

  const load = async () => {
    const r = await axios.get("/admin/grids");
    const list = Array.isArray(r.data) ? r.data : [];
    setGrids(list);
  };
  const loadRefs = async () => {
    const [contracts, activities, cells] = await Promise.all([
      axios.get("/referentials/contracts").then((r) => r.data).catch(() => []),
      axios.get("/referentials/activities").then((r) => r.data).catch(() => []),
      axios.get("/admin/cells").then((r) => r.data).catch(() => []),
    ]);
    setRefs({ contracts: contracts || [], activities: activities || [], cells: Array.isArray(cells) ? cells : [] });
  };

  useEffect(() => { load(); loadRefs(); }, []);

  useEffect(() => {
    const g = grids.find((x) => x._id === selectedId);
    if (!g) { setEditorGrid(null); return; }
    setEditorGrid({
      ...g,
      gridType: (g.gridType || "classic"),
      usage: g.usage || "evaluation",
      callDirection: g.callDirection || "",
      contracts: gridContracts(g),
      activities: gridActivities(g),
      cells: Array.isArray(g.cells) ? g.cells : [],
      rolesAllowed: Array.isArray(g.rolesAllowed) ? g.rolesAllowed : (g.role ? [g.role] : ["cq", "management"]),
      items: ensureIds(g.items || []),
    });
  }, [selectedId, grids]);

  const selectedGrid = useMemo(() => grids.find((g) => g._id === selectedId), [grids, selectedId]);

  const createGrid = async () => {
    const payload = {
      name: "Nouvelle grille",
      gridType: "classic",
      description: "",
      active: true,
      rolesAllowed: ["cq", "management"],
      // Pré-rangement selon l'emplacement courant (Contrat → Activité → Cellule)
      contracts: path.contract && path.contract !== UNCLASSIFIED ? [path.contract] : [],
      activities: path.activity && path.activity !== NO_ACTIVITY ? [path.activity] : [],
      cells: path.cell ? [path.cell] : [],
      items: [
        { type: "group", title: "Phase 1", hardFail: false, malusPercent: 0 },
        { type: "item", label: "Critère 1", pointsConforme: 1, pointsNonConforme: 0, malusPercent: 0 },
      ],
    };
    const r = await axios.post("/admin/grids", payload);
    await load();
    setSelectedId(r.data?._id || null);
  };

  const deleteGrid = async () => {
    if (!toDelete?._id) return;
    setDeleting(true);
    try {
      await axios.delete(`/admin/grids/${toDelete._id}`, { toast: false });
      toast.success(`Grille « ${toDelete.name} » supprimée.`);
      if (toDelete._id === selectedId) setSelectedId(null);
      setToDelete(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Suppression impossible.");
    } finally { setDeleting(false); }
  };

  const saveGridInfo = async () => {
    if (!editorGrid?._id) return;
    await axios.patch(`/admin/grids/${editorGrid._id}`, {
      name: editorGrid.name,
      description: editorGrid.description,
      active: editorGrid.active,
      rolesAllowed: editorGrid.rolesAllowed,
      gridType: editorGrid.gridType,
      // Contrat Orange : usage (évaluation / calibrage / échantillons) et sens d'appel
      usage: editorGrid.usage || "evaluation",
      callDirection: editorGrid.callDirection || "",
      contracts: editorGrid.contracts || [],
      activities: editorGrid.activities || [],
      cells: editorGrid.cells || [],
    }, { toast: false });
    await load();
    toast.success("Informations de la grille enregistrées.");
  };

  const saveGridItems = async () => {
    if (!editorGrid?._id) return;
    const itemsToSave = (editorGrid.items || []).map(({ _localId, ...rest }, idx) => ({ ...rest, order: idx }));
    await axios.patch(`/admin/grids/${editorGrid._id}/items`, { items: itemsToSave }, { toast: false });
    await load();
    toast.success("Critères de la grille enregistrés.");
  };

  // ---------- Editor operations ----------
  const items = editorGrid?.items || [];

  const addPhase = () => {
    const next = [
      ...items,
      { type: "group", title: `Phase ${countGroups(items) + 1}`, hardFail: false, malusPercent: 0, _localId: uid() },
      { type: "item", label: "Critère", pointsConforme: 1, pointsNonConforme: 0, malusPercent: 0, _localId: uid() },
    ];
    setEditorGrid({ ...editorGrid, items: next });
  };

  const addItemAfterGroup = (groupLocalId) => {
    const idx = items.findIndex((x) => x._localId === groupLocalId);
    if (idx < 0) return;
    // insert after group's last item (until next group)
    let insertAt = idx + 1;
    while (insertAt < items.length && !isGroup(items[insertAt])) insertAt++;
    const next = [...items.slice(0, insertAt), { type: "item", label: "Critère", pointsConforme: 1, pointsNonConforme: 0, malusPercent: 0, _localId: uid() }, ...items.slice(insertAt)];
    setEditorGrid({ ...editorGrid, items: next });
  };

  const updateItem = (localId, patch) => {
    const next = items.map((x) => (x._localId === localId ? { ...x, ...patch } : x));
    setEditorGrid({ ...editorGrid, items: next });
  };

  const removeById = (localId) => {
    const next = items.filter((x) => x._localId !== localId);
    setEditorGrid({ ...editorGrid, items: next });
  };

  const duplicatePhase = (groupLocalId) => {
    const idx = items.findIndex((x) => x._localId === groupLocalId);
    if (idx < 0) return;
    const group = items[idx];
    let j = idx + 1;
    while (j < items.length && !isGroup(items[j])) j++;
    const phaseItems = items.slice(idx, j);
    const copied = phaseItems.map((it) => ({
      ...it,
      _localId: uid(),
      ...(isGroup(it) ? { title: `${it.title} (copie)` } : {}),
    }));
    const next = [...items.slice(0, j), ...copied, ...items.slice(j)];
    setEditorGrid({ ...editorGrid, items: next });
  };

  const duplicateItem = (localId) => {
    const idx = items.findIndex((x) => x._localId === localId);
    if (idx < 0) return;
    const it = items[idx];
    const copied = { ...it, _localId: uid(), label: `${it.label} (copie)` };
    const next = [...items.slice(0, idx + 1), copied, ...items.slice(idx + 1)];
    setEditorGrid({ ...editorGrid, items: next });
  };

  // ---------- Drag & Drop (HTML5) ----------
  const [drag, setDrag] = useState(null); // { type: 'group'|'item', id: localId }

  const onDragStart = (it) => (e) => {
    setDrag({ type: it.type, id: it._localId });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", it._localId);
  };

  const onDropOn = (targetIt) => (e) => {
    e.preventDefault();
    if (!drag) return;

    const srcId = drag.id;
    const dstId = targetIt._localId;
    if (srcId === dstId) return;

    const next = reorder(items, drag.type, srcId, dstId, targetIt.type);
    setEditorGrid({ ...editorGrid, items: next });
    setDrag(null);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  // Editor layout: list (top) + editor full width bottom
  // Pending grids approval
  const [pendingGrids, setPendingGrids] = useState([]);
  const loadPending = async () => {
    let role = "";
    try { role = JSON.parse(localStorage.getItem("user") || "{}").role || ""; } catch { /* ignore */ }
    if (role !== "admin") { setPendingGrids([]); return; } // validation des propositions : admin uniquement
    try {
      const r = await axios.get("/grids/pending");
      setPendingGrids(Array.isArray(r.data) ? r.data : []);
    } catch { setPendingGrids([]); }
  };
  useEffect(() => { loadPending(); }, []);

  const approveGrid = async (id) => {
    try {
      await axios.post(`/grids/${id}/approve`);
      loadPending();
      load();
    } catch (e) { alert(e?.response?.data?.message || "Erreur approbation."); }
  };
  const rejectGrid = async (id) => {
    if (!window.confirm("Rejeter cette grille ? Elle sera supprimée.")) return;
    try {
      await axios.post(`/grids/${id}/reject`);
      loadPending();
    } catch (e) { alert(e?.response?.data?.message || "Erreur rejet."); }
  };

  return (
    <>
      {/* Pending approval */}
      {pendingGrids.length > 0 && (
        <Card title={`Grilles en attente de validation (${pendingGrids.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pendingGrids.map((g) => {
              const itemCount = (g.items || []).filter((i) => i.type === "item").length;
              const groupCount = (g.items || []).filter((i) => i.type === "group").length;
              return (
                <div key={g._id} style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(217,119,6,0.25)", background: "var(--warning-bg)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{g.name}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 2 }}>
                      {g.gridType === "presence" ? "Présence" : "Classique"} • {groupCount} phase{groupCount > 1 ? "s" : ""} • {itemCount} critère{itemCount > 1 ? "s" : ""} • Proposée le {new Date(g.createdAt).toLocaleDateString("fr-FR")}
                    </div>
                    {g.description && <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2, fontStyle: "italic" }}>{g.description.slice(0, 120)}</div>}
                    {/* Show items preview */}
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(g.items || []).slice(0, 12).map((it, idx) => (
                        <span key={idx} className={`badge ${it.type === "group" ? "badge--primary" : "badge--muted"}`} style={{ fontSize: "0.68rem" }}>
                          {it.type === "group" ? <><Ico n="folder" /> {it.title}</> : it.label}
                        </span>
                      ))}
                      {(g.items || []).length > 12 && <span className="badge badge--muted" style={{ fontSize: "0.68rem" }}>+{g.items.length - 12}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                    <button className="btn btn--sm" onClick={() => approveGrid(g._id)}><Ico n="check" /> Approuver</button>
                    <button className="btn btn--ghost btn--sm" style={{ color: "var(--danger)" }} onClick={() => rejectGrid(g._id)}><Ico n="x" /> Rejeter</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {!editorGrid && (
        <GridBrowser
          grids={grids}
          contracts={refs.contracts}
          activities={refs.activities}
          cells={refs.cells}
          path={path}
          onPath={setPath}
          onEdit={(g) => { setSelectedId(g._id); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onDelete={(g) => setToDelete(g)}
          canDelete={isAdminUser}
          onCreate={createGrid}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        danger
        title="Supprimer la grille ?"
        message={<>Voulez-vous vraiment supprimer la grille <b>{toDelete?.name}</b> ? Elle ne sera plus proposée pour de nouvelles évaluations ; les évaluations déjà réalisées la conservent.</>}
        confirmLabel="Oui, supprimer"
        busy={deleting}
        onConfirm={deleteGrid}
        onCancel={() => setToDelete(null)}
      />

      {/* Full width editor at bottom */}
      {editorGrid && (
        <Card
          title={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelectedId(null)}><Ico n="arrowL" /> Retour aux grilles</button> Modifier : {editorGrid.name}</span>}
          right={
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn-outline" onClick={saveGridInfo}>Sauver infos</button>
              <button className="btn-outline" onClick={saveGridItems}>Sauver items</button>
            </div>
          }
          style={{ width: "100%" }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <input
              value={editorGrid.name || ""}
              onChange={(e) => setEditorGrid({ ...editorGrid, name: e.target.value })}
              placeholder="Titre de la grille"
              style={inputStyle()}
            />
            <input
              value={editorGrid.description || ""}
              onChange={(e) => setEditorGrid({ ...editorGrid, description: e.target.value })}
              placeholder="Description"
              style={inputStyle()}
            />
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={editorGrid.active !== false}
                onChange={(e) => setEditorGrid({ ...editorGrid, active: e.target.checked })}
              />
              Grille active
            </label>


<label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
  <span style={{ opacity: 0.85, fontWeight: 800 }}>Type de grille:</span>
  <Select
    value={editorGrid.gridType || "classic"}
    onChange={(e) => setEditorGrid({ ...editorGrid, gridType: e.target.value })}
    style={{ ...inputStyle(), maxWidth: 220 }}
  >
    <option value="classic">Grille 1 (classique)</option>
    <option value="presence">Grille 2 (présence)</option>
  </Select>
</label>

<label style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
  <span style={{ opacity: 0.85, fontWeight: 800 }}>Usage :</span>
  <Select
    value={editorGrid.usage || "evaluation"}
    onChange={(e) => setEditorGrid({ ...editorGrid, usage: e.target.value })}
    style={{ ...inputStyle(), maxWidth: 220 }}
  >
    <option value="evaluation">Évaluations</option>
    <option value="calibration">Calibrages (onglet dédié)</option>
    <option value="sample">Évaluations d'échantillons</option>
    <option value="all">Tous usages</option>
  </Select>
  <span style={{ opacity: 0.85, fontWeight: 800 }}>Sens d'appel :</span>
  <Select
    value={editorGrid.callDirection || ""}
    onChange={(e) => setEditorGrid({ ...editorGrid, callDirection: e.target.value })}
    style={{ ...inputStyle(), maxWidth: 160 }}
  >
    <option value="">Indifférent</option>
    <option value="inbound">Entrant</option>
    <option value="outbound">Sortant</option>
  </Select>
  <span style={{ fontSize: "0.78rem", opacity: 0.7 }}>Une grille « Calibrages » n'apparaît plus dans « Nouvelle évaluation ».</span>
</label>

            <div className="grid-place">
              <div className="grid-place__title"><Ico n="mapPin" /> Rangement de la grille</div>
              {(() => {
                const selCtrs = editorGrid.contracts || [];
                const selActs = editorGrid.activities || [];
                const multi = (e) => Array.from(e.target.selectedOptions || []).map((o) => o.value);
                const ctrNames = [...new Set([...refs.contracts.filter((c) => c.active !== false).map((c) => c.name), ...selCtrs])];
                const actOpts = refs.activities.filter((a) => a.active !== false && selCtrs.includes(a.contract));
                const cellOpts = refs.cells.filter((c) => selCtrs.includes(c.contract || "") && (!selActs.length || selActs.includes(c.activity || "")));
                return <>
                  <label className="label">Contrat(s)
                    <Select className="input" multiple value={selCtrs} placeholder="Non classée"
                      onChange={(e) => { const v = multi(e); setEditorGrid({ ...editorGrid, contracts: v, activities: selActs.filter((a) => refs.activities.some((x) => x.name === a && v.includes(x.contract))), cells: (editorGrid.cells || []).filter((n) => refs.cells.some((c) => c.name === n && v.includes(c.contract || ""))) }); }}>
                      {ctrNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </Select>
                  </label>
                  <label className="label">Activité(s)
                    <Select className="input" multiple value={selActs} disabled={!selCtrs.length} placeholder="Toutes les activités"
                      onChange={(e) => { const v = multi(e); setEditorGrid({ ...editorGrid, activities: v, cells: (editorGrid.cells || []).filter((n) => !v.length || refs.cells.some((c) => c.name === n && v.includes(c.activity || ""))) }); }}>
                      {actOpts.map((a) => <option key={a._id} value={a.name}>{selCtrs.length > 1 ? `${a.name} (${a.contract})` : a.name}</option>)}
                    </Select>
                  </label>
                  <label className="label">Cellule(s)
                    <Select className="input" multiple value={editorGrid.cells || []} disabled={!selCtrs.length} placeholder="Toutes les cellules"
                      onChange={(e) => setEditorGrid({ ...editorGrid, cells: multi(e) })}>
                      {cellOpts.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
                    </Select>
                  </label>
                </>;
              })()}
              <div className="grid-place__hint">Sélection multiple possible. Sans cellule choisie, la grille s'applique à toutes les cellules des activités (ou des contrats) choisis. Lors d'une évaluation, seules les grilles de la cellule de l'agent sont proposées.</div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ opacity: 0.85, fontWeight: 800 }}>Rôles:</span>
              {["cq", "formateur", "referent", "superviseur", "management", "admin", "pilote"].map((r) => (
                <label key={r} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={(editorGrid.rolesAllowed || []).includes(r)}
                    onChange={(e) => {
                      const set = new Set(editorGrid.rolesAllowed || []);
                      if (e.target.checked) set.add(r);
                      else set.delete(r);
                      setEditorGrid({ ...editorGrid, rolesAllowed: Array.from(set) });
                    }}
                  />
                  {r}
                </label>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: "1rem",
              height: "calc(100vh - 360px)",
              minHeight: 420,
              overflowY: "auto",
              paddingRight: "0.25rem",
            }}
          >
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <button className="btn-outline" onClick={addPhase}>+ Ajouter phase</button>
            </div>

            {renderItems({
              items,
              collapsed,
              setCollapsed,
              addItemAfterGroup,
              updateItem,
              removeById,
              duplicatePhase,
              duplicateItem,
              onDragStart,
              onDragOver,
              onDropOn,
            })}
          </div>

          <div style={{ marginTop: "0.75rem", opacity: 0.8 }}>
            <b>Règles:</b> si <b>Hard fail</b> activé sur une phase et qu’un item est NC → score final = <b>0%</b>.
            Sinon, si <b>malus (%)</b> défini sur l’item <Ico n="arrowR" /> -x% par item NC (sinon fallback sur malus de phase).
          </div>
        </Card>
      )}
    </>
  );
}

function inputStyle() {
  return {
    padding: "0.55rem 0.7rem",
    borderRadius: "0.75rem",
    border: "1px solid rgba(209,213,219,0.9)",
    background: "var(--panel)",
    color: "var(--text)",
  };
}

function countGroups(items) {
  return (items || []).filter((x) => x.type === "group").length;
}

function renderItems(props) {
  const {
    items,
    collapsed,
    setCollapsed,
    addItemAfterGroup,
    updateItem,
    removeById,
    duplicatePhase,
    duplicateItem,
    onDragStart,
    onDragOver,
    onDropOn,
  } = props;

  let currentGroupId = null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {items.map((it) => {
        if (it.type === "group") currentGroupId = it._localId;
        const isHidden = it.type === "item" && currentGroupId && collapsed[currentGroupId];

        if (isHidden) return null;

        if (it.type === "group") {
          const isCol = !!collapsed[it._localId];
          return (
            <div
              key={it._localId}
              draggable
              onDragStart={onDragStart(it)}
              onDragOver={onDragOver}
              onDrop={onDropOn(it)}
              style={{
                border: "1px solid rgba(209,213,219,0.9)",
                borderRadius: "1rem",
                padding: "0.85rem",
                background: "var(--panel-2)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 900 }}>Phase</span>
                  <input value={it.title || ""} onChange={(e) => updateItem(it._localId, { title: e.target.value })} style={{ ...inputStyle(), minWidth: 260 }} />
                  <button className="btn-outline" onClick={() => setCollapsed((p) => ({ ...p, [it._localId]: !p[it._localId] }))}>
                    {isCol ? "Afficher" : "Masquer"}
                  </button>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button className="btn-outline" onClick={() => addItemAfterGroup(it._localId)}>+ Item</button>
                  <button className="btn-outline" onClick={() => duplicatePhase(it._localId)}>Dupliquer</button>
                  <button className="btn-outline" onClick={() => removeById(it._localId)}>Supprimer</button>
                </div>
              </div>

              <div style={{ marginTop: "0.65rem", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input type="checkbox" checked={!!it.hardFail} onChange={(e) => updateItem(it._localId, { hardFail: e.target.checked })} />
                  Hard fail (NC ⇒ 0%)
                </label>

                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  Malus (%)
                  <input
                    type="number"
                    value={Number.isFinite(it.malusPercent) ? it.malusPercent : 0}
                    onChange={(e) => updateItem(it._localId, { malusPercent: Number(e.target.value) || 0 })}
                    style={{ ...inputStyle(), width: 110 }}
                  />
                </label>
              </div>
            </div>
          );
        }

        // item
        return (
          <div
            key={it._localId}
            draggable
            onDragStart={onDragStart(it)}
            onDragOver={onDragOver}
            onDrop={onDropOn(it)}
            style={{
              border: "1px solid rgba(209,213,219,0.9)",
              borderRadius: "1rem",
              padding: "0.85rem",
              marginLeft: "0.75rem",
              background: "var(--panel)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: "0.5rem", alignItems: "start" }}>
              <textarea
                value={it.label || ""}
                onChange={(e) => updateItem(it._localId, { label: e.target.value })}
                placeholder="Libellé item (vous pouvez mettre des retours à la ligne)"
                rows={2}
                style={{ ...inputStyle(), resize: "vertical", whiteSpace: "pre-wrap" }}
              />
              <input type="number" value={Number.isFinite(it.pointsConforme) ? it.pointsConforme : 1} onChange={(e) => updateItem(it._localId, { pointsConforme: Number(e.target.value) || 0 })} style={inputStyle()} />
              <input type="number" value={Number.isFinite(it.pointsNonConforme) ? it.pointsNonConforme : 0} onChange={(e) => updateItem(it._localId, { pointsNonConforme: Number(e.target.value) || 0 })} style={inputStyle()} />
              <input type="number" value={Number.isFinite(it.malusPercent) ? it.malusPercent : 0} onChange={(e) => updateItem(it._localId, { malusPercent: Number(e.target.value) || 0 })} style={inputStyle()} />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn-outline" onClick={() => duplicateItem(it._localId)}>Dupliquer</button>
                <button className="btn-outline" onClick={() => removeById(it._localId)}>Supprimer</button>
              </div>
            </div>
            <div style={{ marginTop: "0.35rem", opacity: 0.75, fontSize: "0.9rem" }}>
              Notes: conforme / non conforme
            </div>
          </div>
        );
      })}
    </div>
  );
}

function reorder(items, dragType, srcId, dstId, dstType) {
  // If dragging a group: move the group with its subsequent items until next group
  const arr = [...items];
  const srcIdx = arr.findIndex((x) => x._localId === srcId);
  const dstIdx = arr.findIndex((x) => x._localId === dstId);
  if (srcIdx < 0 || dstIdx < 0) return arr;

  if (dragType === "group") {
    const [block, rest] = extractPhaseBlock(arr, srcIdx);
    const dstIdxNew = rest.findIndex((x) => x._localId === dstId);
    if (dstIdxNew < 0) return arr;

    // insert block before destination group
    const insertAt = dstIdxNew;
    const next = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
    return next;
  }

  // dragging item: simple move within flat array (allow crossing phases)
  const item = arr[srcIdx];
  const without = arr.filter((x) => x._localId !== srcId);
  const dstIdx2 = without.findIndex((x) => x._localId === dstId);
  const insertAt = dstIdx2 + (dstType === "item" ? 0 : 1); // drop on group -> insert after group
  const next = [...without.slice(0, insertAt), item, ...without.slice(insertAt)];
  return next;
}

function extractPhaseBlock(arr, groupIndex) {
  const block = [];
  block.push(arr[groupIndex]);
  let i = groupIndex + 1;
  while (i < arr.length && arr[i].type !== "group") {
    block.push(arr[i]);
    i++;
  }
  const rest = [...arr.slice(0, groupIndex), ...arr.slice(i)];
  return [block, rest];
}