// show 的文本渲染:单 eval 详情、--history 时间轴、三个证据切面(transcript / trace / diff)。
// 输出形态照 docs-site/zh/tutorials/viewing-results.mdx 的示例块;长内容一律截断,
// 但截断永远如实标注剩余数量和原始 artifact 路径 —— 输出对上下文窗口友好,事实源留在盘上。
// 全部纯函数(时间经 now 显式传入),证据数据由调用方 await 好了递进来。

import { join, relative } from "node:path";
import type { AssertionResult, DiffData, EvalResult, LocalizedText, TimingNode, TraceSpan, Verdict } from "../types.ts";
import type { AttemptEvidence, AttemptHandle, Snapshot } from "../results/index.ts";
import type { AnnotatedSourceLine, SendAnnotation } from "../results/index.ts";
import { groupIncompatibleVersionSkips } from "../results/index.ts";
import type { SkippedDir } from "../results/index.ts";
import type { ExecutionNode } from "../o11y/execution-tree.ts";
import { foldEvalVerdict } from "../shared/verdict.ts";
import { summaryText } from "../scoring/display.ts";
import { attemptCostUSD } from "../report/metrics.ts";
import { formatDurationMs, formatMetricValue, formatPlainNumber, formatUSD } from "../report/format.ts";
import { indentBlock, padDisplay, renderAlignedRows, wrapDisplay } from "../report/text/layout.ts";
import type { AttemptHistoryRow } from "./compose.ts";
import { localizeText, showCommand, type HostCommandContext } from "./report-host.ts";

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

/** attempt 的展示序号:落盘 attempt 从 0 计,人看 1 计( artifact 目录后缀 __2 = attempt 3)。 */
export function displayAttemptNumber(attempt: AttemptHandle): number {
  return attempt.result.attempt + 1;
}

/**
 * attempt artifact 目录的展示路径:尽量给相对 cwd 的短路径,出了 cwd 给绝对路径。
 * 本快照跑出的条目:artifact 与 result.json 同目录,= `<snapshot.dir>/<ref.attempt>`。
 * 携带条目(--resume 合入):落盘的 artifactBase 相对结果根(= snapshot.dir 的上两级,
 * 即 `<experiment-dir>/<snapshot-dir>` 的上一层),指向原快照的 attempt 目录。
 */
export function attemptArtifactsPath(attempt: AttemptHandle, cwd: string): string {
  const r = attempt.result;
  const abs = r.artifactBase
    ? join(attempt.snapshot.dir, "..", "..", r.artifactBase)
    : join(attempt.snapshot.dir, attempt.ref.attempt);
  const rel = relative(cwd, abs);
  return rel.startsWith("..") ? abs : rel;
}

/**
 * 裸 `show` 零可读结果时,skipped 目录的展示文案。niceeval 自己写的、schemaVersion 不兼容的
 * 落盘按 producer 版本分组,一条 `npx niceeval@<version> show --results <结果根>` 覆盖同版本全部
 * 快照——show 没有 view 的单快照直读模式,`--results` 认的是结果根(其下可以有多个 experiment),
 * 不是单个快照目录,所以不对每个目录重复拼一条各自的命令(那条命令用同一个 root 跑起来
 * 结果完全一样,重复只会刷屏)。其余(第三方 harness、版本信息缺失、malformed、incomplete)
 * 没有可执行的统一建议,原样逐条列出。
 */
export function skippedRunsText(skipped: readonly SkippedDir[], root: string, cwd: string): string {
  const { groups, rest } = groupIncompatibleVersionSkips(skipped);
  const rootDisplay = relative(cwd, root) || ".";
  const lines: string[] = [];
  for (const g of groups) {
    const count = g.dirs.length;
    const version = g.producer.version;
    const schema = g.schemaVersion !== undefined ? ` (schemaVersion ${g.schemaVersion})` : "";
    const cmd = `npx niceeval@${version} show --results ${rootDisplay}`;
    lines.push(
      `  ${count} snapshot${count === 1 ? "" : "s"} written by niceeval ${version}${schema} — run \`${cmd}\` to view`,
    );
  }
  for (const s of rest) {
    lines.push(`  skipped ${s.dir} (${s.reason})`);
  }
  return lines.join("\n");
}

// ───────────────────────── attempt 挑选 ─────────────────────────

/** Selection 内某道题的全部 attempt(合成 Selection 里每实验只剩最新判定)。 */
export function attemptsOfEval(snapshots: Snapshot[], evalId: string): AttemptHandle[] {
  const out: AttemptHandle[] = [];
  for (const snapshot of snapshots) {
    const ev = snapshot.evals.find((e) => e.id === evalId);
    if (ev) out.push(...ev.attempts);
  }
  return out;
}

/**
 * 详情块 / eval-id 前缀证据切面默认挑最新一次失败的 attempt;没有失败挑最新一次。
 * 精确选某一次 attempt 走 `@<locator>`(`resolveLocator`),不再有数字 `--attempt`——
 * --exp 已在 Selection 合成时收窄。
 */
export function pickDetailAttempt(attempts: AttemptHandle[]): AttemptHandle | undefined {
  if (attempts.length === 0) return undefined;
  const byTime = [...attempts].sort((a, b) =>
    (a.result.startedAt ?? "").localeCompare(b.result.startedAt ?? "") || a.result.attempt - b.result.attempt,
  );
  const failing = byTime.filter((a) => a.result.verdict === "failed" || a.result.verdict === "errored");
  return failing.at(-1) ?? byTime.at(-1);
}

// ───────────────────────── 单 eval 详情 ─────────────────────────

function scoreText(score: number): string {
  return formatPlainNumber(Math.round(score * 100) / 100);
}

/** 分组路径标题(嵌套用 " > " 拼接);无分组返回 undefined。 */
function groupTitle(a: AssertionResult): string | undefined {
  return a.groupPath && a.groupPath.length > 0 ? a.groupPath.join(" > ") : undefined;
}

/** 断言行:✓/✗/◌ + severity + 标题;unavailable 带 reason,soft 恒带 score/1(失败再补 detail)。 */
export function assertionLine(a: AssertionResult): string {
  const group = groupTitle(a);
  const scope = group ? `${group} · ` : "";
  const optional = a.optional ? "optional · " : "";
  if (a.outcome === "unavailable") {
    return `◌ ${a.severity} · ${optional}${scope}${a.name} — unavailable: ${a.reason}`;
  }
  const head = `${a.outcome === "passed" ? "✓" : "✗"} ${a.severity} ${optional}${scope}${a.name}`;
  if (a.severity === "soft") {
    const detail = a.outcome === "failed" && a.detail ? `: ${a.detail}` : "";
    const threshold = a.threshold !== undefined ? ` / ${scoreText(a.threshold)}` : "/1";
    return `${head} — ${scoreText(a.score)}${threshold}${detail}`;
  }
  if (a.outcome === "failed") {
    const reason = a.detail ?? `score ${scoreText(a.score)}`;
    const received = a.received ?? a.evidence;
    // 单行面只放摘要收口后的预览;多行值(如 output tail)的完整版在 attempt 首页展开。
    return received !== undefined ? `${head} — ${reason} · received: ${summaryText(received)}` : `${head} — ${reason}`;
  }
  return head;
}

