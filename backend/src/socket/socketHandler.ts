import * as Y from "yjs";
import { Server, Socket } from "socket.io";
import { getOrCreateDocument, saveDocument } from "../services/document";
import { publishUpdate, subscribeToUpdates } from "../services/redis";

const CURSOR_COLORS = [
  "#F87171", // Light red
  "#FB923C", // Orange
  "#FBBF24", // Amber
  "#34D399", // Emerald
  "#60A5FA", // Light blue
  "#818CF8", // Indigo
  "#A78BFA", // Purple
  "#F472B6", // Pink
];

// ── Per-document server state ────────────────────────────────────────────────
interface DocState {
  ydoc: Y.Doc;
  users: Set<string>;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

const docs = new Map<string, DocState>();

function getDocState(docId: string): DocState {
  if (!docs.has(docId)) {
    docs.set(docId, { ydoc: new Y.Doc(), users: new Set(), saveTimer: null });
  }
  return docs.get(docId)!;
}

function scheduleSave(docId: string, state: DocState) {
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    const encoded = Buffer.from(Y.encodeStateAsUpdate(state.ydoc)).toString("base64");
    await saveDocument(docId, encoded).catch(console.error);
  }, 3000);
}

// ── Main handler ─────────────────────────────────────────────────────────────
export function registerSocketHandlers(io: Server) {

  // ── Redis subscriber: receive updates from OTHER server instances ─────────
  // When another instance handles a Yjs update, it publishes to Redis.
  // We receive it here, apply it to our local Y.Doc, and relay to our sockets.
  subscribeToUpdates((docId, update) => {
    const state = docs.get(docId);
    if (!state || state.users.size === 0) return; // no users on this instance for this doc

    Y.applyUpdate(state.ydoc, update, "redis");       // merge into local Y.Doc
    io.to(docId).emit("yjs-update", update);          // forward to connected clients
    scheduleSave(docId, state);
  });

  io.on("connection", (socket: Socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // Per-socket user info (set by client on join)
    let userInfo: { name: string; color: string } | null = null;

    // ── Join document room ──────────────────────────────────────────────────
    socket.on("join-document", async (docId: string, user?: { name: string; color: string }) => {
      if (!docId) return;

      socket.join(docId);
      const state = getDocState(docId);
      state.users.add(socket.id);

      // Store user info
      userInfo = user ?? { name: `User ${socket.id.slice(0, 4)}`, color: CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)] };

      // Bootstrap Y.Doc from DB on first user on THIS instance
      if (state.users.size === 1) {
        try {
          const dbDoc = await getOrCreateDocument(docId);
          if (dbDoc.content) {
            try {
              const update = Buffer.from(dbDoc.content, "base64");
              Y.applyUpdate(state.ydoc, update);
            } catch {
              console.warn(`⚠️  Could not parse Yjs state for "${docId}" — starting fresh`);
            }
          }
        } catch (err) {
          console.error("Error loading document from DB:", err);
        }
      }

      // Send full current Y.Doc state to new user
      socket.emit("load-document", Y.encodeStateAsUpdate(state.ydoc));

      // Notify everyone about the new user
      socket.to(docId).emit("user-joined", { socketId: socket.id, ...userInfo });

      // Send the new user the list of everyone already in the room
      const existingUsers: Record<string, { name: string; color: string }> = {};
      const socketsInRoom = await io.in(docId).fetchSockets();
      for (const s of socketsInRoom) {
        if (s.id === socket.id) continue;
        // We store userInfo per socket via the data property
        if (s.data?.userInfo) {
          existingUsers[s.id] = s.data.userInfo;
        }
      }
      // Store user info on the socket for later lookups
      socket.data.userInfo = userInfo;
      socket.emit("existing-users", existingUsers);

      io.to(docId).emit("collaborators-count", state.users.size);
      console.log(`📄 ${socket.id} (${userInfo.name}) joined "${docId}" (${state.users.size} users)`);
    });

    // ── Cursor position relay ───────────────────────────────────────────────
    socket.on("cursor-move", (docId: string, range: { index: number; length: number } | null) => {
      if (!userInfo) return;
      socket.to(docId).emit("cursor-move", {
        socketId: socket.id,
        name: userInfo.name,
        color: userInfo.color,
        range,
      });
    });

    // ── Update user info ────────────────────────────────────────────────────
    socket.on("update-user-info", (docId: string, user: { name: string; color: string }) => {
      userInfo = user;
      socket.data.userInfo = userInfo;
      socket.to(docId).emit("user-updated", { socketId: socket.id, ...userInfo });
    });

    // ── Receive Yjs update from a client ────────────────────────────────────
    socket.on("yjs-update", async (docId: string, update: Uint8Array) => {
      const state = getDocState(docId);

      // 1. Merge into this instance's Y.Doc
      Y.applyUpdate(state.ydoc, update, "socket");

      // 2. Broadcast to other clients on THIS instance
      socket.to(docId).emit("yjs-update", update);

      // 3. Publish to Redis → other server instances pick it up
      await publishUpdate(docId, update);

      // 4. Schedule DB save
      scheduleSave(docId, state);
    });

    // ── Disconnect cleanup ──────────────────────────────────────────────────
    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room === socket.id) continue;

        const state = docs.get(room);
        if (!state) continue;

        state.users.delete(socket.id);

        // Notify others this user left
        io.to(room).emit("user-left", socket.id);

        if (state.users.size === 0) {
          const encoded = Buffer.from(Y.encodeStateAsUpdate(state.ydoc)).toString("base64");
          saveDocument(room, encoded).catch(console.error);
          if (state.saveTimer) clearTimeout(state.saveTimer);
          docs.delete(room);
        } else {
          io.to(room).emit("collaborators-count", state.users.size);
        }
      }
      console.log(`🔴 Disconnected: ${socket.id}${userInfo ? ` (${userInfo.name})` : ""}`);
    });
  });
}
