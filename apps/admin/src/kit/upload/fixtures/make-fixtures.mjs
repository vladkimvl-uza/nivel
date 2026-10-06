// Makes the three small phone-like files that sharp.test.ts uploads. Run once from apps/admin:
//   pnpm exec node src/kit/upload/fixtures/make-fixtures.mjs
// Every file carries a Make, a GPS position (Tashkent), an XMP creator and a Display P3 profile, so that a test can see
// that none of it is left after the upload. The pictures are 24 x 16 pixels.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const raw = Buffer.alloc(24 * 16 * 3);
for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 7) % 256;
const exif = {
  IFD0: { Make: "SECRET-MAKE" },
  IFD3: {
    GPSMapDatum: "SECRET-GPS-DATUM",
    GPSLatitudeRef: "N",
    GPSLatitude: "41/1 17/1 58/1",
    GPSLongitudeRef: "E",
    GPSLongitude: "69/1 16/1 0/1",
  },
};
const xmp =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>SECRET-XMP</dc:creator></rdf:Description>' +
  "</rdf:RDF></x:xmpmeta>";
const base = (orientation) =>
  sharp(raw, { raw: { width: 24, height: 16, channels: 3 } })
    .withExif(exif)
    .withXmp(xmp)
    .withIccProfile("p3")
    .withMetadata({ orientation });

writeFileSync(join(here, "phone-gps-upright.jpg"), await base(1).jpeg({ quality: 80 }).toBuffer());
writeFileSync(join(here, "phone-gps-rotated.jpg"), await base(6).jpeg({ quality: 80 }).toBuffer());
writeFileSync(join(here, "phone-gps.avif"), await base(6).avif({ quality: 50 }).toBuffer());
