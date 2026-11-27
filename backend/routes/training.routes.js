const express = require("express");
const path = require("path");
const multer = require("multer");
const auth = require("../middleware/auth");
const permit = require("../middleware/roles");
const Training = require("../models/Training");
const Notification = require("../models/Notification");
const router = express.Router();
router.use(auth);

// Contrat Orange : échéance optionnelle d'un quiz. null = aucune ; undefined = invalide.
function parseDueDate(v) {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) d.setUTCHours(23, 59, 59, 999);
  return d;
}

// Délai de passation (minutes) : 0 = sans limite ; undefined = invalide
function parseTimeLimit(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 600) return undefined;
  return Math.round(n);
}
// Seuls les fichiers déposés dans /uploads/training sont acceptés comme support
function uploadedPath(v) {
  const s = String(v || "").trim();
  return /^\/uploads\/training\/[\w.-]+$/.test(s) ? s : "";
}
// Marge réseau tolérée après la fin du délai de passation
const QUIZ_GRACE_MS = 60 * 1000;

/**
 * Démarrage d'un quiz : nouveau passage, reprise du passage en cours (le chronomètre ne repart pas
 * de zéro), refus (tentative unique déjà utilisée) ou délai expiré sur une tentative unique.
 */
function quizStartInfo(t, userId, now = Date.now()) {
  const uid = String(userId);
  const limit = Number(t.timeLimitMinutes) || 0;
  const mine = (t.attempts || []).filter((a) => String(a.user) === uid);
  if (t.allowMultipleAttempts === false && mine.length) return { action: "blocked", limit };
  const lastAttempt = mine.reduce((m, a) => Math.max(m, new Date(a.completedAt || 0).getTime()), 0);
  const st = (t.starts || []).find((x) => String(x.user) === uid);
  const startedMs = st ? new Date(st.startedAt).getTime() : 0;
  if (limit > 0 && st && startedMs > lastAttempt) {
    const deadlineMs = startedMs + limit * 60000;
    if (now <= deadlineMs) return { action: "resume", limit, startedAt: new Date(startedMs), deadline: new Date(deadlineMs) };
    if (now > deadlineMs + QUIZ_GRACE_MS && t.allowMultipleAttempts === false) return { action: "expired", limit };
  }
  return { action: "new", limit };
}

// === Multer config ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fs = require("fs");
    const dir = path.join(__dirname, "..", "uploads", "training");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(mp4|webm|mov|avi|mkv|pdf|ppt|pptx|pps|ppsx)$/i.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error("Format non supporté."));
  },
});

// ======================================================================
//  STATIC ROUTES (must be declared BEFORE /:id to avoid param collision)
// ======================================================================

/**
 * Conversion PowerPoint -> PDF (LibreOffice headless) pour l'affichage dans l'application.
 * Retourne le chemin du PDF, ou "" si LibreOffice n'est pas disponible / la conversion échoue.
 */