/** 字段行:首行 `<label>: <值首行>`,值的其余行(如 CommandResult 的 output tail)缩进原样展开。 */
function fieldLines(label: string, value: string): string[] {
  const [first, ...rest] = value.split("\n");
  return [`    ${label}: ${first ?? ""}`, ...rest.map((line) => `      ${line}`)];
}

/** 每条的通用行组(见 docs/feature/scoring/library/display.md「通用渲染规则」):
 *  首行 `severity · <标题>`(有分组时标题是分组路径,随后 assertion: 行给检查方式),
 *  之后按有则显示的顺序列 expected / received / score / reason / source。 */
function assertionRecordLines(a: AssertionResult): string[] {
  const group = groupTitle(a);
  const optional = a.optional ? "optional · " : "";
  const title = group ?? a.name;
  const lines: string[] = [];
  const scoreSuffix =
    a.outcome !== "unavailable" && (a.severity === "soft" || a.threshold !== undefined)
      ? `   ${scoreText(a.score)}${a.threshold !== undefined ? ` / ${scoreText(a.threshold)}` : ""}`
      : "";
  lines.push(`  ${a.severity} · ${optional}${title}${scoreSuffix}`);
  const detailLine = a.detail ?? (group ? a.name : undefined);
  if (detailLine !== undefined && detailLine !== title) lines.push(`    assertion: ${detailLine}`);
  if (a.outcome === "unavailable") {
    lines.push(`    reason: ${a.reason}`);
  } else {
    if (a.expected !== undefined) lines.push(...fieldLines("expected", a.expected));
    if (a.received !== undefined) lines.push(...fieldLines("received", a.received));
    if (a.evidence !== undefined && a.evidence !== a.received) lines.push(...fieldLines("evidence", a.evidence));
  }
  if (a.loc) lines.push(`    source: ${a.loc.file}:${a.loc.line}${a.loc.column ? `:${a.loc.column}` : ""}`);
  return lines;
}

/**
 * 默认 Attempt 页的首要诊断:按结果分节,只逐条列出需要看的(见 display.md)——
 * `failures:`(gate 失败,含 --strict 下改判的 soft)、`soft below threshold:`、
 * `scores:`(无阈值 judge 的纯打分)、`unavailable:`(证据评不了的,带 reason)。
 * 全部通过时这些节整体省略(返回 undefined),只留计数行。
 */
export function failureDiagnostics(assertions: AssertionResult[], width: number, strict?: boolean): string | undefined {
  const failures = assertions.filter(
    (a) => a.outcome === "failed" && (a.severity === "gate" || strict),
  );
  const softBelow = assertions.filter(
    (a) => a.outcome === "failed" && a.severity === "soft" && !strict,
  );
  const scores = assertions.filter(
    (a) => a.outcome === "passed" && a.severity === "soft" && a.threshold === undefined && a.score < 1,
  );
  const unavailableOnes = assertions.filter((a) => a.outcome === "unavailable");
  const lines: string[] = [];
  const section = (title: string, items: AssertionResult[]) => {
    if (items.length === 0) return;
    if (lines.length > 0) lines.push("");
    lines.push(title);
    for (const a of items) lines.push(...assertionRecordLines(a));
  };
  section("failures:", failures);
  section("soft below threshold:", softBelow);
  section("scores:", scores);
  section("unavailable:", unavailableOnes);
  if (lines.length === 0) return undefined;
  return lines.flatMap((line) => {
    if (line === "") return [line];
    const indent = line.length - line.trimStart().length;
    return wrapDisplay(line.trimStart(), Math.max(20, width - indent)).map((part) => `${" ".repeat(indent)}${part}`);
  }).join("\n");
}

/** 详情块头部:`attempt 3 · compare/codex-gpt-5.4 · failed · 41s · 12.3k tokens · $0.04`。 */
export function attemptHeader(attempt: AttemptHandle): string {
  const r = attempt.result;
  const parts = [
    `attempt ${displayAttemptNumber(attempt)}`,
    attempt.experimentId,
    r.verdict,
    formatDurationMs(r.durationMs),
  ];
  if (r.usage) parts.push(`${formatMetricValue(r.usage.inputTokens + r.usage.outputTokens)} tokens`);
  const cost = attemptCostUSD(r);
  if (cost !== null) parts.push(formatUSD(cost));
  return parts.join(" · ");
}

// ───────────────────────── AttemptEvidence 共用 ─────────────────────────
// evalSourceText / executionText / attemptOverviewText(--eval / --execution / 默认全景)
// 与 evalDetailText 的紧凑索引列共用的小件:locator 头、失败原因、
// 断言计票摘要。三个证据 renderer 与全景面都只消费同一份 AttemptEvidence,不各自读
// artifact 或重新判定 capability(loadAttemptEvidence 已经算好)。

/** `--eval` / `--execution` / 全景块的头行:`@<locator> · <evalId> · <experimentId> · <verdict>`。 */
export function attemptEvidenceHeader(evidence: AttemptEvidence): string {
  return [evidence.locator, evidence.identity.evalId, evidence.identity.experimentId, evidence.result.verdict].join(" · ");
}

/**
 * 一次 attempt 未通过的判定原因,单行、不含 detail——供紧凑索引行使用。precedence 与
 * `report/compute.ts::reasonFor` 同一条规则(error → skipReason → 未通过的 gate 断言,
 * soft 永不进入),但格式更短(`gate <name>`,不带 `: <detail>`——detail 留给
 * `--eval`/单 eval 详情块的完整断言明细),这里独立实现而不是导入 report/ 的函数:
 * report 包正被并行重写(见 plan/attempt-evidence-feedback-loop.md),show 的紧凑索引不应
 * 依赖它的内部实现细节。
 */
export function verdictReasonLine(result: EvalResult): string | undefined {
  if (result.error !== undefined) return result.error.message;
  if (result.skipReason !== undefined) return result.skipReason;
  const gates = result.assertions.filter((a) => a.outcome === "failed" && a.severity === "gate");
  if (gates.length === 0) {
    const gap = result.assertions.find((a) => a.outcome === "unavailable" && !a.optional);
    return gap && gap.outcome === "unavailable" ? `unavailable ${gap.name} (${gap.reason})` : undefined;
  }
  return gates.map((a) => `gate ${a.name}`).join(", ");
}

