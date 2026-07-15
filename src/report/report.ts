// defineReport:一份报告 = 一个报告文件(默认导出),两扇门(show / view)共用。
// 宿主打开结果目录、按官方口径挑好 Selection、注入上下文;报告函数折数据、摆积木,
// 返回一棵组件树。计算全部发生在报告函数体里(读句柄、await 折数据只在这里合法);
// 渲染面是纯同步函数 —— 可达百 MB 的 artifact 永远不进渲染路径。
//
// renderReportToText 是 text 宿主(show)的装载入口;web 宿主(view)的
// renderReportToStaticHtml 在 ./web.ts(那一侧才 import react-dom)。宿主接线是下一波,
// 这两个入口先以内部函数的身份可独立测试。

import type { Results, Selection, SelectionWarning } from "../results/types.ts";
import {
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  validateReportTree,
  type ReportNode,
  type TextRenderOptions,
} from "./tree.ts";
import type { ReportLocale } from "./locale.ts";

export interface ReportContext {
  /** 宿主按现刻水位规则挑好的 Selection:每个 experiment × eval 取跨快照合成的最新判定,外加结构化挑选
   警告;show 的默认索引、view 默认报告与两者的 --report 使用同一选择口径。 */
  selection: Selection;
  /** 默认挑法不合口径时,全量数据自己挑(见 docs/feature/results/library.md)。 */
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

/**
 * 宿主装载报告文件时用:默认导出是不是 ReportDefinition。defineReport 的产物是普通对象;
 * 「组件兼报告」(把 defineReport 产物 Object.assign 到双面组件上)是挂了 build 面的
 * 可调用函数,同样算数——判据只看 build 面与标记,不看宿主形态。
 */
export function isReportDefinition(value: unknown): value is ReportDefinition {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    (value as Partial<ReportDefinition>)[REPORT_DEFINITION] === true &&
    typeof (value as Partial<ReportDefinition>).build === "function"
  );
}

/**
 * 挑选警告的 text 形态:每条渲染好的 message 前缀 "! ",一行一条(与 RunOverview /
 * overviewText 里 warnings 的 "! <message>" 约定一致)。宿主级前置块——不依赖报告是否
 * 摆了 RunOverview,裸跑 / --report 都在报告顶上如实报残缺,不静默。
 */
function renderSelectionWarningsText(warnings: SelectionWarning[], _locale: ReportLocale): string {
  return warnings.map((w) => `! ${w.message}`).join("\n");
}

/**
 * text 宿主的装载语义:build → 渲染前解析数据组件(唯一的 await 边界)→ 树校验 → 遍历渲染
 * text 面;Selection 有挑选警告时在报告顶部前置一块 "! <message>"；报告树里的 RunOverview
 * 已经渲染同一条时不重复。不需要 react-dom。
 */
export async function renderReportToText(
  definition: ReportDefinition,
  ctx: ReportContext,
  options?: TextRenderOptions,
): Promise<string> {
  const node = await definition.build(ctx);
  const resolved = await resolveReportTree(node);
  validateReportTree(resolved);
  const textCtx = createTextContext(options);
  const body = renderNodeToText(resolved, textCtx);
  // RunOverview can render the same Selection warnings as part of the user tree. Keep the
  // host guarantee for reports that omit it, while never printing an identical warning twice.
  const missingWarnings = ctx.selection.warnings.filter((warning) => !body.includes(`! ${warning.message}`));
  return missingWarnings.length > 0
    ? [renderSelectionWarningsText(missingWarnings, textCtx.locale), body].join("\n\n")
    : body;
}
