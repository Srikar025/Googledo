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
// Hardcode known production origins so CORS works even if env vars are missing.
// FRONTEND_URL on Render is an extra override for custom domains.
const allowedOrigins: string[] = [
  "http://localhost:3000",
  "https://googledo.vercel.app",      // production Vercel frontend
];
if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
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