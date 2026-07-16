// cases: docs/engineering/unit-tests/reports/cases.md「外壳、页面与 Tabs」——宿主装载规范化、
// 页索引命令上下文与标题回退链(契约:docs/feature/reports/library/shell.md)。
// 页内树的 resolve / render 归报告库测试;这里只测宿主侧的规范化与选择逻辑(纯函数)。

import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PAGE_TITLE,
  HostReportError,
  localizeText,
  localizedTextEquals,
  normalizeHostReport,
  resolveReportTitle,
  showCommand,
} from "./report-host.ts";
import { pageIndexText } from "./render.ts";

const tree = { kind: "node" }; // 页 content 对宿主是不透明值,规范化不解析树

describe("装载规范化:外壳 + 非空页列表", () => {
  it("content 缩写展开为唯一页 id `report`,页名是内置页名「报告 / Report」", () => {
    const report = normalizeHostReport({ kind: "report", content: tree }, "reports/frontier.tsx");
    expect(report.pages).toHaveLength(1);
    expect(report.pages[0]).toMatchObject({ id: "report", title: BUILT_IN_PAGE_TITLE, content: tree });
    expect(report.links).toEqual([]);
  });

  it("pages 形态按声明序保留页列表与外壳字段", () => {
    const report = normalizeHostReport(
      {
        kind: "report",
        title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
        links: [{ label: "GitHub", href: "https://example.com" }],
        footer: "Published nightly.",
        pages: [
          { id: "overview", title: { en: "Overview", "zh-CN": "总览" }, content: tree },
          { id: "exam", title: { en: "Exam", "zh-CN": "成绩单" }, content: tree },
        ],
      },
      "reports/site.tsx",
    );
    expect(report.pages.map((p) => p.id)).toEqual(["overview", "exam"]);
    expect(report.title).toEqual({ en: "Memory Evals", "zh-CN": "记忆能力评测" });
    expect(report.footer).toBe("Published nightly.");
  });

  it("content 与 pages 恰好声明一个:同给 / 同缺都报错,文案给出 <ExperimentComparison /> 下一步", () => {
    for (const bad of [
      { kind: "report", content: tree, pages: [{ id: "a", title: "A", content: tree }] },
      { kind: "report", title: "T" },
    ]) {
      expect(() => normalizeHostReport(bad, "reports/site.tsx")).toThrow(HostReportError);
      expect(() => normalizeHostReport(bad, "reports/site.tsx")).toThrow(/<ExperimentComparison \/>/);
    }
  });

  it("空 pages 列表 / 重复 page id / 非法 page id 在装载期报错", () => {
    expect(() => normalizeHostReport({ kind: "report", pages: [] }, "r.tsx")).toThrow(/non-empty/);
    expect(() =>
      normalizeHostReport(
        { kind: "report", pages: [{ id: "exam", title: "A", content: tree }, { id: "exam", title: "B", content: tree }] },
        "r.tsx",
      ),
    ).toThrow(/duplicate page id "exam"/);
    for (const id of ["Exam", "a/b"]) {
      expect(() =>
        normalizeHostReport({ kind: "report", pages: [{ id, title: "A", content: tree }] }, "r.tsx"),
      ).toThrow(/invalid/);
    }
  });

  it("默认导出不是 defineReport 产物:完整用户反馈", () => {
    expect(() => normalizeHostReport({ some: "object" }, "reports/bad.tsx")).toThrow(
      /does not default-export a report/,
    );
  });

  it("旧 build 函数形态(集成前桥接)恒为单页 report", () => {
    const legacy = { build: () => tree };
    const report = normalizeHostReport(legacy, "the built-in report");
    expect(report.pages.map((p) => p.id)).toEqual(["report"]);
    expect(report.pages[0]!.content).toBe(legacy);
  });
});

describe("标题回退链:def.title → 唯一且相同的快照 name → NiceEval", () => {
  it("def.title 优先", () => {
    expect(resolveReportTitle({ en: "T" }, [{ name: "S" }])).toEqual({ en: "T" });
  });

  it("无 def.title 时取 Scope 中唯一且相同(深相等,键顺序无关)的非空快照 name", () => {
    expect(resolveReportTitle(undefined, [{ name: { en: "S", "zh-CN": "斯" } }, { name: { "zh-CN": "斯", en: "S" } }]))
      .toEqual({ en: "S", "zh-CN": "斯" });
    expect(resolveReportTitle(undefined, [{}, { name: "Only" }])).toBe("Only");
  });

  it("多个不同 name(en 相同、zh-CN 不同也算不同)不随机挑,回退 NiceEval;全无 name 亦然", () => {
    expect(
      resolveReportTitle(undefined, [{ name: { en: "S", "zh-CN": "甲" } }, { name: { en: "S", "zh-CN": "乙" } }]),
    ).toBe("NiceEval");
    expect(resolveReportTitle(undefined, [{}, {}])).toBe("NiceEval");
    expect(resolveReportTitle("", [])).toBe("NiceEval"); // 空串标题不算声明
  });

  it("LocalizedText 深相等按字段值,不看键顺序", () => {
    expect(localizedTextEquals({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(localizedTextEquals({ a: "1" }, { a: "1", b: "2" })).toBe(false);
  });
});

describe("LocalizedText 回退:locale → en → 键字典序第一个非空值", () => {
  it("三级回退各自命中", () => {
    expect(localizeText({ "zh-CN": "中", en: "E" }, "zh-CN")).toBe("中");
    expect(localizeText({ "zh-CN": "中", en: "E" }, "fr")).toBe("E");
    expect(localizeText({ "zh-TW": "繁", ja: "日" }, "en")).toBe("日"); // ja < zh-TW 字典序
    expect(localizeText("plain", "en")).toBe("plain");
    expect(localizeText({}, "en")).toBeUndefined();
  });
});

describe("页索引与索引命令上下文", () => {
  const report = normalizeHostReport(
    {
      kind: "report",
      title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
      pages: [
        { id: "overview", title: { en: "Overview", "zh-CN": "总览" }, content: tree },
        { id: "exam", title: { en: "Exam", "zh-CN": "成绩单" }, content: tree },
      ],
    },
    "reports/site.tsx",
  );

  it("索引命令保留当前 --results / --report 与位置参数,复制即可复现下一层视图", () => {
    const text = pageIndexText({
      report,
      title: "记忆能力评测",
      command: { patterns: [], results: "tmp/published-results", report: "reports/site.tsx" },
      locale: "zh-CN",
    });
    expect(text).toContain("记忆能力评测 · 2 页");
    expect(text).toContain("niceeval show --results tmp/published-results --report reports/site.tsx --page overview");
    expect(text).toContain("niceeval show --results tmp/published-results --report reports/site.tsx --page exam");
    expect(text).toContain("总览");
    expect(text).toContain("成绩单");
  });

  it("showCommand 按序携带位置参数与 --experiment / --results / --report / --page", () => {
    expect(
      showCommand({ patterns: ["memory/swelancer"], experiment: "dev-e2b", report: "reports/site.tsx", page: "exam" }),
    ).toBe("niceeval show memory/swelancer --experiment dev-e2b --report reports/site.tsx --page exam");
  });
});
