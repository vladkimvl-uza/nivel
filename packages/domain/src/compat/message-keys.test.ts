// The message keys are an interface to packages/i18n (namespace `compat`): the code only returns keys and params.
// This suite keeps three things in step: the key registry, what the rules really emit, and the dictionary of field names
// in the messages (messages/{ru,uz}/compat.json). The texts themselves are checked in packages/i18n.
import { describe, expect, it } from "vitest";
import type { CatalogLookup } from "../catalog/types.ts";
import { checkCompatibility, checkSetup } from "./index.ts";
import { COMPAT_MESSAGE_KEYS, FIELD_NAME_KEY_PREFIX, fieldNameKey, MESSAGE_KEY_PREFIX } from "./message-keys.ts";
import { MISSING_DATA_KEY } from "./rule-kit.ts";
import { PC_SCENARIOS } from "./scenarios.suite.ts";
import { roomOf, SETUP_SCENARIOS, type SetupInput } from "./setup-scenarios.suite.ts";
import { build, ctx, type Part, settings } from "./testkit.ts";
import type { CompatIssue, CompatSettings, RuleId, SetupPlan, Task } from "./types.ts";

const nameFiles = import.meta.glob("../../../i18n/messages/{ru,uz}/compat.json", {
  eager: true,
  query: "?raw",
  import: "default",
});
/** Names of the compat.field.* keys present in the messages of one locale. */
function fieldNames(locale: "ru" | "uz"): Set<string> {
  const raw = Object.entries(nameFiles).find(([path]) => path.includes(`/${locale}/`))?.[1] ?? "{}";
  const out = new Set<string>();
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    } else if (path.startsWith(FIELD_NAME_KEY_PREFIX)) out.add(path);
  };
  walk(JSON.parse(raw), "");
  return out;
}

/** An issue the scenario tables provoke, with the catalog of the build that raised it. */
interface Emitted {
  issue: CompatIssue;
  catalog: CatalogLookup;
}

function collectEmitted(): Emitted[] {
  const out: Emitted[] = [];
  const pc = (parts: Part[], tasks: Task[] = [], over: Partial<CompatSettings> = {}) => {
    const b = build(...parts);
    for (const issue of checkCompatibility(b.lines, b.catalog, ctx(tasks, over)).issues) {
      out.push({ issue, catalog: b.catalog });
    }
  };
  const setup = (input: SetupInput) => {
    const b = build(...input.parts);
    const plan: SetupPlan = { room: roomOf(input.room), lines: b.lines };
    if (input.placement) plan.placement = input.placement;
    for (const issue of checkSetup(plan, b.catalog, settings()).issues) out.push({ issue, catalog: b.catalog });
  };
  for (const sc of Object.values(PC_SCENARIOS)) {
    for (const e of sc.issues) pc(e.parts, e.tasks, e.settings);
    for (const m of sc.missing) pc(m.parts, m.tasks);
  }
  for (const sc of Object.values(SETUP_SCENARIOS)) {
    for (const e of [...sc.issues, ...sc.missing]) setup(e);
  }
  return out;
}

/** Every issue the scenario tables provoke (computed once). */
const EMITTED: readonly Emitted[] = collectEmitted();

describe("message key registry", () => {
  it("uses the compat.* namespace and snake_case keys only", () => {
    for (const key of Object.keys(COMPAT_MESSAGE_KEYS))
      expect(key).toMatch(new RegExp(`^${MESSAGE_KEY_PREFIX}[a-z0-9_]+$`));
  });

  it("every key emitted by a rule is registered with exactly the params the rule passes", () => {
    expect(EMITTED.length).toBeGreaterThan(50);
    for (const { issue: i } of EMITTED) {
      const reg = COMPAT_MESSAGE_KEYS[i.messageKey];
      expect(reg, `unregistered key ${i.messageKey}`).toBeDefined();
      expect(Object.keys(i.params).sort(), i.messageKey).toEqual([...(reg?.params ?? [])].sort());
      if (reg && reg.rule !== "*") expect(i.ruleId, i.messageKey).toBe(reg.rule);
    }
  });

  it("every registered key is provoked by at least one scenario (no dead keys)", () => {
    const seen = new Set(EMITTED.map((e) => e.issue.messageKey));
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

describe("compat.missing_data: the field is shown by its name (convention compat.field.<category>.<field>)", () => {
  const missing = EMITTED.filter((e) => e.issue.messageKey === MISSING_DATA_KEY);

  it("fieldNameKey builds compat.field.<category>.<field>", () => {
    expect(FIELD_NAME_KEY_PREFIX).toBe("compat.field.");
    expect(fieldNameKey("gpu", "tgpW")).toBe("compat.field.gpu.tgpW");
  });

  it("every no-data issue carries a category and a field that has a name in ru and in uz", () => {
    expect(missing.length).toBeGreaterThan(40);
    for (const locale of ["ru", "uz"] as const) {
      const names = fieldNames(locale);
      expect(names.size, locale).toBeGreaterThan(100);
      for (const { issue } of missing) {
        const { field, category } = issue.params;
        const where = `${locale} ${issue.ruleId} params ${JSON.stringify(issue.params)}`;
        expect(typeof category, where).toBe("string");
        expect(typeof field, where).toBe("string");
        expect(names.has(fieldNameKey(String(category), String(field))), where).toBe(true);
      }
    }
  });

  it("params.category of a no-data issue is the category of the product the issue points at", () => {
    for (const { issue, catalog } of missing) {
      expect(issue.productIds, issue.ruleId).toHaveLength(1);
      for (const id of issue.productIds) {
        expect(catalog.get(id)?.category, `${issue.ruleId} ${id}: ${JSON.stringify(issue.params)}`).toBe(
          issue.params.category,
        );
      }
    }
  });

  it("the scenarios provoke no-data issues in more than eight categories", () => {
    expect(new Set(missing.map((e) => e.issue.params.category)).size).toBeGreaterThan(8);
  });
});
