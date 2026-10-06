/// <reference types="node" />
// Rendering helpers for component tests. `react-dom` is not a dependency of @nivel/ui (the package is React-agnostic
// about the renderer), so the server renderer is taken from apps/web, which has it. Request to the integrator: add
// `react-dom` (catalog) to devDependencies of @nivel/ui, then replace the createRequire below with a plain import.
import { createRequire } from "node:module";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

const fromWeb = createRequire(new URL("../../../../apps/web/package.json", import.meta.url));
const server = fromWeb("react-dom/server") as { renderToStaticMarkup(element: ReactNode): string };

/** HTML of a server render (no effects, `useSyncExternalStore` returns the server snapshot). */
export function render(element: ReactNode): string {
  return server.renderToStaticMarkup(element);
}

type Props = Record<string, unknown> & { children?: ReactNode };

/** Elements of a plain element tree (nothing is rendered: components are not expanded) that satisfy `test`. */
export function findAll(node: ReactNode, test: (el: ReactElement<Props>) => boolean): ReactElement<Props>[] {
  const out: ReactElement<Props>[] = [];
  const walk = (n: ReactNode) => {
    for (const child of Children.toArray(n)) {
      if (!isValidElement<Props>(child)) continue;
      if (test(child)) out.push(child);
      walk(child.props.children);
    }
  };
  walk(node);
  return out;
}
