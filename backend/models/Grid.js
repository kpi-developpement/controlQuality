const mongoose = require("mongoose");

const GridItemSchema = new mongoose.Schema(
  {
    // NEW: allow group rows (section titles)
    // - group: uses `title`
    // - item:  uses `label` + points
    type: { type: String, enum: ["group", "item"], default: "item" },

    // group row title
    title: { type: String, default: "" },

    // NEW: phase rules
    // - hardFail: if any NC in this phase => evaluation becomes 0%
    hardFail: { type: Boolean, default: false },

    // - malusPercent: if an item in this phase is NC => total compliance is reduced by -x% per NC
    malusPercent: { type: Number, default: 0 },

    // item row label
    label: { type: String, default: "" },

    // NEW: admin-managed points for compliance scoring
    pointsConforme: { type: Number, default: 1 },
    pointsNonConforme: { type: Number, default: 0 },

    // LEGACY: old defaultValue 1..5 (keep for backward compatibility)
    defaultValue: { type: Number, default: 3 },

    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const GridSchema = new mongoose.Schema(
  {
    // NEW: grid scoring type
    // - classic: existing C/NC/NA scoring
    // - presence: Présent/Conforme, Présent/Non conforme, Non Présent, NA
    gridType: { type: String, enum: ["classic", "presence"], default: "classic" },

    name: { type: String, required: true },
    description: { type: String, default: "" },

    // who can use the grid (existing behavior)
    roles: { type: [String], default: [] },

    active: { type: Boolean, default: true },

    // Usage de la grille (contrat Orange). Les grilles existantes restent "evaluation".
    // evaluation | calibration | sample | all
    usage: { type: String, enum: ["evaluation", "calibration", "sample", "all"], default: "evaluation" },
    // Sens d'appel ciblé (calibrages entrants / sortants). "" = indifférent
    callDirection: { type: String, enum: ["", "inbound", "outbound"], default: "" },

    // Rangement : Contrat → Activité → Cellule(s). Vide = grille non classée (proposée partout).
    contract: { type: String, default: "", trim: true },
    activity: { type: String, default: "", trim: true },
    cells: { type: [String], default: [] },

    // Soft delete: keep grids for historical evaluations
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    items: { type: [GridItemSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Grid", GridSchema);
