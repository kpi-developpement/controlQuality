// backend/models/QualityObjective.js — objectifs mensuels par cellule et par population d'évaluateurs
// (Paramètres qualité → « Objectifs par cellule »).
// Pour chaque cellule : nombre d'évaluations, pickings, coachings, échantillons et calibrages attendus
// chaque mois de la part des CQ, des formateurs, des référents techniques et du management
// (management, superviseurs, chefs de projet). L'objectif est fixé PAR AGENT : le volume attendu
// = objectif × agents actifs de la cellule (champ base conservé pour compatibilité, non utilisé).
const mongoose = require("mongoose");

const ACTIVITIES = ["evaluations", "pickings", "coachings", "samples", "calibrations"];
const GROUPS = ["cq", "formateur", "referent", "management"];

const countsShape = Object.fromEntries(ACTIVITIES.map((a) => [a, { type: Number, default: 0, min: 0, max: 100000 }]));
const CountsSchema = new mongoose.Schema(countsShape, { _id: false });

const QualityObjectiveSchema = new mongoose.Schema(
  {
    cell: { type: String, required: true, trim: true, unique: true },
    contract: { type: String, default: "", trim: true },
    base: { type: String, enum: ["cell", "agent"], default: "cell" },
    cq: { type: CountsSchema, default: () => ({}) },
    formateur: { type: CountsSchema, default: () => ({}) },
    referent: { type: CountsSchema, default: () => ({}) },
    management: { type: CountsSchema, default: () => ({}) },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const QualityObjective = mongoose.model("QualityObjective", QualityObjectiveSchema);
QualityObjective.ACTIVITIES = ACTIVITIES;
QualityObjective.GROUPS = GROUPS;
module.exports = QualityObjective;