/** 紧凑多 attempt 索引的一行:`✗ weather/brooklyn  @7K2M9Q  gate calledTool(...)`。 */
export function attemptIndexLine(opts: {
  evalId: string;
  verdict: Verdict;
  locator: string | undefined;
  reason?: string;
}): string {
  const loc = opts.locator ?? MISSING;
  const parts = [`${verdictMark(opts.verdict)} ${opts.evalId}`, loc];
  if (opts.reason) parts.push(opts.reason);
  return parts.join("  ");
}

/**
 * 断言计票摘要,`--eval` 与全景面共用:`assertions: 1 passed · 1 gate failed · 1 soft below
 * target`。直接读 `EvalResult.assertions`(恒可用的瘦身字段)而不是
 * `AnnotatedEvalSource.summary`——两者对同一批断言算出的计票恒等(`AnnotatedEvalSource` 正是
 * 用这同一个数组喂 `buildAnnotatedEvalSource` 的),但 `evalSource` 可能是 `null`
 * (未捕获源码),读 `result.assertions` 让这条摘要不因缺源码而跟着消失。
 */
export function assertionSummaryLine(assertions: AssertionResult[]): string {
  const passed = assertions.filter((a) => a.outcome === "passed").length;
  const gateFailed = assertions.filter((a) => a.outcome === "failed" && a.severity === "gate").length;
  const softBelow = assertions.filter((a) => a.outcome === "failed" && a.severity === "soft").length;
  const unavailableCount = assertions.filter((a) => a.outcome === "unavailable").length;
  const parts: string[] = [];
  if (passed > 0) parts.push(`${passed} passed`);
  if (gateFailed > 0) parts.push(`${gateFailed} gate failed`);
  if (softBelow > 0) parts.push(`${softBelow} soft below target`);
  if (unavailableCount > 0) parts.push(`${unavailableCount} unavailable`);
  return `assertions: ${parts.length > 0 ? parts.join(" · ") : "(none)"}`;
}

export interface EvalDetailOptions {
  evalId: string;
  snapshots: Snapshot[];
  /** 详情块展示的 attempt(pickDetailAttempt 的产物);无 attempt 时省略详情块。 */
  detail?: AttemptHandle;
  cwd: string;
  now: number;
  width: number;
}

