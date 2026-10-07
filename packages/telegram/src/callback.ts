// callback_data of the inline buttons (ARCHITECTURE 7.1): Latin identifiers joined by ":", at most 64 bytes
// (the limit of Telegram), e.g. `o:NV-2026-0001:ack`. The data is a request of an unknown person: it is parsed
// strictly and what it names is checked again against the database by the handler.

/** Telegram limit for callback_data, bytes. */
export const CALLBACK_DATA_MAX_BYTES = 64;

const PART = /^[A-Za-z0-9_.-]{1,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX32 = /^[0-9a-f]{32}$/;

export interface DecodedCallback {
  scope: string;
  args: string[];
}

export function encodeCallback(scope: string, args: readonly string[] = []): string {
  for (const part of [scope, ...args]) {
    if (typeof part !== "string" || !PART.test(part)) {
      throw new Error(`callback part must be 1-60 characters of A-Z a-z 0-9 _ . -, got ${JSON.stringify(part)}`);
    }
  }
  const data = [scope, ...args].join(":");
  if (Buffer.byteLength(data, "utf8") > CALLBACK_DATA_MAX_BYTES) {
    throw new Error(`callback_data "${data}" is longer than ${CALLBACK_DATA_MAX_BYTES} bytes`);
  }
  return data;
}

/** The scope and the arguments of data the bot wrote itself; anything else is null (never an exception). */
export function decodeCallback(data: unknown): DecodedCallback | null {
  if (typeof data !== "string" || Buffer.byteLength(data, "utf8") > CALLBACK_DATA_MAX_BYTES) return null;
  const parts = data.split(":");
  if (parts.some((p) => !PART.test(p))) return null;
  const [scope, ...args] = parts as [string, ...string[]];
  return { scope, args };
}

/** `o:<order number>:<action>[:<argument>]`: the buttons of an order (the customer's and the owner's). */
export function orderCallback(number: string, action: string, arg?: string): string {
  return encodeCallback("o", arg === undefined ? [number, action] : [number, action, arg]);
}

export function uuidToHex(id: string): string {
  if (!UUID.test(id)) throw new Error(`not a uuid: ${JSON.stringify(id)}`);
  return id.replaceAll("-", "");
}

export function hexToUuid(hex: unknown): string | null {
  if (typeof hex !== "string" || !HEX32.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `a:<32 hex>:sg`: the button "I accept" under an act. */
export function actCallback(actId: string): string {
  return encodeCallback("a", [uuidToHex(actId), "sg"]);
}

/** `l:<32 hex>:<action>`: the buttons of the card of a lead in the owner's group. */
export function leadCallback(leadId: string, action: string): string {
  return encodeCallback("l", [uuidToHex(leadId), action]);
}
