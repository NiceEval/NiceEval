// cases: docs/engineering/unit-tests/reports/cases.md
// 「外壳、页面与 Tabs」——宿主装载分流(文件 vs 内建)与页索引命令上下文。
// 装载规范化(content/pages/extends、page id、input/navigation、标题回退、icon)全部是
// `defineReport` 自己的产物,由 src/report/dual-render.test.tsx 直接对着真实实现测试;
// 这里只测宿主侧仍然私有的编排:内建报告分流与索引命令拼装(纯函数)。

import { describe, expect, it } from "vitest";
import { HostReportError, loadHostReport, localizeText, showCommand } from "./report-host.ts";
import { otherPagesText } from "./render.ts";
// dist-sourced:裸宿主装载的就是这份预编译产物的默认导出(show 与 view 同一条路),
// raw-src import 会是另一份模块实例,引用等同断言必须对着 dist。
import distBuiltInReport from "../../dist/report/built-in/index.js";

describe("裸宿主装载内建报告", () => {
  it("缺省(无 --report)装载 niceeval/report/built-in 的默认导出:同引用,页与其 content 同引用", async () => {
    const host = await loadHostReport(process.cwd(), undefined);
    const builtIn = distBuiltInReport as { pages: readonly { id: string; content: unknown }[] };
    expect(host).toBe(distBuiltInReport);
    expect(host.pages.map((p: { id: string }) => p.id)).toEqual(builtIn.pages.map((p) => p.id));
    for (let i = 0; i < host.pages.length; i++) {
      expect(host.pages[i]!.content).toBe(builtIn.pages[i]!.content);
    }
  });

  it("--report <文件> 走文件装载;找不到文件时是 HostReportError 同族的可预期错误", async () => {
    // loadHostReport 对文件路径委托 dist 里的 loadReportFile;这里只验证分流本身发生
    // (文件装载错误的具体文案由 src/report/load.ts 自己的测试覆盖)。
    await expect(loadHostReport(process.cwd(), "does/not/exist.tsx")).rejects.toThrow();
  });
});

describe("LocalizedText 回退:locale → en → 键字典序第一个非空值", () => {
  it("三级回退各自命中;undefined 输入原样返回 undefined", () => {
    expect(localizeText({ "zh-CN": "中", en: "E" }, "zh-CN")).toBe("中");
    expect(localizeText({ "zh-CN": "中", en: "E" }, "fr")).toBe("E");
    expect(localizeText({ "zh-TW": "繁", ja: "日" }, "en")).toBe("日"); // ja < zh-TW 字典序
    expect(localizeText("plain", "en")).toBe("plain");
    expect(localizeText({}, "en")).toBeUndefined();
    expect(localizeText(undefined, "en")).toBeUndefined();
  });
});

describe("其余页索引与索引命令上下文", () => {
  const pages = [
    { id: "overview", title: { en: "Overview", "zh-CN": "总览" } },
    { id: "exam", title: { en: "Exam", "zh-CN": "成绩单" } },
  ];

  it("只列未渲染的页,索引命令保留当前 --results / --report 与位置参数,复制即可复现下一层视图", () => {
    // 渲染的是 overview,其余页索引只含 exam 一行——与「渲染初始页 + 尾部附其余页索引」
    // 的行为一致(docs/feature/reports/show/reports.md Case 2)。
    const text = otherPagesText({
      otherPages: pages.filter((p) => p.id !== "overview"),
      command: { patterns: [], results: "tmp/published-results", report: "reports/site.tsx" },
      locale: "zh-CN",
    });
    expect(text).toContain("其余页：");
    expect(text).toContain("niceeval show --results tmp/published-results --report reports/site.tsx --page exam");
    expect(text).toContain("成绩单");
    expect(text).not.toContain("总览");
    expect(text).not.toContain("--page overview");
  });

  it("showCommand 按序携带位置参数与 --exp / --results / --report / --page", () => {
    expect(
      showCommand({ patterns: ["memory/swelancer"], experiment: "dev-e2b", report: "reports/site.tsx", page: "exam" }),
    ).toBe("niceeval show memory/swelancer --exp dev-e2b --report reports/site.tsx --page exam");
  });
});

it("HostReportError 是可预期用户错误(与 ReportLoadError 同待遇,不是内部异常)", () => {
  expect(new HostReportError("x")).toBeInstanceOf(Error);
});
