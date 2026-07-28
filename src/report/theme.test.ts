// cases: docs/engineering/testing/unit/reports.md
import { describe, expect, it } from "vitest";
import { basalt, chalk, defineTheme, themeStylesheet } from "./theme.ts";

describe("主题定义与规范化", () => {
  it("单色原样落令牌，pair 展开成 light-dark()，未声明令牌仍取 basalt", () => {
    const theme = defineTheme({ accent: { light: "#123456", dark: "#654321" } });
    const css = themeStylesheet(theme);
    expect(css).toContain("--niceeval-color-accent:light-dark(#123456,#654321)");
    expect(css).toContain("--niceeval-color-page:#050505");
    expect(themeStylesheet(basalt)).toContain("--niceeval-radius:0");
  });

  it("appearance 同时落到 :root 与 .niceeval-report 的 color-scheme", () => {
    expect(themeStylesheet(basalt)).toContain(".niceeval-report{color-scheme:dark;}");
    expect(themeStylesheet(chalk)).toContain(".niceeval-report{color-scheme:light;}");
    expect(themeStylesheet(defineTheme({ appearance: "system" }))).toContain("color-scheme:light dark");
  });

  it("chalk 的差异完整住在令牌里:圆角、浅面、蓝 accent", () => {
    const css = themeStylesheet(chalk);
    expect(css).toContain("--niceeval-radius:8px");
    expect(css).toContain("--niceeval-color-surface:#ffffff");
    expect(css).toContain("--niceeval-color-accent:#2a78d6");
  });

  it("拒绝非法颜色、非六色 palette 与危险 CSS 值", () => {
    expect(() => defineTheme({ accent: "#fff" })).toThrow(/theme\.accent/);
    expect(() => defineTheme({ series: ["#000000"] as never })).toThrow(/theme\.series/);
    expect(() => defineTheme({ radius: "1px; color:red" })).toThrow(/theme\.radius/);
  });
});
