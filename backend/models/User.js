const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },
    // Copie chiffrée (AES-256-GCM) du mot de passe, consultable par l'admin. Jamais renvoyée par défaut.
    passwordEnc: { type: String, default: "", select: false },

    role: {
      type: String,
      // "supervision" ajouté (contrat Orange) : lecture seule sur le périmètre affecté.
      // Rôles métier : pilote, referent (Référent Technique), superviseur, cq, formateur,
      // cdp (Chef de Projet), admin. "management" et "supervision" = rôles historiques conservés.
      enum: ["admin", "cq", "pilote", "management", "formateur", "supervision", "referent", "superviseur", "cdp"],
      default: "pilote",
    },

    active: {
      type: Boolean,
      default: true,
    },

    cell: {
      type: String,
      default: "",
    },

    // ---- Périmètre (contrat Orange) : champs additifs, vides par défaut ----
    project: { type: String, default: "", trim: true },
    contract: { type: String, default: "", trim: true },
    // Cellules supplémentaires autorisées explicitement ("sauf autorisation spécifique")
    extraCells: { type: [String], default: [] },
    // Pôle(s) = activité(s) affectée(s) (Superviseur, Référent technique). Vide = activités de ses cellules.
    poles: { type: [String], default: [] },
    // Périmètre de consultation : "" = valeur par défaut du rôle
    // cell | project | contract | all | self
    visibilityScope: {
      type: String,
      enum: ["", "cell", "project", "contract", "all", "self", "team", "line", "pole"],
      default: "",
    },
    // Périmètre de modification : "" = comportement historique du rôle
    // none (lecture seule) | own (ses propres évaluations) | perimeter (son périmètre)
    editScope: {
      type: String,
      enum: ["", "none", "own", "perimeter"],
      default: "",
    },

    // ---- Hiérarchie : pilote → référent technique → superviseur ----
    referent: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    superviseur: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    assignedGrids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Grid",
      },
    ],
  },
  { timestamps: true }
);

userSchema.index({ role: 1, active: 1 });
userSchema.index({ referent: 1 });
userSchema.index({ superviseur: 1 });
userSchema.index({ cell: 1 });
userSchema.index({ contract: 1, project: 1 });

module.exports = mongoose.model("User", userSchema);
