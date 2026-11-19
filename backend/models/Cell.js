// backend/models/Cell.js
const mongoose = require("mongoose");

const CellSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    // Rattachement optionnel (contrat Orange)
    project: { type: String, default: "", trim: true },
    contract: { type: String, default: "", trim: true },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Cell", CellSchema);
