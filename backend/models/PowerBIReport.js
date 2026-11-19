const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 120 },
  url: { type: String, required: true, maxlength: 6000 },
  pageName: { type: String, default: "", maxlength: 200 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
module.exports = mongoose.model("PowerBIReport", schema);
