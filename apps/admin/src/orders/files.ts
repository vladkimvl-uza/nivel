// Serves a registered file of an order. The bytes were cleaned of the shooting data when they were uploaded (kit/upload);
// the person must be signed in with the right to see orders. The type is the one the registry holds, never a guess.
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { UuidSchema } from "@nivel/contracts/orders";
import { currentUser } from "../auth/next.ts";
import { getRuntime } from "../auth/runtime.ts";
import { canDo } from "./access.ts";

const SAFE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export function filesRoot(): string {
  const env = getRuntime().env;
  return resolve(env.FILES_DIR ?? join(process.cwd(), ".data", "files"));
}

const plain = (status: number, text: string): Response =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function serveFile(id: string): Promise<Response> {
  const user = await currentUser();
  if (!user) return plain(401, "Войдите в админку.");
  if (!canDo(user.role, "orders.read")) return plain(403, "Недостаточно прав.");
  if (!UuidSchema.safeParse(id).success) return plain(404, "Файл не найден.");
  const { rows } = await getRuntime().db.$client.query<{ storage_key: string; mime: string }>(
    "select storage_key, mime from ops.files where id = $1",
    [id],
  );
  const row = rows[0];
  if (!row || !SAFE_TYPES.has(row.mime)) return plain(404, "Файл не найден.");
  const base = filesRoot();
  const target = resolve(join(base, row.storage_key));
  if (!target.startsWith(base + sep)) return plain(404, "Файл не найден.");
  try {
    const bytes = await readFile(/* turbopackIgnore: true */ target);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": row.mime,
        "content-length": String(bytes.length),
        "content-disposition": "inline",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        ...(row.mime.startsWith("image/") ? { "content-security-policy": "default-src 'none'; sandbox" } : {}),
      },
    });
  } catch (error) {
    // A file that is gone is a 404; a folder that cannot be read (rights, a failing disk) is ours to know about.
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return plain(404, "Файл не найден.");
    console.error(`[orders] the file ${id} could not be read:`, error);
    return plain(500, "Файл сейчас не читается. Повторите позже.");
  }
}
