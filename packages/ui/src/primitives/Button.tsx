import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./cx.ts";

/** The triangle mark: only on calls to action and in section kickers (DESIGN_SYSTEM 1), never as a bullet. */
export function Mark() {
  return <span className="nv-mk" aria-hidden="true" />;
}

interface ButtonBase {
  /** Solid by default (asphalt by day, paper at night); ghost has a frame. */
  variant?: "primary" | "ghost" | undefined;
  size?: "md" | "sm" | undefined;
  /** The triangle before the label, for the main call to action. */
  mark?: boolean | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

type AsButton = ButtonBase & Omit<ComponentPropsWithoutRef<"button">, keyof ButtonBase> & { href?: undefined };
type AsLink = ButtonBase & Omit<ComponentPropsWithoutRef<"a">, keyof ButtonBase> & { href: string };
export type ButtonProps = AsButton | AsLink;

/**
 * Button or, with `href`, a link that looks like one. The theme changes the colors by variables, not the markup;
 * hover changes only background and frame, with no lift, shadow or gradient (DESIGN_SYSTEM 3.1).
 */
export function Button(props: ButtonProps) {
  // `props` is narrowed by `href` first, then taken apart in each branch: no cast is needed.
  if (props.href !== undefined) {
    const { variant, size, mark, className, children, ...anchor } = props;
    return (
      <a className={classesOf(variant, size, className)} {...anchor}>
        <Content mark={mark}>{children}</Content>
      </a>
    );
  }
  const { variant, size, mark, className, children, type = "button", ...button } = props;
  return (
    <button type={type} className={classesOf(variant, size, className)} {...button}>
      <Content mark={mark}>{children}</Content>
    </button>
  );
}

function classesOf(variant: ButtonBase["variant"], size: ButtonBase["size"], className: string | undefined): string {
  return cx("nv-btn", variant === "ghost" && "nv-btn--ghost", size === "sm" && "nv-btn--sm", className);
}

function Content({ mark, children }: { mark: boolean | undefined; children: ReactNode }) {
  return (
    <>
      {mark === true && <Mark />}
      {children}
    </>
  );
}
