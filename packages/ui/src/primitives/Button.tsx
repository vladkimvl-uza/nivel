import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./cx.ts";

/** The triangle mark: only on calls to action and in section kickers (DESIGN_SYSTEM 1), never as a bullet. */
export function Mark() {
  return <span className="nv-mk" aria-hidden="true" />;
}

interface ButtonBase {
  /** Solid by default (asphalt by day, paper at night); ghost has a frame. */
  variant?: "primary" | "ghost";
  size?: "md" | "sm";
  /** The triangle before the label, for the main call to action. */
  mark?: boolean;
  className?: string;
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
  const { variant = "primary", size = "md", mark = false, className, children, ...rest } = props;
  const classes = cx("nv-btn", variant === "ghost" && "nv-btn--ghost", size === "sm" && "nv-btn--sm", className);
  const content = (
    <>
      {mark && <Mark />}
      {children}
    </>
  );
  if (props.href !== undefined) {
    return (
      <a className={classes} {...(rest as ComponentPropsWithoutRef<"a">)}>
        {content}
      </a>
    );
  }
  const { type = "button", ...buttonRest } = rest as ComponentPropsWithoutRef<"button">;
  return (
    <button type={type} className={classes} {...buttonRest}>
      {content}
    </button>
  );
}
