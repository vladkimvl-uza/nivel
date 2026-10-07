// GET /registry/export?year=2026: the CSV of the registry for the accountant (the owner and the accountant). The export is
// journaled: it carries the sums of the whole business.
import { currentUser, requestInfo } from "../auth/next.ts";
import { getRuntime } from "../auth/runtime.ts";
import { canDo } from "./access.ts";
import { tashkentDay } from "./format.ts";
import { STATUS_LABEL } from "./labels.ts";
import { listOtherIncome, listRegistry, registryCsv } from "./read-registry.ts";
import { servicesRuntime } from "./runtime.ts";

const plain = (status: number, text: string): Response =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export function parseYear(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback;
  return /^20\d{2}$/.test(raw) ? Number(raw) : null;
}

export async function exportRegistryCsv(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return plain(401, "Войдите в админку.");
  if (!canDo(user.role, "registry.export")) return plain(403, "Недостаточно прав.");
  const now = servicesRuntime().now();
  const year = parseYear(new URL(request.url).searchParams.get("year"), Number(tashkentDay(now).slice(0, 4)));
  if (year === null) return plain(400, "Год указан неверно.");
  const { db, audit } = getRuntime();
  const [rows, income] = await Promise.all([listRegistry(db, year), listOtherIncome(db, year)]);
  const csv = registryCsv(rows, income, (s) => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s);
  await audit.append({
    actor: `admin:${user.id}`,
    action: "registry.export",
    entity: "sales.orders",
    entityId: null,
    after: { year, rows: rows.length },
    ipHash: (await requestInfo()).ipHash,
  });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="registry-${year}.csv"`,
      "cache-control": "no-store",
    },
  });
}
