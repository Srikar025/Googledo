import prisma from "../db/prisma";
import { v4 as uuidv4 } from "uuid";

// Get or create a document by ID
export async function getOrCreateDocument(id: string) {
  let document = await prisma.document.findUnique({ where: { id } });

  if (!document) {
    document = await prisma.document.create({
      data: {
        id,
        title: "Untitled Document",
        content: "",
      },
    });
  }

  return document;
}

// Create a brand-new document with a generated ID
export async function createDocument() {
  const document = await prisma.document.create({
    data: {
      id: uuidv4(),
      title: "Untitled Document",
      content: "",
    },
  });
  return document;
}

// Save document content
export async function saveDocument(id: string, content: string) {
  return prisma.document.update({
    where: { id },
    data: { content },
  });
}
