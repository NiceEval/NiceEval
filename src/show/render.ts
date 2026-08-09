// show 的文本渲染:--history 时间轴、四个证据切面(source / execution / timing / diff)。多
// attempt 范围的分节由 show/index.ts 的 renderEvidenceSections 逐 attempt 复用这些 renderer,
// 不在这里重复。输出形态照 docs-site/zh/tutorials/viewing-results.mdx 的示例块;长内容一律
// 截断,但截断永远如实标注剩余数量和原始 artifact 路径 —— 输出对上下文窗口友好,事实源留在
// 盘上。全部纯函数(时间经 now 显式传入),证据数据由调用方 await 好了递进来。

import { join, relative } from "node:path";
import type { CommandExitEvidence, CommandLimitAttribution, EvalResult, LocalizedText, SandboxBuildRecord, TimingActivity, TraceSpan, Verdict } from "../types.ts";
import type { EvaluationFactResult, ScoreFactUseResult, VerdictFactUseResult } from "../assertions/types.ts";
import type { AttemptEvidence, AttemptHandle, Run } from "../record/index.ts";
import type {
  LineAnnotation,
  ProjectedSourceCall,
  ProjectedSourceLine,
  SendAnnotation,
  SourceCallSummary,
  SourceContentNode,
} from "../record/index.ts";
import { groupIncompatibleVersionSkips } from "../record/index.ts";
import { attemptTerminalOf, factRecordOf, scoreOutcomeOf } from "../record/fact-record.ts";
import type { UnreadableRun } from "../record/index.ts";
import type { ExecutionNode, ExecutionTree } from "../o11y/execution-tree.ts";
import { factDisplaySummary, stripControl, summaryText } from "../assertions/display.ts";
import { firstLine } from "../util.ts";
import { formatDurationMs, formatMetricValue, formatPlainNumber, formatUSD } from "../report/model/format.ts";
import { formatTurnLabel, normalizeTurnLabel } from "../shared/turn-label.ts";
import { diffFilePatchText, diffSummaryText } from "../report/definition/primitives/diff-lines.ts";
import type { AttemptDiffData } from "../report/model/types.ts";
import type {
  AnnotatedSourceResult,
  AttemptTimingResult,
  ConversationResult,
  RunTimingBuildResult,
  RunTimingResult,
} from "../report/tasks.ts";
import { indentBlock, padDisplay, renderAlignedRows, wrapDisplay } from "../report/model/text-layout.ts";
import type { AttemptHistoryRow } from "./compose.ts";
import { localizeText, type HostCommandContext } from "../report/runtime/host.ts";
import { showCommand } from "./command.ts";

const MISSING = "—";

// ───────────────────────── 时间与小件 ─────────────────────────

/** 判定时间的相对标注("just now" / "41s ago" / "2h ago");未来时刻按 just now 兜底。 */
export function relativeAgo(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 10_000) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 120) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** 时间轴行的时刻:ISO 截到分钟,冒号换 -(与 run 目录名的清洗一致)。 */
export function timelineStamp(iso: string): string {
  return iso.slice(0, 16).replace(/:/g, "-");
}

function verdictMark(verdict: Verdict): string {
  if (verdict === "passed") return "✓";
  if (verdict === "skipped") return "-";
  return "✗";
}

function attemptsLabel(n: number): string {
  return `${n} ${n === 1 ? "attempt" : "attempts"}`;
}

/**
 * attempt artifact 目录的展示路径:尽量给相对 cwd 的短路径,出了 cwd 给绝对路径。
 * 本快照跑出的条目:artifact 与 result.json 同目录,= `<run.dir>/<ref.attempt>`。
 * 携带条目(--resume 合入):落盘的 artifactBase 相对结果根(= run.dir 的上两级,
 * 即 `<experiment-dir>/<run-dir>` 的上一层),指向原快照的 attempt 目录。
 */
export function attemptArtifactsPath(attempt: AttemptHandle, cwd: string): string {
  const r = attempt.result;
  const abs = r.artifactBase
    ? join(attempt.run.dir, "..", "..", r.artifactBase)
    : join(attempt.run.dir, attempt.ref.attempt);
  const rel = relative(cwd, abs);
  return rel.startsWith("..") ? abs : rel;
}

/**
 * 裸 `show` 零可读结果时,unreadable 目录的展示文案。niceeval 自己写的、schemaVersion 不兼容的
 * 落盘按 producer 版本分组,一条 `npx niceeval@<version> show --record <记录根>` 覆盖同版本全部
 * Run——show 没有 view 的单 Run 直读模式,`--record` 认的是记录根(其下可以有多个 experiment),
 * 不是单个快照目录,所以不对每个目录重复拼一条各自的命令(那条命令用同一个 root 跑起来
 * 结果完全一样,重复只会刷屏)。其余(第三方 harness、版本信息缺失、malformed、incomplete)
 * 没有可执行的统一建议,原样逐条列出。
 */
export function skippedRunsText(unreadable: readonly UnreadableRun[], root: string, cwd: string): string {
  const { groups, rest } = groupIncompatibleVersionSkips(unreadable);
  const rootDisplay = relative(cwd, root) || ".";
  const lines: string[] = [];
  for (const g of groups) {
    const count = g.dirs.length;
    const version = g.producer.version;
    const schema = g.schemaVersion !== undefined ? ` (schemaVersion ${g.schemaVersion})` : "";
    const cmd = `npx niceeval@${version} show --record ${rootDisplay}`;
    lines.push(
      `  ${count} run${count === 1 ? "" : "s"} written by niceeval ${version}${schema} — run \`${cmd}\` to view`,
    );
  }
  for (const s of rest) {
    lines.push(`  unreadable ${s.dir} (${s.reason})`);
  }
  return lines.join("\n");
}

// ───────────────────────── AttemptEvidence 共用 ─────────────────────────
// evalSourceText / executionText / timingText / diffText(--source / --execution / --timing / --diff
// 四个证据切面)共用的小件:locator 头、失败原因、断言计票摘要。四个证据 renderer 都只消费
// 同一份 AttemptEvidence,不各自读 artifact 或重新判定 capability(loadAttemptEvidence 已经
// 算好);多 attempt 范围的分节由 show/index.ts 的 renderEvidenceSections 逐 attempt 复用这些
// renderer,不在这里重复。无证据 flag 的默认页改由 niceeval/report 的 attempt-input page 管线
// 渲染(docs/feature/reports/show/attempt.md),不在这里。

/** 证据切面的头行:`@<locator> · <evalId> · <experimentId> · <verdict>`。 */
export function attemptEvidenceHeader(evidence: AttemptEvidence): string {
  return [evidence.locator, evidence.identity.evalId, evidence.experimentId, attemptTerminalText(evidence.result)].join(" · ");
}

/** Exact Fact terminal text; score diagnostics are never collapsed into a generic verdict. */
export function attemptTerminalText(result: EvalResult): string {
  const terminal = attemptTerminalOf(result);
  const score = scoreOutcomeOf(result);
  if (score === undefined) return terminal;
  return `${terminal} · earned ${formatPlainNumber(score.earnedScore)} · credited ${score.creditedScore === null ? "null" : formatPlainNumber(score.creditedScore)}`;
}

/**
 * 一次 attempt 未通过的判定原因,单行、不含 detail——供紧凑索引行使用。precedence 与
 * `Fact/use` 图决定摘要；结构化执行 error 与 skip 理由才是图外回退。这里独立实现而不是导入
 * report/ 的函数:
 * report 包正被并行重写(见 plan/attempt-evidence-feedback-loop.md),show 的紧凑索引不应
 * 依赖它的内部实现细节。
 */
export function verdictReasonLine(result: EvalResult): string | undefined {
  const fact = factDisplaySummary(result);
  if (fact !== undefined) return fact.text;
  // 单行面只要 error 的一层摘要:message 取首行(diagnose 的 output tail 等后续行归
  // attempt 详情块展开),再经 summaryText 剥控制字节 + 收口。
  if (result.error !== undefined) return summaryText(firstLine(result.error.message));
  if (result.skipReason !== undefined) return result.skipReason;
  return undefined;
}

// ───────────────────────── --history ─────────────────────────

/**
 * 一个 experimentId + evalId 的执行时间轴分节(docs/feature/reports/show.md「--history」):
 * 节头 `<evalId> · <experimentId> · N attempts · passed x/N`,节内每行
 * 时间 / verdict / 单行摘要 / 耗时 / 成本 / locator,startedAt 升序(compose 已排好)。
 */
export function attemptHistoryText(opts: {
  experimentId: string;
  evalId: string;
  rows: AttemptHistoryRow[];
}): string {
  const { experimentId, evalId, rows } = opts;
  const passed = rows.filter((r) => r.verdict === "passed").length;
  const head = [
    evalId,
    experimentId,
    attemptsLabel(rows.length),
    `passed ${passed}/${rows.length}`,
  ].join(" · ");
  if (rows.length === 0) return head;
  const table = renderAlignedRows(
    rows.map((r) => [
      r.startedAt !== undefined ? timelineStamp(r.startedAt) : MISSING,
      `${verdictMark(r.verdict)} ${r.terminal}`,
      r.summary ?? MISSING,
      formatDurationMs(r.durationMs),
      r.costUSD === null ? MISSING : formatUSD(r.costUSD),
      r.locator ?? MISSING,
    ]),
  );
  return `${head}\n\n${indentBlock(table, "  ")}`;
}

