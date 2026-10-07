// «Все тексты есть на uz и ru» (BUILD_PLAN WP-13): every message the code asks for exists in both languages, the Uzbek
// is Latin with the right apostrophes, the Russian is Cyrillic, and nothing shows a card number.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (lang: string) =>
  JSON.parse(readFileSync(join(ROOT, "packages", "i18n", "messages", lang, "bot.json"), "utf8")) as Record<
    string,
    unknown
  >;

function flatten(tree: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
    if (typeof v === "string") out.set(`${prefix}${k}`, v);
    else for (const [kk, vv] of flatten(v, `${prefix}${k}.`)) out.set(kk, vv);
  }
  return out;
}
const uz = flatten(read("uz"));
const ru = flatten(read("ru"));
const meta = read("meta");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "testing" ? [] : sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}
const CODE = [...sources(join(ROOT, "apps", "bot", "src")), ...sources(join(ROOT, "packages", "telegram", "src"))];
const text = CODE.map((f) => readFileSync(f, "utf8")).join("\n");

describe("the messages the code asks for", () => {
  // t("a.b") and t('a.b'): a whole key written in the code.
  const literal = new Set([...text.matchAll(/\bt\(\s*"([a-z][a-z0-9_.]*)"/g)].map((m) => m[1] as string));
  // t(`a.b.${x}`): the keys of a group; the group must have members, and each member is checked below by the lists of the code.
  const groups = new Set([...text.matchAll(/\bt\(\s*`([a-z][a-z0-9_.]*)\.\$\{/g)].map((m) => m[1] as string));

  it("finds the calls (the scan is not empty)", () => {
    expect(literal.size).toBeGreaterThan(60);
    expect(groups.size).toBeGreaterThan(8);
  });

  it.each([...literal].sort())("%s exists in uz and ru", (key) => {
    expect(uz.has(key), `uz ${key}`).toBe(true);
    expect(ru.has(key), `ru ${key}`).toBe(true);
  });

  it.each([...groups].sort())("the group %s has members in uz and ru", (group) => {
    expect(
      [...uz.keys()].some((k) => k.startsWith(`${group}.`)),
      `uz ${group}.*`,
    ).toBe(true);
    expect(
      [...ru.keys()].some((k) => k.startsWith(`${group}.`)),
      `ru ${group}.*`,
    ).toBe(true);
  });

  it("groups used with a list in the code are complete: tasks, bands, scopes, wishes, terms, events, statuses, errors", () => {
    const need: Record<string, string[]> = {
      "select.task": ["gaming", "streaming", "design3d", "programming", "office"],
      "select.band": ["lt_6_7m", "6_7m_12m", "12m_20m", "20m_35m", "gte_35m"],
      "select.scope": ["pc", "pc_periph", "setup"],
      "select.wishes": ["quiet", "compact", "rgb", "white", "done", "mark"],
      "request.term": ["asap", "week", "month", "later"],
      "owner.event": ["REVISE", "MEETING_DONE", "START_PURCHASE", "PURCHASE_DONE", "ASSEMBLED", "DISPATCH"],
      "act.kind": ["material_acceptance", "customer_parts", "handover"],
      "my.status": [
        "submitted",
        "estimate_confirmed",
        "prepaid",
        "purchasing",
        "receipts_summary",
        "assembly_test",
        "ready",
        "handed_over",
        "cancelled",
      ],
      "owner.status": [
        "estimate_draft",
        "estimate_sent",
        "estimate_expired",
        "accepted",
        "purchasing",
        "report_due",
        "report_sent",
        "settled",
        "assembling",
        "testing",
        "ready",
        "delivering",
        "handed_over",
        "closed",
        "podbor_delivered",
        "cancelling",
        "cancelled",
      ],
      "owner.error": [
        "actor_not_allowed",
        "invalid_transition",
        "estimate_expired",
        "manual_check_missing",
        "compat_block",
        "not_eligible",
        "offer_not_published",
        "consent_missing",
        "payments_incomplete",
        "purchase_too_early",
        "meeting_required",
        "limit_exceeded",
        "funds_exceeded",
        "purchases_incomplete",
        "not_reconciled",
        "report_objection_open",
        "final_payment_missing",
        "act_missing",
        "passport_missing",
      ],
      "owner.scope_short": ["pc", "pc_periph", "setup", "podbor"],
      "owner.band_short": ["lt_6_7m", "6_7m_12m", "12m_20m", "20m_35m", "gte_35m"],
      "my.error": ["estimate_expired", "offer_not_published", "consent_missing", "invalid_transition", "other"],
    };
    for (const [group, members] of Object.entries(need)) {
      for (const m of members) {
        expect(uz.has(`${group}.${m}`), `uz ${group}.${m}`).toBe(true);
        expect(ru.has(`${group}.${m}`), `ru ${group}.${m}`).toBe(true);
      }
    }
  });
});

describe("the catalog of the bot", () => {
  it("has the same keys in uz and ru and a meta entry for each, with the status draft (the Uzbek is for the translator)", () => {
    expect([...uz.keys()].sort()).toEqual([...ru.keys()].sort());
    expect(Object.keys(meta).sort()).toEqual([...uz.keys()].sort());
    for (const entry of Object.values(meta) as { status: string; context: string; maxLen: number }[]) {
      expect(entry.status).toBe("draft");
      expect(entry.context.length).toBeGreaterThan(5);
    }
  });

  it("the Uzbek is in Latin (but for the lines that are bilingual by design), the Russian in Cyrillic", () => {
    const bilingual = new Set(["start.choose_language", "start.language_ru", "menu.language", "common.slow_down"]);
    for (const [key, value] of uz) {
      if (bilingual.has(key)) continue;
      // Words in Latin; the guillemets and signs are not letters.
      expect(/[Ѐ-ӿ]/.test(value), `uz ${key} has Cyrillic: ${value}`).toBe(false);
    }
    for (const [key, value] of ru) {
      if (["start.language_uz", "cmd.start", "menu.language", "start.choose_language"].includes(key)) continue;
      if (/^(lead\.created_empty|select\.wishes\.mark|owner\.receipt\.line|owner\.topic\.title)$/.test(key)) continue;
      expect(/[Ѐ-ӿ]/.test(value) || /^\W*\{/.test(value), `ru ${key} has no Cyrillic: ${value}`).toBe(true);
    }
  });

  it("uses the apostrophes of Uzbek: U+02BB after o and g, U+02BC elsewhere, never U+0027 or U+2019 in a word", () => {
    for (const [key, value] of uz) {
      expect(/\p{L}['’‘`]\p{L}/u.test(value), `uz ${key}: ${value}`).toBe(false);
    }
    const all = [...uz.values()].join(" ");
    expect(all).toContain("oʻ");
    expect(all).toContain("gʻ");
    expect(all).toContain("maʼlumot");
  });

  it("never shows a number of a card, in any text or any language", () => {
    for (const value of [...uz.values(), ...ru.values()]) {
      expect(value).not.toMatch(/(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/);
    }
  });

  it("names no dollar: every price of the platform is in sums", () => {
    for (const value of [...uz.values(), ...ru.values()]) expect(value).not.toMatch(/\$|USD/);
  });
});
