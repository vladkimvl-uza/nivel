// Catalog R0 (BUILD_PLAN WP-10): one form and one CSV import for a position of any category. The form is built from
// the zod schemas of the characteristics in @nivel/contracts/catalog by `defineResource`: the schema of the category
// chosen decides which fields exist, so the form and the contract cannot drift apart. After R0 the catalog screens
// pass to WP-18.
import { LocalizedSchema } from "@nivel/contracts";
import { FeeGroupSchema, ProductBaseSchema, ProductSpecsSchema } from "@nivel/contracts/catalog";
import { z } from "zod";
import type { AuditSink } from "../../auth/audit.ts";
import { defineResource, type Resource, type ResourceStore } from "../resource.ts";
import { CATALOG_LABELS } from "./labels.ts";

const baseShape = {
  brand: ProductBaseSchema.shape.brand,
  model: ProductBaseSchema.shape.model,
  mpn: ProductBaseSchema.shape.mpn,
  // What a file may leave out: the database has the same defaults.
  color: ProductBaseSchema.shape.color.default("other"),
  lighting: ProductBaseSchema.shape.lighting.default("none"),
  // Blank means "as the category says": the category carries the default group and returnability.
  feeGroup: FeeGroupSchema.optional(),
  returnable: z.boolean().optional(),
  manualOnly: ProductBaseSchema.shape.manualOnly.default(false),
  description: LocalizedSchema.optional(),
  status: ProductBaseSchema.shape.status,
  isDemo: ProductBaseSchema.shape.isDemo,
};

const arms = ProductSpecsSchema.options.map((arm) =>
  z.object({ category: arm.shape.category, ...baseShape, spec: arm.shape.spec }),
);

/** A catalog position of any category: the base fields and the specification of its category (draft: null = unknown). */
export const CatalogSchema = z.discriminatedUnion(
  "category",
  arms as unknown as [(typeof arms)[number], ...(typeof arms)[number][]],
);

export interface CatalogValue {
  category: string;
  brand: string;
  model: string;
  mpn?: string;
  color: "black" | "white" | "gray" | "other";
  lighting: "none" | "rgb" | "argb";
  feeGroup?: "pc" | "mount" | "outside_scale";
  returnable?: boolean;
  manualOnly: boolean;
  description?: { uz: string; ru: string };
  status: "draft" | "verified" | "retired";
  isDemo: boolean;
  spec: Record<string, unknown>;
}

const specOf = (v: unknown): Record<string, unknown> =>
  ((v as { spec?: Record<string, unknown> }).spec ?? {}) as Record<string, unknown>;

/** `rtx-5070-asus-dual-oc`: the address-safe name of a position; Cyrillic and other scripts drop out, the rest stays. */
export function slugOf(brand: string, model: string, mpn?: string): string {
  return [brand, model, mpn ?? ""]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** The natural key of a position: brand and part number, or brand and model when there is no part number. */
export function productKey(v: Pick<CatalogValue, "brand" | "model" | "mpn">): string {
  const mpn = v.mpn?.trim();
  return `${v.brand.trim().toLowerCase()}|${mpn ? mpn.toLowerCase() : `model:${v.model.trim().toLowerCase()}`}`;
}

export function createCatalogResource(store: ResourceStore<CatalogValue>, auditSink: AuditSink) {
  return defineResource({
    name: "catalog",
    title: "Каталог",
    table: "catalog.products",
    schema: CatalogSchema as unknown as z.ZodType<CatalogValue>,
    store,
    list: {
      columns: ["category", "brand", "model", "mpn", "status"],
      filters: [
        { field: "category", label: "Категория", kind: "select" },
        {
          field: "status",
          label: "Статус",
          kind: "select",
          options: [
            { value: "draft", label: "Черновик" },
            { value: "verified", label: "Проверено" },
            { value: "retired", label: "Снято" },
          ],
        },
        { field: "q", label: "Поиск", kind: "text" },
      ],
      defaultSort: "category",
    },
    form: {
      hidden: ["status", "isDemo"],
      defaults: { status: "draft", isDemo: false },
      conditional: {
        // A PCIe generation exists only for NVMe; a heatsink only for M.2 drives.
        "spec.pcieGen": (v) => (v.category === "ssd" ? specOf(v).iface !== "sata" : true),
        "spec.heatsinkHeightMm": (v) =>
          v.category === "ssd"
            ? String(specOf(v).formFactor ?? "").startsWith("M.2") || specOf(v).formFactor == null
            : true,
      },
    },
    status: { field: "status", publishValues: ["verified"] },
    csv: { key: productKey },
    labels: CATALOG_LABELS,
    roles: { read: ["owner", "assistant", "accountant"], write: ["owner"] },
    audit: true,
    auditSink,
  }) as Resource<z.ZodType<CatalogValue>>;
}
