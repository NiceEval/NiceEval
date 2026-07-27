// scoring 结果的摘要投影。这里仅决定「摘要面显示哪一条、显示哪些事实」；完整诊断面继续
// 消费 AssertionResult[]，不复用这个有损投影。

import type { AssertionResult, PrimaryAssertionSummary, Verdict } from "./types.ts";

/**
 * 计分制挣分标注:"+1 pt" / "+0.8 pts"(单复数随数值)。与 report/model/format.ts 的
 * formatPointsSuffix 同规则,scoring 层不依赖 report 层,这里独立实现同一条格式化规则。
 */
function pointsSuffix(points: number): string {
  const n = Math.round(points * 10) / 10;
  const trimmed = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `+${trimmed} ${n === 1 ? "pt" : "pts"}`;
}

/**
 * Human/Agent 摘要是一条终端事实行，不是完整证据面。压成单行并设字符上限，避免 received
 * 恰好是源码/工具输出时把多页内容灌进 scrollback；完整 AssertionResult 仍原样留给 show/view。
 */
const SUMMARY_TEXT_MAX_CHARS = 240;

/**
 * Human/Agent 永久行的单行事实预算，与 SUMMARY_TEXT_MAX_CHARS（单值上限）分开计:一条
 * `matcher · expected · received` 拼起来很容易超过一屏宽,这里给的是「一行」的上限，不依赖
 * 终端 columns——agent profile 的 handoff 不是 TTY，不能按运行时宽度变化。
 */
const DETAIL_LINE_MAX_CHARS = 100;

