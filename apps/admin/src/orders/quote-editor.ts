// The editor of the estimate (ARCHITECTURE 6.3): positions of the catalog or lines by hand, the totals at every change.
// The lines of the draft are the state: a change is applied to them and the whole list goes to `quotes.build`, which
// calculates it on the server with the domain (prices from the market, the scale from the settings). The screen shows
// the saved draft; it adds nothing up (red lines).
import { CategoryCodeSchema } from "@nivel/contracts/catalog";
import { UuidSchema } from "@nivel/contracts/orders";
import type { CategoryCode, FeeGroup } from "@nivel/domain/catalog";
import type * as Services from "@nivel/services";
import { canDo } from "./access.ts";
import { type FormInput, parseSum } from "./build-event.ts";
import type { Ctx, Outcome } from "./commands.ts";
import { errorText } from "./messages.ts";

export type ManualLine = Services.quotes.ManualLine;

export interface DraftLines {
  catalog: { productId: string; qty: number; customerOwned: boolean }[];
  manual: ManualLine[];
}

export type QuoteChange =
  | { kind: "add"; productId: string; qty: number }
  | { kind: "qty"; productId: string; qty: number }
  | { kind: "remove"; productId: string }
  | { kind: "owned"; productId: string }
  | { kind: "addManual"; line: ManualLine }
  | { kind: "removeManual"; index: number }
  | { kind: "recalc" };

export type Applied = { ok: true; lines: DraftLines } | { ok: false; message: string };

const NOT_THERE = "Этой позиции нет в смете.";

export function applyChange(lines: DraftLines, change: QuoteChange): Applied {
  const catalog = lines.catalog.map((l) => ({ ...l }));
  const manual = lines.manual.map((l) => ({ ...l }));
  const find = (productId: string) => catalog.findIndex((l) => l.productId === productId);
  switch (change.kind) {
    case "add": {
      const i = find(change.productId);
      const at = catalog[i];
      if (at) at.qty += change.qty;
      else catalog.push({ productId: change.productId, qty: change.qty, customerOwned: false });
      return { ok: true, lines: { catalog, manual } };
    }
    case "qty": {
      const at = catalog[find(change.productId)];
      if (!at) return { ok: false, message: NOT_THERE };
      at.qty = change.qty;
      return { ok: true, lines: { catalog, manual } };
    }
    case "remove": {
      const i = find(change.productId);
      if (i < 0) return { ok: false, message: NOT_THERE };
      catalog.splice(i, 1);
      return { ok: true, lines: { catalog, manual } };
    }
    case "owned": {
      const at = catalog[find(change.productId)];
      if (!at) return { ok: false, message: NOT_THERE };
      at.customerOwned = !at.customerOwned;
      return { ok: true, lines: { catalog, manual } };
    }
    case "addManual":
      return { ok: true, lines: { catalog, manual: [...manual, change.line] } };
    case "removeManual": {
      if (change.index < 0 || change.index >= manual.length) return { ok: false, message: NOT_THERE };
      manual.splice(change.index, 1);
      return { ok: true, lines: { catalog, manual } };
    }
    case "recalc":
      return { ok: true, lines: { catalog, manual } };
  }
}

export type ParsedChange = { ok: true; change: QuoteChange } | { ok: false; message: string };
const bad = (message: string): ParsedChange => ({ ok: false, message });
const FEE_GROUPS: readonly FeeGroup[] = ["pc", "mount", "outside_scale"];

function quantity(raw: string | null, fallback?: number): number | null {
  if (raw === null || raw.trim() === "") return fallback ?? null;
  const n = parseSum(raw);
  return n !== null && n >= 1 && n <= 99 ? n : null;
}

export function parseChange(form: FormInput): ParsedChange {
  const kind = form.get("change");
  const productId = form.get("productId");
  const needProduct = (): string | null => (productId && UuidSchema.safeParse(productId).success ? productId : null);
  switch (kind) {
    case "add": {
      const id = needProduct();
      const qty = quantity(form.get("qty"), 1);
      if (!id) return bad("Выберите позицию каталога.");
      if (qty === null) return bad("Количество — целое число от 1 до 99.");
      return { ok: true, change: { kind: "add", productId: id, qty } };
    }
    case "qty": {
      const id = needProduct();
      const qty = quantity(form.get("qty"));
      if (!id) return bad("Выберите позицию каталога.");
      if (qty === null) return bad("Количество — целое число от 1 до 99.");
      return { ok: true, change: { kind: "qty", productId: id, qty } };
    }
    case "remove":
    case "owned": {
      const id = needProduct();
      return id ? { ok: true, change: { kind, productId: id } } : bad("Выберите позицию каталога.");
    }
    case "removeManual": {
      const index = parseSum(form.get("index"));
      return index === null ? bad("Строка не выбрана.") : { ok: true, change: { kind: "removeManual", index } };
    }
    case "addManual": {
      const title = form.get("title")?.trim() ?? "";
      const category = CategoryCodeSchema.safeParse(form.get("categoryCode"));
      const feeGroup = FEE_GROUPS.find((g) => g === form.get("feeGroup"));
      const qty = quantity(form.get("qty"), 1);
      const unitSum = parseSum(form.get("unitSum"));
      if (title === "" || title.length > 200) return bad("Название строки — от 1 до 200 знаков.");
      if (!category.success) return bad("Выберите категорию.");
      if (!feeGroup) return bad("Выберите группу платы.");
      if (qty === null) return bad("Количество — целое число от 1 до 99.");
      if (unitSum === null) return bad("Цена — целое число сумов.");
      const line: ManualLine = {
        title,
        categoryCode: category.data as CategoryCode,
        feeGroup,
        qty,
        unitSum,
        ...(form.get("notPurchased") === null ? {} : { purchasedByIp: false }),
      };
      return { ok: true, change: { kind: "addManual", line } };
    }
    case "recalc":
      return { ok: true, change: { kind: "recalc" } };
    default:
      return bad("Это изменение сметы не распознано.");
  }
}

const TASKS = ["gaming", "streaming", "design3d", "programming", "office"] as const;
type Task = (typeof TASKS)[number];

/** The tasks of the build: one or two known ones, no repeats (the services accept at most two). */
export function parseTasks(form: FormInput): Task[] {
  const picked = form.getAll("tasks").filter((t): t is Task => (TASKS as readonly string[]).includes(t));
  return [...new Set(picked)].slice(0, 2);
}

export interface QuoteCtx extends Ctx {
  drafts: { load(orderId: string): Promise<DraftLines> };
}

export async function rebuildQuote(ctx: QuoteCtx, orderId: string, form: FormInput): Promise<Outcome> {
  if (!canDo(ctx.user.role, "quotes.write")) {
    return { ok: false, message: "Смету меняет владелец.", denied: true };
  }
  const parsed = parseChange(form);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  try {
    const applied = applyChange(await ctx.drafts.load(orderId), parsed.change);
    if (!applied.ok) return { ok: false, message: applied.message };
    const built = await ctx.svc.quotes.build(
      {
        orderId,
        lines: applied.lines.catalog.map((l) => ({
          productId: l.productId as never,
          qty: l.qty,
          ...(l.customerOwned ? { customerOwned: true } : {}),
        })),
        ...(applied.lines.manual.length === 0 ? {} : { manualLines: applied.lines.manual }),
        tasks: parseTasks(form),
      },
      { kind: "owner", id: ctx.user.id },
      ctx.rt,
    );
    return { ok: true, message: `Смета пересчитана сервером (версия ${built.version}).`, id: built.quoteId };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}
