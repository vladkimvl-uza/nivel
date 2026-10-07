// The selection by buttons (ARCHITECTURE 7.2 «Подбор кнопками»): task, budget band, composition, wishes, one to three
// showcase builds with a price "of the day" and the mark «not an offer». Every press belongs to a step of the session:
// a button of an old message is told so and changes nothing.
import { decodeCallback, encodeCallback, sumText } from "@nivel/telegram";
import { Composer } from "grammy";
import type { BotContext } from "../context.ts";
import { BANDS, type Band, findBuilds, isBand, isScope, isTask, isWish, SCOPES, TASKS, WISHES } from "../showcase.ts";
import { advance, type Step, type StepEvent } from "../steps.ts";
import { ack, button, say } from "../ui.ts";
import { askContact } from "./request.ts";

const sel = (...args: string[]) => encodeCallback("sel", args);

/** Moves the dialog on, or says the button is old. Returns true when the press is taken. */
async function take(ctx: BotContext, event: StepEvent, extra: { scope?: string } = {}): Promise<boolean> {
  const next: Step | null = advance(ctx.session.step, event, extra);
  if (next === null) {
    await ack(ctx, ctx.t("common.stale"));
    return false;
  }
  ctx.session.step = next;
  await ack(ctx);
  return true;
}

function wishRows(ctx: BotContext) {
  const marked = new Set(ctx.session.draft.wishes);
  const label = (w: string) => {
    const text = ctx.t(`select.wishes.${w}`);
    return marked.has(w) ? ctx.t("select.wishes.mark", { label: text }) : text;
  };
  return [
    [button(label("quiet"), sel("w", "quiet")), button(label("compact"), sel("w", "compact"))],
    [button(label("rgb"), sel("w", "rgb")), button(label("white"), sel("w", "white"))],
    [button(ctx.t("select.wishes.done"), sel("done"))],
  ];
}

async function showBuilds(ctx: BotContext) {
  const { task, band, wishes } = ctx.session.draft;
  if (!isTask(task) || !isBand(band)) return;
  const builds = await findBuilds(ctx.deps.db, {
    task,
    band,
    wishes,
    lang: ctx.lang,
    showDemo: ctx.deps.appMode !== "production",
  });
  if (builds.length === 0) {
    return say(ctx, ctx.t("select.none"), [[button(ctx.t("select.leave_request"), sel("leave"))]]);
  }
  await say(ctx, ctx.t("select.result.header"));
  for (const b of builds) {
    const title = ctx.t("select.result.title", { task: ctx.t(`select.task.${b.task}`), tier: Number(b.tier.slice(1)) });
    const price =
      b.priceSum === null
        ? ctx.t("select.result.price_uncertain")
        : ctx.t("select.result.price", { sum: sumText(b.priceSum, ctx.lang) });
    const lines = [title, price, b.explain, b.demo ? ctx.t("select.demo") : ""].filter((l) => l !== "");
    await say(ctx, lines.join("\n"), [[button(ctx.t("select.pick"), sel("pick", `${b.task}.${b.tier}.${b.style}`))]]);
  }
  await say(ctx, ctx.t("select.result.disclaimer"));
}

export const select = new Composer<BotContext>();

select.callbackQuery("m:select", async (ctx) => {
  ctx.session.step = "idle";
  ctx.session.draft = { wishes: [] };
  if (!(await take(ctx, "start_selection"))) return;
  return say(
    ctx,
    ctx.t("select.task.ask"),
    TASKS.map((task) => [button(ctx.t(`select.task.${task}`), sel("task", task))]),
  );
});

select.callbackQuery(/^sel:/, async (ctx) => {
  const data = decodeCallback(ctx.callbackQuery.data);
  const [field, value] = data?.args ?? [];
  switch (field) {
    case "task": {
      if (!isTask(value)) return ack(ctx);
      if (!(await take(ctx, "task"))) return;
      ctx.session.draft.task = value;
      return say(
        ctx,
        ctx.t("select.band.ask"),
        BANDS.map((b) => [button(ctx.t(`select.band.${b}`), sel("band", b))]),
      );
    }
    case "band": {
      if (!isBand(value)) return ack(ctx);
      if (!(await take(ctx, "band"))) return;
      ctx.session.draft.band = value satisfies Band;
      return say(
        ctx,
        ctx.t("select.scope.ask"),
        SCOPES.map((s) => [button(ctx.t(`select.scope.${s}`), sel("scope", s))]),
      );
    }
    case "scope": {
      if (!isScope(value)) return ack(ctx);
      if (!(await take(ctx, "scope", { scope: value }))) return;
      ctx.session.draft.scope = value;
      if (value === "setup") {
        await say(ctx, ctx.t("select.setup"));
        return askContact(ctx);
      }
      return say(ctx, ctx.t("select.wishes.ask"), wishRows(ctx));
    }
    case "w": {
      if (!isWish(value) || ctx.session.step !== "sel_wishes") return ack(ctx, ctx.t("common.stale"));
      const wishes = new Set(ctx.session.draft.wishes);
      if (!wishes.delete(value)) wishes.add(value);
      // The order of WISHES, not of the presses: the same set is always the same text.
      ctx.session.draft.wishes = WISHES.filter((x) => wishes.has(x));
      await ack(ctx);
      const rows = wishRows(ctx).map((r) => r.map((b) => ({ text: b.text, callback_data: b.callbackData })));
      return void ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: rows } }).catch(() => undefined);
    }
    case "done": {
      if (!(await take(ctx, "wishes_done"))) return;
      return showBuilds(ctx);
    }
    case "pick": {
      const [task, tier, style] = (value ?? "").split(".");
      if (!isTask(task) || !/^T[1-4]$/.test(tier ?? "") || (style !== "A" && style !== "B")) return ack(ctx);
      if (!(await take(ctx, "pick"))) return;
      const title = ctx.t("select.result.title", {
        task: ctx.t(`select.task.${task}`),
        tier: Number((tier as string).slice(1)),
      });
      ctx.session.draft.build = { task, tier: tier as string, style, title };
      return askContact(ctx);
    }
    case "leave": {
      if (!(await take(ctx, "leave_request"))) return;
      return askContact(ctx);
    }
    default:
      return ack(ctx);
  }
});