// 捕获内容(received=命令输出 / expected=源码 / evidence)常带被测工具的着色:jest/vitest 的
// 代码帧、行号、✕ 都由 ANSI 转义(ESC[…m 等)上色。这些 ESC(U+001B)不是 \s,若原样落进任何
// 面,终端会重新解释它们(被单行截断从序列中间切开时尤其乱),HTML 报告则把 ESC[2m28|ESC[22m
// 当字面文本渲染。所以任何展示面在渲染捕获内容前先剥控制字节;剥的是展示投影,不改存进
// AssertionResult / artifact 的原始字节(完整证据仍在 events.json / diff.json)。
// CSI(ESC[…,含 SGR 着色 / 光标控制)与 OSC(ESC]…,以 BEL 或 ST 收尾);OSC 的 payload 一并吃掉,
// 不让它作为裸文本泄漏。没配成序列的裸 ESC 由 OTHER_CONTROL 兜底。
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001B(?:\[[0-9;:?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\))/g;
// 其余不可打印 C0/C1(含裸 ESC);保留 \t\n\f\r 交给下游折空白规则,不在这里塌成空。
// eslint-disable-next-line no-control-regex
const OTHER_CONTROL = /[\u0000-\u0008\u000B\u000E-\u001F\u007F-\u009F]/g;

/**
 * 剥离 ANSI 转义与其余不可打印控制字节,保留可打印字符与结构性空白(换行 / 制表)。给需要
 * 完整多行值的面(报告详情)直接用;`summaryText` 在此基础上再折单行 + 截断。jest 合法打印的
 * `✕ ✓ › ❯ ↓ │`(均 ≥ U+2020)在保留范围内,不误删。
 */
export function stripControl(value: string): string {
  return value.replace(ANSI_ESCAPE, "").replace(OTHER_CONTROL, "");
}

/** 摘要面的单值收口:剥控制字节 + 折单行 + 240 字符上限。任何把断言事实放进「行」里的面共用这一条。 */
export function summaryText(value: string): string {
  const singleLine = stripControl(value).replace(/\s+/g, " ").trim();
  return singleLine.length <= SUMMARY_TEXT_MAX_CHARS
    ? singleLine
    : `${singleLine.slice(0, SUMMARY_TEXT_MAX_CHARS - 1)}…`;
}

/**
 * 按公开展示契约选择主失败断言：failed gate 优先；只有 soft 促成 failed verdict 时才取 soft；
 * errored 且没有结构化 error 时可由第一条非 optional unavailable 解释；计分制（`scoring:
 * "points"`）`passed` 存在丢分得分点（`.points` 断言 outcome 为 failed）时取记录顺序第一条
 * （docs/feature/assertions/library/display.md「主失败断言怎样选」规则 6）。`scoring` 必填而非
 * 默认 "pass"：调用方必须显式表态，避免漏传导致这条规则悄悄失效。
 */
export function primaryAssertionSummary(
  assertions: readonly AssertionResult[],
  verdict: Verdict,
  scoring: "pass" | "points",
): PrimaryAssertionSummary | undefined {
  if (verdict === "failed") {
    const failedGates = assertions.filter(
      (assertion) => assertion.outcome === "failed" && assertion.severity === "gate",
    );
    if (failedGates.length > 0) return summaryOf(failedGates[0]!, failedGates.length - 1);

    const failedSoft = assertions.filter(
      (assertion) => assertion.outcome === "failed" && assertion.severity === "soft",
    );
    if (failedSoft.length > 0) return summaryOf(failedSoft[0]!, failedSoft.length - 1);
  }

  if (verdict === "errored") {
    const unavailable = assertions.filter(
      (assertion) => assertion.outcome === "unavailable" && assertion.optional !== true,
    );
    if (unavailable.length > 0) return summaryOf(unavailable[0]!, unavailable.length - 1);
  }

  if (verdict === "passed" && scoring === "points") {
    const lostPoints = assertions.filter(
      (assertion) => assertion.outcome === "failed" && assertion.points !== undefined,
    );
    if (lostPoints.length > 0) return summaryOf(lostPoints[0]!, lostPoints.length - 1);
  }

  return undefined;
}

function summaryOf(assertion: AssertionResult, additionalFailures: number): PrimaryAssertionSummary {
  const rawTitle = assertion.groupPath?.length ? assertion.groupPath.join(" > ") : assertion.name;
  const rawMatcher = assertion.detail ?? assertion.name;
  const title = summaryText(rawTitle);
  return {
    severity: assertion.severity,
    assertion: title,
    ...(rawMatcher !== rawTitle ? { matcher: summaryText(rawMatcher) } : {}),
    ...(assertion.outcome === "unavailable"
      ? { reason: summaryText(assertion.reason) }
      : {
          ...(assertion.expected !== undefined ? { expected: summaryText(assertion.expected) } : {}),
          ...(assertion.received !== undefined ? { received: summaryText(assertion.received) } : {}),
          ...(assertion.severity === "soft" || assertion.threshold !== undefined ? { score: assertion.score } : {}),
          ...(assertion.threshold !== undefined ? { threshold: assertion.threshold } : {}),
          ...(assertion.points !== undefined ? { points: assertion.points } : {}),
        }),
    additionalFailures,
  };
}

/** 摘要的事实层；Human/Agent 用作第二行，表格可把它接在标题后。 */
export function assertionSummaryDetail(summary: PrimaryAssertionSummary): string | undefined {
  const parts: string[] = [];
  if (summary.matcher !== undefined) parts.push(summary.matcher);
  if (summary.expected !== undefined) parts.push(`expected ${summary.expected}`);
  if (summary.received !== undefined) parts.push(`received ${summary.received}`);
  if (summary.score !== undefined) parts.push(`score ${summary.score}`);
  if (summary.threshold !== undefined) parts.push(`threshold ${summary.threshold}`);
  if (summary.reason !== undefined) parts.push(`reason ${summary.reason}`);
  if (summary.points !== undefined) parts.push(pointsSuffix(summary.points));
  if (summary.additionalFailures > 0) parts.push(`+${summary.additionalFailures} more failures`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Human/Agent 永久行的排版：标题独占一行；`matcher · expected`（含 score/threshold/reason）
 * 独占下一行；`received` 能跟这行拼在一起仍在 DETAIL_LINE_MAX_CHARS 内就合并，放不下就单独
 * 再起一行并硬截断。`+N more failures` 永远是独立尾行，不参与截断，也不拼进被截断的值——
 * 截断处的 `…` 后面只会是值本身，不会被人误读成计数的一部分。
 */
export function assertionSummaryLines(summary: PrimaryAssertionSummary): string[] {
  const lines: string[] = [`${summary.severity}: ${summary.assertion}`];

  const factParts: string[] = [];
  if (summary.matcher !== undefined) factParts.push(summary.matcher);
  if (summary.expected !== undefined) factParts.push(`expected ${summary.expected}`);
  if (summary.score !== undefined) factParts.push(`score ${summary.score}`);
  if (summary.threshold !== undefined) factParts.push(`threshold ${summary.threshold}`);
  if (summary.reason !== undefined) factParts.push(`reason ${summary.reason}`);
  if (summary.points !== undefined) factParts.push(pointsSuffix(summary.points));
  const facts = factParts.length > 0 ? factParts.join(" · ") : undefined;

  if (summary.received !== undefined) {
    const combined = facts !== undefined ? `${facts} · received ${summary.received}` : `received ${summary.received}`;
    if (combined.length <= DETAIL_LINE_MAX_CHARS) {
      lines.push(combined);
    } else {
      if (facts !== undefined) lines.push(facts);
      lines.push(shrinkTo(`received: ${summary.received}`, DETAIL_LINE_MAX_CHARS));
    }
  } else if (facts !== undefined) {
    lines.push(facts);
  }

  if (summary.additionalFailures > 0) lines.push(`+${summary.additionalFailures} more failures`);
  return lines;
}

/** 比较列表的单元格投影；无 group 时不重复 `gate:` 前缀。 */
export function compactAssertionSummary(summary: PrimaryAssertionSummary): string {
  const hasDistinctTitle = summary.matcher !== undefined;
  const head = hasDistinctTitle ? `${summary.severity}: ${summary.assertion}` : summary.assertion;
  const detail = assertionSummaryDetail(summary);
  return detail === undefined ? head : `${head} · ${detail}`;
}

/** 收口用的截断:目标长度容不下时截到 target-1 并补 `…`。 */
function shrinkTo(text: string, target: number): string {
  return text.length <= target ? text : `${text.slice(0, Math.max(0, target - 1))}…`;
}

/**
 * 单元格投影的宽度收口。空间不足时按解释力从低到高让位:先截语义标题、再截 matcher,
 * `expected / received` 与 `+N more failures` 最后截——它们直接解释为什么红。
 * maxChars 由渲染面按可用宽度给(如两行单元格 = 2 × 列宽);字符数口径与
 * SUMMARY_TEXT_MAX_CHARS 一致,显示宽度的精确裁剪仍归渲染面。
 */
export function fitCompactAssertionSummary(summary: PrimaryAssertionSummary, maxChars: number): string {
  const budget = Math.max(24, Math.floor(maxChars));
  let full = compactAssertionSummary(summary);
  if (full.length <= budget) return full;

  const TITLE_FLOOR = 24;
  let fitted: PrimaryAssertionSummary = {
    ...summary,
    assertion: shrinkTo(summary.assertion, Math.max(TITLE_FLOOR, summary.assertion.length - (full.length - budget))),
  };
  full = compactAssertionSummary(fitted);
  if (full.length <= budget) return full;

  const MATCHER_FLOOR = 16;
  if (fitted.matcher !== undefined) {
    fitted = {
      ...fitted,
      matcher: shrinkTo(fitted.matcher, Math.max(MATCHER_FLOOR, fitted.matcher.length - (full.length - budget))),
    };
    full = compactAssertionSummary(fitted);
    if (full.length <= budget) return full;
  }

  return shrinkTo(full, budget);
}
