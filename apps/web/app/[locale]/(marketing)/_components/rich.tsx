import type { ReactNode } from "react";

/** Tags of the rich texts of `site.json`: `<n>` is a figure set in mono, `<b>` is a bold phrase. */
export const richTags = {
  n: (chunks: ReactNode) => <span className="nv-num">{chunks}</span>,
  b: (chunks: ReactNode) => <b>{chunks}</b>,
};
