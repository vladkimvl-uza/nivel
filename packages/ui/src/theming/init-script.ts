import { createElement, type ReactElement } from "react";
import { themeTokens } from "../themes/tokens.ts";
import { DAY_FROM_HOUR, DAY_TO_HOUR, THEME_STORAGE_KEY } from "./select.ts";

/**
 * The inline script for `<head>`: sets `data-theme` and the browser theme-color before the first paint, so that
 * the page never flashes the wrong mode. Same rule as `resolveTheme` (a test runs both over every hour):
 * `?theme=` of the address, then the saved choice, then local time 07:00-19:00. Plain ES5, no dependencies.
 */
export function themeInitScript(): string {
  const { day, night } = themeTokens;
  return [
    "(function(){",
    "var d=document.documentElement,t=null,q=null;",
    `try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}`,
    'try{q=new URLSearchParams(location.search).get("theme")}catch(e){}',
    'if(q==="day"||q==="night")t=q;',
    'if(t!=="day"&&t!=="night"){var h=new Date().getHours();' +
      `t=(h>=${DAY_FROM_HOUR}&&h<${DAY_TO_HOUR})?"day":"night"}`,
    'd.setAttribute("data-theme",t);',
    "var m=document.querySelector('meta[name=\"theme-color\"]');",
    'if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m)}',
    `m.setAttribute("content",t==="night"?${JSON.stringify(night.themeColor)}:${JSON.stringify(day.themeColor)});`,
    "})();",
  ].join("");
}

/** `<script>` with the code above; pass the CSP nonce of the request when the page has one. */
export function ThemeInitScript({ nonce }: { nonce?: string | undefined }): ReactElement {
  return createElement("script", {
    ...(nonce === undefined ? {} : { nonce }),
    // The text is built from constants of this package only, nothing from the request.
    dangerouslySetInnerHTML: { __html: themeInitScript() },
  });
}
