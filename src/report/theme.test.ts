// cases: docs/engineering/testing/unit/reports.md
import { describe, expect, it } from "vitest";
import { basalt, defineTheme, themeStylesheet } from "./theme.ts";

describe("主题定义与规范化", () => {
  it("单色展开到两个外观分支，未声明令牌仍取 Basalt", () => {
    const theme = defineTheme({ accent: "#123456" });
    const css = themeStylesheet(theme);
    expect(css).toContain("--niceeval-color-accent:light-dark(#123456,#123456)");
    expect(css).toContain("--niceeval-color-page:light-dark(#FAFAFA,#0A0B0C)");
    expect(themeStylesheet(basalt)).toContain("--niceeval-radius:0");
  });

  it("拒绝非法颜色、非六色 palette 与危险 CSS 值", () => {
    expect(() => defineTheme({ accent: "#fff" })).toThrow(/theme\.accent/);
    expect(() => defineTheme({ series: ["#000000"] as never })).toThrow(/theme\.series/);
    expect(() => defineTheme({ radius: "1px; color:red" })).toThrow(/theme\.radius/);
  });
});
