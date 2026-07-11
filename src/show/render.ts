// show 的文本渲染:单 eval 详情、--history 时间轴、三个证据切面(transcript / trace / diff)。
// 输出形态照 docs-site/zh/guides/viewing-results.mdx 的示例块;长内容一律截断,
// 但截断永远如实标注剩余数量和原始工件路径 —— 输出对上下文窗口友好,事实源留在盘上。
// 全部纯函数(时间经 now 显式传入),证据数据由调用方 await 好了递进来。

import { join, relative } from "node:path";
import type { AssertionResult, Verdict, StreamEvent, TraceSpan } from "../types.ts";
import type { DiffData } from "../types.ts";
import type { AttemptHandle, Selection, Snapshot } from "../results/index.ts";
import { foldEvalVerdict } from "../shared/verdict.ts";
import { attemptCostUSD } from "../report/metrics.ts";
import { formatDurationMs, formatMetricValue, formatPlainNumber, formatUSD } from "../report/format.ts";
import { indentBlock, padDisplay, renderAlignedRows, wrapDisplay } from "../report/text/layout.ts";
import type { EvalHistoryRow, ExperimentHistoryRow } from "./compose.ts";

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

/** attempt 的展示序号:落盘 attempt 从 0 计,人看 1 计(工件目录后缀 __2 = attempt 3)。 */
export function displayAttemptNumber(attempt: AttemptHandle): number {
  return attempt.result.attempt + 1;
}

/** attempt 工件目录的展示路径:尽量给相对 cwd 的短路径,出了 cwd 给绝对路径。 */
export function attemptArtifactsPath(attempt: AttemptHandle, cwd: string): string | undefined {
  const r = attempt.result;
  let abs: string | undefined;
  if (r.artifactsDir) abs = join(attempt.runDir.dir, r.artifactsDir);
  else if (r.artifactBase) abs = join(attempt.runDir.dir, "..", r.artifactBase);
  if (!abs) return undefined;
  const rel = relative(cwd, abs);
  return rel.startsWith("..") ? abs : rel;
}

// ───────────────────────── attempt 挑选 ─────────────────────────

/** 选集内某道题的全部 attempt(合成选集里每实验只剩最新判定)。 */
export function attemptsOfEval(snapshots: Snapshot[], evalId: string): AttemptHandle[] {
  const out: AttemptHandle[] = [];
  for (const snapshot of snapshots) {
    const ev = snapshot.evals.find((e) => e.id === evalId);
    if (ev) out.push(...ev.attempts);
  }
  return out;
}

/**
 * 证据切面与详情块默认挑最新一次失败的 attempt;没有失败挑最新一次。
 * --attempt 收人看的 1 计序号;--experiment 已在选集合成时收窄。
 */
export function pickDetailAttempt(
  attempts: AttemptHandle[],
  attemptNumber?: number,
): AttemptHandle | undefined {
  if (attempts.length === 0) return undefined;
  const byTime = [...attempts].sort((a, b) =>
    (a.result.startedAt ?? "").localeCompare(b.result.startedAt ?? "") || a.result.attempt - b.result.attempt,
  );
  if (attemptNumber !== undefined) {
    const wanted = byTime.filter((a) => a.result.attempt === attemptNumber - 1);
    return wanted.at(-1);
  }
  const failing = byTime.filter((a) => a.result.verdict === "failed" || a.result.verdict === "errored");
  return failing.at(-1) ?? byTime.at(-1);
}

// ───────────────────────── 单 eval 详情 ─────────────────────────

function scoreText(score: number): string {
  return formatPlainNumber(Math.round(score * 100) / 100);
}

