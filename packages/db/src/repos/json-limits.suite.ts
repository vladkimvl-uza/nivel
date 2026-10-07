import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, createOrder, one, pgError, uniq } from "./testkit.ts";

// WP-00, limits of the free JSON: what the public side writes and the database keeps for good has a size limit in the
// database too, the second line after the check of the services: pg_column_size of the stored value. The consents carry
// up to 4 KB of evidence, a saved configuration up to 16 KB of preferences and of the room.
let migrator: pg.Client;
const clients = {} as Record<"WEB" | "BOT" | "ADMIN", pg.Client>;
let order: { orderId: string; customerId: string };

beforeAll(async () => {
  migrator = await connectAs("MIGRATOR");
  for (const role of ["WEB", "BOT", "ADMIN"] as const) clients[role] = await connectAs(role);
  order = await createOrder(migrator);
});
afterAll(async () => {
  for (const c of [migrator, ...Object.values(clients)]) await c.end();
});

/** The text length that makes `{"k": "<text>"}` exactly `size` bytes as the database keeps it (jsonb, 4-byte header). */
async function padFor(size: number): Promise<number> {
  const r = await one<{ base: number }>(migrator, "select pg_column_size(jsonb_build_object('k', ''::text)) as base");
  return size - r.base;
}
const doc = (pad: number) => JSON.stringify({ k: "x".repeat(pad) });

const CONSENT = `insert into ops.consents (customer_id, order_id, kind, granted, channel, evidence)
                 values ($1, $2, 'non_returnable', true, 'test', $3::jsonb)`;
const consent = (c: pg.Client, evidence: string | null) =>
  c.query(CONSENT, [order.customerId, order.orderId, evidence]);
const configSql = (columns: string, values: string) =>
  `insert into sales.configurations (public_code, kind, items, ${columns}, created_via) values ($1, 'pc', '[]', ${values}, 'web')`;
const code = () => `j${String(uniq()).padStart(7, "0")}`;

describe("ops.consents.evidence: 4 KB", () => {
  it.each(["WEB", "BOT", "ADMIN"] as const)(
    "%s: takes the largest evidence of 4096 bytes and refuses one byte more",
    async (role) => {
      const pad = await padFor(4096);
      await consent(clients[role], doc(pad));
      const e = await pgError(clients[role], CONSENT, [order.customerId, order.orderId, doc(pad + 1)]);
      expect(e.code).toBe("23514");
      expect(e.constraint).toBe("consents_evidence_size_chk");
    },
  );

  it("takes no evidence, a small one and the empty object", async () => {
    await consent(clients.BOT, null);
    await consent(clients.BOT, "{}");
    await consent(clients.WEB, doc(10));
  });

  it("measures what is kept, not the text that was sent: many small values are larger as jsonb than as text", async () => {
    const numbers = JSON.stringify({ n: Array.from({ length: 700 }, (_, i) => i) });
    const kept = await one<{ size: number }>(migrator, "select pg_column_size($1::jsonb) as size", [numbers]);
    expect(numbers.length).toBeLessThan(4096);
    expect(kept.size).toBeGreaterThan(4096);
    const e = await pgError(clients.BOT, CONSENT, [order.customerId, order.orderId, numbers]);
    expect(e.constraint).toBe("consents_evidence_size_chk");
  });
});

describe("sales.configurations.prefs and room: 16 KB", () => {
  const CONSTRAINTS = { prefs: "configurations_prefs_size_chk", room: "configurations_room_size_chk" } as const;
  it.each(["prefs", "room"] as const)(
    "%s: takes 16384 bytes and refuses one byte more, for the site and the bot",
    async (column) => {
      const pad = await padFor(16_384);
      for (const role of ["WEB", "BOT"] as const) {
        await clients[role].query(configSql(column, "$2::jsonb"), [code(), doc(pad)]);
        const e = await pgError(clients[role], configSql(column, "$2::jsonb"), [code(), doc(pad + 1)]);
        expect(e.code).toBe("23514");
        expect(e.constraint).toBe(CONSTRAINTS[column]);
      }
    },
  );

  it("takes both fields empty and both at the limit together", async () => {
    await clients.WEB.query(configSql("prefs", "null"), [code()]);
    const pad = await padFor(16_384);
    await clients.BOT.query(configSql("prefs, room", "$2::jsonb, $2::jsonb"), [code(), doc(pad)]);
  });

  it("does not limit the other fields of the configuration: the price snapshot and the compatibility result are the server's", async () => {
    const big = JSON.stringify({ k: "x".repeat(30_000) });
    await clients.ADMIN.query(
      `insert into sales.configurations (public_code, kind, items, price_snapshot, compat, created_via)
       values ($1, 'pc', '[]', $2::jsonb, $2::jsonb, 'admin')`,
      [code(), big],
    );
  });
});
