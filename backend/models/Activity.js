// backend/models/Activity.js — activités d'un contrat (ex. Bytel : Activité technique, Service client…)
// Sert à ranger les cellules et les grilles : Contrat → Activité → Cellule → Grilles.
const mongoose = require("mongoose");

const ActivitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    contract: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", maxlength: 500 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ActivitySchema.index({ contract: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Activity", ActivitySchema);
