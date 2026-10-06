// Names of the categories for the screens: Russian, from catalog.categories (the seed holds all 29).
import type { Db } from "@nivel/db";
import { catalog } from "@nivel/db/repos";

export async function categoryNames(db: Db): Promise<Record<string, string>> {
  const rows = await catalog.listCategories(db);
  return Object.fromEntries(rows.map((r) => [r.code, r.name.ru || r.code]));
}

export const STATUS_NAMES: Record<string, string> = { draft: "Черновик", verified: "Проверено", retired: "Снято" };
