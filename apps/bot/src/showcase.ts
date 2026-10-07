// The answers of the selection by buttons (ARCHITECTURE 7.2, R0): the showcase templates of `catalog.base_builds`
// by task, tier and style, with the price of the day. In R1 `domain.autobuild` takes this place. What the bot shows
// is a guide, "not an offer": the price comes from the market medians, never from the customer.
import type { Db } from "@nivel/db";
import { catalog, pricing } from "@nivel/db/repos";
import type { AppLocale } from "@nivel/i18n";

export const TASKS = ["gaming", "streaming", "design3d", "programming", "office"] as const;
export type Task = (typeof TASKS)[number];
export const BANDS = ["lt_6_7m", "6_7m_12m", "12m_20m", "20m_35m", "gte_35m"] as const;
export type Band = (typeof BANDS)[number];
export const SCOPES = ["pc", "pc_periph", "setup"] as const;
export type Scope = (typeof SCOPES)[number];
export const WISHES = ["quiet", "compact", "rgb", "white"] as const;
export type Wish = (typeof WISHES)[number];
export type Tier = "T1" | "T2" | "T3" | "T4";
const TIERS: readonly Tier[] = ["T1", "T2", "T3", "T4"];

export const isTask = (v: unknown): v is Task => (TASKS as readonly unknown[]).includes(v);
export const isBand = (v: unknown): v is Band => (BANDS as readonly unknown[]).includes(v);
export const isScope = (v: unknown): v is Scope => (SCOPES as readonly unknown[]).includes(v);
export const isWish = (v: unknown): v is Wish => (WISHES as readonly unknown[]).includes(v);

/** The tier of the parts for a budget band (ARCHITECTURE 4.11: < 12 M, 12-20 M, 20-35 M, 35 M and more). */
export const BAND_TIER: Record<Band, Tier> = {
  lt_6_7m: "T1",
  "6_7m_12m": "T1",
  "12m_20m": "T2",
  "20m_35m": "T3",
  gte_35m: "T4",
};

/** The lower bound of a band, whole sums: what is written as the budget of the request (leads.budgetBandOf cuts it back). */
export const BAND_BUDGET_SUM: Record<Band, number> = {
  lt_6_7m: 6_000_000,
  "6_7m_12m": 6_700_000,
  "12m_20m": 12_000_000,
  "20m_35m": 20_000_000,
  gte_35m: 35_000_000,
};

/** Style A is the plain one; the wish for lighting or a white case asks for B (the closest template is taken anyway). */
export function styleOf(wishes: readonly string[]): "A" | "B" {
  return wishes.includes("rgb") || wishes.includes("white") ? "B" : "A";
}

export interface BuildCard {
  task: Task;
  tier: Tier;
  style: "A" | "B";
  /** Whole sums, or null when a part of the template has no price (the master names it). */
  priceSum: number | null;
  explain: string;
  demo: boolean;
}

const middle = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] as number;
};

/** The middle price of the verified positions of a price class that have a sure market price. */
async function classPrice(db: Db, classKey: string): Promise<number | null> {
  const cls = await db.query.priceClasses.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.key, classKey),
  });
  if (!cls) return null;
  const positions = await db.query.products.findMany({
    columns: { id: true },
    where: (t, { and, eq }) => and(eq(t.priceClassId, cls.id), eq(t.status, "verified")),
  });
  return middlePrice(
    db,
    positions.map((p) => p.id),
  );
}

async function middlePrice(db: Db, productIds: string[]): Promise<number | null> {
  if (productIds.length === 0) return null;
  const prices = await pricing.currentMarketPrices(db, productIds);
  const sure = prices.filter((p) => p.medianSum !== null && p.confidence !== "low").map((p) => Number(p.medianSum));
  return sure.length === 0 ? null : middle(sure);
}

async function priceOf(db: Db, items: { classKey: string | null; productId: string | null; qty: number }[]) {
  let total = 0;
  for (const item of items) {
    const unit =
      item.productId !== null ? await middlePrice(db, [item.productId]) : await classPrice(db, item.classKey as string);
    if (unit === null) return null;
    total += unit * item.qty;
  }
  return total;
}

async function card(
  db: Db,
  cell: { task: Task; tier: Tier; style: "A" | "B" },
  lang: AppLocale,
  showDemo: boolean,
): Promise<BuildCard | null> {
  const build = await catalog.getBaseBuild(db, { ...cell, variant: "base" });
  if (!build || build.status !== "offered" || !build.isShowcase || (build.isDemo && !showDemo)) return null;
  const explain = build.explain?.[lang] ?? "";
  return { ...cell, priceSum: await priceOf(db, build.items), explain, demo: build.isDemo };
}

/**
 * Up to three templates: the tier of the budget first, then the one below and the one above. The style asked for comes
 * first in each tier; when the tier has only the other style, that one is shown.
 */
export async function findBuilds(
  db: Db,
  input: { task: Task; band: Band; wishes: readonly string[]; lang: AppLocale; showDemo: boolean },
): Promise<BuildCard[]> {
  const main = TIERS.indexOf(BAND_TIER[input.band]);
  const order = [main, main - 1, main + 1].filter((i) => i >= 0 && i < TIERS.length);
  const wanted = styleOf(input.wishes);
  const styles = wanted === "A" ? (["A", "B"] as const) : (["B", "A"] as const);
  const found: BuildCard[] = [];
  for (const i of order) {
    for (const style of styles) {
      const c = await card(db, { task: input.task, tier: TIERS[i] as Tier, style }, input.lang, input.showDemo);
      if (c) {
        found.push(c);
        break;
      }
    }
  }
  return found;
}