// ───────────────────────── --report 其余页索引 ─────────────────────────

/**
 * 渲染初始页之后追加的「其余页」索引(docs/feature/reports/show/reports.md Case 2):
 * 只列未渲染的页 —— 每行 id / 本 locale 页名 / 可复制的 `--page` 命令,索引命令携带完整上下文
 * (--record / --report / 位置参数),复制即可精确复现下一层视图。调用方只在页数大于一时
 * 拼接这段(单页定义没有「其余页」段);`otherPages` 不含被渲染的那一页。
 */
export function otherPagesText(opts: {
  otherPages: { id: string; title: LocalizedText }[];
  command: HostCommandContext;
  locale: string;
}): string {
  const { otherPages, command, locale } = opts;
  const head = locale === "zh-CN" ? "其余页：" : "Other pages:";
  const table = renderAlignedRows(
    otherPages.map((page) => [
      page.id,
      localizeText(page.title, locale) ?? page.id,
      showCommand({ ...command, page: page.id }),
    ]),
  );
  return `${head}\n${indentBlock(table, "  ")}`;
}

// ───────────────────────── 截断预算(--eval / --execution / 全景共用) ─────────────────────────

const MAX_EVENTS = 80;
const MAX_TEXT = 600;

function clip(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (+${text.length - max} more chars)`;
}

function jsonPreview(value: unknown, max = 200): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "";
  } catch {
    text = String(value);
  }
  return clip(text, max);
}

function recordOf(value: unknown): globalThis.Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as globalThis.Record<string, unknown> : undefined;
}

function indentedText(text: string, width: number, indent = 4, maxLines = 18): string[] {
  const source = clip(text).split("\n");
  const shown = source.slice(0, maxLines);
  const lines = shown.flatMap((line) => wrapDisplay(line || " ", Math.max(20, width - indent)).map((part) => `${" ".repeat(indent)}${part}`));
  if (source.length > shown.length) lines.push(`${" ".repeat(indent)}… (+${source.length - shown.length} more lines)`);
  return lines;
}

// ───────────────────────── 证据切面:--eval(Eval 源码标注) ─────────────────────────

/** send 行摘要只显示 status · 墙钟(有记录才出现),不透传内部轮 label。 */
function sendAnnotationLine(send: SendAnnotation): string {
  const parts: string[] = [send.status];
  if (send.durationMs !== undefined) parts.push(formatDurationMs(send.durationMs));
  return parts.join(" · ");
}

function sourceLocText(loc: { file: string; line: number } | undefined): string | undefined {
  return loc === undefined ? undefined : `${loc.file}:${loc.line}`;
}

function factResultLine(fact: EvaluationFactResult): string {
  const details = [
    `fact: ${fact.name}`,
    fact.outcome,
    ...(fact.expected !== undefined ? [`expected ${summaryText(fact.expected)}`] : []),
    ...(fact.received !== undefined ? [`received ${summaryText(fact.received)}`] : []),
    ...(fact.explanation !== undefined ? [`explanation ${summaryText(fact.explanation)}`] : []),
    ...(fact.outcome === "unavailable" || fact.outcome.startsWith("notReached") ? [`reason ${(fact as { reason: string }).reason}`] : []),
    ...(fact.outcome === "errored" ? [`error ${fact.error.message}`] : []),
    ...(sourceLocText(fact.producerLoc) ? [`producer: ${sourceLocText(fact.producerLoc)!}`] : []),
  ];
  return details.join(" · ");
}

function factUseLine(use: VerdictFactUseResult | ScoreFactUseResult): string {
  const title = use.useKind === "score" ? use.label : use.label ?? use.key ?? use.method;
  const useKind = use.useKind === "verdict" && use.outcome === "failed" ? "gate" : use.useKind;
  const details = [
    `${use.outcome === "passed" || use.outcome === "scored" ? "✓" : use.outcome === "failed" || use.outcome === "errored" ? "✗" : "◌"} ${useKind}`,
    title,
    ...(use.key !== undefined && use.label !== undefined ? [`key: ${use.key}`] : []),
  ];
  if (use.useKind === "score" && use.outcome === "scored") {
    details.push(use.input.kind === "fact" ? `${formatPlainNumber(use.earned)} / ${formatPlainNumber(use.input.max)}` : formatPlainNumber(use.earned));
  }
  if (use.outcome === "unavailable" || use.outcome.startsWith("notReached") || use.outcome === "notApplicable") {
    details.push(`reason ${summaryText((use as { reason: string }).reason)}`);
  }
  if (use.outcome === "errored") details.push(`error ${summaryText(use.error.message)}`);
  const consumer = sourceLocText(use.consumerLoc);
  if (consumer) details.push(`consumer: ${consumer}`);
  return details.join(" · ");
}

function lineGlyph(annotations: readonly LineAnnotation[]): string {
  const sends = annotations.flatMap((annotation) => annotation.kind === "send" ? [annotation.send] : []);
  const anyFailed = annotations.some((annotation) =>
    (annotation.kind === "fact" && (annotation.fact.outcome === "failed" || annotation.fact.outcome === "errored")) ||
    (annotation.kind === "factUse" && (annotation.use.outcome === "failed" || annotation.use.outcome === "errored"))
  ) || sends.some((send) => send.status === "failed");
  const anyUnavailable = annotations.some((annotation) =>
    (annotation.kind === "fact" && (annotation.fact.outcome === "unavailable" || annotation.fact.outcome.startsWith("notReached"))) ||
    (annotation.kind === "factUse" && (
      annotation.use.outcome === "unavailable" || annotation.use.outcome === "notApplicable" || annotation.use.outcome.startsWith("notReached")
    ))
  );
  return annotations.length === 0
    ? " "
    : anyFailed
      ? "✗"
      : anyUnavailable
        ? "◌"
        : "✓";
}

function annotationDetailLine(annotation: LineAnnotation): string | undefined {
  if (annotation.kind === "send") return sendAnnotationLine(annotation.send);
  if (annotation.kind === "fact") return factResultLine(annotation.fact);
  if (annotation.kind === "factUse") return factUseLine(annotation.use);
  return undefined;
}

function evalSourceLineText(line: ProjectedSourceLine, gutterWidth: number, width: number, indent: string): string[] {
  const glyph = lineGlyph(line.annotations);
  const marginWidth = gutterWidth + 2; // 行号列 + glyph + 分隔空格
  const prefix = `${indent}${padDisplay(String(line.line), gutterWidth)}${glyph} `;
  // 源码行的空白(尤其是缩进)是语义的一部分:wrapDisplay 按单词重排会把连续空格
  // 吃成一个、把缩进整体丢掉(agent-feedback-loop.mdx 的示例明确保留 2/4/6 格嵌套缩进)。
  // 过长的源码行只裁一刀(clip,与其它证据切面的截断口径一致),不按词折成多行——
  // 折行只对续行加统一 margin,救不回已经被吃掉的原始缩进,不如老实截断。
  const available = Math.max(20, width - marginWidth - indent.length);
  const out = [prefix + clip(line.text, available)];
  const margin = `${indent}${" ".repeat(marginWidth)}`;
  for (const annotation of line.annotations) {
    const detail = annotationDetailLine(annotation);
    if (detail === undefined) continue;
    for (const wrapped2 of wrapDisplay(detail, available)) out.push(margin + wrapped2);
  }
  return out;
}

function sourceCallSummaryLine(summary: SourceCallSummary): string {
  return [
    `${summary.checks} checks`,
    `${summary.passed} ✓`,
    `${summary.failed} ✗`,
    ...(summary.unavailable > 0 ? [`${summary.unavailable} unavailable`] : []),
    ...(summary.points ? [`${summary.points.earned}/${summary.points.available} pts`] : []),
    ...(summary.aborted ? ["aborted"] : []),
  ].join(" · ");
}

function renderOpaqueCall(call: ProjectedSourceCall, indent: string, width: number): string[] {
  const target = call.target;
  if (target.kind === "source") return renderSourceNode(target.node, indent, width);
  const label = target.kind === "package"
    ? `package: ${target.package}`
    : `source unavailable: ${target.file}${target.line === undefined ? "" : `:${target.line}`}`;
  const lines = [`${indent}${label}`];
  if (target.kind === "unavailable") {
    for (const annotation of target.annotations) {
      const detail = annotationDetailLine(annotation);
      if (detail) lines.push(...wrapDisplay(detail, Math.max(20, width - indent.length - 2)).map((part) => `${indent}  ${part}`));
    }
  }
  if (call.open) {
    for (const child of target.calls) {
      const childLabel = child.target.kind === "source"
        ? child.target.node.file
        : child.target.kind === "package"
          ? `package: ${child.target.package}`
          : `source unavailable: ${child.target.file}`;
      lines.push(`${indent}↳ ${childLabel} · ${sourceCallSummaryLine(child.summary)}`);
      if (child.open) lines.push(...renderOpaqueCall(child, `${indent}│ `, width));
    }
  }
  return lines;
}

function renderSourceNode(node: SourceContentNode, indent: string, width: number): string[] {
  const lines: string[] = [`${indent}${node.file}`];
  const gutterWidth = String(node.lines.at(-1)?.line ?? 1).length;
  let previous = 0;
  for (const line of node.lines) {
    if (previous > 0 && line.line > previous + 1) lines.push(`${indent}... ${line.line - previous - 1} lines`);
    else if (previous === 0 && line.line > 1) lines.push(`${indent}... ${line.line - 1} lines`);
    lines.push(...evalSourceLineText(line, gutterWidth, width, indent));
    for (const call of line.calls) {
      const label = call.target.kind === "source"
        ? call.target.node.file
        : call.target.kind === "package"
          ? `package: ${call.target.package}`
          : `source unavailable: ${call.target.file}`;
      lines.push(`${indent}  ↳ ${label} · ${sourceCallSummaryLine(call.summary)}`);
      if (call.open) lines.push(...renderOpaqueCall(call, `${indent}  │ `, width));
    }
    previous = line.line;
  }
  return lines;
}

function hasClosedCalls(node: SourceContentNode): boolean {
  const visit = (calls: readonly ProjectedSourceCall[]): boolean => calls.some((call) => {
    if (!call.open) return true;
    if (call.target.kind === "source") return hasClosedCalls(call.target.node);
    return visit(call.target.calls);
  });
  return node.lines.some((line) => visit(line.calls));
}

/**
 * `--eval`:运行时保存的 Eval 源码,Fact producer / consumer 标回源码行；
 * 无位置事实也必须保留，`evidence.evalSource === null` 时如实说明源码未捕获。
 */
export function evalSourceText(
  result: AnnotatedSourceResult,
  opts: { header: string; artifactPath?: string; width: number },
): string {
  const { header, artifactPath, width } = opts;
  const source = result.source;
  const artifact = artifactPath ? join(artifactPath, "sources.json") : undefined;
  if (!source) {
    return `${header}\n\n(eval source unavailable for this attempt${artifact ? ` · expected: ${artifact}` : ""})`;
  }

  const blocks: string[] = [header, renderSourceNode(source.spine, "", width).join("\n")];
  for (const detached of source.detached) {
    blocks.push(`outside the eval entry · ${renderSourceNode(detached, "", width).join("\n")}`);
  }

  if (source.unmapped.facts.length > 0 || source.unmapped.uses.length > 0) {
    const unmappedLines = [
      ...source.unmapped.facts.map(factResultLine),
      ...source.unmapped.uses.map(factUseLine),
    ].map((line) => indentBlock(wrapDisplay(line, width - 2).join("\n"), "  "));
    blocks.push(
      [`unmapped evidence (${unmappedLines.length}, no source location):`, ...unmappedLines].join("\n"),
    );
  }

  const tail = [
    `${source.summary.checks} checks · ${source.summary.passed} passed · ${source.summary.failed} failed` +
      (source.summary.unavailable > 0 ? ` · ${source.summary.unavailable} unavailable` : ""),
  ];
  // 标注行的值是收口预览;有未通过断言时给「更进一步」——attempt 首页展开完整 expected /
  // received(含 output tail),再往下是 result.json / events.json。
  if (source.summary.failed > 0 || source.summary.unavailable > 0) {
    tail.push(`full failure detail: niceeval show ${result.locator}`);
  }
  if (hasClosedCalls(source.spine) || source.detached.some(hasClosedCalls)) {
    tail.push(`inline every callee: niceeval show ${result.locator} --source=full`);
  }
  if (artifact) tail.push(`full eval source: ${artifact}`);
  blocks.push(tail.join("\n"));
  return blocks.join("\n\n");
}

// ───────────────────────── 证据切面:--execution(标准事件流 + OTel enrichment) ─────────────────────────

function relSeconds(ms: number, originMs: number): string {
  return `${((ms - originMs) / 1000).toFixed(1)}s`;
}

/** 卡片正文的有界预览预算(docs/feature/reports/show/execution.md「卡片预览预算与 --expand」):
 *  主尺度是行——每个内容段最多显示前 3 行(保留原始换行);每段另有 1 KiB(UTF-8 字节)兜底,
 *  防单行超长的 JSON blob 击穿行预算。 */
const CARD_SEGMENT_MAX_LINES = 3;
const CARD_SEGMENT_BUDGET_BYTES = 1024;

/**
 * 按 UTF-8 字节预算截断,永不切断一个 codepoint。快速路径:总字节数不超预算时不做任何逐字符
 * 扫描。慢速路径只在确实超限时才逐 codepoint 累加字节数,找到恰好塞满预算的前缀。
 */
function truncateByteBudget(text: string, maxBytes: number): { shown: string; foldedChars: number } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { shown: text, foldedChars: 0 };
  const chars = Array.from(text);
  let bytes = 0;
  let i = 0;
  for (; i < chars.length; i++) {
    const charBytes = Buffer.byteLength(chars[i]!, "utf8");
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
  }
  return { shown: chars.slice(0, i).join(""), foldedChars: chars.length - i };
}

/** 一段内容截断后的状态:`shown` 是保留的前缀,`linesFullyHidden` 是被 3 行上限整行折掉的行数
 *  (不含被字节兜底截到一半的那一行),`partialCut` 标记这段是否被字节兜底从中间截断过,
 *  `foldedChars` 是这段被折掉的字符总数(= 原文 codepoint 数 − `shown` 的 codepoint 数)。 */
interface SegmentTruncation {
  shown: string;
  linesFullyHidden: number;
  partialCut: boolean;
  foldedChars: number;
}

/**
 * 单段的行 + 字节双重预算截断(docs/feature/reports/show/execution.md「卡片预览预算与
 * --expand」):先按 3 行裁剪(保留原始换行),再对裁剪结果套 1 KiB 字节兜底(按字符边界回退,
 * 不切分代理对),防单行超长的 JSON blob 击穿行预算。两次裁剪都只从末尾裁,`shown` 因此恒是
 * 原文的一个前缀,折字符数可以直接用两侧 codepoint 数之差倒推。
 */
function truncateSegment(text: string): SegmentTruncation {
  const lines = text.split("\n");
  const shownLineCount = Math.min(CARD_SEGMENT_MAX_LINES, lines.length);
  const candidate = lines.slice(0, shownLineCount).join("\n");
  const { shown, foldedChars: byteFoldedChars } = truncateByteBudget(candidate, CARD_SEGMENT_BUDGET_BYTES);
  const totalChars = Array.from(text).length;
  const shownChars = Array.from(shown).length;
  return {
    shown,
    linesFullyHidden: lines.length - shownLineCount,
    partialCut: byteFoldedChars > 0,
    foldedChars: totalChars - shownChars,
  };
}

/**
 * 卡尾截断提示的聚合(docs/feature/reports/show/execution.md「卡片预览预算与 --expand」):
 * N 是全卡各段被整行折掉的行数之和,再加上「同一张卡里确实有整行被折」时,每个被字节兜底截到
 * 一半的段各计 1 行——这条规则只在 N 本来就 > 0 时生效;如果全卡没有任何一段整行被折、只是
 * 某段字节兜底切了字符(单段本身没超 3 行,但这一两行太长),N 退化为 0,尾巴退化成
 * `(+M chars · …)`,不虚报一行「被折」。返回 undefined 表示这张卡没有任何段被截断,调用方不
 * 应追加尾巴。
 */
function foldCardTail(bits: readonly SegmentTruncation[], locator: string, handle: string): string | undefined {
  const totalFoldedChars = bits.reduce((sum, b) => sum + b.foldedChars, 0);
  if (totalFoldedChars === 0) return undefined;
  const totalHiddenLines = bits.reduce((sum, b) => sum + b.linesFullyHidden, 0);
  const partialCutCount = bits.reduce((sum, b) => sum + (b.partialCut ? 1 : 0), 0);
  const n = totalHiddenLines > 0 ? totalHiddenLines + partialCutCount : 0;
  const head = n > 0 ? `+${n} line${n === 1 ? "" : "s"} · ${totalFoldedChars} chars` : `+${totalFoldedChars} chars`;
  return `(${head} · niceeval show ${locator} --execution --expand ${handle})`;
}

/** 逐行加前缀,保留原始换行(不做 wrapDisplay 折行——「保留原始换行」是这个区块 text 面的契约)。
 *  空行不补前缀,避免制造纯空白的尾随行。 */
function indentLines(text: string, indent: string): string {
  if (indent === "") return text;
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : `${indent}${line}`))
    .join("\n");
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** grep 的一次匹配测试;显式重置 lastIndex,不让调用方传入的全局/粘性正则的内部状态
 *  在多张卡片之间互相污染(RegExp.test 对 g/y 标志有状态)。 */
function testGrep(grep: RegExp, text: string): boolean {
  if (grep.global || grep.sticky) grep.lastIndex = 0;
  return grep.test(text);
}

// ───────────────────────── 卡片模型:句柄、分组、内容 ─────────────────────────

/** Agent 事件卡:句柄 `t<轮序>.c<轮内卡序>`,两个序号从 1 起、由 events.json 的事件序确定性派生
 *  (docs/feature/reports/show/execution.md「卡片预览预算与 --expand」)。 */
interface AgentCard {
  handle: string;
  turnNumber: number;
  cardNumber: number;
  node: ExecutionNode;
}

interface TurnSection {
  turnNumber: number;
  /** 对应的 timing turn 节点;缺失时(如没有阶段计时)只用序号兜底渲染头行。 */
  turn?: TimingActivity;
  cards: AgentCard[];
}

/** Sandbox 命令卡(成功、observed、failed 三态):句柄 `cmd<序号>`,按关联 timing 节点的 startOffsetMs 排序后从 1 编号。 */
interface CommandCard {
  handle: string;
  command: CommandExitEvidence;
  timingNode?: TimingActivity;
}

/** `commands.json` 的投影(docs/feature/record/architecture.md「commandsjson」);没有 Sandbox 命令时 evidence.commands 为空。 */
function commandExitsOf(evidence: ConversationResult): readonly CommandExitEvidence[] {
  return evidence.commands;
}

function findTimingActivityById(nodes: readonly TimingActivity[] | undefined, id: string): TimingActivity | undefined {
  for (const n of nodes ?? []) {
    if (n.id === id) return n;
    const found = findTimingActivityById(n.children, id);
    if (found) return found;
  }
  return undefined;
}

function findCommandTimingActivity(phases: readonly NonNullable<EvalResult["phases"]>[number][], id: string): TimingActivity | undefined {
  for (const p of phases) {
    const found = findTimingActivityById(p.children, id);
    if (found) return found;
  }
  return undefined;
}

/** 失败命令卡按关联 timing 节点的 startOffsetMs 排序后编号;关联不到节点的排到最后(仍确定性,
 *  按原始 commands.json 顺序兜底)。 */
function buildCommandCards(evidence: ConversationResult): CommandCard[] {
  const commands = commandExitsOf(evidence);
  if (commands.length === 0) return [];
  const phases = evidence.phases;
  const withNode = commands.map((command, index) => ({ command, index, timingNode: findCommandTimingActivity(phases, command.timingNodeId) }));
  withNode.sort((a, b) =>
    (a.timingNode?.startOffsetMs ?? Number.POSITIVE_INFINITY) - (b.timingNode?.startOffsetMs ?? Number.POSITIVE_INFINITY) ||
    a.index - b.index,
  );
  return withNode.map((entry, i) => ({ handle: `cmd${i + 1}`, command: entry.command, timingNode: entry.timingNode }));
}

/**
 * 按轮分段(docs/feature/reports/show.md「--execution」):边界按用户消息切(t.send 恒以用户消息
 * 开轮)。事件流不以用户消息开头的极端情形(如首个事件是前置注入)仍归入轮 1——句柄两个序号从 1
 * 起是契约,不发明 0 号轮。
 */
function groupIntoTurnCards(agentNodes: readonly ExecutionNode[], turnNodes: readonly TimingActivity[]): TurnSection[] {
  const turns: TurnSection[] = [];
  for (const node of agentNodes) {
    const isTurnStart = node.kind === "message" && node.role === "user";
    if (isTurnStart || turns.length === 0) {
      const turnNumber = turns.length + 1;
      turns.push({ turnNumber, turn: turnNodes[turnNumber - 1], cards: [] });
    }
    const section = turns[turns.length - 1]!;
    const cardNumber = section.cards.length + 1;
    section.cards.push({ handle: `t${section.turnNumber}.c${cardNumber}`, turnNumber: section.turnNumber, cardNumber, node });
  }
  return turns;
}

function nodeMeta(node: ExecutionNode, originMs: number): string {
  const span = node.kind !== "telemetry" ? node.span : undefined;
  if (!span) return "";
  return `${relSeconds(span.startMs, originMs)} · ${formatDurationMs(span.endMs - span.startMs)}`;
}

/** 卡片正文的一个内容段(docs/feature/reports/show/execution.md「卡片预览预算与 --expand」):
 *  预览预算(3 行 + 1 KiB 兜底)按段独立截断,不是对整卡正文一次性截断。 */
interface CardSegment {
  /** 段的骨架行(如 `input` / `result · completed`);不计入预算、不截断。undefined 表示这段
   *  没有骨架行——单段卡的正文,或失败命令卡的命令行本身。 */
  label?: string;
  /** 这段的完整(未截断)原始内容,保留原始换行;预算截断与 --expand 的完整输出都基于它。 */
  text: string;
}

interface CardParts {
  /** 卡片标题行(不缩进,含 kind 标签与相对时间/耗时 meta)。 */
  header: string;
  /** 卡片正文按结构划分的段落;角色文本/thinking 这类单段卡只有 1 段,TOOL 卡 input/result
   *  各一段,失败命令卡命令行/stdout/stderr 各一段。 */
  segments: CardSegment[];
  /** --grep 的匹配面:角色文本、工具名、input、result(docs/feature/reports/show/execution.md
   *  「范围化:跨 attempt 扫描与 --grep」);未经截断,grep 命中不受预览预算影响。 */
  matchText: string;
  /** 截断尾巴相对卡片正文的额外缩进——多段结构(如 TOOL 的 input/result)的正文本身已经带
   *  一层内嵌缩进,尾巴要落在同一层,不是贴着卡片左边。 */
  tailIndent: string;
}

/** 一个 Agent 事件节点 → 卡片的标题/段落/匹配面。`node.kind` 已排除 telemetry(见调用方的
 *  agentNodes 过滤),telemetry 分支仅为联合类型穷尽性存在,不会被触达。 */
function agentCardParts(node: ExecutionNode, originMs: number): CardParts {
  const meta = nodeMeta(node, originMs);
  const withMeta = (title: string) => (meta ? `${title}  ${meta}` : title);
  switch (node.kind) {
    case "message":
      return { header: withMeta(node.role.toUpperCase()), segments: [{ text: node.text }], matchText: node.text, tailIndent: "" };
    case "thinking":
      return { header: withMeta("THINKING"), segments: [{ text: node.text }], matchText: node.text, tailIndent: "" };
    case "context.injected":
      return {
        header: withMeta(node.source ? `CONTEXT INJECTED · ${node.source}` : "CONTEXT INJECTED"),
        segments: [{ text: node.text }],
        matchText: node.text,
        tailIndent: "",
      };
    case "skill.loaded":
      return { header: withMeta(`SKILL · ${node.skill}`), segments: [{ text: "loaded" }], matchText: node.skill, tailIndent: "" };
    case "action": {
      const input = recordOf(node.input);
      const output = recordOf(node.output);
      const inputText = typeof input?.command === "string" ? input.command : jsonText(node.input);
      const outputText = typeof output?.output === "string"
        ? output.output
        : node.output !== undefined
          ? jsonText(node.output)
          : "(no result)";
      const exit = typeof output?.exit_code === "number" ? ` · exit ${output.exit_code}` : "";
      return {
        header: withMeta(`TOOL · ${node.name}`),
        segments: [
          { label: "input", text: inputText },
          { label: `result · ${node.status}${exit}`, text: outputText },
        ],
        matchText: `${node.name} ${inputText} ${outputText}`,
        tailIndent: "  ",
      };
    }
    case "subagent": {
      const resultText = node.output === undefined ? node.status : `result · ${node.status}: ${jsonText(node.output)}`;
      return { header: withMeta(`SUBAGENT · ${node.name}`), segments: [{ text: resultText }], matchText: `${node.name} ${resultText}`, tailIndent: "" };
    }
    case "input.requested": {
      const text = node.request.prompt ?? node.request.display ?? "(input requested)";
      const matchText = [text, node.request.action, node.request.input !== undefined ? jsonText(node.request.input) : undefined]
        .filter((s): s is string => s !== undefined)
        .join(" ");
      return { header: withMeta("INPUT REQUESTED"), segments: [{ text }], matchText, tailIndent: "" };
    }
    case "compaction":
      return { header: withMeta("COMPACTION"), segments: [{ text: node.reason ?? "context compacted" }], matchText: node.reason ?? "", tailIndent: "" };
    case "error":
      return { header: withMeta("ERROR"), segments: [{ text: node.message }], matchText: node.message, tailIndent: "" };
    case "telemetry":
      return { header: "TELEMETRY", segments: [], matchText: "", tailIndent: "" };
  }
}

function commandCardParts(command: CommandExitEvidence): CardParts {
  const segments: CardSegment[] = [{ text: command.display }];
  if (command.stdout) segments.push({ label: "stdout", text: command.stdout });
  if (command.stderr) segments.push({ label: "stderr", text: command.stderr });
  return {
    header: "",
    segments,
    matchText: `${command.display} ${command.stdout} ${command.stderr}`,
    tailIndent: "  ",
  };
}

function commandCardHeader(entry: CommandCard): string {
  const duration = entry.timingNode ? ` · ${formatDurationMs(entry.timingNode.durationMs)}` : "";
  const title =
    entry.command.exitCode === 0 ? "COMMAND"
    : entry.command.checked ? "FAILED COMMAND"
    : "NON-ZERO COMMAND · observed";
  return `${title} · ${entry.command.phase} · exit ${entry.command.exitCode}${duration}`;
}

/** turn 头行:`标签 · status · 该轮墙钟 · 该轮 usage`(usage 有记录才出现;docs/feature/reports/
 *  show/execution.md)。usage 读 TimingActivity.usage(该轮 `Turn.usage` 落盘原样),字段不存在时
 *  这一段照常省略。 */
function turnHeadLine(section: TurnSection): string {
  const label = normalizeTurnLabel(section.turn?.label ?? formatTurnLabel(1, section.turnNumber));
  const status = section.turn?.failed ? "failed" : "completed";
  const parts = [label, status];
  if (section.turn) parts.push(formatDurationMs(section.turn.durationMs));
  const usage = turnUsageText(section.turn);
  if (usage) parts.push(usage);
  return parts.join(" · ");
}

function turnUsageText(turn: TimingActivity | undefined): string | undefined {
  const usage = turn?.usage;
  if (!usage) return undefined;
  const parts: string[] = [];
  if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    const total = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheCreationTokens ?? 0);
    parts.push(`${formatMetricValue(total)} tok`);
  }
  if (usage.costUSD !== undefined) parts.push(formatUSD(usage.costUSD));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * 一张卡片的完整渲染:`full` 时逐段输出未截断的落盘内容(--expand);否则每段独立按 3 行 + 1 KiB
 * 预算截断(docs/feature/reports/show/execution.md「卡片预览预算与 --expand」),卡尾追加一条
 * 聚合尾巴。带 `label` 的段(TOOL 的 input/result、失败命令的 stdout/stderr)先输出骨架行,
 * 段正文本身再多缩进一层;没有 label 的段(单段卡的正文,命令行本身)正文与骨架行同一层。
 * 两种形态都只做逐行前缀(indentLines),不做 wrapDisplay 折行——保留原始换行是这个区块 text
 * 面的契约,不是遗漏。
 */
function renderCardLines(parts: CardParts, handle: string, locator: string, full: boolean): string[] {
  const bodyLines: string[] = [];
  const truncations: SegmentTruncation[] = [];
  for (const seg of parts.segments) {
    // events/commands 保留原始证据；text 面不能让被测 CLI 的 ANSI/C0 字节重新控制用户终端。
    // JSON 面不走这里，仍忠实返回落盘值。
    const safeText = stripControl(seg.text);
    let content: string;
    if (full) {
      content = safeText;
    } else {
      const t = truncateSegment(safeText);
      truncations.push(t);
      content = t.shown;
    }
    if (seg.label) {
      bodyLines.push(seg.label, ...indentLines(content, "  ").split("\n"));
    } else {
      bodyLines.push(...content.split("\n"));
    }
  }
  if (!full) {
    const tail = foldCardTail(truncations, locator, handle);
    if (tail) bodyLines.push(`${parts.tailIndent}${tail}`);
  }
  const body = indentLines(bodyLines.join("\n"), "  ");
  return parts.header ? [parts.header, ...body.split("\n")] : body.split("\n");
}

// ───────────────────────── --execution 三种输出形态 ─────────────────────────

function executionTail(
  evidence: ConversationResult,
  tree: ExecutionTree | null,
  timingAvailable: boolean,
  telemetryCount: number,
  eventsSource: string | undefined,
  artifactPath: string | undefined,
): string[] {
  const tail: string[] = [];
  if (timingAvailable) {
    const nodes = tree?.nodes ?? [];
    const skillLoads = nodes.filter((n) => n.kind === "skill.loaded").length;
    const toolCalls = nodes.filter((n) => n.kind === "action").length;
    const aiMessages = nodes.filter((n) => n.kind === "message" && n.role === "assistant").length;
    tail.push(
      [
        `total ${formatDurationMs(evidence.durationMs)}`,
        `${skillLoads} skill ${skillLoads === 1 ? "load" : "loads"}`,
        `${toolCalls} tool ${toolCalls === 1 ? "call" : "calls"}`,
        `${aiMessages} AI ${aiMessages === 1 ? "message" : "messages"}`,
      ].join(" · "),
    );
  } else {
    tail.push("timing unavailable · OTel trace was not collected");
  }
  if (eventsSource) tail.push(`full events: ${eventsSource}`);
  if (telemetryCount > 0) tail.push(`${telemetryCount} unlinked telemetry spans omitted; inspect the OTel trace for framework timing.`);
  if (timingAvailable && artifactPath) tail.push(`full OTel trace: ${join(artifactPath, "trace.json")}`);
  return tail;
}

type OrderedExecutionBlock =
  | { kind: "turn"; section: TurnSection; order: number }
  | { kind: "command"; entry: CommandCard; order: number };

const CLOSING_COMMAND_PHASES = new Set(["agent.teardown", "sandbox.cleanup", "sandbox.suspend", "sandbox.stop"]);

function commandPlacement(phase: string): number {
  return CLOSING_COMMAND_PHASES.has(phase) ? 2 : phase === "eval.run" ? 1 : 0;
}

/** execution 的生命周期命令独立成卡,按 setup/turn/teardown 的 timing 位置安插。 */
function orderedExecutionBlocks(
  turns: readonly TurnSection[],
  commandCards: readonly CommandCard[],
): OrderedExecutionBlock[] {
  const blocks: OrderedExecutionBlock[] = turns.map((section, index) => ({ kind: "turn", section, order: index }));
  for (const [index, entry] of commandCards.entries()) blocks.push({ kind: "command", entry, order: turns.length + index });
  return blocks.sort((a, b) => {
    const aPosition = a.kind === "command" ? commandPlacement(a.entry.command.phase) : 1;
    const bPosition = b.kind === "command" ? commandPlacement(b.entry.command.phase) : 1;
    if (aPosition !== bPosition) return aPosition - bPosition;
    const aOffset = a.kind === "command" ? a.entry.timingNode?.startOffsetMs : a.section.turn?.startOffsetMs;
    const bOffset = b.kind === "command" ? b.entry.timingNode?.startOffsetMs : b.section.turn?.startOffsetMs;
    return (aOffset ?? Number.POSITIVE_INFINITY) - (bOffset ?? Number.POSITIVE_INFINITY) || a.order - b.order;
  });
}

/** 全量渲染(无 --grep/--expand):轮次与独立命令证据按 lifecycle timing 合并,末尾追加事实小结。 */
function renderFull(
  evidence: ConversationResult,
  header: string,
  tree: ExecutionTree | null,
  timingAvailable: boolean,
  telemetryCount: number,
  eventsSource: string | undefined,
  artifactPath: string | undefined,
  turns: readonly TurnSection[],
  commandCards: readonly CommandCard[],
  originMs: number,
): string {
  const lines: string[] = [];
  for (const [i, block] of orderedExecutionBlocks(turns, commandCards).entries()) {
    if (i > 0) lines.push("");
    if (block.kind === "turn") {
      const section = block.section;
      lines.push(turnHeadLine(section));
      section.cards.forEach((card, j) => {
        if (j > 0) lines.push("");
        const parts = agentCardParts(card.node, originMs);
        lines.push(...renderCardLines(parts, card.handle, evidence.locator, false).map((l) => `  ${l}`));
      });
    } else {
      const entry = block.entry;
      const parts = commandCardParts(entry.command);
      lines.push(...renderCardLines({ ...parts, header: commandCardHeader(entry) }, entry.handle, evidence.locator, false).map((l) => `  ${l}`));
    }
  }
  const tail = executionTail(evidence, tree, timingAvailable, telemetryCount, eventsSource, artifactPath);
  return `${header}\n\n${lines.join("\n")}\n\n${tail.join("\n")}`;
}

/**
 * `--grep`:只输出命中的卡片,每卡自带定位行(locator · evalId · experimentId · 所在轮/阶段,
 * 不是 verdict——grep 结果关心「这条证据在哪一轮」,不是判定)。命中卡照常受预览预算约束。
 * 0 命中与「N matches in M attempts」的最终措辞归调用方,这里只回填 matches 数。
 */
function renderGrep(
  evidence: ConversationResult,
  turns: readonly TurnSection[],
  commandCards: readonly CommandCard[],
  grep: RegExp,
  originMs: number,
): { text: string; matches: number } {
  const blocks: string[] = [];
  let matches = 0;
  for (const section of turns) {
    for (const card of section.cards) {
      const parts = agentCardParts(card.node, originMs);
      if (!testGrep(grep, parts.matchText)) continue;
      matches += 1;
      const locatorLine = [evidence.locator, evidence.identity.evalId, evidence.experimentId, normalizeTurnLabel(section.turn?.label ?? formatTurnLabel(1, section.turnNumber))].join(
        " · ",
      );
      const cardLines = renderCardLines(parts, card.handle, evidence.locator, false);
      blocks.push([locatorLine, ...cardLines.map((l) => `  ${l}`)].join("\n"));
    }
  }
  for (const entry of commandCards) {
    const parts = commandCardParts(entry.command);
    if (!testGrep(grep, parts.matchText)) continue;
    matches += 1;
    const locatorLine = [evidence.locator, evidence.identity.evalId, evidence.experimentId, entry.command.phase].join(" · ");
    const cardLines = renderCardLines({ ...parts, header: commandCardHeader(entry) }, entry.handle, evidence.locator, false);
    blocks.push([locatorLine, ...cardLines.map((l) => `  ${l}`)].join("\n"));
  }
  return { text: blocks.join("\n\n"), matches };
}

/**
 * `--expand <handle>`:句柄未命中(轮/卡序号或命令序号超界,或语法不认识)按用法错误抛出,报该
 * attempt 实际的 turn 数与该 turn 的卡片数(或命令数)——不猜相邻卡片
 * (docs/feature/reports/show/execution.md「卡片预览预算与 --expand」)。
 */
function renderExpand(
  evidence: ConversationResult,
  header: string,
  turns: readonly TurnSection[],
  commandCards: readonly CommandCard[],
  handle: string,
  originMs: number,
): string {
  const agentMatch = /^t(\d+)\.c(\d+)$/.exec(handle);
  const cmdMatch = /^cmd(\d+)$/.exec(handle);
  if (agentMatch) {
    const turnNumber = Number(agentMatch[1]);
    const cardNumber = Number(agentMatch[2]);
    const section = turns.find((s) => s.turnNumber === turnNumber);
    if (!section) {
      throw new Error(`handle "${handle}" not found: this attempt has ${turns.length} turn${turns.length === 1 ? "" : "s"}.`);
    }
    const card = section.cards.find((c) => c.cardNumber === cardNumber);
    if (!card) {
      throw new Error(`handle "${handle}" not found: turn ${turnNumber} has ${section.cards.length} card${section.cards.length === 1 ? "" : "s"}.`);
    }
    const parts = agentCardParts(card.node, originMs);
    const lines = renderCardLines(parts, handle, evidence.locator, true);
    return `${header}\n\n${lines.join("\n")}`;
  }
  if (cmdMatch) {
    const n = Number(cmdMatch[1]);
    const entry = commandCards[n - 1];
    if (!entry) {
      throw new Error(
        `handle "${handle}" not found: this attempt has ${commandCards.length} command exit${commandCards.length === 1 ? "" : "s"}.`,
      );
    }
    const parts = commandCardParts(entry.command);
    const lines = renderCardLines({ ...parts, header: commandCardHeader(entry) }, handle, evidence.locator, true);
    return `${header}\n\n${lines.join("\n")}`;
  }
  throw new Error(`invalid handle "${handle}": expected "t<turn>.c<card>" or "cmd<n>".`);
}

/** `--execution` 的渲染选项(docs/feature/reports/show/execution.md):两者互斥,`expand` 优先——
 *  校验层面的「--expand 与 --grep 不能组合」不是这里的职责,这里按存在性直接分支。 */
export interface ExecutionRenderOptions {
  /** JS 正则;有值时只输出命中的卡片,每卡带定位行。 */
  grep?: RegExp;
  /** 展开句柄(`t<N>.c<M>` 或 `cmd<N>`);有值时只输出该卡片完整落盘内容(不截断),未命中抛
   *  带 turn/卡计数(或命令计数)的 Error。 */
  expand?: string;
}

/**
 * `--execution`:标准事件流骨架(message / thinking / context.injected / skill load /
 * tool call+result / subagent / input.requested / compaction / error)按轮分段渲染成卡片,
 * 有 OTel 时同一节点补相对时间与耗时;没有 OTel 时节点、顺序与内容不变,只去掉时间列,并在结尾
 * 如实标 timing unavailable(ExecutionTree 的契约:骨架不因时间有无而变形,见
 * o11y/execution-tree.ts 头注)。除 Agent 事件外,attempt 按 lifecycle timing 放置独立的
 * Sandbox 命令退出卡(`cmd<N>`,来自 `commands.json`,经 `evidence.commands` 读取;没有命令
 * 退出时这一段自然零输出,见 `commandExitsOf`)。
 *
 * 卡片正文按段(单段卡的正文、TOOL 卡的 input/result、命令证据卡的命令行/stdout/stderr)分别是
 * 3 行(保留原始换行)的有界预览,单段另有 1 KiB 字节兜底(按字符边界回退);截断尾巴带被折
 * 行数与字符数、以及展开句柄(全卡没有整行被折、只是字节兜底切了字符时,行数退化为省略)。
 * `options.expand` 精确定位一张卡片输出完整落盘内容;`options.grep` 只输出匹配面(角色文本/
 * 工具名/input/result,命令卡另加 display/stdout/stderr)命中的卡片,返回值的 `matches` 是本
 * attempt 内的命中卡片数——「N matches in M attempts」与 0 命中的措辞归调用方组装。
 */
export function executionText(
  input: ConversationResult | AttemptEvidence,
  opts: { header: string; artifactPath?: string; width: number },
  options?: ExecutionRenderOptions,
): { text: string; matches?: number } {
  const evidence: ConversationResult = "conversation" in input ? input : {
    locator: input.locator,
    experimentId: input.experimentId,
    identity: input.identity,
    conversation: null,
    execution: input.execution,
    commands: input.commands ?? [],
    phases: input.result.phases ?? [],
    durationMs: input.result.durationMs,
  };
  const { header, artifactPath } = opts;
  const tree = evidence.execution;
  const eventsSource = artifactPath ? join(artifactPath, "events.json") : undefined;

  const timingAvailable = tree?.timingAvailable ?? false;
  const spanStarts = tree ? tree.nodes.flatMap((n) => (n.span ? [n.span.startMs] : [])) : [];
  const originMs = spanStarts.length > 0 ? Math.min(...spanStarts) : 0;

  // `--execution` 回答 Agent 做了什么。未关联到标准事件的原始 spans 属于 trace 证据，
  // 逐条混入 transcript 会把几十条 SDK 内部 span 盖过消息和工具调用。
  const agentNodes = tree ? tree.nodes.filter((node) => node.kind !== "telemetry") : [];
  const telemetryCount = tree ? tree.nodes.length - agentNodes.length : 0;

  // 按轮分段(见 docs/feature/reports/show.md「--execution」):边界按用户消息切
  // (t.send 恒以用户消息开轮),turn 身份取自 result.json.phases 的 turn 时间树。
  const turnNodes = evidence.phases
    .flatMap((p) => p.children ?? [])
    .filter((n) => n.key === "agent.turn");

  const turns = groupIntoTurnCards(agentNodes, turnNodes);
  const commandCards = buildCommandCards(evidence);

  if (options?.expand !== undefined) {
    return { text: renderExpand(evidence, header, turns, commandCards, options.expand, originMs) };
  }

  if (agentNodes.length === 0 && commandCards.length === 0) {
    if (options?.grep) return { text: "", matches: 0 };
    return { text: `${header}\n\n(no events recorded for this attempt${eventsSource ? ` · expected: ${eventsSource}` : ""})` };
  }

  if (options?.grep) {
    return renderGrep(evidence, turns, commandCards, options.grep, originMs);
  }

  return { text: renderFull(evidence, header, tree, timingAvailable, telemetryCount, eventsSource, artifactPath, turns, commandCards, originMs) };
}

/** net 效果的单字母标记(A/M/D;none = 动过但净无变化,标 ±)。 */
// ───────────────────────── 证据切面:diff ─────────────────────────

/**
 * `--diff` 摘要与 `--diff=<path>` 的逐窗口 patch 都读 attemptDiffData 这一份投影
 * (docs/feature/reports/show/diff.md),渲染函数与 DiffView 的 text 面同一个,不另算一遍。
 */
export function diffText(opts: {
  header: string;
  data: AttemptDiffData | null;
  artifactPath?: string;
  /** --diff=<路径>:看单个文件的完整内容。 */
  file?: string;
}): string {
  const { header, data, artifactPath, file } = opts;
  const source = artifactPath ? join(artifactPath, "diff.json") : undefined;
  if (data === null) {
    return `${header}\n\ndiff unavailable (no diff recorded for this attempt: Direct Agent, or diff artifact not published${source ? `; expected: ${source}` : ""})`;
  }
  const files = data.files;

  if (file !== undefined) {
    const entry = files.find((f) => f.path === file);
    if (entry === undefined) {
      const known = files.map((f) => f.path);
      return `${header}\n\nFile "${file}" is not in this attempt's agent diff. Files: ${known.join(", ") || "(none)"}`;
    }
    return `${header}\n\n${diffFilePatchText(entry)}${source ? `\n\n(full diff: ${source})` : ""}`;
  }

  if (files.length === 0) {
    return `${header}\n\n(no file changes by the agent in any send window${source ? ` · full diff: ${source}` : ""})`;
  }
  return `${header}\n\n${diffSummaryText(files, { singleFileHint: true })}`;
}

