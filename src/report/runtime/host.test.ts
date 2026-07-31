// cases: docs/engineering/testing/unit/reports.md
// 「外壳、页面与 Tabs」——宿主装载分流(文件 vs 内建)。
// 装载规范化(content/pages/extends、page id、input/navigation、标题回退、icon)全部是
// `defineReport` 自己的产物,由 src/report/runtime/dual-render.test.tsx 直接对着真实实现测试;
// 这里只测 host facade 仍然私有的编排:内建报告分流与 LocalizedText 回退。

import { describe, expect, it } from "vitest";
import { describeReportSource, HostReportError, loadHostReport, localizeText } from "./host.ts";
// dist-sourced:裸宿主装载的就是这份预编译产物的默认导出(show 与 view 同一条路),
// raw-src import 会是另一份模块实例,引用等同断言必须对着 dist。
import distBuiltInReport from "../../../dist/report/built-in/index.js";

describe("裸宿主装载内建报告", () => {
  it("缺省(无 --report)装载 niceeval/report/built-in 的默认导出:同引用,页 render 同引用", async () => {
    const host = await loadHostReport(process.cwd(), undefined);
    const builtIn = distBuiltInReport as { pages: readonly { id: string; render: unknown }[] };
    expect(host).toBe(distBuiltInReport);
    expect(host.pages.map((p: { id: string }) => p.id)).toEqual(builtIn.pages.map((p) => p.id));
    for (let i = 0; i < host.pages.length; i++) {
      expect(host.pages[i]!.render).toBe(builtIn.pages[i]!.render);
    }
  });

  it("--report <文件> 走文件装载;找不到文件时是 HostReportError 同族的可预期错误", async () => {
    // loadHostReport 对文件路径委托 dist 里的 loadReportFile;这里只验证分流本身发生
    // (文件装载错误的具体文案由 src/report/runtime/load.ts 自己的测试覆盖)。
    await expect(loadHostReport(process.cwd(), "does/not/exist.tsx")).rejects.toThrow();
  });
});

describe("报告出处标签与取值链同档", () => {
  const configured = distBuiltInReport as Parameters<typeof describeReportSource>[1];

  it("--report 在场点名它的取值", () => {
    expect(describeReportSource("reports/site.tsx", configured)).toContain("--report reports/site.tsx");
  });

  it("只有 config.report 时点名配置文件的 report 字段,不说内建", () => {
    const label = describeReportSource(undefined, configured);
    expect(label).toContain("niceeval.config.ts");
    expect(label).not.toContain("built-in");
  });

  it("两档都没有才说内建", () => {
    expect(describeReportSource(undefined, undefined)).toBe("the built-in report");
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

it("HostReportError 是可预期用户错误(与 ReportLoadError 同待遇,不是内部异常)", () => {
  expect(new HostReportError("x")).toBeInstanceOf(Error);
});
