// The message keys are an interface to packages/i18n (WP-08, namespace `common`): the code only returns keys and params.
// This suite keeps three things in step: the key registry, what the rules really emit, and the request to WP-08
// (packages/testing/fixtures/wp-03/compat-message-keys.json with a Russian draft per key).
import { describe, expect, it } from "vitest";
import { checkCompatibility, checkSetup } from "./index.ts";
import { COMPAT_MESSAGE_KEYS, MESSAGE_KEY_PREFIX } from "./message-keys.ts";
import { MISSING_DATA_KEY } from "./rule-kit.ts";
import { PC_SCENARIOS } from "./scenarios.suite.ts";
import { roomOf, SETUP_SCENARIOS } from "./setup-scenarios.suite.ts";
import { build, ctx, settings } from "./testkit.ts";
import type { CompatIssue, RuleId } from "./types.ts";

const fixtureFiles = import.meta.glob("../../../testing/fixtures/wp-03/compat-message-keys.json", {
  eager: true,
  query: "?raw",
  import: "default",
});
interface DraftRow {
  key: string;
  rule: string;
  params: string[];
  ru: string;
}
const draft: DraftRow[] = JSON.parse(Object.values(fixtureFiles)[0] ?? "[]");

/** Every issue the scenario tables provoke, with the rule that raised it. */
function emitted(): CompatIssue[] {
  const out: CompatIssue[] = [];
  const pc = (parts: Parameters<typeof build>, tasks: Parameters<typeof ctx>[0] = [], s = {}) => {
    const b = build(...parts);
    out.push(...checkCompatibility(b.lines, b.catalog, ctx(tasks, s)).issues);
  };
  for (const sc of Object.values(PC_SCENARIOS)) {
    for (const e of sc.issues) pc(e.parts, e.tasks, e.settings);
    for (const m of sc.missing) pc(m.parts, m.tasks);
  }
  const setup = (i: { parts: Parameters<typeof build>; room?: Parameters<typeof roomOf>[0]; placement?: never }) => {
    const b = build(...i.parts);
    const plan = { room: roomOf(i.room), lines: b.lines, ...(i.placement ? { placement: i.placement } : {}) };
    out.push(...checkSetup(plan, b.catalog, settings()).issues);
  };
  for (const sc of Object.values(SETUP_SCENARIOS)) {
    for (const e of [...sc.issues, ...sc.missing]) setup(e as never);
  }
  return out;
}

describe("message key registry", () => {
  it("uses the compat.* namespace and snake_case keys only", () => {
    for (const key of Object.keys(COMPAT_MESSAGE_KEYS))
      expect(key).toMatch(new RegExp(`^${MESSAGE_KEY_PREFIX}[a-z0-9_]+$`));
  });

  it("every key emitted by a rule is registered with exactly the params the rule passes", () => {
    const issues = emitted();
    expect(issues.length).toBeGreaterThan(50);
    for (const i of issues) {
      const reg = COMPAT_MESSAGE_KEYS[i.messageKey];
      expect(reg, `unregistered key ${i.messageKey}`).toBeDefined();
      expect(Object.keys(i.params).sort(), i.messageKey).toEqual([...(reg?.params ?? [])].sort());
      if (reg && reg.rule !== "*") expect(i.ruleId, i.messageKey).toBe(reg.rule);
    }
  });

  it("every registered key is provoked by at least one scenario (no dead keys)", () => {
    const seen = new Set(emitted().map((i) => i.messageKey));
    expect([...Object.keys(COMPAT_MESSAGE_KEYS)].filter((k) => !seen.has(k))).toEqual([]);
  });

  it("covers every rule with at least one key; the generic missing-data key belongs to all", () => {
    const rules = new Set<RuleId>(
      Object.values(COMPAT_MESSAGE_KEYS)
        .map((r) => r.rule)
        .filter((r): r is RuleId => r !== "*"),
    );
    expect(rules.size).toBe(37);
    expect(COMPAT_MESSAGE_KEYS[MISSING_DATA_KEY]?.rule).toBe("*");
  });
});

describe("request to WP-08: compat-message-keys.json", () => {
  it("lists exactly the registered keys with their rule and params", () => {
    expect(draft.map((d) => d.key).sort()).toEqual(Object.keys(COMPAT_MESSAGE_KEYS).sort());
    for (const d of draft) {
      const reg = COMPAT_MESSAGE_KEYS[d.key];
      expect(d.rule, d.key).toBe(reg?.rule);
      expect([...d.params].sort(), d.key).toEqual([...(reg?.params ?? [])].sort());
    }
  });

  it("has a Russian draft per key that uses only declared params, with no ASCII apostrophes", () => {
    for (const d of draft) {
      expect(d.ru.trim().length, d.key).toBeGreaterThan(10);
      expect(d.ru, d.key).toMatch(/[А-Яа-яЁё]/);
      expect(d.ru, d.key).not.toContain("'");
      const used = [...d.ru.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1] as string);
      for (const name of used) expect(d.params, `${d.key}: {${name}}`).toContain(name);
    }
  });

  it("uses every param of a key in its draft except the technical ones", () => {
    const technical = new Set(["category"]);
    for (const d of draft) {
      for (const p of d.params) {
        if (technical.has(p)) continue;
        expect(d.ru, `${d.key} should mention {${p}}`).toMatch(new RegExp(`\\{${p}[,}]`));
      }
    }
  });
});
