import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import documentRoutes from "./routes/documents";
import { registerSocketHandlers } from "./socket/socketHandler";

const app = express();
const PORT = process.env.PORT || 5000;

// ── Allowed Origins (dev + production) ──────────────────────────────────────
const allowedOrigins: string[] = ["http://localhost:3000"];
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json());

// ── REST Routes ──────────────────────────────────────────────────────────────
app.use("/api/documents", documentRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── HTTP Server (wraps Express so Socket.io can share the same port) ─────────
const httpServer = http.createServer(app);

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

registerSocketHandlers(io);

// ── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`🚀 Server + Socket.io running on http://localhost:${PORT}`);
});