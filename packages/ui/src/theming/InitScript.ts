import { createElement, type ReactElement } from "react";
import { themeInitScript } from "./init-script.ts";

/** `<script>` with the code above; pass the CSP nonce of the request when the page has one. */
export function ThemeInitScript({ nonce }: { nonce?: string | undefined }): ReactElement {
  return createElement("script", {
    ...(nonce === undefined ? {} : { nonce }),
    // The text is built from constants of this package only, nothing from the request.
    dangerouslySetInnerHTML: { __html: themeInitScript() },
  });
}
