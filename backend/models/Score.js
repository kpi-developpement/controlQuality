const mongoose = require("mongoose");

const ScoreItemSchema = new mongoose.Schema(
  {
    // The label of the criterion (for item rows). For group rows, this can be empty.
    label: { type: String, default: "" },

    // NEW: compliance status
    // C  = Conforme
    // NC = Non conforme
    // NA = Non applicable (excluded from compliance calculation)
    status: { type: String, enum: ["C","NC","NA","PC","PNC","NP",""], default: "" },

    // LEGACY: old scoring 1..5
    // Keep for backward-compat, but DO NOT enforce min/max anymore.
    // Some of our new logic uses value as "points obtained" and it can be 0.
    value: { type: Number, default: 0 },
  },
  { _id: false }
);

const ScoreSchema = new mongoose.Schema(
  {
    pilot: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    evaluator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // reference to the grid used for this evaluation (optional but recommended)
    gridId: { type: mongoose.Schema.Types.ObjectId, ref: "Grid", default: null },

    // metadata
    listeningDate: { type: Date, default: null },
    callDate: { type: Date, default: null },
    interactionDate: { type: Date, default: null },
    eps: { type: String, default: "" },
    // Picking de contrôle process : plusieurs EPS (5 minimum), sans prime
    epsList: { type: [String], default: undefined },
    // ✅ New (backward compatible): optional feature flag per evaluation
    pickingPrime: { type: Boolean, default: false },
    callDuration: { type: String, default: "" },
    comment: { type: String, default: "" },

    // evaluation rows
    items: { type: [ScoreItemSchema], default: [] },

    // contest workflow (existing)
    contested: { type: Boolean, default: false },
    // Arbitrage des contestations (CQ / Formateur / Admin)
    contestStatus: { type: String, enum: ["", "pending", "accepted", "rejected"], default: "" },
    contestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    arbitratedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    arbitratedAt: { type: Date, default: null },
    arbitrationComment: { type: String, default: "" },
    contestComment: { type: String, default: "" },
    contestedAt: { type: Date, default: null },
    // when CQ reevaluates after contest
    reevaluatedAt: { type: Date, default: null },

    // NEW: date de l’évaluation (distincte de la date de l’appel)
    evaluationDate: { type: Date, default: null },

    // ---- Contrat Orange (champs additifs ; documents existants = "standard") ----
    // standard | sample | calibration | picking | coaching
    evaluationType: {
      type: String,
      enum: ["standard", "sample", "calibration", "picking", "coaching"],
      default: "standard",
    },
    closureCode: { type: String, default: "", trim: true, maxlength: 120 },
    callDirection: { type: String, enum: ["", "inbound", "outbound"], default: "" },
    sample: { type: mongoose.Schema.Types.ObjectId, ref: "Sample", default: null },
    // Mois de prime concerné (AAAA-MM) — remplace le « sens d'appel » hors calibrage
    primeMonth: { type: String, default: "", match: /^(\d{4}-(0[1-9]|1[0-2]))?$/ },

    // Photographie du périmètre de l'agent au moment de l'évaluation (exports / historique)
    cellAtEvaluation: { type: String, default: "" },
    projectAtEvaluation: { type: String, default: "" },
    contractAtEvaluation: { type: String, default: "" },

    // Validation de l'évaluation par l'agent (indicateur "taux de validation")
    pilotValidated: { type: Boolean, default: false },
    pilotValidatedAt: { type: Date, default: null },
    pilotValidationComment: { type: String, default: "" },
  },
  { timestamps: true }
);

// Performance indexes
ScoreSchema.index({ createdAt: -1 });
ScoreSchema.index({ evaluator: 1, createdAt: -1 });
ScoreSchema.index({ pilot: 1, createdAt: -1 });
ScoreSchema.index({ contested: 1, createdAt: -1 });
ScoreSchema.index({ eps: 1 });
ScoreSchema.index({ evaluationType: 1, createdAt: -1 });
ScoreSchema.index({ callDate: -1 });

module.exports = mongoose.model("Score", ScoreSchema);
