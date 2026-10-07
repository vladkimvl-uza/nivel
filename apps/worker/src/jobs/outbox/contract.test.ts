import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORDER_CALENDAR_JOBS, OUTBOX_JOB, QUEUE, queueOfJob, REFUSED_JOBS } from "./routes.ts";

// The worker keeps a copy of the names of the jobs of the contract (the package of the services does not export them). This
// test reads the source of the contract and fails when a name drifts.
const source = readFileSync(
  new URL("../../../../../packages/services/src/outbox/contract.ts", import.meta.url),
  "utf8",
);

describe("the copy of the outbox contract", () => {
  it("has every name the contract has, with the same text", () => {
    for (const [key, value] of Object.entries(OUTBOX_JOB)) {
      expect(source, `${key}: "${value}"`).toContain(`${key}: "${value}"`);
    }
  });

  it("has every job of the contract that the worker can be given", () => {
    const names = [...source.matchAll(/^\s+([A-Z_]+): "([a-z_.]+)",?$/gm)].map((m) => m[1]);
    const jobs = names.filter((n) => n !== "LEAD_CREATED");
    expect(new Set(jobs)).toEqual(new Set(Object.keys(OUTBOX_JOB)));
  });
});

describe("routes", () => {
  it("sends the jobs the worker runs to their own queues", () => {
    expect(queueOfJob("payment.expect")).toBe(QUEUE.paymentExpect);
    expect(queueOfJob("ledger.append")).toBe(QUEUE.ledgerAppend);
    expect(queueOfJob("threshold.check")).toBe(QUEUE.thresholdCheck);
    expect(queueOfJob("web.revalidate")).toBe(QUEUE.webRevalidate);
    expect(queueOfJob("pdf.render")).toBe(QUEUE.pdfRender);
  });

  it("sends the order calendar to one queue", () => {
    for (const job of ORDER_CALENDAR_JOBS) expect(queueOfJob(job)).toBe(QUEUE.ordersScheduled);
    expect(ORDER_CALENDAR_JOBS).toContain("accept_reminder");
  });

  it("takes the name of an unknown job for the name of the queue of another domain", () => {
    expect(queueOfJob("prices.import.file")).toBe("prices.import.file");
  });

  it("refuses act.sign", () => {
    expect(Object.keys(REFUSED_JOBS)).toEqual(["act.sign"]);
  });
});
