// backend/models/Sample.js — échantillons d'appels à évaluer (onglet "Évaluations d'échantillons")
const mongoose = require("mongoose");

/**
 * Statuts :
 *  - pending     : en attente, non affecté à un évaluateur
 *  - assigned    : affecté, non commencé
 *  - in_progress : évaluation commencée
 *  - standby     : bloqué / en attente d'un complément (motif obligatoire)
 *  - done        : évaluation finalisée (score lié)
 *  - cancelled   : retiré de l'échantillon
 * La définition métier de « standby » est paramétrable dans les indicateurs.
 */
const SAMPLE_STATUSES = ["pending", "assigned", "in_progress", "standby", "done", "cancelled"];
const STANDBY_REASONS = ["", "blocked", "waiting_info", "audio_missing", "other"];

const SampleSchema = new mongoose.Schema(
  {
    batch: { type: String, default: "", trim: true, maxlength: 120 },

    // Appel / interaction concernée
    eps: { type: String, default: "", trim: true },
    phone: { type: String, default: "" },
    callDate: { type: Date, default: null },
    callDirection: { type: String, enum: ["", "inbound", "outbound"], default: "" },
    audioDay: { type: String, default: "" },
    audioFile: { type: String, default: "" },
    callRef: { type: String, default: "" },

    pilot: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    gridId: { type: mongoose.Schema.Types.ObjectId, ref: "Grid", default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Périmètre
    cell: { type: String, default: "" },
    project: { type: String, default: "" },
    contract: { type: String, default: "" },

    status: { type: String, enum: SAMPLE_STATUSES, default: "pending" },
    standbyReason: { type: String, enum: STANDBY_REASONS, default: "" },
    standbyComment: { type: String, default: "", maxlength: 1000 },
    dueDate: { type: Date, default: null },

    score: { type: mongoose.Schema.Types.ObjectId, ref: "Score", default: null },
    startedAt: { type: Date, default: null },
    doneAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

SampleSchema.index({ status: 1, createdAt: -1 });
SampleSchema.index({ assignedTo: 1, status: 1 });
SampleSchema.index({ cell: 1, contract: 1 });

const Sample = mongoose.model("Sample", SampleSchema);
Sample.STATUSES = SAMPLE_STATUSES;
Sample.STANDBY_REASONS = STANDBY_REASONS;
module.exports = Sample;
