// cases: docs/engineering/testing/unit/reports.md
import { describe, expect, it } from "vitest";
import type { AttemptLocator } from "../../record/locator.ts";
import { createTextContext, renderNodeToText } from "./tree.ts";
import { Grid, Stat } from "./primitives.tsx";
import type { Cell } from "./cell.ts";

const locator = (s: string): AttemptLocator => s as AttemptLocator;

describe("Stat Cell", () => {
  it("measure Cell 与 notApplicable 两面投影", () => {
    const measure: Cell = {
      kind: "measure",
      measure: {
        value: 0.5,
        display: { en: "50%", "zh-CN": "50%" },
        samples: 2,
        total: 3,
        refs: [locator("exp/a")],
      },
    };
    const text = renderNodeToText(
      <Grid columns={2}>
        <Stat label="Pass" value={measure} />
        <Stat label="N/A" value={{ kind: "notApplicable" }} />
      </Grid>,
      createTextContext({ width: 60 }),
    );
    expect(text).toContain("Pass");
    expect(text).toContain("50%");
    expect(text).toContain("N/A");
    expect(text).toContain("—");
  });

  it("标量与 LocalizedText 过渡形态仍可用", () => {
    const text = renderNodeToText(
      <Stat label="Count" value={12} detail="of 20" />,
      createTextContext({ width: 40 }),
    );
    expect(text).toContain("Count");
    expect(text).toContain("12");
    expect(text).toContain("of 20");
  });
});
