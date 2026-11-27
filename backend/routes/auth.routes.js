// backend/routes/auth.routes.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const auth = require("../middleware/auth");
const LoginEvent = require("../models/LoginEvent");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET;
const { SESSION_VERSION } = require("../middleware/auth");

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!JWT_SECRET) {
      console.error("❌ JWT_SECRET non défini dans .env");
      return res
        .status(500)
        .json({ message: "Configuration serveur invalide (JWT)." });
    }

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email et mot de passe sont obligatoires." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // On cherche un utilisateur actif
    const user = await User.findOne({ email: normalizedEmail, active: true });
    if (!user) {
      return res.status(400).json({ message: "Utilisateur introuvable" });
    }

    // Vérification du mot de passe
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res
        .status(400)
        .json({ message: "Email ou mot de passe incorrect" });
    }

    // Génération du token JWT avec id, rôle, nom
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role, // "admin", "cq", "pilote", "management"
        name: user.name,
        // Version de session : les sessions ouvertes avant le coffre des mots de passe sont renouvelées
        pv: SESSION_VERSION,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    // Mot de passe consultable par l'admin : les comptes créés avant la mise en place du coffre
    // n'ont pas de copie chiffrée ; on l'enregistre à la première connexion réussie
    // (ou si la clé a changé). N'empêche jamais la connexion.
    try {
      const vault = require("../utils/passwordVault");
      const current = await User.findById(user._id).select("+passwordEnc").lean();
      if (vault.openPassword(current?.passwordEnc) !== password) {
        const sealed = vault.sealPassword(password);
        if (sealed) await User.updateOne({ _id: user._id }, { $set: { passwordEnc: sealed } });
      }
    } catch (e) {
      console.error("Password vault error:", e?.message || e);
    }

    // Contrat Orange : journal des connexions (taux d'utilisation). N'empêche jamais la connexion.
    try {
      await LoginEvent.create({
        user: user._id,
        role: user.role || "",
        cell: user.cell || "",
        project: user.project || "",
        contract: user.contract || "",
        ip: (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").toString().slice(0, 120),
        userAgent: (req.headers["user-agent"] || "").toString().slice(0, 240),
      });
    } catch (e) {
      console.error("LoginEvent error:", e?.message || e);
    }

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        cell: user.cell || "",
        project: user.project || "",
        contract: user.contract || "",
      },
    });
  } catch (err) {
    console.error("Erreur login:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/auth/ping (keep-alive)
router.get("/ping", auth, (req, res) => {
  res.json({ ok: true, user: req.user || null });
});

/**
 * GET /api/auth/me
 * Returns full profile of the authenticated user (no passwordHash).
 */
router.get("/me", auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId).select("-passwordHash").lean();
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable." });
    res.json(user);
  } catch (err) {
    console.error("GET /auth/me error:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * PATCH /api/auth/profile
 * Self-service profile update (name, password).
 * Body: { name?, currentPassword?, newPassword? }
 */
router.patch("/profile", auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { name, currentPassword, newPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable." });

    // Update name
    if (name && typeof name === "string" && name.trim().length > 0) {
      user.name = name.trim();
    }

    // Change password
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Le mot de passe actuel est requis." });
      }
      const match = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!match) {
        return res.status(400).json({ message: "Mot de passe actuel incorrect." });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 6 caractères." });
      }
      user.passwordHash = await bcrypt.hash(newPassword, 10);
      user.passwordEnc = require("../utils/passwordVault").sealPassword(newPassword);
    }

    await user.save();

    const plain = user.toObject();
    delete plain.passwordHash;
    res.json(plain);
  } catch (err) {
    console.error("PATCH /auth/profile error:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

module.exports = router;
