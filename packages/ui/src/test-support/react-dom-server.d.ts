// @nivel/ui has no @types/react-dom (a dependency request to the integrator is in the WP-09 report): the only member
// the tests use is declared here. Delete this file when @types/react-dom is in the catalog and in devDependencies.
declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToStaticMarkup(element: ReactNode): string;
}
