import type { ReactNode } from "react";
import { assertText, cx } from "./cx.ts";

/**
 * The marks of honesty (DESIGN_SYSTEM 3.6, 7.8): `demo` for demo data, `draft` for an unconfirmed document,
 * `visualization` for the 3D scene and drawings, `sample` for example documents.
 */
export const badgeKinds = ["demo", "draft", "visualization", "sample"] as const;
export type BadgeKind = (typeof badgeKinds)[number];

/**
 * A plaque with a required kind and a required label. The words (uz/ru) come from the caller; there is no default,
 * so a mark cannot be left out or left untranslated, and an empty one is refused.
 */
export function Badge({ kind, label, className }: { kind: BadgeKind; label: string; className?: string }) {
  if (!(badgeKinds as readonly string[]).includes(kind)) throw new Error(`Badge: unknown kind ${JSON.stringify(kind)}`);
  assertText(label, "label", "Badge");
  return (
    <span className={cx("nv-badge", `nv-badge--${kind}`, className)} data-kind={kind}>
      {label}
    </span>
  );
}

/** A free-text bordered label in mono, e.g. "цены на 05.10.2026 · пример · не оферта". */
export function Tag({ children }: { children?: ReactNode }) {
  return <span className="nv-tag">{children}</span>;
}
