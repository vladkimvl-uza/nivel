// A photo as a phone camera makes it, for the browser tests: a JPEG with an EXIF block that names the place. The admin
// must save it without the place (kit/upload). Not part of the application.
const TINY_JPEG = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** `marker` goes into the EXIF block so that a test can look for it in the saved file (and must not find it). */
export function phonePhoto(marker = "GPS-41.2995N-69.2401E"): Buffer {
  const tiff = [
    ...ascii("MM"),
    0,
    42,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    ...ascii(marker),
  ];
  const exif = [...ascii("Exif"), 0, 0, ...tiff];
  const head = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255];
  return Buffer.from([0xff, 0xd8, ...head, ...exif, ...TINY_JPEG.subarray(2), 0xff, 0xd9]);
}

/** An iPhone photo in HEIC: the admin cannot read it and says how to send it as JPEG. */
export function heicPhoto(): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
}

/** The text of a sum as the screen writes it, with ordinary spaces (the browser test compares normalised text). */
export function plainSum(text: string): string {
  return text.replace(/ /g, " ");
}
