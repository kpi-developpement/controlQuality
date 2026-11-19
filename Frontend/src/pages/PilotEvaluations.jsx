import React, { useEffect, useState, useMemo } from "react";
import api from "../api.js";
import PeriodFilter from "../components/PeriodFilter.jsx";
import { initialPeriod, inPeriod } from "../utils/period.mjs";
import { typeLabel, directionLabel } from "../utils/evalMeta.js";
import Ico from "../ui/Ico.jsx";
import Select from "../ui/Select.jsx";

function getRefDate(s) { const d = s.listeningDate || s.interactionDate || s.callDate || s.createdAt; return d ? new Date(d) : null; }
const MONTHS = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];
const sc = (v) => v >= 80 ? "badge--success" : v >= 50 ? "badge--warning" : "badge--danger";

export default function PilotEvaluations() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(initialPeriod);
  const [scores, setScores] = useState([]);
  const [filterYear, setFilterYear] = useState("all");
  const [filterMonth, setFilterMonth] = useState("all");
  const [selectedEval, setSelectedEval] = useState(null);
  // Contrat Orange : validation de l'évaluation par l'agent
  const [validationEnabled, setValidationEnabled] = useState(false);
  const [validateComment, setValidateComment] = useState("");
  const [validating, setValidating] = useState(false);
  const [validateErr, setValidateErr] = useState("");

  async function load() {
    try {
      const d = (await api.get("/scores/me")).data || {};
      setScores(d.scores || []);
      setValidationEnabled(!!d.validationEnabled);
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function validateEval(ev) {
    setValidating(true); setValidateErr("");
    try {
      const { data } = await api.post(`/scores/${ev._id}/validate`, { comment: validateComment }, { toastSuccessMessage: "Évaluation validée" });
      const patch = { pilotValidated: true, pilotValidatedAt: data?.pilotValidatedAt || new Date().toISOString(), pilotValidationComment: data?.pilotValidationComment || validateComment };
      setScores((prev) => prev.map((s) => (s._id === ev._id ? { ...s, ...patch } : s)));
      setSelectedEval((cur) => (cur && cur._id === ev._id ? { ...cur, ...patch } : cur));
      setValidateComment("");
    } catch (e) {
      setValidateErr(e?.response?.data?.message || "Validation impossible.");
    } finally { setValidating(false); }
  }

  const years = useMemo(() => [...new Set(scores.map((s) => getRefDate(s)?.getFullYear()).filter(Boolean))].sort((a, b) => b - a), [scores]);

  const filtered = useMemo(() => scores.filter((s) => {
    const d = getRefDate(s); if (!d) return false;
    if (!inPeriod(d, period)) return false;
    if (filterYear !== "all" && String(d.getFullYear()) !== filterYear) return false;
    if (filterMonth !== "all" && String(d.getMonth() + 1) !== filterMonth) return false;
    return true;
  }), [scores, filterYear, filterMonth, period]);

  return (
    <div className="page">
      <div style={{ marginBottom: 16 }}>
        <div className="page-title"><Ico n="clipboard" /> Mes évaluations</div>
        <div style={{ color: "var(--muted)", fontSize: "0.875rem", marginTop: 2 }}>Consultez le détail de chaque écoute réalisée par votre évaluateur.</div>
      </div>

      <div className="card filters-card"><PeriodFilter value={period} onChange={(p) => { setPeriod(p); setFilterYear("all"); setFilterMonth("all"); }} /></div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{filtered.length} évaluation{filtered.length > 1 ? "s" : ""}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Select className="input" style={{ padding: "4px 8px", fontSize: "0.82rem" }} value={filterYear} onChange={(e) => { setFilterYear(e.target.value); setPeriod(initialPeriod()); }}>
              <option value="all">Toutes années</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Select className="input" style={{ padding: "4px 8px", fontSize: "0.82rem" }} value={filterMonth} onChange={(e) => { setFilterMonth(e.target.value); setPeriod(initialPeriod()); }}>
              <option value="all">Tous mois</option>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </Select>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Chargement…</div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Évaluateur</th><th>Prime</th><th>EPS</th><th>Durée</th><th>Score</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {filtered.map((s) => {
                  const d = getRefDate(s);
                  const v = Number(s.total || 0);
                  return (
                    <tr key={s._id} style={s.contested ? { opacity: 0.55 } : undefined}>
                      <td style={{ fontSize: "0.85rem" }}>{d ? d.toLocaleDateString("fr-FR") : "—"}</td>
                      <td style={{ fontWeight: 600, fontSize: "0.85rem" }}>{s.evaluatorName || s.evaluator?.name || s.cq?.name || s.evaluatorRole || "—"}</td>
                      <td>
                        {s.pickingPrime ? (
                          <span className="badge badge--primary">Oui</span>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Non</span>
                        )}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{s.eps || "—"}</td>
                      <td style={{ fontSize: "0.85rem" }}>{s.callDuration || "—"}</td>
                      <td><span className={`badge ${sc(v)}`}>{v.toFixed(1)}%</span></td>
                      <td>{s.contested ? <span className="badge badge--warning">Contestée</span> : s.pilotValidated ? <span className="badge badge--success">Validée</span> : validationEnabled ? <span className="badge badge--muted">À valider</span> : <span style={{ color: "var(--success)", fontWeight: 600, fontSize: "0.82rem" }}><Ico n="check" /></span>}</td>
                      <td><button className="btn btn--ghost btn--sm" onClick={() => { setValidateErr(""); setValidateComment(""); setSelectedEval(s); }}>{validationEnabled && !s.contested && !s.pilotValidated ? "Voir / valider" : "Détail"}</button></td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Aucune évaluation.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedEval && (
        <div className="modal-overlay" onClick={() => setSelectedEval(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>Détail de l'évaluation</div>
              <button className="btn btn--ghost btn--sm" onClick={() => setSelectedEval(null)}>Fermer</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
              {[
                { k: "Date", v: getRefDate(selectedEval)?.toLocaleDateString("fr-FR") || "—" },
                { k: "Évaluateur", v: selectedEval.evaluatorName || selectedEval.evaluator?.name || selectedEval.cq?.name || selectedEval.evaluatorRole || "—" },
                { k: "Rôle évaluateur", v: selectedEval.evaluatorRole || selectedEval.evaluator?.role || "—" },
                { k: "Prime", v: selectedEval.pickingPrime ? "Oui" : "Non" },
                { k: "EPS", v: selectedEval.eps || "—" },
                { k: "Durée", v: selectedEval.callDuration || "—" },
                { k: "Score", v: `${Number(selectedEval.total || 0).toFixed(1)}%` },
                { k: "Type", v: typeLabel(selectedEval.evaluationType) },
                { k: "Code de clôture", v: selectedEval.closureCode || "—" },
                ...(selectedEval.callDirection ? [{ k: "Sens d'appel", v: directionLabel(selectedEval.callDirection) }] : []),
              ].map((x) => (
                <div key={x.k} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>{x.k}</div>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem", marginTop: 2 }}>{x.v}</div>
                </div>
              ))}
            </div>
            {selectedEval.contested && (
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--warning-bg)", border: "1px solid rgba(217,119,6,0.2)", marginBottom: 12, fontSize: "0.85rem" }}>
                <b><Ico n="alert" /> Contestée</b>{selectedEval.contestComment ? ` — ${selectedEval.contestComment}` : ""}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 8 }}>Résultat par critère</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
              {(selectedEval.items || []).map((it, idx) => {
                const isNC = ["NC", "PNC", "NP"].includes(it.status);
                return (
                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: isNC ? "var(--danger-bg)" : "var(--panel-2)" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{it.label}</span>
                    <span className={`badge ${["C","PC"].includes(it.status) ? "badge--success" : it.status === "NA" ? "badge--muted" : "badge--danger"}`}>
                      {it.status === "C" ? <><Ico n="check" /> Conforme</> : it.status === "NC" ? <><Ico n="x" /> Non conforme</> : it.status === "NA" ? "N/A" : it.status === "PC" ? <><Ico n="check" /> Partiellement</> : it.status === "PNC" ? <><Ico n="x" /> P/Non conforme</> : it.status === "NP" ? <><Ico n="x" /> Non présent</> : it.status || "—"}
                    </span>
                  </div>
                );
              })}
            </div>
            {validationEnabled && !selectedEval.contested && (
              <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: selectedEval.pilotValidated ? "var(--success-bg)" : "var(--panel-2)", marginBottom: 12 }}>
                {selectedEval.pilotValidated ? (
                  <div style={{ fontSize: "0.85rem" }}>
                    <b><Ico n="checkCircle" /> Évaluation validée</b>{selectedEval.pilotValidatedAt ? ` le ${new Date(selectedEval.pilotValidatedAt).toLocaleDateString("fr-FR")}` : ""}
                    {selectedEval.pilotValidationComment ? <div style={{ marginTop: 4, color: "var(--muted)" }}>« {selectedEval.pilotValidationComment} »</div> : null}
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 6 }}>Valider cette évaluation</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: 8 }}>Confirmez que vous avez pris connaissance de cette évaluation. Commentaire facultatif.</div>
                    <textarea className="input" rows={2} value={validateComment} onChange={(e) => setValidateComment(e.target.value)} placeholder="Mon commentaire (facultatif)…" maxLength={2000} />
                    {validateErr && <div style={{ color: "var(--danger)", fontSize: "0.82rem", marginTop: 6 }}>{validateErr}</div>}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                      <button className="btn btn--sm" onClick={() => validateEval(selectedEval)} disabled={validating}>{validating ? "Envoi…" : <><Ico n="check" /> Je valide cette évaluation</>}</button>
                    </div>
                  </>
                )}
              </div>
            )}
            {selectedEval.comment && (
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 6 }}><Ico n="message" /> Commentaire de l'évaluateur</div>
                <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", fontSize: "0.85rem", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{selectedEval.comment}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