function convertToPdf(filePath) {
  const { execFile } = require("child_process");
  const dir = path.dirname(filePath);
  const bins = [process.env.SOFFICE_BIN, "soffice", "libreoffice", "/usr/lib/libreoffice/program/soffice"].filter(Boolean);
  return new Promise((resolve) => {
    const tryBin = (i) => {
      if (i >= bins.length) return resolve("");
      // Profil LibreOffice dédié à chaque conversion : évite les blocages (profil verrouillé, première exécution)
      const profile = path.join(require("os").tmpdir(), `kcq-lo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const args = [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", "--nologo", "--convert-to", "pdf", "--outdir", dir, filePath];
      execFile(bins[i], args, { timeout: 180000, env: { ...process.env, HOME: process.env.HOME || require("os").tmpdir() } }, (err, stdout, stderr) => {
        require("fs").rm(profile, { recursive: true, force: true }, () => {});
        const out = path.join(dir, `${path.basename(filePath, path.extname(filePath))}.pdf`);
        if (!err && require("fs").existsSync(out)) return resolve(out);
        if (err && err.code !== "ENOENT") console.error(`Conversion PowerPoint (${bins[i]}) échouée :`, err.message, String(stderr || "").slice(0, 500));
        tryBin(i + 1);
      });
    };
    tryBin(0);
  });
}

/** POST /training/upload — Dépôt d'une vidéo, d'un PDF ou d'un PowerPoint */
// Erreurs de dépôt (format, taille) renvoyées en JSON lisible par l'interface
function uploadSingle(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    return res.status(400).json({ message: tooBig ? "Fichier trop volumineux (500 Mo maximum)." : err.message === "Format non supporté." ? "Format non supporté : PDF, PowerPoint (.ppt, .pptx, .pps, .ppsx) ou vidéo (.mp4, .webm, .mov)." : `Dépôt impossible : ${err.message}` });
  });
}

router.post("/upload", permit("admin", "formateur"), uploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Aucun fichier." });
    const url = `/uploads/training/${req.file.filename}`;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileType = ext === ".pdf" ? "pdf" : /^\.pp[st]x?$/.test(ext) ? "ppt" : "video";
    // Nom d'origine : multer le décode en latin1 (accents « Présentation » mal affichés sinon)
    let original = req.file.originalname;
    try { const utf = Buffer.from(original, "latin1").toString("utf8"); if (!utf.includes("\uFFFD")) original = utf; } catch { /* nom laissé tel quel */ }
    const out = { url, filename: original, size: req.file.size, fileType };
    if (fileType === "ppt") {
      const pdf = await convertToPdf(req.file.path);
      out.viewUrl = pdf ? `/uploads/training/${path.basename(pdf)}` : "";
      out.converted = !!pdf;
    } else if (fileType === "pdf") {
      out.viewUrl = url;
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ message: err.message || "Erreur upload." });
  }
});

/** GET /training/admin — Admin/Formateur: list all trainings with stats */
router.get("/admin", permit("admin", "formateur"), async (req, res) => {
  try {
    const items = await Training.find({ active: { $ne: false } })
      .select("-pdfData -questions.imageData")
      .sort({ createdAt: -1 })
      .lean();

    const result = items.map((t) => {
      const attempts = t.attempts || [];
      const attemptCount = attempts.length;
      let sumPct = 0;
      for (const a of attempts) sumPct += a.total > 0 ? (a.score / a.total) * 100 : 0;
      return { ...t, attempts: undefined, attemptCount, avgScore: attemptCount ? Math.round(sumPct / attemptCount) : 0 };
    });
    res.json(result);
  } catch (err) {
    console.error("GET /training/admin error:", err);
    res.status(500).json({ message: "Erreur." });
  }
});

/** GET /training/history/me — User quiz history */
router.get("/history/me", async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const trainings = await Training.find({ "attempts.user": userId })
      .select("title category attempts")
      .lean();

    const history = [];
    for (const t of trainings) {
      for (const a of (t.attempts || [])) {
        if (String(a.user) === String(userId)) {
          history.push({
            trainingId: t._id, trainingTitle: t.title, category: t.category || "",
            score: a.score, total: a.total,
            percent: a.total > 0 ? Math.round((a.score / a.total) * 100) : 0,
            completedAt: a.completedAt,
          });
        }
      }
    }
    history.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    res.json(history);
  } catch (err) {
    console.error("GET /training/history/me error:", err);
    res.status(500).json({ message: "Erreur." });
  }
});

/** GET /training/stats/global — Admin: training platform KPIs */
router.get("/stats/global", permit("admin", "formateur"), async (req, res) => {
  try {
    const trainings = await Training.find({ active: { $ne: false } }).select("title questions attempts category").lean();

    let totalTrainings = trainings.length, totalQuestions = 0, totalAttempts = 0, totalScore = 0;
    const byTraining = [];

    for (const t of trainings) {
      const qCount = (t.questions || []).length;
      totalQuestions += qCount;
      const attempts = t.attempts || [];
      totalAttempts += attempts.length;
      let sum = 0;
      for (const a of attempts) { const pct = a.total > 0 ? (a.score / a.total) * 100 : 0; sum += pct; totalScore += pct; }
      byTraining.push({ id: t._id, title: t.title, category: t.category || "", questions: qCount, attempts: attempts.length, avgScore: attempts.length ? Math.round(sum / attempts.length) : 0 });
    }
    res.json({ totalTrainings, totalQuestions, totalAttempts, avgScore: totalAttempts > 0 ? Math.round(totalScore / totalAttempts) : 0, byTraining });
  } catch (err) {
    console.error("GET /training/stats/global error:", err);
    res.status(500).json({ message: "Erreur." });
  }
});

/** Tentatives de l'utilisateur courant (sans exposer celles des autres). */
const { quizAttemptInfo: myAttemptInfo } = require("../utils/evalRules");
const isTrainingManager = (req) => ["admin", "formateur"].includes(req.user.role);

/** GET /training — User: list visible trainings */
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const role = req.user.role;
    const User = require("../models/User");
    const me = await User.findById(userId).select("cell").lean();
    const myCell = me?.cell || "";

    const q = {
      active: { $ne: false },
      $or: [
        { $and: [
          { $or: [{ roles: { $size: 0 } }, { roles: { $exists: false } }] },
          { $or: [{ targetCells: { $size: 0 } }, { targetCells: { $exists: false } }] },
          { $or: [{ targetUsers: { $size: 0 } }, { targetUsers: { $exists: false } }] },
        ]},
        { roles: role },
        ...(myCell ? [{ targetCells: myCell }] : []),
        { targetUsers: userId },
      ],
    };
    const items = await Training.find(q).select("-pdfData -starts -questions.imageData -attempts.answers").sort({ createdAt: -1 }).lean();
    res.json(items.map((t) => {
      const info = myAttemptInfo(t, userId);
      // Les bonnes réponses ne quittent pas le serveur
      const questions = (t.questions || []).map(({ correctIndex, ...rest }) => rest);
      return { ...t, questions, attempts: undefined, ...info };
    }));
  } catch (err) {
    console.error("GET /training error:", err);
    res.status(500).json({ message: "Erreur." });
  }
});

/** POST /training — Create training */
router.post("/", permit("admin", "formateur"), async (req, res) => {
  try {
    const { title, description, pdfUrl, pdfData, videoUrl, category, roles, targetCells, targetUsers, questions, allowMultipleAttempts, passThreshold, fileUrl, fileName, fileType } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ message: "Titre obligatoire." });
    const timeLimitMinutes = parseTimeLimit(req.body.timeLimitMinutes);
    if (timeLimitMinutes === undefined) return res.status(400).json({ message: "Délai de passation invalide (0 à 600 minutes)." });
    const dueDate = parseDueDate(req.body.dueDate);
    if (dueDate === undefined) return res.status(400).json({ message: "Date d'échéance invalide." });

    const t = await Training.create({
      title: title.trim(), description: description || "", pdfUrl: pdfUrl || "", pdfData: pdfData || "",
      videoUrl: videoUrl || "", category: category || "",
      fileUrl: uploadedPath(fileUrl), fileName: String(fileName || "").slice(0, 200), fileType: ["pdf", "ppt"].includes(fileType) ? fileType : "",
      timeLimitMinutes,
      roles: Array.isArray(roles) ? roles : [], targetCells: Array.isArray(targetCells) ? targetCells : [],
      targetUsers: Array.isArray(targetUsers) ? targetUsers : [],
      allowMultipleAttempts: allowMultipleAttempts !== false,
      passThreshold: Number.isFinite(Number(passThreshold)) ? Number(passThreshold) : 80,
      questions: Array.isArray(questions) ? questions : [],
      dueDate,
      createdBy: req.user.id || req.user._id,
    });

    // Push notification
    try {
      const notif = await Notification.create({
        type: "information", title: "Nouvelle formation disponible",
        message: `📚 "${t.title}" est disponible. ${(t.questions || []).length > 0 ? `Quiz de ${t.questions.length} questions inclus.` : ""}`,
        targetAll: true, createdBy: req.user.id || req.user._id, meta: { trainingId: String(t._id) },
      });
      const io = req.app.get("io");
      if (io) io.emit("notification:new", notif);
    } catch (_) {}

    res.status(201).json(t);
  } catch (err) {
    console.error("POST /training error:", err);
    res.status(500).json({ message: "Erreur création." });
  }
});

// ======================================================================
//  PARAMETERIZED ROUTES (/:id) — must come AFTER all static routes
// ======================================================================

/** GET /training/:id — Get full training detail */
router.get("/:id", async (req, res) => {
  try {
    const t = await Training.findById(req.params.id).select("-starts -attempts.answers").lean();
    if (!t) return res.status(404).json({ message: "Formation introuvable." });
    const info = myAttemptInfo(t, req.user.id || req.user._id);
    const questions = isTrainingManager(req) ? t.questions : (t.questions || []).map(({ correctIndex, ...rest }) => rest);
    res.json({ ...t, questions, attempts: undefined, ...info });
  } catch (err) {
    res.status(500).json({ message: "Erreur." });
  }
});

/** PATCH /training/:id — Update training */
router.patch("/:id", permit("admin", "formateur"), async (req, res) => {
  try {
    const update = {};
    const { title, description, pdfUrl, pdfData, videoUrl, category, roles, targetCells, targetUsers, questions, active, allowMultipleAttempts, passThreshold } = req.body;
    if (title !== undefined) update.title = String(title).trim();
    if (description !== undefined) update.description = String(description);
    if (pdfUrl !== undefined) update.pdfUrl = String(pdfUrl);
    if (pdfData !== undefined) update.pdfData = String(pdfData);
    if (videoUrl !== undefined) update.videoUrl = String(videoUrl);
    if (req.body.fileUrl !== undefined) update.fileUrl = uploadedPath(req.body.fileUrl);
    if (req.body.fileName !== undefined) update.fileName = String(req.body.fileName || "").slice(0, 200);
    if (req.body.fileType !== undefined) update.fileType = ["pdf", "ppt"].includes(req.body.fileType) ? req.body.fileType : "";
    if (req.body.timeLimitMinutes !== undefined) {
      const tl = parseTimeLimit(req.body.timeLimitMinutes);
      if (tl === undefined) return res.status(400).json({ message: "Délai de passation invalide (0 à 600 minutes)." });
      update.timeLimitMinutes = tl;
    }
    if (category !== undefined) update.category = String(category);
    if (roles !== undefined) update.roles = Array.isArray(roles) ? roles : [];
    if (targetCells !== undefined) update.targetCells = Array.isArray(targetCells) ? targetCells : [];
    if (targetUsers !== undefined) update.targetUsers = Array.isArray(targetUsers) ? targetUsers : [];
    if (questions !== undefined) update.questions = Array.isArray(questions) ? questions : [];
    if (active !== undefined) update.active = !!active;
    if (allowMultipleAttempts !== undefined) update.allowMultipleAttempts = !!allowMultipleAttempts;
    if (passThreshold !== undefined) update.passThreshold = Number.isFinite(Number(passThreshold)) ? Number(passThreshold) : 80;
    if (req.body.dueDate !== undefined) {
      const due = parseDueDate(req.body.dueDate);
      if (due === undefined) return res.status(400).json({ message: "Date d'échéance invalide." });
      update.dueDate = due;
    }

    const t = await Training.findByIdAndUpdate(req.params.id, update, { new: true }).select("-pdfData -attempts");
    if (!t) return res.status(404).json({ message: "Formation introuvable." });
    res.json(t);
  } catch (err) {
    res.status(500).json({ message: "Erreur mise à jour." });
  }
});

/** DELETE /training/:id — Admin only: permanent delete */
router.delete("/:id", permit("admin"), async (req, res) => {
  try {
    const t = await Training.findById(req.params.id);
    if (!t) return res.status(404).json({ message: "Formation introuvable." });

    // Cleanup uploaded video / support (et le PDF converti d'un PowerPoint)
    const fs = require("fs");
    const files = [t.videoUrl, t.fileUrl, t.fileType === "ppt" ? t.pdfUrl : ""].filter((u) => u && u.startsWith("/uploads/"));
    for (const u of files) {
      const filePath = path.join(__dirname, "..", u);
      if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch (_) {}
    }

    await Training.deleteOne({ _id: req.params.id });
    res.json({ ok: true, message: "Formation supprimée." });
  } catch (err) {
    console.error("DELETE /training/:id error:", err);
    res.status(500).json({ message: "Erreur suppression." });
  }
});

/** POST /training/:id/start — Contrat Orange : marque le quiz « en cours » pour l'utilisateur */
router.post("/:id/start", async (req, res) => {
  try {
    const mongoose = require("mongoose");
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "ID invalide." });
    const userId = req.user.id || req.user._id;
    const t = await Training.findById(req.params.id).select("allowMultipleAttempts attempts.user attempts.completedAt starts timeLimitMinutes questions._id").lean();
    if (!t) return res.status(404).json({ message: "Formation introuvable." });
    const info = quizStartInfo(t, userId);
    if (info.action === "blocked") {
      return res.status(403).json({ message: "Une seule tentative autorisée pour ce quiz. Vous l'avez déjà passé.", canAttempt: false });
    }
    if (info.action === "expired") {
      // Tentative unique commencée puis abandonnée au-delà du délai : enregistrée comme non réussie
      const total = (t.questions || []).length;
      await Training.updateOne(
        { _id: t._id, "attempts.user": { $ne: userId } },
        { $push: { attempts: { user: userId, answers: [], score: 0, total, completedAt: new Date(), timedOut: true } } }
      );
      return res.status(403).json({ message: `Délai de passation dépassé (${info.limit} min). Une seule tentative était autorisée.`, code: "QUIZ_TIMEOUT", canAttempt: false });
    }
    if (info.action === "resume") {
      // Un passage déjà en cours : le chronomètre continue (il ne repart pas de zéro)
      return res.json({ ok: true, resumed: true, startedAt: info.startedAt, timeLimitMinutes: info.limit, deadline: info.deadline });
    }
    const startedAt = new Date();
    await Training.updateOne({ _id: req.params.id }, { $pull: { starts: { user: userId } } });
    await Training.updateOne({ _id: req.params.id }, { $push: { starts: { user: userId, startedAt } } });
    const limit = info.limit;
    res.json({ ok: true, startedAt, timeLimitMinutes: limit, deadline: limit ? new Date(startedAt.getTime() + limit * 60000) : null });
  } catch (err) {
    console.error("POST /training/:id/start error:", err);
    res.status(500).json({ message: "Erreur." });
  }
});

/** POST /training/:id/attempt — Submit quiz answers */
router.post("/:id/attempt", async (req, res) => {
  try {
    const t = await Training.findById(req.params.id);
    if (!t) return res.status(404).json({ message: "Formation introuvable." });

    const userId = String(req.user.id || req.user._id);

    if (t.allowMultipleAttempts === false) {
      if ((t.attempts || []).some((a) => String(a.user) === userId)) {
        return res.status(403).json({ message: "Une seule tentative autorisée pour ce quiz. Vous l'avez déjà passé.", canAttempt: false });
      }
    }

    const { answers } = req.body;
    if (!Array.isArray(answers)) return res.status(400).json({ message: "Réponses requises." });

    // Délai de passation : au-delà (marge réseau comprise), la tentative est refusée
    const limitMin = Number(t.timeLimitMinutes) || 0;
    let timedOut = false;
    if (limitMin > 0) {
      const st = (t.starts || []).find((x) => String(x.user) === userId);
      if (!st) return res.status(400).json({ message: "Démarrez le quiz avant d'envoyer vos réponses." });
      const elapsed = Date.now() - new Date(st.startedAt).getTime();
      if (elapsed > limitMin * 60000 + QUIZ_GRACE_MS) {
        if (t.allowMultipleAttempts === false) {
          await Training.updateOne(
            { _id: t._id, "attempts.user": { $ne: req.user.id || req.user._id } },
            { $push: { attempts: { user: req.user.id || req.user._id, answers: [], score: 0, total: (t.questions || []).length, completedAt: new Date(), timedOut: true } } }
          );
        }
        return res.status(403).json({ message: `Délai de passation dépassé (${limitMin} min). Réponses non enregistrées.`, code: "QUIZ_TIMEOUT" });
      }
      timedOut = elapsed > limitMin * 60000;
    }

    let score = 0;
    const total = (t.questions || []).length;
    (t.questions || []).forEach((q, idx) => { if (answers[idx] === q.correctIndex) score++; });

    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
    const threshold = Number.isFinite(t.passThreshold) ? t.passThreshold : 80;

    const attempt = { user: req.user.id || req.user._id, answers, score, total, completedAt: new Date(), timedOut };
    // Écriture atomique : en tentative unique, la condition empêche un double envoi simultané
    const cond = { _id: t._id };
    if (t.allowMultipleAttempts === false) cond["attempts.user"] = { $ne: attempt.user };
    const upd = await Training.updateOne(cond, { $push: { attempts: attempt } });
    if (!upd.modifiedCount) {
      return res.status(403).json({ message: "Une seule tentative autorisée pour ce quiz. Vous l'avez déjà passé.", canAttempt: false });
    }

    res.json({ score, total, percent, passed: percent >= threshold, threshold });
  } catch (err) {
    console.error("POST /training/:id/attempt error:", err);
    res.status(500).json({ message: "Erreur." });
  }
});

/** GET /training/:id/results — Admin: quiz results for a training */
router.get("/:id/results", permit("admin", "formateur"), async (req, res) => {
  try {
    const t = await Training.findById(req.params.id)
      .select("title attempts questions")
      .populate("attempts.user", "name email role cell")
      .lean();
    if (!t) return res.status(404).json({ message: "Formation introuvable." });

    res.json({
      title: t.title,
      questionCount: (t.questions || []).length,
      attempts: (t.attempts || []).map((a) => ({
        user: a.user, score: a.score, total: a.total,
        percent: a.total > 0 ? Math.round((a.score / a.total) * 100) : 0,
        completedAt: a.completedAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: "Erreur." });
  }
});

module.exports = router;
module.exports._test = { quizStartInfo };