/** `niceeval show <eval id>`:各 experiment 的判定行 + 默认 attempt 的断言明细。 */
export function evalDetailText(opts: EvalDetailOptions): string {
  const { evalId, snapshots, detail, cwd, now, width } = opts;
  const blocks: string[] = [];

  const description = snapshots
    .flatMap((s) => s.evals.filter((e) => e.id === evalId))
    .flatMap((e) => e.attempts)
    .map((a) => a.result.description)
    .find((d) => d !== undefined);
  blocks.push(description ? `${evalId} — ${description}` : evalId);

  // 每 experiment 一行:折叠判定、attempt 数、最新 attempt 的耗时、总成本、判定时间、
  // 代表 attempt 的紧凑索引(locator + 失败原因)——agent 从这张榜单
  // 就能直接摘到一个 `@<locator>` 下钻,不必先跑一遍 `--eval`/`--execution` 才知道选谁。
  const rows: string[][] = [];
  for (const snapshot of snapshots) {
    const ev = snapshot.evals.find((e) => e.id === evalId);
    if (!ev || ev.attempts.length === 0) continue;
    const verdict = foldEvalVerdict(ev.attempts.map((a) => a.result));
    const latest = ev.attempts.reduce((a, b) => (b.result.attempt >= a.result.attempt ? b : a));
    let cost: number | null = null;
    for (const attempt of ev.attempts) {
      const c = attemptCostUSD(attempt.result);
      if (c !== null) cost = (cost ?? 0) + c;
    }
    const rep = pickDetailAttempt(ev.attempts);
    const locatorCell = rep?.locator ?? MISSING;
    const reasonCell = rep ? (verdictReasonLine(rep.result) ?? "") : "";
    rows.push([
      snapshot.experimentId,
      `${verdictMark(verdict)} ${verdict}`,
      attemptsLabel(ev.attempts.length),
      formatDurationMs(latest.result.durationMs),
      cost === null ? MISSING : formatUSD(cost),
      `(${relativeAgo(latest.result.startedAt ?? snapshot.startedAt, now)})`,
      locatorCell,
      reasonCell,
    ]);
  }
  if (rows.length > 0) blocks.push(renderAlignedRows(rows));

  if (detail) {
    const lines: string[] = [attemptHeader(detail)];
    for (const a of detail.result.assertions) {
      lines.push(indentBlock(wrapDisplay(assertionLine(a), width - 2).join("\n"), "  "));
    }
    if (detail.result.error !== undefined) {
      lines.push(indentBlock(wrapDisplay(`error: ${detail.result.error.message}`, width - 2).join("\n"), "  "));
    }
    if (detail.result.skipReason !== undefined) {
      lines.push(indentBlock(wrapDisplay(`skipped: ${detail.result.skipReason}`, width - 2).join("\n"), "  "));
    }
    blocks.push(lines.join("\n"));

    const tail: string[] = [];
    const artifacts = attemptArtifactsPath(detail, cwd);
    if ( artifacts) tail.push(`artifacts: ${artifacts}/`);
    if (detail.locator) tail.push(`attempt locator: ${detail.locator}`);
    tail.push(
      detail.locator
        ? `next: niceeval show ${detail.locator} [--source|--execution|--diff]`
        : `next: niceeval show ${evalId} [--source|--execution|--diff]`,
    );
    blocks.push(tail.join("\n"));
  }

  return blocks.join("\n\n");
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
      `${verdictMark(r.verdict)} ${r.verdict}`,
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
 * (--results / --report / 位置参数),复制即可精确复现下一层视图。调用方只在页数大于一时
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

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function indentedText(text: string, width: number, indent = 4, maxLines = 18): string[] {
  const source = clip(text).split("\n");
  const shown = source.slice(0, maxLines);
  const lines = shown.flatMap((line) => wrapDisplay(line || " ", Math.max(20, width - indent)).map((part) => `${" ".repeat(indent)}${part}`));
  if (source.length > shown.length) lines.push(`${" ".repeat(indent)}… (+${source.length - shown.length} more lines)`);
  return lines;
}

// ───────────────────────── 证据切面:--eval(Eval 源码标注) ─────────────────────────

const MAX_SOURCE_LINES = 400;

/** gate 失败 / soft 恒带分 / unavailable 带 reason——与 assertionLine 的口径一致,但不带断言
 *  name(源码行本身就是名字)。 */
function evalAssertionDetailLine(a: AssertionResult): string | undefined {
  if (a.outcome === "unavailable") {
    return `${a.severity} · unavailable · ${a.reason}`;
  }
  if (a.severity === "soft") {
    const detail = a.outcome === "failed" && a.detail ? ` · ${a.detail}` : "";
    const threshold = a.threshold !== undefined ? ` / ${scoreText(a.threshold)}` : "/1";
    return `soft · ${scoreText(a.score)}${threshold}${detail}`;
  }
  if (a.outcome === "failed") {
    // 标注行是源码页里的一行事实,不是证据面:expected / received 过摘要收口
    // (折单行 + 上限),完整值在 attempt 首页与 events.json / diff.json。
    const parts = ["gate"];
    const group = groupTitle(a);
    if (group) parts.push(group);
    parts.push(a.name);
    if (a.expected !== undefined) parts.push(`expected ${summaryText(a.expected)}`);
    const received = a.received ?? a.evidence;
    if (received !== undefined) parts.push(`received ${summaryText(received)}`);
    if (a.detail) parts.push(summaryText(a.detail));
    return parts.join(" · ");
  }
  return undefined;
}

/** send 行标注:轮身份 · status · 墙钟(有记录才出现),契约见 show.md「--eval」。 */
function sendAnnotationLine(send: SendAnnotation): string {
  const parts = [send.label, send.status];
  if (send.durationMs !== undefined) parts.push(formatDurationMs(send.durationMs));
  return parts.join(" · ");
}

function evalSourceLineText(line: AnnotatedSourceLine, gutterWidth: number, width: number): string[] {
  const anyFailed = line.assertions.some((a) => a.outcome === "failed") ||
    line.sends.some((send) => send.status === "failed");
  const anyUnavailable = line.assertions.some((a) => a.outcome === "unavailable");
  const glyph = line.assertions.length === 0 && line.sends.length === 0
    ? " "
    : anyFailed
      ? "✗"
      : anyUnavailable
        ? "◌"
        : "✓";
  const marginWidth = gutterWidth + 2; // 行号列 + glyph + 分隔空格
  const prefix = `${padDisplay(String(line.line), gutterWidth)}${glyph} `;
  // 源码行的空白(尤其是缩进)是语义的一部分:wrapDisplay 按单词重排会把连续空格
  // 吃成一个、把缩进整体丢掉(agent-feedback-loop.mdx 的示例明确保留 2/4/6 格嵌套缩进)。
  // 过长的源码行只裁一刀(clip,与其它证据切面的截断口径一致),不按词折成多行——
  // 折行只对续行加统一 margin,救不回已经被吃掉的原始缩进,不如老实截断。
  const out = [prefix + clip(line.text, Math.max(20, width - marginWidth))];
  const margin = " ".repeat(marginWidth);
  for (const send of line.sends) {
    for (const wrapped2 of wrapDisplay(sendAnnotationLine(send), Math.max(20, width - marginWidth))) {
      out.push(margin + wrapped2);
    }
  }
  for (const a of line.assertions) {
    const detail = evalAssertionDetailLine(a);
    if (detail === undefined) continue;
    for (const wrapped2 of wrapDisplay(detail, Math.max(20, width - marginWidth))) out.push(margin + wrapped2);
  }
  return out;
}

/**
 * `--eval`:运行时保存的 Eval 源码,gate/soft 断言标回源码行,外加 unmapped 断言(永不丢弃)
 * 与断言计票摘要。`evidence.evalSource === null` 时如实说明源码未捕获,不伪造空文档。
 */
export function evalSourceText(
  evidence: AttemptEvidence,
  opts: { header: string; artifactPath?: string; width: number },
): string {
  const { header, artifactPath, width } = opts;
  const source = evidence.evalSource;
  const artifact = artifactPath ? join(artifactPath, "sources.json") : undefined;
  if (!source) {
    return `${header}\n\n(eval source unavailable for this attempt${artifact ? ` · expected: ${artifact}` : ""})`;
  }

  const blocks: string[] = [header, `eval source: ${source.sourcePath} · sha256:${source.sourceSha256.slice(0, 8)}…`];

  const gutterWidth = String(source.lines.length).length;
  const shownLines = source.lines.slice(0, MAX_SOURCE_LINES);
  const lineLines = shownLines.flatMap((line) => evalSourceLineText(line, gutterWidth, width));
  if (source.lines.length > shownLines.length) {
    lineLines.push(`(${source.lines.length - shownLines.length} more lines not shown)`);
  }
  blocks.push(lineLines.join("\n"));

  if (source.unmapped.length > 0) {
    const unmappedLines = source.unmapped.map((a) => indentBlock(wrapDisplay(assertionLine(a), width - 2).join("\n"), "  "));
    blocks.push(
      [`unmapped assertions (${source.unmapped.length}, no source location):`, ...unmappedLines].join("\n"),
    );
  }

  const tail = [assertionSummaryLine(evidence.result.assertions)];
  // 标注行的值是收口预览;有未通过断言时给「更进一步」——attempt 首页展开完整 expected /
  // received(含 output tail),再往下是 result.json / events.json。
  if (evidence.result.assertions.some((a) => a.outcome !== "passed")) {
    tail.push(`full failure detail: niceeval show ${evidence.locator}`);
  }
  if (artifact) tail.push(`full eval source: ${artifact}`);
  blocks.push(tail.join("\n"));
  return blocks.join("\n\n");
}

// ───────────────────────── 证据切面:--execution(标准事件流 + OTel enrichment) ─────────────────────────

const EXEC_LABEL_PAD = 12;
const EXEC_TIME_PAD = 6;

function relSeconds(ms: number, originMs: number): string {
  return `${((ms - originMs) / 1000).toFixed(1)}s`;
}

/** 一个 ExecutionNode 的一行(或折行后多行);时间列只在整棵树 timingAvailable 时出现。 */
function execBody(
  time: string | undefined,
  label: string,
  text: string,
  duration: string | undefined,
  width: number,
  timingAvailable: boolean,
): string[] {
  const timeCol = timingAvailable ? padDisplay(time ?? "", EXEC_TIME_PAD) + " " : "";
  const marginWidth = timeCol.length + EXEC_LABEL_PAD;
  const wrapped = wrapDisplay(clip(text), Math.max(20, width - marginWidth));
  return wrapped.map((line, i) => {
    if (i !== 0) return " ".repeat(marginWidth) + line;
    const head = timeCol + padDisplay(label, EXEC_LABEL_PAD) + line;
    return duration ? `${head}  ${duration}` : head;
  });
}

/**
 * action / subagent 节点渲染成两行(call + result)——节点模型把 call+result 合并成一个
 * ExecutionNode(按 callId),但分两行读更符合「先看调用、再看结果」的阅读顺序,
 * 与 docs-site/zh/tutorials/agent-feedback-loop.mdx 的示例一致。
 */
function executionNodeLines(node: ExecutionNode, originMs: number, timingAvailable: boolean, width: number): string[] {
  const time = node.kind !== "telemetry" && node.span ? relSeconds(node.span.startMs, originMs) : undefined;
  const duration = node.kind !== "telemetry" && node.span ? formatDurationMs(node.span.endMs - node.span.startMs) : undefined;
  const meta = [time, duration].filter(Boolean).join(" · ");
  const block = (title: string, body: string, extra: string[] = []): string[] => {
    const heading = meta ? `${title}  ${meta}` : title;
    const bodyLines = wrapDisplay(clip(body), Math.max(20, width - 2)).map((line) => `  ${line}`);
    return [heading, ...bodyLines, ...extra.flatMap((line) => wrapDisplay(line, Math.max(20, width - 2)).map((part) => `  ${part}`))];
  };

  switch (node.kind) {
    case "message":
      return block(node.role.toUpperCase(), node.text);
    case "thinking":
      return block("THINKING", clip(node.text, 200));
    case "skill.loaded":
      return block(`SKILL · ${node.skill}`, "loaded");
    case "action": {
      const input = recordOf(node.input);
      const output = recordOf(node.output);
      const inputText = typeof input?.command === "string" ? input.command : jsonPreview(node.input);
      const outputText = typeof output?.output === "string" ? output.output : node.output !== undefined ? jsonPreview(node.output) : "(no result)";
      const exit = typeof output?.exit_code === "number" ? ` · exit ${output.exit_code}` : "";
      return [
        meta ? `TOOL · ${node.name}  ${meta}` : `TOOL · ${node.name}`,
        "  input",
        ...indentedText(inputText, width),
        `  result · ${node.status}${exit}`,
        ...indentedText(outputText, width),
      ];
    }
    case "subagent": {
      return block(`SUBAGENT · ${node.name}`, node.output === undefined ? node.status : `result · ${node.status}: ${jsonPreview(node.output)}`);
    }
    case "input.requested":
      return block("INPUT REQUESTED", node.request.prompt ?? node.request.display ?? "(input requested)");
    case "compaction":
      return block("COMPACTION", node.reason ?? "context compacted");
    case "error":
      return block("ERROR", node.message);
    case "telemetry":
      return execBody(
        relSeconds(node.span.startMs, originMs),
        "telemetry",
        node.span.name || node.span.kind || "span",
        formatDurationMs(node.span.endMs - node.span.startMs),
        width,
        true,
      );
  }
}

/**
 * `--execution`:标准事件流骨架(message / thinking / skill load / tool call+result / subagent /
 * input.requested / compaction / error),有 OTel 时同一节点补相对时间与耗时;没有 OTel 时
 * 节点、顺序与内容不变,只去掉时间列,并在结尾如实标 timing unavailable
 * (ExecutionTree 的契约:骨架不因时间有无而变形,见 o11y/execution-tree.ts 头注)。
 */
export function executionText(
  evidence: AttemptEvidence,
  opts: { header: string; artifactPath?: string; width: number },
): string {
  const { header, artifactPath, width } = opts;
  const tree = evidence.execution;
  const eventsSource = artifactPath ? join(artifactPath, "events.json") : undefined;
  if (!tree) {
    return `${header}\n\n(no events recorded for this attempt${eventsSource ? ` · expected: ${eventsSource}` : ""})`;
  }

  const timingAvailable = tree.timingAvailable;
  const spanStarts = tree.nodes.flatMap((n) => (n.span ? [n.span.startMs] : []));
  const originMs = spanStarts.length > 0 ? Math.min(...spanStarts) : 0;

  // `--execution` 回答 Agent 做了什么。未关联到标准事件的原始 spans 属于 trace 证据，
  // 逐条混入 transcript 会把几十条 SDK 内部 span 盖过消息和工具调用。
  const agentNodes = tree.nodes.filter((node) => node.kind !== "telemetry");
  const telemetryCount = tree.nodes.length - agentNodes.length;
  const shown = agentNodes.slice(0, MAX_EVENTS);

  // 按轮分段(见 docs/feature/reports/show.md「--execution」):每轮以 TURN 头行开始——身份
  // s<session>/t<turn>(与 --timing 的 turn 节点、diff 的 windows 同一套标签,来自
  // result.json.phases 的 turn 时间树)、该轮墙钟;边界按用户消息切(t.send 恒以用户消息开轮)。
  const turnNodes = (evidence.result.phases ?? [])
    .flatMap((p) => p.children ?? [])
    .filter((n) => n.kind === "turn");
  const lines: string[] = [];
  let turnIndex = -1;
  shown.forEach((node, index) => {
    const isTurnStart = node.kind === "message" && node.role === "user";
    if (isTurnStart) {
      turnIndex += 1;
      const turn = turnNodes[turnIndex];
      const label = turn?.label ?? `t${turnIndex + 1}`;
      const durationPart = turn ? ` · ${formatDurationMs(turn.durationMs)}` : "";
      const failedPart = turn?.failed ? " · failed" : "";
      if (index > 0) lines.push("");
      lines.push(`TURN ${label}${failedPart || " · completed"}${durationPart}`);
    } else if (index > 0) {
      lines.push("");
    }
    lines.push(...executionNodeLines(node, originMs, timingAvailable, width).map((l) => (turnIndex >= 0 ? `  ${l}` : l)));
  });

  const tail: string[] = [];
  if (timingAvailable) {
    const skillLoads = tree.nodes.filter((n) => n.kind === "skill.loaded").length;
    const toolCalls = tree.nodes.filter((n) => n.kind === "action").length;
    const aiMessages = tree.nodes.filter((n) => n.kind === "message" && n.role === "assistant").length;
    tail.push(
      [
        `total ${formatDurationMs(evidence.result.durationMs)}`,
        `${skillLoads} skill ${skillLoads === 1 ? "load" : "loads"}`,
        `${toolCalls} tool ${toolCalls === 1 ? "call" : "calls"}`,
        `${aiMessages} AI ${aiMessages === 1 ? "message" : "messages"}`,
        ...(agentNodes.length > shown.length ? [`${agentNodes.length - shown.length} more events not shown`] : []),
      ].join(" · "),
    );
  } else {
    tail.push(
      [
        "timing unavailable · OTel trace was not collected",
        ...(agentNodes.length > shown.length ? [`${agentNodes.length - shown.length} more events not shown`] : []),
      ].join(" · "),
    );
  }
  if (eventsSource) tail.push(`full events: ${eventsSource}`);
  if (telemetryCount > 0) tail.push(`${telemetryCount} unlinked telemetry spans omitted; inspect the OTel trace for framework timing.`);
  if (timingAvailable && artifactPath) tail.push(`full OTel trace: ${join(artifactPath, "trace.json")}`);

  return `${header}\n\n${lines.join("\n")}\n\n${tail.join("\n")}`;
}

// ───────────────────────── 默认全景:AttemptEvidence 紧凑总览 ─────────────────────────

const MAX_OVERVIEW_DIFF_NAMES = 5;

/** net 效果的单字母标记(A/M/D;none = 动过但净无变化,标 ±)。 */
function netLetter(net: string): string {
  switch (net) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "none":
      return "±";
    default:
      return "M";
  }
}

