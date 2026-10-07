import { describe, expect, it } from "vitest";
import { type AuditSink, withAudit } from "./audit.ts";
import { ForbiddenError } from "./roles.ts";
import type { AuditEntry } from "./store.ts";

function sink() {
  const entries: AuditEntry[] = [];
  const failing = { on: false };
  const s: AuditSink = {
    async append(e) {
      if (failing.on) throw new Error("journal down");
      entries.push(e);
    },
  };
  return { s, entries, failing };
}

const meta = { actor: "admin:1", action: "settings.save", entity: "ops.settings" };

describe("withAudit", () => {
  it("returns the value and journals before and after", async () => {
    const { s, entries } = sink();
    const value = await withAudit(s, { ...meta, entityId: "money.fee_settings", ipHash: "h" }, async () => ({
      value: 42,
      before: { v: 1 },
      after: { v: 2 },
    }));
    expect(value).toBe(42);
    expect(entries).toEqual([
      { ...meta, entityId: "money.fee_settings", before: { v: 1 }, after: { v: 2 }, ipHash: "h" },
    ]);
  });

  it("takes the entity id from the result when the action only learns it then", async () => {
    const { s, entries } = sink();
    await withAudit(s, meta, async () => ({ value: 1, entityId: "new-id" }));
    expect(entries[0]?.entityId).toBe("new-id");
  });

  it("writes nothing when the action fails, and passes the error on", async () => {
    const { s, entries } = sink();
    await expect(
      withAudit(s, meta, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(entries).toEqual([]);
  });

  it("journals a refusal by role as a denied attempt", async () => {
    const { s, entries } = sink();
    await expect(
      withAudit(s, meta, async () => {
        throw new ForbiddenError("assistant", "settings.money.write");
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(entries).toEqual([
      {
        ...meta,
        action: "settings.save.denied",
        entityId: null,
        after: { role: "assistant", needed: "settings.money.write" },
        ipHash: null,
      },
    ]);
  });

  it("fails the action when the journal cannot be written: no change goes unrecorded", async () => {
    const { s, failing } = sink();
    failing.on = true;
    await expect(withAudit(s, meta, async () => ({ value: 1 }))).rejects.toThrow("journal down");
  });

  describe("in one transaction with the change", () => {
    /** A sink that has transactions: what the action wrote through `tx` is kept only when the whole block succeeded. */
    function transactional() {
      const committed: string[] = [];
      const entries: AuditEntry[] = [];
      const failing = { on: false };
      const s: AuditSink = {
        async append(e, tx) {
          if (failing.on) throw new Error("journal down");
          (tx as { journal: AuditEntry[] } | undefined)?.journal.push(e);
          if (!tx) entries.push(e);
        },
        async atomically(fn) {
          const tx = { changes: [] as string[], journal: [] as AuditEntry[] };
          const out = await fn(tx);
          committed.push(...tx.changes);
          entries.push(...tx.journal);
          return out;
        },
      };
      return { s, committed, entries, failing };
    }

    it("hands the action the transaction, and the entry is written through the same one", async () => {
      const { s, committed, entries } = transactional();
      const value = await withAudit(s, meta, async (tx) => {
        (tx as { changes: string[] }).changes.push("fee v2");
        return { value: "done", after: { v: 2 } };
      });
      expect(value).toBe("done");
      expect(committed).toEqual(["fee v2"]);
      expect(entries).toMatchObject([{ action: "settings.save", after: { v: 2 } }]);
    });

    it("when the journal cannot be written the change is taken back too", async () => {
      const { s, committed, entries, failing } = transactional();
      failing.on = true;
      await expect(
        withAudit(s, meta, async (tx) => {
          (tx as { changes: string[] }).changes.push("fee v2");
          return { value: 1 };
        }),
      ).rejects.toThrow("journal down");
      expect(committed).toEqual([]);
      expect(entries).toEqual([]);
    });

    it("when the action fails nothing is committed, and a refusal is still journaled as denied outside the transaction", async () => {
      const { s, committed, entries } = transactional();
      await expect(
        withAudit(s, meta, async (tx) => {
          (tx as { changes: string[] }).changes.push("half");
          throw new ForbiddenError("assistant", "settings.money.write");
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(committed).toEqual([]);
      expect(entries).toMatchObject([{ action: "settings.save.denied" }]);
    });
  });
});
