# ✦ CollabDocs — Real-Time Collaborative Document Editor

A full-stack, Google Docs-style collaborative rich-text editor built with **CRDTs (Conflict-free Replicated Data Types)**. Multiple users can write and edit the same document simultaneously — no conflicts, no overwriting.

---

## 🚀 Features

- 📝 **Real-time collaboration** — multiple users edit the same document simultaneously
- ⚡ **Yjs CRDT engine** — conflict-free merging of concurrent edits
- 🖊️ **Rich text editing** — powered by Quill 2 (bold, italic, headings, lists, code blocks, links, and more)
- 👥 **Live presence** — see collaborator avatars, names, and colored cursors in real time
- 🕒 **Version history** — save named snapshots and restore any previous revision
- 🔗 **Instant sharing** — share a document link with anyone to start collaborating
- 💾 **Persistent storage** — documents and versions saved to PostgreSQL via Supabase
- 🔴 **Redis pub/sub** — scalable real-time sync via Upstash Redis
- 🎨 **Clean light UI** — modern Google Docs-inspired interface

---

## 🏗️ Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| React 19 + TypeScript | UI framework |
| Vite 8 | Build tool & dev server |
| Quill 2 | Rich text editor |
| Yjs | CRDT collaborative sync |
| Socket.IO Client | Real-time WebSocket communication |
| React Router v7 | Client-side routing |
| Axios | HTTP requests |
| TailwindCSS v4 | Utility-first styling |

### Backend
| Technology | Purpose |
|---|---|
| Node.js + TypeScript | Runtime & language |
| Express 5 | HTTP REST API |
| Socket.IO 4 | WebSocket server |
| Yjs | CRDT state management on server |
| Prisma ORM | Database access layer |
| PostgreSQL (Supabase) | Persistent document & version storage |
| Redis (Upstash) | Real-time pub/sub for horizontal scaling |
| UUID | Unique document ID generation |

---

## 📁 Project Structure

```
CollabDocs/
├── frontend/                  # React + Vite application
│   ├── src/
│   │   ├── components/
│   │   │   ├── Editor.tsx     # Quill editor component
│   │   │   └── Editor.css     # Editor light theme styles
│   │   ├── pages/
│   │   │   ├── Home.tsx       # Landing page (create/join doc)
│   │   │   └── Editor.tsx     # Full editor page with collaboration
│   │   ├── sockets/
│   │   │   └── socket.ts      # Socket.IO client setup
│   │   ├── App.tsx            # Root component & routes
│   │   ├── index.css          # Global styles & CSS variables
│   │   └── main.tsx           # App entry point
│   ├── vite.config.ts
│   └── package.json
│
└── backend/                   # Express + Socket.IO server
    ├── src/
    │   ├── routes/
    │   │   └── documents.ts   # REST API routes
    │   ├── socket/
    │   │   └── socketHandler.ts # Real-time socket event handlers
    │   ├── services/          # Business logic / Redis helpers
    │   ├── db/                # Prisma client instance
    │   └── server.ts          # App entry point
    ├── prisma/
    │   └── schema.prisma      # Database schema (Document + Version)
    ├── .env                   # Environment variables (see below)
    └── package.json
```

---

## ⚙️ Prerequisites

Make sure you have the following installed:

