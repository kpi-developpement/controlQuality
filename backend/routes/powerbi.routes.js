const router = require("express").Router();
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const permit = require("../middleware/roles");
const Report = require("../models/PowerBIReport");
const { normalizeReport } = require("../utils/powerbi");
router.use(auth, permit("admin"));
router.get("/", async (req, res) => {
  try { res.json(await Report.find().sort({ createdAt: 1 }).lean()); }
  catch { res.status(500).json({ message: "Impossible de charger les rapports Power BI." }); }
});
function validate(req, res, next) {
  try { req.report = normalizeReport(req.body || {}); next(); }
  catch (e) { res.status(400).json({ message: e.message }); }
}
router.post("/", validate, async (req, res) => {
  try { res.status(201).json(await Report.create({ ...req.report, createdBy: req.user.id || req.user._id })); }
  catch { res.status(500).json({ message: "Impossible d’enregistrer le rapport." }); }
});
router.param("id", (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Identifiant invalide." });
  next();
});
router.put("/:id", validate, async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(req.params.id, { $set: req.report }, { new: true, runValidators: true });
    if (!report) return res.status(404).json({ message: "Rapport introuvable." });
    res.json(report);
  } catch { res.status(500).json({ message: "Impossible de modifier le rapport." }); }
});
router.delete("/:id", async (req, res) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);
    if (!report) return res.status(404).json({ message: "Rapport introuvable." });
    res.json({ ok: true });
  } catch { res.status(500).json({ message: "Impossible de supprimer le rapport." }); }
});
module.exports = router;
