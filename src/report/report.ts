// defineReport:一份报告 = 一个报告文件(默认导出),两扇门(show / view)共用。
// 宿主打开结果目录、按官方口径挑好 Selection、注入上下文;报告函数折数据、摆积木,
// 返回一棵组件树。计算全部发生在报告函数体里(读句柄、await 折数据只在这里合法);
// 渲染面是纯同步函数 —— 可达百 MB 的 artifact 永远不进渲染路径。
//
// renderReportToText 是 text 宿主(show)的装载入口;web 宿主(view)的
// renderReportToStaticHtml 在 ./web.ts(那一侧才 import react-dom)。宿主接线是下一波,
// 这两个入口先以内部函数的身份可独立测试。

import type { Results, Selection } from "../results/index.ts";
import {
  createTextContext,
  renderNodeToText,
  validateReportTree,
  type ReportNode,
  type TextRenderOptions,
} from "./tree.ts";
import { prepareDefaultReportData, runWithDefaultReportData } from "./default-report.tsx";

export interface ReportContext {
  /** results.latest() 挑好的 Selection:现刻水位快照 + 结构化挑选警告,同默认报告口径。 */
  selection: Selection;
  /** 默认挑法不合口径时,全量数据自己挑(见 docs/results-lib.md)。 */
  results: Results;
}

const REPORT_DEFINITION: unique symbol = Symbol.for("niceeval.report.definition");

export interface ReportDefinition {
  build(ctx: ReportContext): ReportNode | Promise<ReportNode>;
  [REPORT_DEFINITION]: true;
}

export function defineReport(
  build: (ctx: ReportContext) => ReportNode | Promise<ReportNode>,
): ReportDefinition {
  if (typeof build !== "function") {
    throw new Error(
      "defineReport expects a build function: defineReport(async ({ selection, results }) => <Col>...</Col>).",
    );
  }
  return { build, [REPORT_DEFINITION]: true };
}

/** 宿主装载报告文件时用:默认导出是不是 defineReport 的产物。 */
export function isReportDefinition(value: unknown): value is ReportDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<ReportDefinition>)[REPORT_DEFINITION] === true &&
    typeof (value as Partial<ReportDefinition>).build === "function"
  );
}

/**
 * text 宿主的装载语义:build → 渲染前树校验 → 备好官方水位(DefaultReport 的数据)
 * → 遍历渲染 text 面。不需要 react-dom。
 */
export async function renderReportToText(
  definition: ReportDefinition,
  ctx: ReportContext,
  options?: TextRenderOptions,
): Promise<string> {
  const node = await definition.build(ctx);
  validateReportTree(node);
  const defaultData = await prepareDefaultReportData(ctx.selection);
  const textCtx = createTextContext(options);
  return runWithDefaultReportData(defaultData, () => renderNodeToText(node, textCtx));
}
