import type { ReactNode } from "react";
import { cx } from "./cx.ts";

/**
 * The surface of a document (estimate, receipt report, passport): always paper, by day and at night, with square
 * corners and a paper shadow. The estimate, sum table, stamps and plaques are drawn for this surface.
 */
export function Paper({
  tilt,
  badge,
  className,
  children,
}: {
  /** A slight slant on wide screens, like a sheet laid on a desk. */
  tilt?: "left" | "right" | undefined;
  /** The sample plaque, which sits over the top edge: `<Badge kind="sample" label=... />`. */
  badge?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <article className={cx("nv-paper", tilt && `nv-paper--tilt-${tilt}`, className)}>
      {badge}
      {children}
    </article>
  );
}
