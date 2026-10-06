import { describe, expect, it } from "vitest";
import { boundaryOf, MAX_FORM_PARTS, parseMultipart } from "./multipart.ts";

/** The body of a form the way a browser (undici) writes it. */
async function formBody(entries: Array<[string, string | Uint8Array, string?]>) {
  const data = new FormData();
  for (const [name, value, filename] of entries) {
    if (typeof value === "string") data.set(name, value);
    else data.set(name, new File([value as BlobPart], filename ?? "f.bin", { type: "application/octet-stream" }));
  }
  const request = new Request("http://admin.test/x", { method: "POST", body: data });
  const contentType = request.headers.get("content-type");
  const boundary = boundaryOf(contentType);
  if (!boundary) throw new Error("no boundary");
  return { body: Buffer.from(await request.arrayBuffer()), boundary };
}

const emptyPart = (boundary: string) =>
  `--${boundary}\r\nContent-Disposition: form-data; name="a"; filename="f"\r\nContent-Type: image/jpeg\r\n\r\n\r\n`;

describe("boundaryOf", () => {
  it("reads the boundary, quoted or not, and nothing from other types", () => {
    expect(boundaryOf("multipart/form-data; boundary=abc123")).toBe("abc123");
    expect(boundaryOf('multipart/form-data; charset=utf-8; boundary="a b:c"')).toBe("a b:c");
    expect(boundaryOf("MULTIPART/FORM-DATA;BOUNDARY=xyz")).toBe("xyz");
    expect(boundaryOf("text/plain; boundary=abc")).toBeNull();
    expect(boundaryOf("multipart/form-data")).toBeNull();
    expect(boundaryOf(null)).toBeNull();
    expect(boundaryOf(`multipart/form-data; boundary=${"x".repeat(71)}`)).toBeNull();
  });
});

describe("parseMultipart", () => {
  it("reads fields and a file with bytes that look like delimiters and line ends, without copying the file", async () => {
    const bytes = Buffer.concat([Buffer.from("\r\n\r\n--almost\r\n"), Buffer.from([0, 255, 13, 10, 0, 13, 10])]);
    const { body, boundary } = await formBody([
      ["kind", "receipt"],
      ["photo", bytes, 'ЧЕК "1".jpg'],
    ]);
    const parts = parseMultipart(body, boundary);
    expect(parts?.map((p) => p.name)).toEqual(["kind", "photo"]);
    expect(parts?.[0]?.data.toString("utf8")).toBe("receipt");
    expect(parts?.[1]?.data.equals(bytes)).toBe(true);
    expect(parts?.[1]?.filename).toContain("1");
    expect(parts?.[1]?.data.buffer).toBe(body.buffer);
  });

  it("reads an empty file part and an empty field", async () => {
    const { body, boundary } = await formBody([
      ["kind", ""],
      ["photo", new Uint8Array(0), "empty.jpg"],
    ]);
    const parts = parseMultipart(body, boundary);
    expect(parts?.map((p) => p.data.length)).toEqual([0, 0]);
  });

  it("refuses a body with more parts than a form of this admin has, without building them", () => {
    const boundary = "B";
    const parts = MAX_FORM_PARTS + 1;
    const body = Buffer.from(`${emptyPart(boundary).repeat(parts)}--${boundary}--\r\n`);
    expect(parseMultipart(body, boundary)).toBeNull();
    const fine = Buffer.from(`${emptyPart(boundary).repeat(MAX_FORM_PARTS)}--${boundary}--\r\n`);
    expect(parseMultipart(fine, boundary)).toHaveLength(MAX_FORM_PARTS);
  });

  it("refuses twelve megabytes of empty parts at once, quickly and without taking memory", () => {
    const boundary = "B";
    const one = Buffer.from(emptyPart(boundary));
    const body = Buffer.concat(Array.from({ length: Math.floor((12 * 1024 * 1024) / one.length) }, () => one));
    const before = process.memoryUsage().rss;
    const started = Date.now();
    expect(parseMultipart(body, boundary)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(process.memoryUsage().rss - before).toBeLessThan(40 * 1024 * 1024);
  });

  it("refuses what is broken: no delimiter, an open part, no line end after the delimiter, no name, no header end", () => {
    const b = "B";
    expect(parseMultipart(Buffer.from("hello"), b)).toBeNull();
    expect(parseMultipart(Buffer.from('--B\r\nContent-Disposition: form-data; name="a"\r\n\r\nx\r\n'), b)).toBeNull();
    expect(
      parseMultipart(Buffer.from('--Bxx\r\nContent-Disposition: form-data; name="a"\r\n\r\nx\r\n--B--'), b),
    ).toBeNull();
    expect(parseMultipart(Buffer.from("--B\r\nContent-Type: text/plain\r\n\r\nx\r\n--B--\r\n"), b)).toBeNull();
    expect(
      parseMultipart(Buffer.from('--B\r\nContent-Disposition: form-data; name="a"\r\nx\r\n--B--\r\n'), b),
    ).toBeNull();
    expect(
      parseMultipart(Buffer.from('--B\r\nContent-Disposition: form-data; name="a"\r\n\r\nxno-crlf--B--\r\n'), b),
    ).toBeNull();
  });

  it("ignores a preamble and an epilogue", () => {
    const body = Buffer.from(
      'preamble\r\n--B\r\nContent-Disposition: form-data; name="a"\r\n\r\nx\r\n--B--\r\nepilogue',
    );
    expect(parseMultipart(body, "B")?.map((p) => p.data.toString())).toEqual(["x"]);
  });
});