- **Node.js** v18 or higher — [nodejs.org](https://nodejs.org)
- **npm** v9 or higher (comes with Node.js)
- A **Supabase** project (free tier works) — [supabase.com](https://supabase.com)
- An **Upstash Redis** database (free tier works) — [upstash.com](https://upstash.com)

---

## 🛠️ Setup & Installation

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd CollabDocs
```

### 2. Configure environment variables

Copy the example env file in the `backend/` directory:

```bash
cd backend
cp .env.example .env
```

Then open `backend/.env` and fill in your credentials:

```env
# PostgreSQL connection (from Supabase → Project Settings → Database)
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.<project-ref>:<password>@aws-<region>.pooler.supabase.com:5432/postgres"

# Redis (from Upstash → your database → Redis URL)
REDIS_URL="rediss://default:<password>@<host>.upstash.io:6379"

# Frontend origin (for CORS)
FRONTEND_URL="http://localhost:3000"
```

### 3. Install dependencies

**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd ../frontend
npm install
```

### 4. Run database migrations

```bash
cd backend
npx prisma migrate deploy
```

Or, if setting up fresh:
```bash
npx prisma migrate dev --name init
```

### 5. Start the development servers

**Terminal 1 — Backend** (runs on port `5000`):
```bash
cd backend
npm run dev
```

**Terminal 2 — Frontend** (runs on port `3000`):
```bash
cd frontend
npm run dev
```

Open your browser at **[http://localhost:3000](http://localhost:3000)** 🎉

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/documents` | Create a new document |
| `GET` | `/api/documents/:id` | Get document by ID |
| `GET` | `/api/documents/:id/versions` | List all saved versions |
| `POST` | `/api/documents/:id/versions` | Save a new named version |
| `GET` | `/api/documents/:id/versions/:vid` | Get a specific version content |
| `GET` | `/health` | Server health check |

---

## 🔄 How Real-Time Collaboration Works

```
User A types          User B types
    │                     │
    ▼                     ▼
Quill Editor          Quill Editor
    │                     │
    ▼                     ▼
Yjs (local CRDT)      Yjs (local CRDT)
    │                     │
    └────── Socket.IO ────┘
              │
              ▼
        Backend Server
        (Yjs + Redis pub/sub)
              │
              ▼
        PostgreSQL (Supabase)
        [Periodic persistence]
```

1. Each user has a local **Yjs document** bound to their Quill editor
2. When a user types, the Yjs delta is emitted via **Socket.IO** to the server
3. The server applies the update to its own Yjs state and broadcasts it to all other clients in the room
4. **Redis pub/sub** enables this to work across multiple server instances
5. The final merged state is periodically persisted to **PostgreSQL via Prisma**

---

## 🗄️ Database Schema

```prisma
model Document {
  id        String    @id @default(uuid())
  title     String
  content   String    @default("")
  createdAt DateTime  @default(now())
  versions  Version[]
}

model Version {
  id         String   @id @default(uuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  name       String
  content    String   // Base64-encoded Yjs state snapshot
  createdAt  DateTime @default(now())
}
```

---

## 📦 All Dependencies

### Frontend (`frontend/package.json`)

| Package | Version | Role |
|---|---|---|
| `react` | ^19.2.7 | UI library |
| `react-dom` | ^19.2.7 | DOM rendering |
| `react-router-dom` | ^7.17.0 | Client-side routing |
| `quill` | ^2.0.3 | Rich text editor |
| `@types/quill` | ^2.0.14 | Quill TypeScript types |
| `yjs` | ^13.6.31 | CRDT collaborative sync |
| `socket.io-client` | ^4.8.3 | Real-time WebSocket client |
| `axios` | ^1.17.0 | HTTP API client |
| `vite` | ^8.0.12 | Build tool & dev server |
| `@vitejs/plugin-react` | ^6.0.2 | React plugin for Vite |
| `tailwindcss` | ^4.3.1 | CSS utility framework |
| `@tailwindcss/vite` | ^4.3.1 | Tailwind Vite integration |
| `typescript` | ~6.0.2 | TypeScript compiler |
| `@types/react` | ^19.2.17 | React TypeScript types |
| `@types/react-dom` | ^19.2.3 | React DOM TypeScript types |

### Backend (`backend/package.json`)

| Package | Version | Role |
|---|---|---|
| `express` | ^5.2.1 | HTTP web framework |
| `socket.io` | ^4.8.3 | Real-time WebSocket server |
| `yjs` | ^13.6.31 | CRDT engine on server |
| `@prisma/client` | ^6.19.3 | Database ORM client |
| `prisma` | ^6.19.3 | Prisma CLI & migrations |
| `@upstash/redis` | ^1.38.0 | Upstash Redis SDK |
| `ioredis` | ^5.11.1 | Redis client (pub/sub) |
| `cors` | ^2.8.6 | CORS middleware |
| `dotenv` | ^17.4.2 | Environment variable loader |
| `uuid` | ^11.1.1 | Unique ID generation |
| `ts-node-dev` | ^2.0.0 | TypeScript dev runner with hot reload |
| `typescript` | ^6.0.3 | TypeScript compiler |
| `@types/express` | ^5.0.6 | Express TypeScript types |
| `@types/cors` | ^2.8.19 | CORS TypeScript types |
| `@types/node` | ^25.9.3 | Node.js TypeScript types |
| `@types/uuid` | ^10.0.0 | UUID TypeScript types |

---

## 🧑‍💻 Development Scripts

### Backend
```bash
npm run dev      # Start with hot-reload (ts-node-dev)
npm run build    # Compile TypeScript → dist/
npm run start    # Run compiled production build
```

### Frontend
```bash
npm run dev      # Start Vite dev server (http://localhost:3000)
npm run build    # Build for production
npm run preview  # Preview production build locally
```

---

## 🌐 Deployment Notes

- Set `FRONTEND_URL` in backend `.env` to your deployed frontend origin (e.g., `https://your-app.vercel.app`)
- The frontend Vite proxy (`/api` → `localhost:5000`) only applies in dev — update your production API base URL accordingly
- Run `npx prisma migrate deploy` in your production environment before starting the server

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
