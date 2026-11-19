// backend/models/ClosureCode.js — référentiel des codes de clôture
const mongoose = require("mongoose");

const ClosureCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, maxlength: 120 },
    label: { type: String, default: "", trim: true, maxlength: 200 },
    // Contrat concerné ("" = tous)
    contract: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ClosureCodeSchema.index({ code: 1, contract: 1 }, { unique: true });

module.exports = mongoose.model("ClosureCode", ClosureCodeSchema);