/** 断言行:✓/✗ + severity + name;gate 失败带 detail,soft 恒带 score/1(失败再补 detail)。 */
export function assertionLine(a: AssertionResult): string {
  const head = `${a.passed ? "✓" : "✗"} ${a.severity} ${a.name}`;
  if (a.severity === "soft") {
    const detail = !a.passed && a.detail ? `: ${a.detail}` : "";
    return `${head} — ${scoreText(a.score)}/1${detail}`;
  }
  if (!a.passed) return a.detail ? `${head} — ${a.detail}` : `${head} — score ${scoreText(a.score)}`;
  return head;
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

  // 每 experiment 一行:折叠判定、attempt 数、最新 attempt 的耗时、总成本、判定时间
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
    rows.push([
      snapshot.experimentId,
      `${verdictMark(verdict)} ${verdict}`,
      attemptsLabel(ev.attempts.length),
      formatDurationMs(latest.result.durationMs),
      cost === null ? MISSING : formatUSD(cost),
      `(${relativeAgo(latest.result.startedAt ?? snapshot.startedAt, now)})`,
    ]);
  }
  if (rows.length > 0) blocks.push(renderAlignedRows(rows));

  if (detail) {
    const lines: string[] = [attemptHeader(detail)];
    for (const a of detail.result.assertions) {
      lines.push(indentBlock(wrapDisplay(assertionLine(a), width - 2).join("\n"), "  "));
    }
    if (detail.result.error !== undefined) {
      lines.push(indentBlock(wrapDisplay(`error: ${detail.result.error}`, width - 2).join("\n"), "  "));
    }
    if (detail.result.skipReason !== undefined) {
      lines.push(indentBlock(wrapDisplay(`skipped: ${detail.result.skipReason}`, width - 2).join("\n"), "  "));
    }
    blocks.push(lines.join("\n"));

    const tail: string[] = [];
    const artifacts = attemptArtifactsPath(detail, cwd);
    if (artifacts) tail.push(`artifacts: ${artifacts}/`);
    tail.push(`next: niceeval show ${evalId} --transcript | --trace | --diff`);
    blocks.push(tail.join("\n"));
  }

  return blocks.join("\n\n");
}

// ───────────────────────── --history ─────────────────────────

/** 单 eval 时间轴:`compare/codex-gpt-5.4 · 5 runs · passed 2/5` + 每次真实执行一行。 */
export function evalHistoryText(opts: {
  experimentId: string;
  /** 多 eval 前缀时块头带上 eval id;单 eval 与 mdx 示例一致不带。 */
  evalId?: string;
  rows: EvalHistoryRow[];
}): string {
  const { experimentId, evalId, rows } = opts;
  const passed = rows.filter((r) => r.verdict === "passed").length;
  const head = [
    ...(evalId ? [evalId] : []),
    experimentId,
    `${rows.length} ${rows.length === 1 ? "run" : "runs"}`,
    `passed ${passed}/${rows.length}`,
  ].join(" · ");
  if (rows.length === 0) return head;
  const table = renderAlignedRows(
    rows.map((r) => [
      timelineStamp(r.startedAt),
      `${verdictMark(r.verdict)} ${r.verdict}`,
      attemptsLabel(r.attempts),
      r.costUSD === null ? MISSING : formatUSD(r.costUSD),
      r.failedAssertion ?? (r.error ? `error: ${r.error}` : ""),
    ]),
  );
  return `${head}\n\n${indentBlock(table, "  ")}`;
}

/** 实验级 per-run 通过率序列(裸 `show --history`)。 */
export function experimentHistoryText(experimentId: string, rows: ExperimentHistoryRow[]): string {
  const head = `${experimentId} · ${rows.length} ${rows.length === 1 ? "run" : "runs"}`;
  if (rows.length === 0) return head;
  const table = renderAlignedRows(
    rows.map((r) => [
      timelineStamp(r.startedAt),
      `${r.passedEvals}/${r.totalEvals} passed`,
      r.costUSD === null ? MISSING : formatUSD(r.costUSD),
    ]),
  );
  return `${head}\n\n${indentBlock(table, "  ")}`;
}

// ───────────────────────── 证据切面:transcript ─────────────────────────

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

const ROLE_PAD = 12;

