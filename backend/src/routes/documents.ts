import { Router } from "express";
import { createDocument, getOrCreateDocument, saveDocument } from "../services/document";
import { createVersion, getVersionsList, getVersionContent } from "../services/version";

const router = Router();

// POST /api/documents — create a new blank document, returns its ID
router.post("/", async (_req, res) => {
  try {
    const doc = await createDocument();
    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create document" });
  }
});

// GET /api/documents/:id — get (or auto-create) a document by ID
router.get("/:id", async (req, res) => {
  try {
    const doc = await getOrCreateDocument(req.params.id);
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// PATCH /api/documents/:id — save content
router.patch("/:id", async (req, res) => {
  try {
    const { content } = req.body as { content: string };
    const doc = await saveDocument(req.params.id, content);
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save document" });
  }
});

// POST /api/documents/:id/versions — create a version snapshot
router.post("/:id/versions", async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    const version = await createVersion(req.params.id, name);
    res.status(201).json(version);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to create version snapshot" });
  }
});

// GET /api/documents/:id/versions — list all versions for a document
router.get("/:id/versions", async (req, res) => {
  try {
    const versions = await getVersionsList(req.params.id);
    res.json(versions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch version history" });
  }
});

// GET /api/documents/:id/versions/:versionId — get full content of a specific version
router.get("/:id/versions/:versionId", async (req, res) => {
  try {
    const version = await getVersionContent(req.params.versionId);
    if (!version) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    res.json(version);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch version content" });
  }
});

export default router;
