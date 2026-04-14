/**
 * POST /api/settings/dove/avatar — Upload a new Dove avatar image.
 * Accepts multipart/form-data with a "file" field.
 * Saves to chatbot/public/uploads/dove-avatar.<ext> and returns the public URL.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { CHATBOT_PUBLIC_DIR } from "@@/lib/paths";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json(
      { error: "Unsupported file type. Use JPEG, PNG, WebP, or GIF." },
      { status: 415 },
    );
  }

  const ext = extname(file.name) || `.${file.type.split("/")[1]}`;
  const filename = `dove-avatar${ext}`;
  const uploadsDir = join(CHATBOT_PUBLIC_DIR, "uploads");
  mkdirSync(uploadsDir, { recursive: true });

  const bytes = await file.arrayBuffer();
  writeFileSync(join(uploadsDir, filename), Buffer.from(bytes));

  return Response.json({ url: `/uploads/${filename}` });
}
