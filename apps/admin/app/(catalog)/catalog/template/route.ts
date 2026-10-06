import { currentUser } from "../../../../src/auth/next.ts";
import { can } from "../../../../src/auth/roles.ts";
import { getRuntime } from "../../../../src/auth/runtime.ts";
import { toCsv } from "../../../../src/kit/csv.ts";

export const dynamic = "force-dynamic";

/** Byte order mark: Excel reads a CSV as UTF-8 only with it. */
const BOM = String.fromCharCode(0xfeff);

/** GET /catalog/template?category=gpu: the header of a file the import accepts (semicolons and a BOM: Russian Excel). */
export async function GET(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return new Response("Нужен вход.", { status: 401 });
  if (!can(user.role, "catalog.import")) return new Response("Недостаточно прав.", { status: 403 });
  const category = new URL(request.url).searchParams.get("category") ?? "";
  const { catalog } = getRuntime();
  if (!catalog.root.arms || !(category in catalog.root.arms))
    return new Response("Неизвестная категория.", { status: 404 });
  const body = `${BOM}${toCsv([catalog.csvColumns(category)], { delimiter: ";" })}`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="catalog-${category}.csv"`,
      "cache-control": "no-store",
    },
  });
}
