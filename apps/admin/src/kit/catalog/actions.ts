"use server";

// Server actions of the catalog: save a position by form, change its status, preview and apply an import from a file.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guardAction, NOT_ALLOWED } from "../../auth/next.ts";
import { getRuntime } from "../../auth/runtime.ts";
import { decodeCsvBytes } from "../csv.ts";
import { formDataSource } from "../form.ts";
import type { FormState } from "../ui/SchemaForm.tsx";
import type { CatalogValue } from "./resource.ts";

const text = (data: FormData, name: string): string => {
  const v = data.get(name);
  return typeof v === "string" ? v : "";
};

export async function saveCatalogAction(_previous: FormState, data: FormData): Promise<FormState> {
  const user = await guardAction("catalog.write", "catalog.save", "catalog.products");
  const { catalog } = getRuntime();
  if (!user) return { ok: false, message: NOT_ALLOWED, errors: {}, values: {} };
  const id = text(data, "id") || null;
  const result = await catalog.save(user, id, formDataSource(data));
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors,
      values: result.value,
      fields: catalog.formModel(result.value).fields,
      hiddenNames: catalog.hiddenNames(result.value),
      message: "Позиция не сохранена: проверьте отмеченные поля.",
    };
  }
  revalidatePath("/catalog");
  if (id === null) redirect(`/catalog/${result.id}?created=1`);
  revalidatePath(`/catalog/${id}`);
  return {
    ok: true,
    errors: {},
    values: result.value,
    fields: catalog.formModel(result.value).fields,
    hiddenNames: catalog.hiddenNames(result.value),
    message: "Сохранено.",
  };
}

export interface StatusState {
  error?: string;
}

/** `status` is draft, verified or retired; the database refuses `verified` for a position with unknown key fields. */
export async function setCatalogStatusAction(_previous: StatusState, data: FormData): Promise<StatusState> {
  const user = await guardAction("catalog.write", "catalog.status", "catalog.products");
  if (!user) return { error: NOT_ALLOWED };
  const id = text(data, "id");
  const result = await getRuntime().catalog.setStatus(user, id, text(data, "status"));
  if (!result.ok) return { error: Object.values(result.errors).join(" ") };
  revalidatePath(`/catalog/${id}`);
  revalidatePath("/catalog");
  return {};
}

// ---- import from a file --------------------------------------------------------------------------------------------------

export interface ImportPreviewRow {
  line: number;
  status: "new" | "update" | "error";
  label: string;
  errors: { field: string; message: string }[];
}

export interface ImportState {
  phase: "idle" | "preview" | "applied" | "error";
  error?: string;
  /** The file text, carried to the second step so that what is applied is exactly what was previewed. */
  csv?: string;
  counts?: { new: number; update: number; error: number };
  rows?: ImportPreviewRow[];
  applied?: { created: number; updated: number };
  failed?: { line: number; message: string }[];
}

// Next.js stops the body of a server action at 1 MB, and the second step sends the text of the file again as a hidden
// field: the file is limited to half of that, so that the message below reaches the person instead of a failed request.
const MAX_FILE_BYTES = 512 * 1024;
const TOO_BIG = "Файл больше 512 КБ.";

async function fileText(data: FormData): Promise<string | { error: string }> {
  const file = data.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { error: TOO_BIG };
    return decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
  }
  const pasted = text(data, "csv");
  if (Buffer.byteLength(pasted, "utf8") > MAX_FILE_BYTES) return { error: TOO_BIG };
  return pasted.trim() === "" ? { error: "Выберите файл CSV." } : pasted;
}

const flat = (errors: Record<string, string>) => Object.entries(errors).map(([field, message]) => ({ field, message }));

export async function previewImportAction(_previous: ImportState, data: FormData): Promise<ImportState> {
  const user = await guardAction("catalog.import", "catalog.import_preview", "catalog.products");
  if (!user) return { phase: "error", error: NOT_ALLOWED };
  const body = await fileText(data);
  if (typeof body !== "string") return { phase: "error", error: body.error };
  const plan = await getRuntime().catalog.importPreview(user, body);
  if (!plan.ok) return { phase: "error", error: plan.error };
  return {
    phase: "preview",
    csv: body,
    counts: plan.counts,
    rows: plan.rows.map((r) => {
      const v = r.value as CatalogValue | undefined;
      return { line: r.line, status: r.status, label: v ? `${v.brand} ${v.model}` : "", errors: flat(r.errors) };
    }),
  };
}

export async function applyImportAction(_previous: ImportState, data: FormData): Promise<ImportState> {
  const user = await guardAction("catalog.import", "catalog.import_apply", "catalog.products");
  if (!user) return { phase: "error", error: NOT_ALLOWED };
  const body = text(data, "csv");
  const result = await getRuntime().catalog.importApply(user, body);
  if (!result.ok) return { phase: "error", error: result.error };
  revalidatePath("/catalog");
  return {
    phase: "applied",
    applied: result.applied,
    failed: result.failed.map((f) => ({
      line: f.line,
      message: Object.entries(f.errors)
        .map(([field, message]) => (field ? `${field}: ${message}` : message))
        .join("; "),
    })),
  };
}
