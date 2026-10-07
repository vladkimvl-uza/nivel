// What the owner and the assistant write in a topic of the owner's group (ARCHITECTURE 7.2): the reply that is copied to
// the customer (lines that begin with `//` are the owner's own notes and stay in the group) and the caption under the
// photo of a receipt (`1250000 Mycom`) or of a paper act.

const NOTE = /^[ \t]*\/\//;

/** The text without the note lines, and whether there were any. Blank lines left at the ends are cut. */
export function stripOwnerNotes(text: string | undefined): { text: string; hadNotes: boolean } {
  if (typeof text !== "string" || text === "") return { text: "", hadNotes: false };
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const kept = lines.filter((l) => !NOTE.test(l));
  const hadNotes = kept.length !== lines.length;
  if (!hadNotes) return { text: lines.join("\n"), hadNotes };
  return { text: kept.join("\n").replace(/^\n+|\n+$/g, ""), hadNotes };
}

const MAX_VENDOR = 80;
const MAX_RECEIPT_SUM = 1_000_000_000_000;
/** A whole number of sums: plain digits, or groups of three after a space, a dot, a comma or an underscore. */
const AMOUNT = String.raw`(\d{1,3}(?:[  ._,]\d{3})+|\d+)`;
const CURRENCY = String.raw`(?:(?:so[ʻʼ'’]?m|sum|сум|сўм|uzs)\s+)?`;
const RECEIPT = new RegExp(`^${AMOUNT}\\s+${CURRENCY}(.+)$`, "iu");

/** `1250000 Mycom` → 1 250 000 sums at the shop Mycom; null when the caption is not of that form. */
export function parseReceiptCaption(caption: string | undefined): { amountSum: number; vendorName: string } | null {
  if (typeof caption !== "string") return null;
  const m = RECEIPT.exec(caption.trim());
  if (m === null) return null;
  const amountSum = Number((m[1] as string).replace(/[  ._,]/g, ""));
  const vendorName = (m[2] as string).trim();
  if (!Number.isSafeInteger(amountSum) || amountSum < 1 || amountSum > MAX_RECEIPT_SUM) return null;
  if (vendorName === "" || vendorName.length > MAX_VENDOR) return null;
  return { amountSum, vendorName };
}

const ACT_CAPTION = /^\s*(?:акт|act|dalolatnoma)(?![\p{L}\p{N}])/iu;

/** The caption that marks the photo as a paper act ("акт", "act", "dalolatnoma"), not as a receipt. */
export function isActPhotoCaption(caption: string | undefined): boolean {
  return typeof caption === "string" && ACT_CAPTION.test(caption);
}
