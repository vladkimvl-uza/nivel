// An outbox in memory for the unit tests of the relay (not part of the product): the same contract as the store of the
// database, with rows a test can read back.
import type { OutboxRow, OutboxStore } from "../store.ts";

export interface MemoryRow extends OutboxRow {
  status: "pending" | "sent" | "failed";
  lastError: string | null;
  /** How many milliseconds the row was held back by the last `defer` or `retryLater`. */
  heldMs: number | null;
}

export class MemoryOutbox implements OutboxStore {
  rows: MemoryRow[] = [];
  #seq = 0;

  add(
    kind: OutboxRow["kind"],
    payload: Record<string, unknown>,
    over: Partial<Pick<OutboxRow, "dedupeKey" | "priority" | "attempts" | "createdAt">> = {},
  ): MemoryRow {
    this.#seq += 1;
    const row: MemoryRow = {
      id: `row-${this.#seq}`,
      kind,
      payload,
      dedupeKey: over.dedupeKey ?? null,
      priority: over.priority ?? 0,
      attempts: over.attempts ?? 0,
      createdAt: over.createdAt ?? new Date(2026, 9, 12, 9, 0, this.#seq),
      status: "pending",
      lastError: null,
      heldMs: null,
    };
    this.rows.push(row);
    return row;
  }

  get(id: string): MemoryRow {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no row ${id}`);
    return row;
  }

  /** Rows that are claimable: pending and not held back. */
  #leased = new Set<string>();
  #held = new Set<string>();

  async claim(limit: number): Promise<OutboxRow[]> {
    const due = this.rows
      .filter((r) => r.status === "pending" && !this.#leased.has(r.id) && !this.#held.has(r.id))
      .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
    for (const r of due) this.#leased.add(r.id);
    return due.map(({ status: _s, lastError: _e, heldMs: _h, ...row }) => row);
  }

  /** A new pass: leases run out and held rows come back (the test says when). */
  release(): void {
    this.#leased.clear();
    this.#held.clear();
  }

  async markSent(id: string): Promise<void> {
    const r = this.get(id);
    r.status = "sent";
    r.lastError = null;
  }

  async retryLater(id: string, error: string, retryAfterMs: number, maxAttempts: number) {
    const r = this.get(id);
    r.attempts += 1;
    r.lastError = error;
    r.heldMs = retryAfterMs;
    r.status = r.attempts >= maxAttempts ? "failed" : "pending";
    this.#held.add(id);
    return r.status;
  }

  async fail(id: string, error: string): Promise<void> {
    const r = this.get(id);
    r.attempts += 1;
    r.status = "failed";
    r.lastError = error;
  }

  async skip(id: string, reason: string): Promise<void> {
    const r = this.get(id);
    r.status = "failed";
    r.lastError = `skipped: ${reason}`;
  }

  async defer(id: string, ms: number): Promise<void> {
    const r = this.get(id);
    r.heldMs = ms;
    this.#held.add(id);
  }
}