function overviewDiffLine(diff: DiffData): string {
  const names = Object.entries(diff.files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, f]) => `${netLetter(f.net)} ${p}`);
  const shown = names.slice(0, MAX_OVERVIEW_DIFF_NAMES);
  const more = names.length > shown.length ? ` · +${names.length - shown.length} more` : "";
  return `changes: ${names.length} ${names.length === 1 ? "file" : "files"} changed by agent · ${shown.join(" · ")}${more}`;
}

/** 有界行 diff(公共前后缀修剪):对单区域编辑精确,复杂编辑给出上界近似。 */
function lineDelta(before: string | undefined, after: string | undefined): { adds: number; dels: number } {
  const a = before === undefined ? [] : before.split("\n");
  const b = after === undefined ? [] : after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return { adds: b.length - prefix - suffix, dels: a.length - prefix - suffix };
}

/**
 * `niceeval show @<locator>` 不带证据 flag 时的默认面:紧凑全景,只给摘要——Eval 断言计票、
 * 执行事件计数、可选 OTel 时间指示、工作区 diff 摘要,不复现 `--eval` 的完整源码、
 * `--execution` 的完整事件流或 `--diff` 的完整文件列表(那些内容各自的证据 flag 才给)。
 */
/** lifecycle operation → 首页可读标签:点换空格,与 docs/feature/reports/show.md 的
 *  `phase: sandbox provision` 字面一致(不引入第二套本地化标签,show 首页用英文原样呈现)。 */
