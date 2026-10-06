import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { render } from "../test-support/render.ts";
import { Badge } from "./Badge.tsx";
import { Button, type ButtonProps } from "./Button.tsx";
import { EstimateRow } from "./Estimate.tsx";
import { Money } from "./Money.tsx";
import { Paper } from "./Paper.tsx";
import { RoundStamp, Stamp } from "./Stamp.tsx";

// With exactOptionalPropertyTypes (tsconfig.base.json) a wrapper that forwards an optional value of its own
// (`string | undefined`) must compile: the public optional props accept `undefined`. `tsc -b` checks this file.
const none: string | undefined = undefined as string | undefined;
const tilt: "left" | "right" | undefined = undefined as "left" | "right" | undefined;

describe("optional props accept undefined (wrappers can forward them)", () => {
  it("Money, EstimateRow, Badge, Paper, Stamp, RoundStamp, Button", () => {
    expect(render(Money({ amount: 1200, unit: none }))).not.toContain("undefined");
    expect(
      render(
        h(
          "table",
          null,
          h("tbody", null, EstimateRow({ name: "n", amount: 5, unit: none, index: undefined, note: undefined })),
        ),
      ),
    ).not.toContain("undefined");
    expect(render(Badge({ kind: "demo", label: "демо", className: none }))).toContain("nv-badge");
    expect(render(Paper({ tilt, className: none, badge: undefined }))).toContain("nv-paper");
    expect(render(Stamp({ word: "w", meta: none, tilt, className: none }))).toContain("nv-stamp-r");
    expect(render(RoundStamp({ id: "r", ring: "x", date: "d", label: "l", className: none }))).toContain("nv-rstamp");
    const forwarded: ButtonProps = { className: none, variant: undefined, size: undefined, mark: undefined };
    expect(render(Button(forwarded))).toContain("nv-btn");
  });
});
