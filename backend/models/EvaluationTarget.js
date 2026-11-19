// backend/models/EvaluationTarget.js — volumes d'évaluations attendus (taux de couverture)
const mongoose = require("mongoose");

const EvaluationTargetSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // mois d'appel YYYY-MM
    cell: { type: String, default: "", trim: true },
    project: { type: String, default: "", trim: true },
    contract: { type: String, default: "", trim: true },
    target: { type: Number, required: true, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

EvaluationTargetSchema.index({ month: 1, cell: 1, project: 1, contract: 1 }, { unique: true });

module.exports = mongoose.model("EvaluationTarget", EvaluationTargetSchema);
