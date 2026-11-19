// backend/models/LoginEvent.js — journal des connexions (taux d'utilisation)
const mongoose = require("mongoose");

const LoginEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, default: "" },
    cell: { type: String, default: "" },
    project: { type: String, default: "" },
    contract: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { versionKey: false }
);

LoginEventSchema.index({ at: -1 });
LoginEventSchema.index({ user: 1, at: -1 });

module.exports = mongoose.model("LoginEvent", LoginEventSchema);