function operationWords(operation: string): string {
  return operation.replace(/\./g, " ");
}

/**
 * errored attempt 的结构化 `error:` 块(见 docs/feature/reports/show.md「errored attempt 的首页」)。
 * 先展开 phase(= operation 的可读形态)/ code / message / cause,stack 放在块后、保持原始换行。
 * 字段来自结构化 `AttemptError`;非 errored(`r.error === undefined`)返回 undefined。
 */
function renderErrorBlock(r: EvalResult): string | undefined {
  const err = r.error;
  if (err === undefined) return undefined;
  const lines = ["error:", `  phase: ${err.phase}`, `  code: ${err.code}`, `  message: ${err.message}`];
  if (err.cause) {
    const c = err.cause;
    const causeText = c.name ? `${c.name} · ${c.message}` : c.message;
    lines.push(`  cause: ${causeText}`);
  }
  // stack 放在 error 块之后、保持原始换行(见 docs);没有 stack(如 timeout / turn-failed)就不加空块。
  if (err.stack && err.stack.trim() !== "") return `${lines.join("\n")}\n\n${err.stack.replace(/\n+$/, "")}`;
  return lines.join("\n");
}

/**
 * attempt 级诊断块(见 docs/feature/reports/show.md「diagnostics」)。每条一行标头
 * `<level> · <operation> · <code>`,message 缩进在下一行;`count > 1` 时补 `(N occurrences)`。
 * 诊断的 level 与 verdict 无关 —— passed / failed / errored 都可能带一条 cleanup / teardown
 * warning。没有诊断返回 undefined。
 */
function renderAttemptDiagnostics(r: EvalResult): string | undefined {
  if (!r.diagnostics || r.diagnostics.length === 0) return undefined;
  const lines = ["diagnostics:"];
  for (const d of r.diagnostics) {
    lines.push(`  ${d.level} · ${d.phase} · ${d.code}`);
    const occ = d.count && d.count > 1 ? ` (${d.count} occurrences)` : "";
    lines.push(`    ${d.message}${occ}`);
  }
  return lines.join("\n");
}

export function attemptOverviewText(
  evidence: AttemptEvidence,
  opts: { header: string; artifactPath?: string; width: number },
): string {
  const { header, artifactPath } = opts;
  const r = evidence.result;

  const metaParts = [`snapshot ${evidence.identity.snapshotStartedAt}`, `attempt ${evidence.identity.attempt + 1}`, formatDurationMs(r.durationMs)];
  if (r.usage) metaParts.push(`${formatMetricValue(r.usage.inputTokens + r.usage.outputTokens)} tokens`);
  const cost = attemptCostUSD(r);
  if (cost !== null) metaParts.push(formatUSD(cost));

  const blocks: string[] = [[header, metaParts.join(" · ")].join("\n")];

  // errored attempt 的首页不靠 trace 就要能解释基础设施错误(见 docs/feature/reports/show.md
  // 「errored attempt 的首页」):先展开结构化 error(phase/operation/code/message/cause + stack),
  // 断言块对没有断言的 errored attempt 省略(它在评分之前就挂了)。
  const errorBlock = renderErrorBlock(r);
  if (errorBlock) blocks.push(errorBlock);

  // errored 且没有任何断言时不打印空的 "assertions: 0 passed" —— 主因已经在 error 块里说清楚了。
  if (r.assertions.length > 0 || r.error === undefined) {
    blocks.push(
      [
        assertionSummaryLine(r.assertions),
        evidence.evalSource
          ? `eval source: ${evidence.evalSource.sourcePath} · sha256:${evidence.evalSource.sourceSha256.slice(0, 8)}…`
          : "eval source: unavailable (not captured for this attempt)",
      ].join("\n"),
    );
  }

  const diagnostics = failureDiagnostics(r.assertions, opts.width);
  if (diagnostics) blocks.push(diagnostics);

  // attempt 级诊断(teardown/cleanup 等,与 verdict 独立;passed/failed/errored 都可能有)。
  const attemptDiag = renderAttemptDiagnostics(r);
  if (attemptDiag) blocks.push(attemptDiag);

  if (evidence.execution) {
    const nodes = evidence.execution.nodes.filter((node) => node.kind !== "telemetry");
    const skillLoads = nodes.filter((n) => n.kind === "skill.loaded").length;
    const toolCalls = nodes.filter((n) => n.kind === "action").length;
    const aiMessages = nodes.filter((n) => n.kind === "message" && n.role === "assistant").length;
    const counted = (count: number, singular: string, plural = `${singular}s`) =>
      `${count} ${count === 1 ? singular : plural}`;
    const execLines = [
      `execution: ${counted(nodes.length, "event")} · ${counted(skillLoads, "skill load")} · ${counted(toolCalls, "tool call")} · ${counted(aiMessages, "AI message")}`,
    ];
    const timingLine = overviewTimingLine(r);
    if (timingLine) execLines.push(timingLine);
    blocks.push(execLines.join("\n"));
  } else {
    blocks.push("execution: unavailable (no events recorded for this attempt)");
  }

  if (evidence.diff && evidence.capabilities.diff) {
    blocks.push(overviewDiffLine(evidence.diff));
  } else if (evidence.diff) {
    blocks.push("changes: diff unavailable · this attempt did not produce workspace file changes");
  } else {
    blocks.push("changes: diff unavailable · no workspace diff was recorded for this attempt");
  }

  const tail: string[] = [];
  if (artifactPath) tail.push(`artifacts: ${artifactPath}/`);
  const available = [
    evidence.capabilities.source ? `niceeval show ${evidence.locator} --source` : undefined,
    evidence.capabilities.execution ? `niceeval show ${evidence.locator} --execution` : undefined,
    evidence.capabilities.timing ? `niceeval show ${evidence.locator} --timing` : undefined,
    evidence.capabilities.diff ? `niceeval show ${evidence.locator} --diff` : undefined,
  ].filter((command): command is string => command !== undefined);
  if (available.length > 0) tail.push(`available:\n${available.map((command) => `  ${command}`).join("\n")}`);
  if (tail.length > 0) blocks.push(tail.join("\n"));

  return blocks.join("\n\n");
}