function eventLines(event: StreamEvent, width: number): string[] {
  const body = (tag: string, text: string): string[] => {
    const wrapped = wrapDisplay(clip(text), Math.max(20, width - ROLE_PAD));
    return wrapped.map((line, i) => (i === 0 ? padDisplay(tag, ROLE_PAD) + line : " ".repeat(ROLE_PAD) + line));
  };
  switch (event.type) {
    case "message":
      return body(`[${event.role}]`, event.text);
    case "thinking":
      return body("[thinking]", clip(event.text, 200));
    case "action.called":
      return body("[tool]", `${event.name}(${jsonPreview(event.input)})`);
    case "action.result":
      return body("", `→ ${event.status}${event.output !== undefined ? `: ${jsonPreview(event.output)}` : ""}`);
    case "subagent.called":
      return body("[subagent]", event.name);
    case "subagent.completed":
      return body("", `→ ${event.status}`);
    case "input.requested":
      return body("[input]", event.request.prompt ?? event.request.display ?? "(input requested)");
    case "compaction":
      return body("[compaction]", event.reason ?? "context compacted");
    case "error":
      return body("[error]", event.message);
  }
}

export function transcriptText(opts: {
  header: string;
  events: StreamEvent[] | null;
  artifactPath?: string;
  width: number;
}): string {
  const { header, events, artifactPath, width } = opts;
  const source = artifactPath ? join(artifactPath, "events.json") : undefined;
  if (!events || events.length === 0) {
    return `${header}\n\n(no events recorded for this attempt${source ? ` · expected: ${source}` : ""})`;
  }
  const shown = events.slice(0, MAX_EVENTS);
  const lines = shown.flatMap((event) => eventLines(event, width));
  const toolCalls = events.filter((e) => e.type === "action.called").length;
  const footer = [
    `${events.length} ${events.length === 1 ? "event" : "events"}`,
    toolCalls === 0 ? "no tool calls" : `${toolCalls} tool calls`,
    ...(events.length > shown.length ? [`${events.length - shown.length} more events not shown`] : []),
    ...(source ? [`full stream: ${source}`] : []),
  ].join(" · ");
  return `${header}\n\n${lines.join("\n")}\n\n(${footer})`;
}

// ───────────────────────── 证据切面:trace ─────────────────────────

const MAX_SPANS = 40;
const TRACE_BAR_WIDTH = 20;

/** span 类目与 web 版同一套标准化口径(SpanKind),不读原生 span 名;other 保留原名如实展示。 */
function spanLabel(span: TraceSpan): string {
  switch (span.kind) {
    case "turn":
      return "agent run";
    case "model":
      return "inference";
    case "tool": {
      const tool = span.attributes?.["tool_name"];
      return typeof tool === "string" ? `execute_tool ${tool}` : "execute_tool";
    }
    case "agent":
      return "invoke_agent";
    default:
      return span.name || "other";
  }
}

function traceBar(startMs: number, endMs: number, windowStart: number, windowEnd: number): string {
  const total = Math.max(1, windowEnd - windowStart);
  const from = Math.max(0, Math.min(TRACE_BAR_WIDTH - 1, Math.floor(((startMs - windowStart) / total) * TRACE_BAR_WIDTH)));
  const to = Math.max(from + 1, Math.min(TRACE_BAR_WIDTH, Math.ceil(((endMs - windowStart) / total) * TRACE_BAR_WIDTH)));
  return `▕${"░".repeat(from)}${"█".repeat(to - from)}${"░".repeat(TRACE_BAR_WIDTH - to)}▏`;
}

