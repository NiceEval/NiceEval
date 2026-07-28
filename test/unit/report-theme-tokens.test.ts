import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { basalt } from "../../src/report/theme.ts";

// 仓库守护:官方 CSS 的令牌兜底值必须逐项等于默认主题 basalt(src/report/theme.ts)。
// 契约在 docs/feature/reports/library/theme.md「CSS 覆盖与完整重写」与 themes/basalt.md:
// 官方样式在每个 var(--niceeval-*, <兜底>) 用点写 basalt 的值,所以「不装任何主题」与
// 「装 basalt」看到同一个样子,basalt 也因此不需要自带 styles。兜底值是手抄进 CSS 的
// 第二份数字——没有这条守护,改 basalt 不同步 CSS(或反过来)时两条交付路径(view 装载 /
// 嵌入自己的页面)会静默分叉,任何类型检查与渲染测试都发现不了。
// 同一条守护盖住 src/view/styles.css 的宿主 chrome 兜底:宿主与报告读同一份主题
// (theme.md「在 view 中怎样生效」),view 里那份 :root 短名不是第二份色板。

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** basalt 单值令牌表:令牌名(--niceeval- 后缀)→ 期望的兜底值。 */
function basaltTokens(): Map<string, string> {
  const single = (v: string | { light: string; dark: string } | undefined, fallback?: string): string => {
    if (v === undefined) return fallback!;
    return typeof v === "string" ? v : v.dark;
  };
  const out = new Map<string, string>();
  out.set("color-page", single(basalt.page));
  out.set("color-surface", single(basalt.surface));
  out.set("color-surface-subtle", single(basalt.surfaceSubtle));
  out.set("color-border", single(basalt.border));
  out.set("color-border-strong", single(basalt.borderStrong));
  out.set("color-text", single(basalt.text));
  out.set("color-text-secondary", single(basalt.textSecondary));
  out.set("color-text-tertiary", single(basalt.textTertiary));
  out.set("color-accent", single(basalt.accent));
  out.set("color-focus", single(basalt.focus, single(basalt.accent)));
  out.set("color-positive", single(basalt.positive));
  out.set("color-negative", single(basalt.negative));
  out.set("color-warning", single(basalt.warning));
  basalt.series!.forEach((color, i) => out.set(`color-series-${i + 1}`, single(color)));
  out.set("radius", basalt.radius!);
  out.set("font-sans", basalt.font!.sans!);
  out.set("font-mono", basalt.font!.mono!);
  out.set("font-size", basalt.fontSize!);
  return out;
}

/** 抽出一份 CSS 里全部 var(--niceeval-<token>, <兜底>) 用点。 */
function fallbacksIn(css: string): Array<{ token: string; fallback: string }> {
  const out: Array<{ token: string; fallback: string }> = [];
  for (const m of css.matchAll(/var\(--niceeval-([a-z0-9-]+), (.*)\)/g)) {
    out.push({ token: m[1]!, fallback: m[2]! });
  }
  return out;
}

describe.each([
  { file: "src/report/assets/styles.css", name: "report 官方样式" },
  { file: "src/view/styles.css", name: "view 宿主 chrome" },
])("$name 的令牌兜底 = basalt", ({ file }) => {
  const css = readFileSync(join(ROOT, file), "utf-8");
  const expected = basaltTokens();
  const used = fallbacksIn(css);

  it("每个 var(--niceeval-*, <兜底>) 的兜底值与 src/report/theme.ts 的 basalt 逐项相等", () => {
    expect(used.length).toBeGreaterThan(0);
    const mismatches = used
      .filter(({ token, fallback }) => expected.get(token) !== fallback)
      .map(({ token, fallback }) => `--niceeval-${token}: 兜底 ${fallback},basalt 是 ${expected.get(token) ?? "(未知令牌)"}`);
    expect(mismatches, `${file} 的兜底与 basalt 漂移:改主题与改兜底必须同一笔`).toEqual([]);
  });

  it("兜底不带 light-dark():basalt 锁暗,单值即全部", () => {
    const paired = used.filter(({ fallback }) => fallback.includes("light-dark("));
    expect(paired, "兜底应是 basalt 的单值;要双分支观感请发主题,不改官方兜底").toEqual([]);
  });
});
