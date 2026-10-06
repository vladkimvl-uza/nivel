// Rendering helpers for component tests.
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** HTML of a server render (no effects). */
export function render(element: ReactNode): string {
  return renderToStaticMarkup(element);
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
