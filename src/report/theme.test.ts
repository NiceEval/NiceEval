// cases: docs/engineering/testing/unit/reports.md
import { describe, expect, it } from "vitest";
import { defineTheme } from "./theme.ts";

describe("主题定义与规范化", () => {
  it("拒绝非法颜色、非六色 palette 与危险 CSS 值", () => {
    expect(() => defineTheme({ accent: "#fff" })).toThrow(/theme\.accent/);
    expect(() => defineTheme({ series: ["#000000"] as never })).toThrow(/theme\.series/);
    expect(() => defineTheme({ radius: "1px; color:red" })).toThrow(/theme\.radius/);
  });
});
