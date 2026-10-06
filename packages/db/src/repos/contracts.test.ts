import { orderTransitionTable } from "@nivel/domain/order";
import { describe, expect, it } from "vitest";
import { ACTOR_KINDS, ORDER_STATUSES } from "../schema/sales.ts";

// The lists in the schema files become CHECK constraints; the contracts of packages/domain are the source. The
// compiler checks that the schema lists hold only values of the domain types (satisfies); this checks the reverse:
// nothing of the domain is missing from the database.
describe("schema lists against packages/domain", () => {
  const table = orderTransitionTable();

  it("lists every status of the order automaton", () => {
    const used = new Set(table.flatMap((r) => [r.from, r.to]));
    expect([...used].sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it("lists every actor of the order automaton", () => {
    const used = new Set(table.flatMap((r) => r.actors));
    expect([...used].sort()).toEqual([...ACTOR_KINDS].sort());
  });
});
