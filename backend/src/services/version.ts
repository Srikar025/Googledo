import prisma from "../db/prisma";

// Create a new version snapshot for a document
export async function createVersion(documentId: string, name?: string) {
  // Fetch current document state from the DB
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { content: true }
  });

  if (!doc) {
    throw new Error(`Document with ID ${documentId} not found`);
  }

  // Create a default name based on the current time if not provided
  const versionName = name?.trim() || `Version - ${new Date().toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;

  return prisma.version.create({
    data: {
      documentId,
      name: versionName,
      content: doc.content, // snapshot of the current base64 Yjs update
    },
  });
}

// Get the list of saved versions for a document (excludes content to save bandwidth)
export async function getVersionsList(documentId: string) {
  return prisma.version.findMany({
    where: { documentId },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

// Get a specific version details including the Yjs update content
export async function getVersionContent(versionId: string) {
  return prisma.version.findUnique({
    where: { id: versionId },
  });
}
