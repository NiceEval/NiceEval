// cases: docs/engineering/unit-tests/reports/cases.md
// 「外壳、页面与 Tabs」分区——
// 品牌位恒为 NiceEval 字标(声明 title 也不覆盖)、hero 走标题回退链(与浏览器标题同源;
// document.title 由 useEffect 设置,静态渲染不执行,这里断言 hero 即断言同一个 shellTitle)、
// ReportLink.icon 渲染在 label 前(web 面)。契约:docs/feature/reports/library/shell.md「行为约束」。

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import type { ViewData } from "./types.ts";

beforeAll(() => {
  // App 的初始状态读 location(hash 路由 / 旧版 ?modal=);node 下静态渲染补最小 stub。
  (globalThis as { location?: unknown }).location = { hash: "", search: "", pathname: "/" };
});

const reportPages = { report: { en: "<p>REPORT_BODY</p>", "zh-CN": "<p>REPORT_BODY</p>" } };

function dataWithShell(report: ViewData["report"]): ViewData {
  return { composedRuns: 1, snapshots: [], ...(report !== undefined ? { report } : {}) };
}

describe("外壳:品牌位、hero 标题与 ReportLink.icon", () => {
  it("声明 title 后品牌位仍是 NiceEval 字标;hero 显示走完回退链的报告标题", () => {
    const html = renderToStaticMarkup(
      <App
        data={dataWithShell({
          title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
          links: [],
          pages: [{ id: "report", title: "Report" }],
          initialPageId: "report",
        })}
        reportPages={reportPages}
      />,
    );
    // 品牌位:恒定的 NiceEval 字标,不吃报告 title,外链官网并带归因参数。
    const brand = html.match(/<a[^>]*class="brand"[\s\S]*?<\/a>/)![0];
    expect(brand).toContain(">NiceEval</span>");
    expect(brand).not.toContain("Memory Evals");
    expect(brand).toContain("https://niceeval.com/?utm_source=report&amp;utm_medium=brand");
    // Powered by 行:同样外链官网,utm_medium 区分品牌位。
    const poweredBy = html.match(/<span class="powered-by">[\s\S]*?<\/span>/)![0];
    expect(poweredBy).toContain("https://niceeval.com/?utm_source=report&amp;utm_medium=powered-by");
    // hero:报告 title(node 环境 locale 回退 en)。
    const hero = html.match(/<h1>[\s\S]*?<\/h1>/)![0];
    expect(hero).toContain("Memory Evals");
  });

  it("缺外壳声明(旧数据)时 hero 落内置文案 Eval Results,品牌位不变", () => {
    const html = renderToStaticMarkup(<App data={dataWithShell(undefined)} reportPages={reportPages} />);
    expect(html.match(/<h1>[\s\S]*?<\/h1>/)![0]).toContain("Eval Results");
    expect(html.match(/class="brand"[\s\S]*?<\/a>/)![0]).toContain(">NiceEval</span>");
  });

  it("ReportLink.icon 的内联 SVG 渲染在 label 前,原样内联", () => {
    const html = renderToStaticMarkup(
      <App
        data={dataWithShell({
          title: "T",
          links: [{ label: "GitHub", href: "https://example.com", icon: { svg: '<svg data-mark="gh"></svg>' } }],
          pages: [{ id: "report", title: "Report" }],
          initialPageId: "report",
        })}
        reportPages={reportPages}
      />,
    );
    const link = html.match(/<a[^>]*href="https:\/\/example\.com"[\s\S]*?<\/a>/)![0];
    const iconAt = link.indexOf('<svg data-mark="gh"></svg>');
    const labelAt = link.indexOf("GitHub");
    expect(iconAt).toBeGreaterThan(-1);
    expect(labelAt).toBeGreaterThan(iconAt);
  });
});
