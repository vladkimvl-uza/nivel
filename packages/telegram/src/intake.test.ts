import { describe, expect, it } from "vitest";
import {
  BOT_JOB,
  type FileIntakePayload,
  parseFileIntake,
  parseWarrantyReport,
  type WarrantyReportPayload,
} from "./intake.ts";

const receipt: FileIntakePayload = {
  job: "telegram.file_intake",
  kind: "receipt_photo",
  orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  orderNumber: "NV-2026-0001",
  telegramFileId: "AgACAgIAAxkBAAI",
  telegramFileUniqueId: "AQADwL8xG",
  mime: "image/jpeg",
  amountSum: 1_250_000,
  vendorName: "Mycom",
  byTelegramId: 6_001_000_001,
};

describe("the job «telegram.file_intake» the bot queues for the worker", () => {
  it("has a name the worker can register", () => {
    expect(BOT_JOB.FILE_INTAKE).toBe("telegram.file_intake");
  });

  it("is read back as it was written, for a receipt and for a paper act", () => {
    expect(parseFileIntake(receipt)).toEqual(receipt);
    const act: FileIntakePayload = {
      job: "telegram.file_intake",
      kind: "act_photo",
      orderId: receipt.orderId,
      orderNumber: receipt.orderNumber,
      telegramFileId: receipt.telegramFileId,
      telegramFileUniqueId: receipt.telegramFileUniqueId,
      mime: "image/jpeg",
      actId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
      byTelegramId: 6_001_000_002,
    };
    expect(parseFileIntake(act)).toEqual(act);
  });

  it("refuses what the bot never writes: another job, another kind, a sum that is not whole, a receipt without sum", () => {
    expect(parseFileIntake({ ...receipt, job: "other" })).toBeNull();
    expect(parseFileIntake({ ...receipt, kind: "passport" })).toBeNull();
    expect(parseFileIntake({ ...receipt, amountSum: 12.5 })).toBeNull();
    expect(parseFileIntake({ ...receipt, amountSum: 0 })).toBeNull();
    const { amountSum: _a, ...noSum } = receipt;
    expect(parseFileIntake(noSum)).toBeNull();
    expect(parseFileIntake({ ...receipt, orderNumber: "x" })).toBeNull();
    expect(parseFileIntake({ ...receipt, mime: "image/heic" })).toBeNull();
    expect(parseFileIntake({ ...receipt, byTelegramId: "6001" })).toBeNull();
    expect(parseFileIntake({ ...receipt, kind: "act_photo" })).toBeNull(); // an act photo needs the act
    expect(parseFileIntake(null)).toBeNull();
    expect(parseFileIntake("x")).toBeNull();
    expect(parseFileIntake([])).toBeNull();
  });
});

describe("the job «warranty.report» of a customer who reports a problem", () => {
  const report: WarrantyReportPayload = {
    job: "warranty.report",
    orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    orderNumber: "NV-2026-0001",
    reportedAt: "2026-10-20T07:15:30.000Z",
    text: "The PC does not start after the move",
    photoFileIds: ["AgAC-1", "AgAC-2"],
    byTelegramId: 7_100_000_001,
  };

  it("has a name the worker can register", () => {
    expect(BOT_JOB.WARRANTY_REPORT).toBe("warranty.report");
  });

  it("is read back as it was written", () => {
    expect(parseWarrantyReport(report)).toEqual(report);
    expect(parseWarrantyReport({ ...report, text: "", photoFileIds: ["AgAC-1"] })).toMatchObject({
      photoFileIds: ["AgAC-1"],
    });
  });

  it("refuses what the bot never writes: no time, no description and no photo, too many photos, a time that is not a date", () => {
    expect(parseWarrantyReport({ ...report, reportedAt: "yesterday" })).toBeNull();
    expect(parseWarrantyReport({ ...report, text: "", photoFileIds: [] })).toBeNull();
    expect(parseWarrantyReport({ ...report, photoFileIds: Array.from({ length: 11 }, (_, i) => `f${i}`) })).toBeNull();
    expect(parseWarrantyReport({ ...report, text: "x".repeat(2001) })).toBeNull();
    expect(parseWarrantyReport({ ...report, job: "other" })).toBeNull();
    expect(parseWarrantyReport({ ...report, orderNumber: "x" })).toBeNull();
    expect(parseWarrantyReport(null)).toBeNull();
  });
});