// ───────────────────────── 证据切面:diff ─────────────────────────

const MAX_DIFF_LINES = 200;

export function diffText(opts: {
  header: string;
  diff: DiffData | null;
  artifactPath?: string;
  /** --diff=<路径>:看单个文件的完整内容。 */
  file?: string;
}): string {
  const { header, diff, artifactPath, file } = opts;
  const source = artifactPath ? join(artifactPath, "diff.json") : undefined;
  if (!diff) {
    return `${header}\n\ndiff unavailable (no diff recorded for this attempt: remote agent, or diff artifact not published${source ? `; expected: ${source}` : ""})`;
  }

  if (file !== undefined) {
    const summary = diff.files[file];
    if (summary === undefined) {
      const known = Object.keys(diff.files).sort();
      return `${header}\n\nFile "${file}" is not in this attempt's agent diff. Files: ${known.join(", ") || "(none)"}`;
    }
    // 单文件 patch 按窗口逐段渲染(diff.json 存的就是逐窗口 delta,不产出跨窗口合成 patch)。
    const head = `${netLetter(summary.net)} ${file} · touched in ${summary.windows.join(", ")}`;
    if (summary.binary) {
      const sections = diff.windows
        .filter((w) => w.changes[file] !== undefined)
        .map((w) => {
          const c = w.changes[file]!;
          const b = c.binary ?? {};
          return `── window ${w.window}\nbinary · ${b.beforeBytes ?? 0} → ${b.afterBytes ?? 0} bytes`;
        });
      return `${header}\n\n${head}\n\n${sections.join("\n\n")}`;
    }
    const sections: string[] = [];
    for (const w of diff.windows) {
      const c = w.changes[file];
      if (c === undefined) continue;
      sections.push(`── window ${w.window}\n${windowHunk(c)}`);
    }
    return `${header}\n\n${head}\n\n${sections.join("\n\n")}${source ? `\n\n(full diff: ${source})` : ""}`;
  }

  const entries = Object.entries(diff.files).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return `${header}\n\n(no file changes by the agent in any send window${source ? ` · full diff: ${source}` : ""})`;
  }
  const rows = entries.map(([path, summary]) => {
    if (summary.binary) {
      return [netLetter(summary.net), path, "binary", summary.windows.join(", ")];
    }
    let adds = 0;
    let dels = 0;
    for (const w of diff.windows) {
      const c = w.changes[path];
      if (!c) continue;
      const d = lineDelta(c.before, c.after);
      adds += Math.max(0, d.adds);
      dels += Math.max(0, d.dels);
    }
    const delta = [adds > 0 ? `+${adds}` : "", dels > 0 ? `-${dels}` : ""].filter(Boolean).join(" ") || "±0";
    return [netLetter(summary.net), path, delta, summary.windows.join(", ")];
  });
  const headLine = `${entries.length} ${entries.length === 1 ? "file" : "files"} changed by agent`;
  const single = entries[0] ? `\n\nsingle file: niceeval show @… --diff=${entries[0][0]}` : "";
  return `${header}\n\n${headLine}\n${renderAlignedRows(rows).split("\n").map((l) => `  ${l}`).join("\n")}${single}`;
}

/** 一个窗口内单文件的最小 unified hunk:公共前后缀修剪出的编辑区,一段 @@ 展示。 */
function windowHunk(c: { status: string; before?: string; after?: string }): string {
  const a = c.before === undefined ? [] : c.before.replace(/\n$/, "").split("\n");
  const b = c.after === undefined ? [] : c.after.replace(/\n$/, "").split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  const ctxBefore = a.slice(Math.max(0, prefix - 2), prefix);
  const lines: string[] = [];
  lines.push(`@@ -${Math.max(1, prefix - ctxBefore.length + 1)},${removed.length + ctxBefore.length} +${Math.max(1, prefix - ctxBefore.length + 1)},${added.length + ctxBefore.length} @@`);
  for (const l of ctxBefore) lines.push(` ${l}`);
  const MAX_HUNK_LINES = 200;
  const shownRemoved = removed.slice(0, MAX_HUNK_LINES);
  const shownAdded = added.slice(0, MAX_HUNK_LINES);
  for (const l of shownRemoved) lines.push(`-${l}`);
  if (removed.length > shownRemoved.length) lines.push(`… (${removed.length - shownRemoved.length} more removed lines)`);
  for (const l of shownAdded) lines.push(`+${l}`);
  if (added.length > shownAdded.length) lines.push(`… (${added.length - shownAdded.length} more added lines)`);
  return lines.join("\n");
}

// ───────────────────────── 证据切面:--timing(统一时间树) ─────────────────────────

const CLOSING_PHASE_NAMES = new Set(["eval.teardown", "agent.teardown", "sandbox.teardown", "sandbox.suspend", "sandbox.stop"]);

// 首页只保留能回答「大头在哪」的阶段。分类账锚点与 telemetry bookkeeping 在很短时
// 留给 --timing 完整树；一旦自身变成慢点或失败，仍必须抬到首页，不能被静默藏掉。
const OVERVIEW_DETAIL_PHASE_NAMES = new Set(["workspace.baseline", "telemetry.configure", "telemetry.collect"]);
const OVERVIEW_DETAIL_THRESHOLD_MS = 1_000;

/** phases 主链摘要行(首页 `timing:`):各主链阶段耗时点隔,收尾段合计以 `teardown +N` 单列。 */
export function overviewTimingLine(r: EvalResult): string | undefined {
  if (!r.phases || r.phases.length === 0) return undefined;
  const main = r.phases.filter(
    (p) =>
      !CLOSING_PHASE_NAMES.has(p.name) &&
      (p.failed === true || !OVERVIEW_DETAIL_PHASE_NAMES.has(p.name) || p.durationMs >= OVERVIEW_DETAIL_THRESHOLD_MS),
  );
  const closing = r.phases.filter((p) => CLOSING_PHASE_NAMES.has(p.name));
  const parts = main.map((p) => `${p.name} ${formatDurationMs(p.durationMs)}${p.failed ? " ✗" : ""}`);
  const closingMs = closing.reduce((sum, p) => sum + p.durationMs, 0);
  if (closingMs > 0) parts.push(`teardown +${formatDurationMs(closingMs)}`);
  return `timing: ${parts.join(" · ")}`;
}

