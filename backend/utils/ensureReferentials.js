// backend/utils/ensureReferentials.js — référentiels de base (ajout seulement, jamais de suppression)
// Contrats Bytel, Orange, Tisseo et activités Bytel, créés au démarrage s'ils n'existent pas encore.
const Contract = require("../models/Contract");
const Activity = require("../models/Activity");

const CONTRACTS = ["Bytel", "Orange", "Tisseo"];
const ACTIVITIES = {
  Bytel: ["Activité technique", "Activité service client", "Activité sécurisation et backoffice"],
};

async function ensureReferentials() {
  try {
    for (const name of CONTRACTS) {
      await Contract.updateOne({ name }, { $setOnInsert: { name, active: true } }, { upsert: true });
    }
    for (const [contract, names] of Object.entries(ACTIVITIES)) {
      for (const name of names) {
        await Activity.updateOne({ contract, name }, { $setOnInsert: { contract, name, active: true } }, { upsert: true });
      }
    }
  } catch (e) {
    console.error("ensureReferentials:", e.message);
  }
}

module.exports = { ensureReferentials };
