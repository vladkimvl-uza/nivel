import { describe, expect, it } from "vitest";
import { BOT_JOB, type FileIntakePayload, parseFileIntake } from "./intake.ts";

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