export function traceText(opts: {
  header: string;
  spans: TraceSpan[] | null;
  artifactPath?: string;
  width: number;
}): string {
  const { header, spans, artifactPath } = opts;
  const source = artifactPath ? join(artifactPath, "trace.json") : undefined;
  if (!spans || spans.length === 0) {
    return `${header}\n\n(no trace recorded for this attempt${source ? ` · expected: ${source}` : ""})`;
  }

  const windowStart = Math.min(...spans.map((s) => s.startMs));
  const windowEnd = Math.max(...spans.map((s) => s.endMs));
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string, TraceSpan[]>();
  const roots: TraceSpan[] = [];
  for (const span of spans) {
    if (span.parentSpanId && ids.has(span.parentSpanId)) {
      const list = children.get(span.parentSpanId) ?? [];
      list.push(span);
      children.set(span.parentSpanId, list);
    } else {
      roots.push(span);
    }
  }
  const byStart = (a: TraceSpan, b: TraceSpan) => a.startMs - b.startMs;
  roots.sort(byStart);
  for (const list of children.values()) list.sort(byStart);

  const rows: { label: string; span: TraceSpan }[] = [];
  const walk = (span: TraceSpan, prefix: string, childPrefix: string) => {
    rows.push({ label: prefix + spanLabel(span), span });
    const kids = children.get(span.spanId) ?? [];
    kids.forEach((kid, i) => {
      const last = i === kids.length - 1;
      walk(kid, childPrefix + (last ? "└─ " : "├─ "), childPrefix + (last ? "   " : "│  "));
    });
  };
  for (const root of roots) walk(root, "", "");

  const shown = rows.slice(0, MAX_SPANS);
  const labelWidth = Math.max(...shown.map((r) => r.label.length));
  const lines = shown.map(
    (r) =>
      `${padDisplay(r.label, labelWidth)}  ${traceBar(r.span.startMs, r.span.endMs, windowStart, windowEnd)} ${formatDurationMs(
        r.span.endMs - r.span.startMs,
      )}${r.span.status === "error" ? " ✗" : ""}`,
  );

  const toolSpans = spans.filter((s) => s.kind === "tool").length;
  const footer = [
    `${spans.length} ${spans.length === 1 ? "span" : "spans"}`,
    toolSpans === 0 ? "no execute_tool spans" : `${toolSpans} execute_tool spans`,
    ...(rows.length > shown.length ? [`${rows.length - shown.length} more spans not shown`] : []),
    ...(source ? [`full trace: ${source}`] : []),
  ].join(" · ");
  return `${header}\n\n${lines.join("\n")}\n\n(${footer})`;
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
    return `${header}\n\n(no diff recorded for this attempt${source ? ` · expected: ${source}` : ""})`;
  }

  if (file !== undefined) {
    const content = diff.generatedFiles[file];
    if (content === undefined) {
      if (diff.deletedFiles.includes(file)) return `${header}\n\nD ${file} (deleted by the agent)`;
      const known = [...Object.keys(diff.generatedFiles), ...diff.deletedFiles];
      return `${header}\n\nFile "${file}" is not in this attempt's diff. Files: ${known.join(", ") || "(none)"}`;
    }
    const lines = content.split("\n");
    const shown = lines.slice(0, MAX_DIFF_LINES);
    const footer = [
      `${lines.length} ${lines.length === 1 ? "line" : "lines"}`,
      ...(lines.length > shown.length ? [`${lines.length - shown.length} more lines not shown`] : []),
      ...(source ? [`full diff: ${source}`] : []),
    ].join(" · ");
    return `${header}\n\n${file}\n${shown.join("\n")}\n\n(${footer})`;
  }

  const generated = Object.entries(diff.generatedFiles).sort(([a], [b]) => a.localeCompare(b));
  const deleted = [...diff.deletedFiles].sort();
  if (generated.length === 0 && deleted.length === 0) {
    return `${header}\n\n(no file changes recorded${source ? ` · full diff: ${source}` : ""})`;
  }
  // 落盘的 diff 只有改后全文(git name-status + readFile),没有基线:
  // 行数是文件现大小,不硬编 +/- 增删行;A/M 无从区分,统一 M(created or modified)。
  const rows = [
    ...generated.map(([path, content]) => {
      const lines = content.split("\n").length;
      return ["M", path, `${lines} ${lines === 1 ? "line" : "lines"}`];
    }),
    ...deleted.map((path) => ["D", path, "(deleted)"]),
  ];
  const footer = [
    `${rows.length} ${rows.length === 1 ? "file" : "files"}`,
    ...(source ? [`full diff: ${source}`] : []),
  ].join(" · ");
  return `${header}\n\n${renderAlignedRows(rows)}\n\n(${footer})`;
}
