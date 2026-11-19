// backend/models/Contract.js — référentiel des contrats (ex. Bytel, Orange)
const mongoose = require("mongoose");

const ContractSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
    // Nom du projet de rattachement (optionnel)
    project: { type: String, default: "", trim: true, maxlength: 120 },
    description: { type: String, default: "", maxlength: 500 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Contract", ContractSchema);
