require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { Server: SocketIOServer } = require("socket.io");

const User = require("./models/User");

// 🔹 Routes
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const scoreRoutes = require("./routes/score.routes");
const managementRoutes = require("./routes/management.routes");
const gridRoutes = require("./routes/grid.routes");
const cqRoutes = require("./routes/cq.routes");
const notificationRoutes = require("./routes/notification.routes");
const coachingRoutes = require("./routes/coaching.routes");
const usersRoutes = require("./routes/users.routes");
const trainingRoutes = require("./routes/training.routes");
const callsRoutes = require("./routes/calls.routes");

// 🔹 App
const app = express();
app.set("startedAt", new Date().toISOString());

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Disable x-powered-by for security
app.disable("x-powered-by");

// 🔹 Uploads directory + static serving with cache
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir, { maxAge: "7d", etag: true }));

// 🔹 Test
app.get("/", (req, res) => {
  res.json({ message: "API KCQ opérationnelle 🚀" });
});

// 🔹 Route mounting with /api prefix
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/scores", scoreRoutes);
app.use("/api/management", managementRoutes);
app.use("/api/grids", gridRoutes);
app.use("/api/cq", cqRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/coaching", coachingRoutes);
app.use("/api/powerbi", require("./routes/powerbi.routes"));
app.use("/api/users", usersRoutes);
app.use("/api/training", trainingRoutes);
app.use("/api/calls", callsRoutes);
// Contrat Orange : indicateurs, échantillons, référentiels (routes nouvelles, préfixes inédits)
app.use("/api/kpi", require("./routes/kpi.routes"));
app.use("/api/samples", require("./routes/samples.routes"));
app.use("/api/referentials", require("./routes/referentials.routes"));

// 🔹 HTTP + Socket.io
const server = http.createServer(app);

let socketClients = 0;

const io = new SocketIOServer(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PATCH", "DELETE"] },
});

// expose io to routes
app.set("io", io);
app.set("socketClients", () => socketClients);

io.on("connection", async (socket) => {
  socketClients += 1;
  socket.on("disconnect", () => {
    socketClients = Math.max(0, socketClients - 1);
  });

  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      "";

    if (!token) return;

    const secret = process.env.JWT_SECRET || process.env.SECRET;
    if (!secret) return;
    const decoded = jwt.verify(String(token).replace(/^Bearer\s+/i, ""), secret);

    const userId = decoded?.id || decoded?._id || decoded?.userId;
    if (!userId) return;

    socket.join(`user:${userId}`);

    // also join by cell for targeted notifications
    const user = await User.findById(userId).select("cell").lean();
    const cell = (user?.cell || "").toString().trim();
    if (cell) socket.join(`cell:${cell}`);
  } catch (e) {
    // silent: don't kill connection for anonymous sockets
  }
});

// 🔹 DB + run
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/kcq";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connectée");
    server.listen(PORT, () => {
      console.log(`🚀 Serveur lancé sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Erreur MongoDB :", err);
  });

module.exports = app;
