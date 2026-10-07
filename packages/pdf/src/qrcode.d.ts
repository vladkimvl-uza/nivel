// The types of `qrcode` (the package has none and @types/qrcode is not in the catalog): only what the passport uses.
declare module "qrcode" {
  interface QrModules {
    /** Modules on a side. */
    size: number;
    /** Row by row, 1 for a dark module. */
    data: Uint8Array;
  }
  interface QrCode {
    modules: QrModules;
    version: number;
  }
  interface QrCodeApi {
    create(text: string, options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): QrCode;
  }
  const api: QrCodeApi;
  export default api;
}