// ───────────────────────── 证据切面:--timing(统一时间树) ─────────────────────────

const CLOSING_PHASE_NAMES = new Set(["agent.teardown", "sandbox.cleanup", "sandbox.suspend", "sandbox.stop"]);

const TIMING_DETAIL_NODE_BUDGET = 80;

interface DiagnosticTimingActivity {
  id: string;
  label: string;
  startOffsetMs: number;
  durationMs: number;
  failed: boolean;
  otel: boolean;
  /** 命令节点的时限归属(采集端写下的事实,renderer 只投影)。 */
  limit?: CommandLimitAttribution;
  children: DiagnosticTimingActivity[];
}

/** 时限来源层的人读词(词表单源在 docs/feature/sandbox/architecture.md「时限归属」)。 */
const TIMING_LIMIT_SOURCE_LABEL: Readonly<globalThis.Record<CommandLimitAttribution["source"], string>> = {
  "attempt-deadline": "attempt deadline",
  "command-timeout": "per-command timeout",
  "provider-limit": "provider limit",
};

/** `deadline 1m 0s · per-command timeout`:生效的值 + 它来自哪一层,两样一起给。 */
function timingLimitNote(limit: CommandLimitAttribution): string {
  return `deadline ${formatDurationMs(limit.limitMs)} · ${TIMING_LIMIT_SOURCE_LABEL[limit.source]}`;
}

