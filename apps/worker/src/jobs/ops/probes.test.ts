import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProbes, daysUntil, diskUsedPercent, fileAgeHours } from "./probes.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nivel-probes-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date("2026-10-12T10:00:00+05:00");

describe("fileAgeHours (the mark the backup container leaves after a good copy)", () => {
  it("is the age of the file in hours", async () => {
    const mark = join(dir, "last-backup");
    writeFileSync(mark, "ok");
    const written = new Date(NOW.getTime() - 27.5 * 3_600_000);
    utimesSync(mark, written, written);
    expect(await fileAgeHours(mark, NOW)).toBeCloseTo(27.5, 3);
  });

  it("is infinite when the mark is not there: no copy was ever made", async () => {
    expect(await fileAgeHours(join(dir, "nothing"), NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it("is zero for a file from the future (clocks differ a little), never negative", async () => {
    const mark = join(dir, "last-backup");
    writeFileSync(mark, "ok");
    const later = new Date(NOW.getTime() + 60_000);
    utimesSync(mark, later, later);
    expect(await fileAgeHours(mark, NOW)).toBe(0);
  });
});

describe("diskUsedPercent", () => {
  it("is a share between 0 and 100 of the disk the directory is on", async () => {
    const used = await diskUsedPercent(dir);
    expect(used).toBeGreaterThanOrEqual(0);
    expect(used).toBeLessThanOrEqual(100);
  });

  it("is null for a directory that is not there", async () => {
    expect(await diskUsedPercent(join(dir, "missing"))).toBeNull();
  });
});

describe("daysUntil (the certificate)", () => {
  it("counts whole days left, rounded down, and goes negative after the end", () => {
    expect(daysUntil("Oct 26 10:00:00 2026 GMT", new Date("2026-10-12T10:00:00Z"))).toBe(14);
    expect(daysUntil("Oct 26 09:59:00 2026 GMT", new Date("2026-10-12T10:00:00Z"))).toBe(13);
    expect(daysUntil("Oct 10 10:00:00 2026 GMT", new Date("2026-10-12T10:00:00Z"))).toBe(-2);
  });

  it("is null for a date that cannot be read", () => {
    expect(daysUntil("tomorrow-ish", NOW)).toBeNull();
  });
});

describe("createProbes", () => {
  it("answers null for what is not configured: the check says it cannot tell and does not alarm", async () => {
    const probes = createProbes({
      now: () => NOW,
      publicBaseUrl: "http://localhost:3100",
      dataDir: undefined,
      backupMarkFile: undefined,
    });
    expect(await probes.backupAgeHours()).toBeNull();
    expect(await probes.diskUsedPercent()).toBeNull();
    expect(await probes.certDaysLeft()).toBeNull(); // a plain http address has no certificate
  });

  it("reads the backup mark and the disk when they are configured", async () => {
    const mark = join(dir, "last-backup");
    writeFileSync(mark, "ok");
    utimesSync(mark, new Date(NOW.getTime() - 3_600_000), new Date(NOW.getTime() - 3_600_000));
    const probes = createProbes({
      now: () => NOW,
      publicBaseUrl: "http://localhost:3100",
      dataDir: dir,
      backupMarkFile: mark,
    });
    expect(await probes.backupAgeHours()).toBeCloseTo(1, 3);
    expect(typeof (await probes.diskUsedPercent())).toBe("number");
  });
});
