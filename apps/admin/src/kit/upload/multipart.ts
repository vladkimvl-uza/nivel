// The body of a form with a file (multipart/form-data), read from bytes that are already in memory and bounded.
//
// The parser of the platform (`request.formData()`) takes memory in proportion to the number of parts, not to the size of
// the body: twelve megabytes of empty parts (125 thousand of them) took 290 MB, in a container of 384. Here the number of
// delimiters is counted first with a plain search, and a body with more parts than a form of this admin has is refused
// before anything is built from it. The parts are slices of the one buffer: no copy of the file is made.

/** The photo, the kind, and room for a field or two that a page may add. */
export const MAX_FORM_PARTS = 8;
const MAX_HEADER_BYTES = 8 * 1024;

export interface FormPart {
  name: string;
  filename: string | null;
  data: Buffer;
}

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

export function boundaryOf(contentType: string | null): string | null {
  if (!contentType || !/^\s*multipart\/form-data\s*;/i.test(contentType)) return null;
  const match = /;\s*boundary=(?:"([^"\r\n]{1,70})"|([^\s;"]{1,70})(?=[\s;]|$))/i.exec(contentType);
  return match?.[1] ?? match?.[2] ?? null;
}

function disposition(headers: string): { name: string; filename: string | null } | null {
  for (const line of headers.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0 || line.slice(0, colon).trim().toLowerCase() !== "content-disposition") continue;
    const value = line.slice(colon + 1);
    const name = /;\s*name="([^"]*)"/i.exec(value)?.[1];
    if (name === undefined) return null;
    return { name, filename: /;\s*filename="([^"]*)"/i.exec(value)?.[1] ?? null };
  }
  return null;
}

/** The parts of the body, or null when it is not a form this admin can read (no delimiter, too many parts, broken). */
export function parseMultipart(body: Buffer, boundary: string): FormPart[] | null {
  const delimiter = Buffer.from(`--${boundary}`, "latin1");
  // The delimiters are counted before anything is built: a part cannot exist without one.
  const at: number[] = [];
  for (let pos = body.indexOf(delimiter); pos !== -1; pos = body.indexOf(delimiter, pos + delimiter.length)) {
    if (at.length > MAX_FORM_PARTS) return null;
    at.push(pos);
  }
  if (at.length === 0) return null;

  const parts: FormPart[] = [];
  for (let i = 0; i < at.length; i += 1) {
    const from = (at[i] ?? 0) + delimiter.length;
    if (body[from] === 0x2d && body[from + 1] === 0x2d) break; // the closing delimiter
    const next = at[i + 1];
    if (next === undefined) return null; // a part that is not closed
    if (!body.subarray(from, from + 2).equals(CRLF)) return null;
    const headersEnd = body.indexOf(HEADER_END, from);
    if (headersEnd < 0 || headersEnd + HEADER_END.length > next || headersEnd - from > MAX_HEADER_BYTES) return null;
    const info = disposition(body.toString("utf8", from + 2, headersEnd));
    const dataEnd = next - CRLF.length;
    if (!info || dataEnd < headersEnd + HEADER_END.length || !body.subarray(dataEnd, next).equals(CRLF)) return null;
    parts.push({ ...info, data: body.subarray(headersEnd + HEADER_END.length, dataEnd) });
  }
  return parts;
}
