// cases: docs/engineering/testing/unit/reports.md
// 「显示值单点」「缺数据词表」「呈现工具箱的导出面」

import { describe, expect, it } from "vitest";

import * as report from "../index.ts";
import * as reportReact from "../react/index.tsx";
import { formatCellText } from "../definition/cell.ts";
import { isCalculation } from "./calculation.ts";
import {
  formatAxisTick,
  formatMeasureValue,
  measureDisplay,
  missingText,
} from "./format.ts";

describe("measureDisplay / formatMeasureValue", () => {
  it("五支 unit 各折一种读法;tokens 的 46500 不是裸数字", () => {
    expect(formatMeasureValue(0.873, "%")).toBe("87.3%");
    expect(formatMeasureValue(850, "ms")).toBe("850ms");
    expect(formatMeasureValue(0.31, "$")).toBe("$0.31");
    expect(formatMeasureValue(46_500, "tokens")).toBe("46.5k tokens");
    expect(formatMeasureValue(1_200)).toBe("1.2k");
    expect(measureDisplay(46_500, "tokens")).toBe("46.5k tokens");
  });

  it("null 写成缺数据 LocalizedText,不写 —", () => {
    expect(measureDisplay(null)).toEqual({ en: "no data", "zh-CN": "无数据" });
  });

  it("AttemptMetric.display 覆盖内建格式,不改变 value 语义", () => {
    const display = measureDisplay(0.5, "%", (value, locale) =>
      locale === "zh-CN" ? `命中 ${Math.round(value * 100)}%` : `hit ${Math.round(value * 100)}%`,
    );
    expect(display).toEqual({ en: "hit 50%", "zh-CN": "命中 50%" });
  });
});

describe("formatAxisTick", () => {
  it("精度跟随步长;同值走 formatMeasureValue 会缩写", () => {
    expect(formatAxisTick(0.25, 0.25)).toBe("0.25");
    expect(formatAxisTick(0.5, 0.25)).toBe("0.5");
    expect(formatMeasureValue(0.25)).toBe("0.3");
  });
});

describe("missingText / formatCellText", () => {
  it("三个内建 code 在 en / zh-CN 各有文案;未命中原样露出", () => {
    expect(missingText("noSamples", "en")).toBe("no data");
    expect(missingText("noSamples", "zh-CN")).toBe("无数据");
    expect(missingText("notRun", "en")).toBe("not run");
    expect(missingText("notRun", "zh-CN")).toBe("未跑到");
    expect(missingText("unscorable", "en")).toBe("unscorable");
    expect(missingText("unscorable", "zh-CN")).toBe("测不出");
    expect(missingText("custom-reason", "zh-CN")).toBe("custom-reason");

    expect(formatCellText({ kind: "missing", code: "noSamples" }, "zh-CN")).toBe("无数据");
    expect(formatCellText({ kind: "missing", code: "noSamples" }, "en")).toBe("no data");
    expect(formatCellText({ kind: "missing", code: "vendor-timeout" }, "zh-CN")).toBe("vendor-timeout");
  });
});

describe("呈现工具箱导出面", () => {
  it("总表函数从 niceeval/report 与 react 导出且同引用;色板 helper 不公开", () => {
    expect(report.measureDisplay).toBe(measureDisplay);
    expect(report.formatMeasureValue).toBe(formatMeasureValue);
    expect(report.formatAxisTick).toBe(formatAxisTick);
    expect(report.formatCellText).toBe(formatCellText);
    expect(report.missingText).toBe(missingText);
    expect(report.presentDimension).toBeTypeOf("function");
    expect(report.shortestUniqueLabels).toBeTypeOf("function");

    expect(reportReact.measureDisplay).toBe(report.measureDisplay);
    expect(reportReact.formatMeasureValue).toBe(report.formatMeasureValue);
    expect(reportReact.formatAxisTick).toBe(report.formatAxisTick);
    expect(reportReact.formatCellText).toBe(report.formatCellText);
    expect(reportReact.missingText).toBe(report.missingText);
    expect(reportReact.presentDimension).toBe(report.presentDimension);

    expect(report).not.toHaveProperty("SERIES_PALETTE");
    expect(report).not.toHaveProperty("colorHexForKey");
    expect(reportReact).not.toHaveProperty("SERIES_PALETTE");
    expect(reportReact).not.toHaveProperty("colorHexForKey");
    expect(reportReact).not.toHaveProperty("colorClassForKey");
  });

  it("旧 AttemptMetric / MeasureCell / ResolveMemo 不在公开面;官方读数是 Calculation", () => {
    expect(report).not.toHaveProperty("defineMeasure");
    expect(report).not.toHaveProperty("ResolveMemo");
    expect(report).not.toHaveProperty("MeasureCell");
    expect(report).not.toHaveProperty("MeasureColumn");
    expect(report).not.toHaveProperty("AttemptMetric");
    expect(report).not.toHaveProperty("taskPassRate");
    expect(report).not.toHaveProperty("executionReliability");
    expect(report).not.toHaveProperty("endToEndPassRate");
    expect(report).not.toHaveProperty("assistantTurns");
    expect(report).not.toHaveProperty("repeatedFailedCommands");
    expect(report).not.toHaveProperty("Dataset");
    expect(report).not.toHaveProperty("ScoreboardData");
    expect(isCalculation(report.totalScore)).toBe(true);
    expect(isCalculation(report.passRate)).toBe(true);
  });
});
