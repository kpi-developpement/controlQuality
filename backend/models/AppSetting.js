// backend/models/AppSetting.js — paramètres applicatifs modifiables par l'admin
const mongoose = require("mongoose");

const AppSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppSetting", AppSettingSchema);