function timingNodeLabel(node: TimingActivity): string {
  // 结构化字段归 key 所有:sandbox.command / agent.turn 用自己的摘要形态。
  // 其它 key(含未知)一律渲染 producer 的 label——不查 LifecyclePhase 锚点表,也不对 key 穷尽 switch。
  if (node.key === "sandbox.command" && node.command) return `shell · ${node.command.display}`;
  if (node.key === "agent.turn") return `turn ${normalizeTurnLabel(node.label)}`;
  return node.label;
}

function traceReferenceCounts(nodes: readonly TimingActivity[], counts = new Map<string, number>()): Map<string, number> {
  for (const node of nodes) {
    if (node.key === "agent.turn" && node.traceId) counts.set(node.traceId, (counts.get(node.traceId) ?? 0) + 1);
    traceReferenceCounts(node.children ?? [], counts);
  }
  return counts;
}

/** OTel 只按唯一 traceId 归属和 span parent 关系挂接；不按绝对墙钟猜跨进程顺序。 */
function otelForest(traceId: string, spans: readonly TraceSpan[], turnStartOffsetMs: number): DiagnosticTimingActivity[] {
  const unique = new Map<string, TraceSpan>();
  for (const span of spans) if (span.traceId === traceId && !unique.has(span.spanId)) unique.set(span.spanId, span);
  const selected = [...unique.values()];
  if (selected.length === 0) return [];
  const traceOrigin = Math.min(...selected.map((span) => span.startMs));
  const nodes = new Map<string, DiagnosticTimingActivity>();
  for (const span of selected) {
    nodes.set(span.spanId, {
      id: `otel:${span.traceId}:${span.spanId}`,
      label: `${span.kind ?? "span"} · ${span.name}`,
      startOffsetMs: turnStartOffsetMs + Math.max(0, span.startMs - traceOrigin),
      durationMs: Math.max(0, span.endMs - span.startMs),
      failed: span.status === "error",
      otel: true,
      children: [],
    });
  }
  const roots: DiagnosticTimingActivity[] = [];
  for (const span of selected) {
    const node = nodes.get(span.spanId)!;
    const parent = span.parentSpanId && span.parentSpanId !== span.spanId ? nodes.get(span.parentSpanId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: DiagnosticTimingActivity[]) => {
    items.sort((a, b) => a.startOffsetMs - b.startOffsetMs || a.id.localeCompare(b.id));
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

function diagnosticTimingActivity(
  node: TimingActivity,
  spans: readonly TraceSpan[],
  uniqueTraceIds: ReadonlySet<string>,
): DiagnosticTimingActivity {
  const children = (node.children ?? []).map((child) => diagnosticTimingActivity(child, spans, uniqueTraceIds));
  if (node.key === "agent.turn" && node.traceId && uniqueTraceIds.has(node.traceId)) {
    children.push(...otelForest(node.traceId, spans, node.startOffsetMs));
  }
  return {
    id: `runner:${node.id}`,
    label: timingNodeLabel(node),
    startOffsetMs: node.startOffsetMs,
    durationMs: node.durationMs,
    failed: node.failed === true,
    otel: false,
    ...(node.command?.limit !== undefined ? { limit: node.command.limit } : {}),
    children,
  };
}

interface FlatTimingActivity {
  node: DiagnosticTimingActivity;
  path: readonly DiagnosticTimingActivity[];
}

function flattenTimingForest(roots: readonly DiagnosticTimingActivity[]): FlatTimingActivity[] {
  const flat: FlatTimingActivity[] = [];
  const visit = (node: DiagnosticTimingActivity, ancestors: readonly DiagnosticTimingActivity[]) => {
    const path = [...ancestors, node];
    flat.push({ node, path });
    for (const child of node.children) visit(child, path);
  };
  for (const root of roots) visit(root, []);
  return flat;
}

/**
 * 默认 80-node 投影。四个稳定池先各用自己的配额，再把空余额按失败→最慢→首尾重分配。
 * 选中深层节点必须连同祖先整条加入；四池合并后按 id 去重。
 */
function selectTimingActivitys(roots: readonly DiagnosticTimingActivity[]): ReadonlySet<string> {
  const flat = flattenTimingForest(roots);
  if (flat.length <= TIMING_DETAIL_NODE_BUDGET) return new Set(flat.map(({ node }) => node.id));

  const selected = new Set<string>();
  const byStart = [...flat].sort(
    (a, b) => a.node.startOffsetMs - b.node.startOffsetMs || a.node.id.localeCompare(b.node.id),
  );
  const failed = byStart.filter(({ node }) => node.failed);
  const slow = [...flat].sort(
    (a, b) => b.node.durationMs - a.node.durationMs || a.node.startOffsetMs - b.node.startOffsetMs || a.node.id.localeCompare(b.node.id),
  );
  const latest = [...flat].sort(
    (a, b) => b.node.startOffsetMs - a.node.startOffsetMs || a.node.id.localeCompare(b.node.id),
  );

  const add = (candidate: FlatTimingActivity, allowance: number): number => {
    const missing = candidate.path.filter((node) => !selected.has(node.id));
    if (missing.length === 0 || missing.length > allowance || selected.size + missing.length > TIMING_DETAIL_NODE_BUDGET) {
      return 0;
    }
    for (const node of missing) selected.add(node.id);
    return missing.length;
  };
  const pool = (candidates: readonly FlatTimingActivity[], cap: number) => {
    let remaining = cap;
    for (const candidate of candidates) {
      if (remaining === 0) break;
      remaining -= add(candidate, remaining);
    }
  };

  pool(failed, 40);
  pool(slow, 20);
  pool(byStart, 10);
  pool(latest, 10);

  // 固定池未用满时，剩余额度按契约优先级继续分配；候选稳定、无法容纳的整条路径跳过。
  for (const candidate of [...failed, ...slow, ...byStart, ...latest]) {
    const remaining = TIMING_DETAIL_NODE_BUDGET - selected.size;
    if (remaining === 0) break;
    add(candidate, remaining);
  }
  return selected;
}

function subtreeStats(node: DiagnosticTimingActivity): { nodes: number; failed: number } {
  let nodes = 1;
  let failed = node.failed ? 1 : 0;
  for (const child of node.children) {
    const stats = subtreeStats(child);
    nodes += stats.nodes;
    failed += stats.failed;
  }
  return { nodes, failed };
}

type VisibleTimingEntry =
  | { kind: "node"; node: DiagnosticTimingActivity }
  | { kind: "omitted"; nodes: number; failed: number };

function visibleTimingEntries(
  nodes: readonly DiagnosticTimingActivity[],
  selected: ReadonlySet<string> | undefined,
): VisibleTimingEntry[] {
  if (!selected) return nodes.map((node) => ({ kind: "node", node }));
  const entries: VisibleTimingEntry[] = [];
  for (let i = 0; i < nodes.length;) {
    const node = nodes[i]!;
    if (selected.has(node.id)) {
      entries.push({ kind: "node", node });
      i += 1;
      continue;
    }
    let omittedNodes = 0;
    let omittedFailed = 0;
    while (i < nodes.length && !selected.has(nodes[i]!.id)) {
      const stats = subtreeStats(nodes[i]!);
      omittedNodes += stats.nodes;
      omittedFailed += stats.failed;
      i += 1;
    }
    entries.push({ kind: "omitted", nodes: omittedNodes, failed: omittedFailed });
  }
  return entries;
}

/**
 * 一棵子树的行。时限归属两档:撞线失败的节点**在哪一档都**原位标注(读者不该靠「停在整
 * 1m 0s」这种巧合反推是谁掐断了命令);`full` 档对全部带线的命令节点给出该字段。
 */
function diagnosticTimingLines(
  nodes: readonly DiagnosticTimingActivity[],
  prefix: string,
  selected: ReadonlySet<string> | undefined,
  locator: string,
  full: boolean,
): string[] {
  const entries = visibleTimingEntries(nodes, selected);
  const lines: string[] = [];
  entries.forEach((entry, index) => {
    const last = index === entries.length - 1;
    const branch = `${prefix}${last ? "└─ " : "├─ "}`;
    const childPrefix = `${prefix}${last ? "   " : "│  "}`;
    if (entry.kind === "omitted") {
      const failed = entry.failed > 0 ? ` · ${entry.failed} failed` : "";
      lines.push(`${branch}… ${entry.nodes} nodes omitted${failed} · full: niceeval show ${locator} --timing=full`);
      return;
    }
    const node = entry.node;
    const limitNote = node.limit?.timedOut
      ? ` ${timingLimitNote(node.limit)}`
      : full && node.limit
        ? `  ${timingLimitNote(node.limit)}`
        : "";
    lines.push(
      `${branch}${node.label}   ${formatDurationMs(node.durationMs)}${node.failed ? " ✗" : ""}${limitNote}${node.otel ? "  OTel" : ""}`,
    );
    lines.push(...diagnosticTimingLines(node.children, childPrefix, selected, locator, full));
  });
  return lines;
}

/**
 * `--timing`:整个 attempt 的统一时间树(见 docs/feature/reports/show.md)。先按
 * `result.json.phases` 输出 runner 生命周期,再展开 hook / 命令 / turn;turn 带 traceId 时
 * 从 trace.json 挂接 agent/model/tool spans。缩进表达包含关系,子项不能求和后与父项比较。
 */
export function timingText(
  input: AttemptTimingResult | AttemptEvidence,
  opts: { header: string; artifactPath?: string; width: number; mode?: "summary" | "full" },
): string {
  const result: AttemptTimingResult = "kind" in input ? input : {
    kind: "attempt",
    locator: input.locator,
    durationMs: input.result.durationMs,
    ...(input.result.error !== undefined ? { error: input.result.error } : {}),
    phases: input.result.phases ?? [],
    trace: input.trace,
  };
  if (result.phases.length === 0) {
    return `${opts.header}\n\nphase timing unavailable (this result was not produced by a runner with phase timing)`;
  }
  const spans = result.trace;
  // 超时 attempt 的 workspace.diff 条目是收尾段补折叠的(docs/runner.md「超时:双层保护」超时
  // 不丢证据),不计入 durationMs——与正常完成路径里 workspace.diff 属于主链、计入 durationMs
  // 是两回事,但两者共用同一个 phase 名字(同一件事:折叠 workspace diff,只是时点不同)。
  // `error.code === "timeout"` 是唯二真正把它归为收尾段的场景(非超时 attempt 的 error.code
  // 永远不是 "timeout"),用它做判别,不新增 LifecyclePhase 成员。
  const isTimeoutClosingDiff = (p: NonNullable<EvalResult["phases"]>[number]) =>
    p.name === "workspace.diff" && result.error?.code === "timeout";
  const main = result.phases.filter((p) => !CLOSING_PHASE_NAMES.has(p.name) && !isTimeoutClosingDiff(p));
  const closing = result.phases.filter((p) => CLOSING_PHASE_NAMES.has(p.name) || isTimeoutClosingDiff(p));
  const traceCounts = new Map<string, number>();
  for (const phase of result.phases) traceReferenceCounts(phase.children ?? [], traceCounts);
  const uniqueTraceIds = new Set([...traceCounts].filter(([, count]) => count === 1).map(([traceId]) => traceId));
  const phaseForests = new Map(
    result.phases.map((phase) => [
      phase,
      (phase.children ?? []).map((node) => diagnosticTimingActivity(node, spans ?? [], uniqueTraceIds)),
    ]),
  );
  const allRoots = [...phaseForests.values()].flat();
  const selected = opts.mode === "full" ? undefined : selectTimingActivitys(allRoots);

  const lines: string[] = [`total ${formatDurationMs(result.durationMs)}`, ""];
  // 超时归属:撞的是哪层时限、上限多少、值从哪一层来。三样一起印在时间树顶上——
  // 「跑了 20 分钟然后 ✗」本身说不出是谁把它掐的(见 docs/feature/sandbox/architecture.md
  // 「时限归属」)。
  if (result.error?.timeout) {
    const { trigger, limitMs, source } = result.error.timeout;
    lines.push(`timeout  ${trigger} · limit ${formatDurationMs(limitMs)} · from ${source}`, "");
  }
  const renderPhase = (p: NonNullable<EvalResult["phases"]>[number]) => {
    const failedNote = p.failed ? ` ✗ failed here${result.error ? ` (${result.error.code})` : ""}` : "";
    lines.push(`${p.name.padEnd(22)}${formatDurationMs(p.durationMs)}${failedNote}`);
    lines.push(...diagnosticTimingLines(phaseForests.get(p) ?? [], "  ", selected, result.locator, opts.mode === "full"));
  };
  for (const p of main) renderPhase(p);
  if (closing.length > 0) {
    lines.push("", "teardown (not counted in total):");
    for (const p of closing) renderPhase(p);
  }
  return `${opts.header}\n\n${lines.join("\n")}`;
}

/**
 * `--timing` 不带 attempt locator 时的 Run 级 activity 树(docs/feature/reports/show/timing.md
 * 「Run 级 activity 的读取」)。与 attempt 树共用预算 / 失败 / 时序投影;`sandboxBuilds`
 * 专用卡从 provenance 读 locator/inputs/依赖 attempt,不解析 timing label。
 */
export function runTimingText(
  input: RunTimingResult | Run,
  opts: {
    header: string;
    width: number;
    mode?: "summary" | "full";
  },
): string {
  const result: RunTimingResult = "kind" in input ? input : {
    kind: "run",
    experimentId: input.experimentId,
    runId: input.runId,
    startedAt: input.startedAt,
    timings: input.timings ?? [],
    sandboxBuilds: (input.sandboxBuilds ?? []).map((build) => {
      const timing = findTimingActivityById(input.timings, build.timingNodeId);
      const dependents = input.attempts
        .filter((attempt) => attempt.result.error?.origin?.scope === "run" && attempt.result.error.origin.timingNodeId === build.timingNodeId)
        .map((attempt) => attempt.locator ?? `${attempt.evalId}#${attempt.result.attempt}`);
      return {
        ...build,
        ...(timing !== undefined ? { durationMs: timing.durationMs } : {}),
        ...(dependents.length > 0 ? { dependents } : {}),
      };
    }),
  };
  const timings = result.timings;
  const builds = result.sandboxBuilds;
  if (timings.length === 0 && builds.length === 0) {
    return `${opts.header}\n\nrun timing unavailable (this run has no shared activity)`;
  }

  const roots = timings.map((node) => diagnosticTimingActivity(node, [], new Set()));
  const selected = opts.mode === "full" ? undefined : selectTimingActivitys(roots);
  const totalMs = timings.reduce((sum, node) => Math.max(sum, node.startOffsetMs + node.durationMs), 0);
  const lines: string[] = [`total ${formatDurationMs(totalMs)}`, ""];
  lines.push(...diagnosticTimingLines(roots, "", selected, result.runId, opts.mode === "full"));

  if (builds.length > 0) {
    lines.push("", "sandboxBuilds:");
    for (const build of builds) {
      lines.push(...sandboxBuildCardLines(build));
    }
  }
  return `${opts.header}\n\n${lines.join("\n")}`;
}

/** sandboxBuild 专用卡:字段全部来自 provenance + 经 timingNodeId 关联的耗时,不解析 label。 */
function sandboxBuildCardLines(
  build: RunTimingBuildResult,
): string[] {
  const duration = build.durationMs !== undefined ? formatDurationMs(build.durationMs) : "—";
  const dependents = build.dependents ?? [];
  const lines = [
    `  ${build.status} · ${build.provider} · ${build.buildKey.slice(0, 16)}…  ${duration}${build.status === "failed" ? " ✗" : ""}`,
  ];
  if (build.locator !== undefined) {
    lines.push(`    locator: ${JSON.stringify(build.locator)}`);
  }
  lines.push(`    inputs: ${JSON.stringify(build.inputs)}`);
  if (build.error) {
    lines.push(`    error: ${build.error.code} · ${firstLine(build.error.message)}`);
  }
  if (dependents.length > 0) {
    lines.push(`    dependents: ${dependents.join(", ")}`);
  }
  return lines;
}
