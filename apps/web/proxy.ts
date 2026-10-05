// Next 16 proxy (formerly middleware): locale routing by next-intl plus CSP nonce (BUILD_PLAN 4.2 spike).
import { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { buildCsp } from "./src/csp.ts";
import { routing } from "./src/i18n/routing.ts";

const intl = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  // Next reads the nonce from the request CSP header and stamps it on its own scripts;
  // next-intl forwards the request headers in NextResponse.next/rewrite.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const response = intl(new NextRequest(request, { headers }));
  response.headers.set("content-security-policy", csp);
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

export const config = {
  // Everything except API, Next internals, /healthz and files with an extension; prefetches skip the nonce.
  matcher: [
    {
      source: "/((?!api|_next|_vercel|healthz|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