const TIMING_DETAIL_NODE_BUDGET = 80;

interface DiagnosticTimingNode {
  id: string;
  label: string;
  startOffsetMs: number;
  durationMs: number;
  failed: boolean;
  otel: boolean;
  children: DiagnosticTimingNode[];
}

function timingNodeLabel(node: TimingNode): string {
  if (node.kind === "command" && node.command) return `shell · ${node.command.display}`;
  if (node.kind === "turn") return `turn ${node.label}`;
  if (node.kind === "operation" || node.kind === "provider") return `${node.kind} · ${node.label}`;
  return node.label;
}

function traceReferenceCounts(nodes: readonly TimingNode[], counts = new Map<string, number>()): Map<string, number> {
  for (const node of nodes) {
    if (node.kind === "turn" && node.traceId) counts.set(node.traceId, (counts.get(node.traceId) ?? 0) + 1);
    traceReferenceCounts(node.children ?? [], counts);
  }
  return counts;
}

/** OTel 只按唯一 traceId 归属和 span parent 关系挂接；不按绝对墙钟猜跨进程顺序。 */
function otelForest(traceId: string, spans: readonly TraceSpan[], turnStartOffsetMs: number): DiagnosticTimingNode[] {
  const unique = new Map<string, TraceSpan>();
  for (const span of spans) if (span.traceId === traceId && !unique.has(span.spanId)) unique.set(span.spanId, span);
  const selected = [...unique.values()];
  if (selected.length === 0) return [];
  const traceOrigin = Math.min(...selected.map((span) => span.startMs));
  const nodes = new Map<string, DiagnosticTimingNode>();
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
  const roots: DiagnosticTimingNode[] = [];
  for (const span of selected) {
    const node = nodes.get(span.spanId)!;
    const parent = span.parentSpanId && span.parentSpanId !== span.spanId ? nodes.get(span.parentSpanId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: DiagnosticTimingNode[]) => {
    items.sort((a, b) => a.startOffsetMs - b.startOffsetMs || a.id.localeCompare(b.id));
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

function diagnosticTimingNode(
  node: TimingNode,
  spans: readonly TraceSpan[],
  uniqueTraceIds: ReadonlySet<string>,
): DiagnosticTimingNode {
  const children = (node.children ?? []).map((child) => diagnosticTimingNode(child, spans, uniqueTraceIds));
  if (node.kind === "turn" && node.traceId && uniqueTraceIds.has(node.traceId)) {
    children.push(...otelForest(node.traceId, spans, node.startOffsetMs));
  }
  return {
    id: `runner:${node.id}`,
    label: timingNodeLabel(node),
    startOffsetMs: node.startOffsetMs,
    durationMs: node.durationMs,
    failed: node.failed === true,
    otel: false,
    children,
  };
}

interface FlatTimingNode {
  node: DiagnosticTimingNode;
  path: readonly DiagnosticTimingNode[];
}

function flattenTimingForest(roots: readonly DiagnosticTimingNode[]): FlatTimingNode[] {
  const flat: FlatTimingNode[] = [];
  const visit = (node: DiagnosticTimingNode, ancestors: readonly DiagnosticTimingNode[]) => {
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
function selectTimingNodes(roots: readonly DiagnosticTimingNode[]): ReadonlySet<string> {
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

  const add = (candidate: FlatTimingNode, allowance: number): number => {
    const missing = candidate.path.filter((node) => !selected.has(node.id));
    if (missing.length === 0 || missing.length > allowance || selected.size + missing.length > TIMING_DETAIL_NODE_BUDGET) {
      return 0;
    }
    for (const node of missing) selected.add(node.id);
    return missing.length;
  };
  const pool = (candidates: readonly FlatTimingNode[], cap: number) => {
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

function subtreeStats(node: DiagnosticTimingNode): { nodes: number; failed: number } {
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
  | { kind: "node"; node: DiagnosticTimingNode }
  | { kind: "omitted"; nodes: number; failed: number };

function visibleTimingEntries(
  nodes: readonly DiagnosticTimingNode[],
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

function diagnosticTimingLines(
  nodes: readonly DiagnosticTimingNode[],
  prefix: string,
  selected: ReadonlySet<string> | undefined,
  locator: string,
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
    lines.push(
      `${branch}${node.label}   ${formatDurationMs(node.durationMs)}${node.failed ? " ✗" : ""}${node.otel ? "  OTel" : ""}`,
    );
    lines.push(...diagnosticTimingLines(node.children, childPrefix, selected, locator));
  });
  return lines;
}

/**
 * `--timing`:整个 attempt 的统一时间树(见 docs/feature/reports/show.md)。先按
 * `result.json.phases` 输出 runner 生命周期,再展开 hook / 命令 / turn;turn 带 traceId 时
 * 从 trace.json 挂接 agent/model/tool spans。缩进表达包含关系,子项不能求和后与父项比较。
 */
export function timingText(
  evidence: AttemptEvidence,
  opts: { header: string; artifactPath?: string; width: number; mode?: "summary" | "full" },
): string {
  const r = evidence.result;
  if (!r.phases || r.phases.length === 0) {
    return `${opts.header}\n\nphase timing unavailable (this result was not produced by a runner with phase timing)`;
  }
  const spans = evidence.trace;
  const main = r.phases.filter((p) => !CLOSING_PHASE_NAMES.has(p.name));
  const closing = r.phases.filter((p) => CLOSING_PHASE_NAMES.has(p.name));
  const traceCounts = new Map<string, number>();
  for (const phase of r.phases) traceReferenceCounts(phase.children ?? [], traceCounts);
  const uniqueTraceIds = new Set([...traceCounts].filter(([, count]) => count === 1).map(([traceId]) => traceId));
  const phaseForests = new Map(
    r.phases.map((phase) => [
      phase,
      (phase.children ?? []).map((node) => diagnosticTimingNode(node, spans ?? [], uniqueTraceIds)),
    ]),
  );
  const allRoots = [...phaseForests.values()].flat();
  const selected = opts.mode === "full" ? undefined : selectTimingNodes(allRoots);

  const lines: string[] = [`total ${formatDurationMs(r.durationMs)}`, ""];
  const renderPhase = (p: NonNullable<EvalResult["phases"]>[number]) => {
    const failedNote = p.failed ? ` ✗ failed here${r.error ? ` (${r.error.code})` : ""}` : "";
    lines.push(`${p.name.padEnd(22)}${formatDurationMs(p.durationMs)}${failedNote}`);
    lines.push(...diagnosticTimingLines(phaseForests.get(p) ?? [], "  ", selected, evidence.locator));
  };
  for (const p of main) renderPhase(p);
  if (closing.length > 0) {
    lines.push("", "teardown (not counted in total):");
    for (const p of closing) renderPhase(p);
  }
  return `${opts.header}\n\n${lines.join("\n")}`;
}
