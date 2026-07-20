// Attempt 详情组件族的装配点(docs/feature/reports/library/attempt-detail.md)。11 个叶子
// 组件都是同一份 spec/data 判别联合(AttemptSectionProps<Data>):省略 input 时取当前
// attempt-input page 注入的 evidence;放在 scope-input page 且未显式传 input/data 时
// resolve 报完整用户反馈并指引移到 attempt-input page 或传入 evidence。
// AttemptAssessment / AttemptDetail 是组合组件,只装配叶子,不产生新的 data 或渲染面。

import type { ReactNode } from "react";
import { defineComponent, type ReportComponent, type ResolveContext, type TextContext, type WebContext } from "../../definition/tree.ts";
import { Col } from "../../definition/primitives.tsx";
import type { AttemptEvidence } from "../../../results/attempt-evidence.ts";
import { arrayProblem, dataShapeError, isObject } from "../shared.ts";
import type {
  AttemptAssertionsData,
  AttemptConversationData,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptSourceData,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  AttemptUsageData,
} from "../../model/types.ts";
import {
  attemptAssertionsData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSourceData,
  attemptSummaryData,
  attemptTimelineData,
  attemptTraceData,
  attemptUsageData,
} from "./compute.ts";
import {
  attemptAssertionsText,
  attemptConversationText,
  attemptDiagnosticsText,
  attemptDiffText,
  attemptErrorText,
  attemptFixPromptText,
  attemptSourceText,
  attemptSummaryText,
  attemptTimelineText,
  attemptTraceText,
  attemptUsageText,
} from "./faces.ts";
import { AttemptSummary as AttemptSummaryWeb } from "./AttemptSummary.tsx";
import { AttemptError as AttemptErrorWeb } from "./AttemptError.tsx";
import { AttemptAssertions as AttemptAssertionsWeb } from "./AttemptAssertions.tsx";
import { AttemptSource as AttemptSourceWeb } from "./AttemptSource.tsx";
import { AttemptFixPrompt as AttemptFixPromptWeb } from "./AttemptFixPrompt.tsx";
import { AttemptTimeline as AttemptTimelineWeb } from "./AttemptTimeline.tsx";
import { AttemptConversation as AttemptConversationWeb } from "./AttemptConversation.tsx";
import { AttemptDiagnostics as AttemptDiagnosticsWeb } from "./AttemptDiagnostics.tsx";
import { AttemptUsage as AttemptUsageWeb } from "./AttemptUsage.tsx";
import { AttemptTrace as AttemptTraceWeb } from "./AttemptTrace.tsx";
import { AttemptDiff as AttemptDiffWeb } from "./AttemptDiff.tsx";

// ───────────────────────── spec / data 判别联合 ─────────────────────────

export type AttemptSectionProps<Data> =
  | { input?: AttemptEvidence; data?: never; className?: string }
  | { data: Data; input?: never; className?: string };

interface AttemptComponentDef<Data> {
  name: string;
  dataFnName: string;
  shapeName: string;
  dataFn: (evidence: AttemptEvidence) => Data | null;
  /** 只在 data !== null 时调用。 */
  validate: (data: unknown) => string | null;
  web(props: { data: Data | null; className?: string }, ctx: WebContext): ReactNode;
  text(props: { data: Data | null; className?: string }, ctx: TextContext): string;
}

/**
 * 11 个叶子组件共用的装配:resolve 决定 evidence 来源(显式 data > 显式 input > 当前
 * attempt-input page 注入的 evidence),不在 scope-input page 上凭空工作;两面渲染前都
 * 校验 data 结构,版本漂移时报完整用户反馈而不是静默展示错误字段。
 */
function makeAttemptComponent<Data>(
  def: AttemptComponentDef<Data>,
): ReportComponent<AttemptSectionProps<Data>> {
  type Props = Record<string, unknown>;
  type Resolved = { data: Data | null; className?: string };

  const assertData = (data: unknown): Data | null => {
    if (data === null) return null;
    const problem = def.validate(data);
    if (problem !== null) throw dataShapeError(def.name, def.dataFnName, def.shapeName, problem);
    return data as Data;
  };

  const resolve = (props: Props, ctx: ResolveContext): Resolved => {
    if (props.data !== undefined) {
      if (props.input !== undefined) {
        throw new Error(
          `<${def.name}> got both \`data\` and \`input\` — the two evidence sources are exclusive and niceeval will not silently pick one. ` +
            `Keep \`data\` (precomputed with ${def.dataFnName}()) and drop \`input\`, or drop \`data\` and let the pipeline compute it from the evidence.`,
        );
      }
      assertData(props.data);
      return { data: props.data as Data, className: props.className as string | undefined };
    }
    const evidence =
      (props.input as AttemptEvidence | undefined) ?? (ctx.page.input === "attempt" ? ctx.page.evidence : undefined);
    if (evidence === undefined) {
      throw new Error(
        `<${def.name}> needs an attempt: the current page has no locator to derive evidence from (it is a scope-input page, or no page context is active). ` +
          `Move it to an attempt-input page (\`input: "attempt"\`), or pass \`input\` explicitly with an AttemptEvidence.`,
      );
    }
    return { data: def.dataFn(evidence), className: props.className as string | undefined };
  };

  const component = defineComponent<Props, Resolved>({
    resolve,
    web: (props, ctx) => {
      assertData(props.data);
      return def.web(props, ctx);
    },
    text: (props, ctx) => {
      assertData(props.data);
      return def.text(props, ctx);
    },
  }) as unknown as ReportComponent<AttemptSectionProps<Data>>;
  component.displayName = def.name;
  return component;
}

// ───────────────────────── 跨叶子复用的字段路径校验 ─────────────────────────

/** SourceLoc(src/shared/types.ts):`t.send` / 断言在 eval 源码里的调用点。 */
function sourceLocProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a SourceLoc { file, line }`;
  if (typeof value.file !== "string") return `"${path}.file" must be a string`;
  if (typeof value.line !== "number") return `"${path}.line" must be a number`;
  return null;
}

/** AssertionResult(src/scoring/types.ts):按 outcome 判别的联合,passed/failed 要 score,unavailable 要 reason。 */
function assertionResultProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AssertionResult object`;
  if (typeof value.name !== "string") return `"${path}.name" must be a string`;
  if (value.severity !== "gate" && value.severity !== "soft") return `"${path}.severity" must be "gate" or "soft"`;
  if (value.outcome === "passed" || value.outcome === "failed") {
    if (typeof value.score !== "number") return `"${path}.score" must be a number`;
    return null;
  }
  if (value.outcome === "unavailable") {
    if (typeof value.reason !== "string") return `"${path}.reason" must be a string`;
    return null;
  }
  return `"${path}.outcome" must be "passed" | "failed" | "unavailable"`;
}

/** TraceSpan(src/o11y/types.ts):AttemptTimeline 的 trace 与 AttemptTrace 的 spans 共用。 */
function traceSpanProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a TraceSpan { traceId, spanId, name, startMs, endMs }`;
  if (typeof value.traceId !== "string") return `"${path}.traceId" must be a string`;
  if (typeof value.spanId !== "string") return `"${path}.spanId" must be a string`;
  if (typeof value.name !== "string") return `"${path}.name" must be a string`;
  if (typeof value.startMs !== "number") return `"${path}.startMs" must be a number`;
  if (typeof value.endMs !== "number") return `"${path}.endMs" must be a number`;
  return null;
}

// ───────────────────────── AttemptSummary(恒非空) ─────────────────────────

/** AttemptIdentity(src/results/locator.ts):locator 派生自的不可变身份元组。 */
function attemptIdentityProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) {
    return `"${path}" must be an AttemptIdentity { experimentId, snapshotStartedAt, evalId, attempt }`;
  }
  if (typeof value.experimentId !== "string") return `"${path}.experimentId" must be a string`;
  if (typeof value.snapshotStartedAt !== "string") return `"${path}.snapshotStartedAt" must be a string`;
  if (typeof value.evalId !== "string") return `"${path}.evalId" must be a string`;
  if (typeof value.attempt !== "number") return `"${path}.attempt" must be a number`;
  return null;
}

/** AttemptEvidenceCapabilities(src/results/attempt-evidence.ts):四个证据切面开关。 */
function capabilitiesProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { source, execution, timing, diff }`;
  for (const key of ["source", "execution", "timing", "diff"] as const) {
    if (typeof value[key] !== "boolean") return `"${path}.${key}" must be a boolean`;
  }
  return null;
}

export function validateSummaryData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  const identityProblem = attemptIdentityProblem(data.identity, "identity");
  if (identityProblem !== null) return identityProblem;
  if (typeof data.verdict !== "string") return 'missing "verdict" (string)';
  if (typeof data.durationMs !== "number") return '"durationMs" must be a number';
  if (!(data.costUSD === null || typeof data.costUSD === "number")) return '"costUSD" must be a number or null';
  return capabilitiesProblem(data.capabilities, "capabilities");
}

export const AttemptSummary = makeAttemptComponent<AttemptSummaryData>({
  name: "AttemptSummary",
  dataFnName: "attemptSummaryData",
  shapeName: "AttemptSummaryData",
  dataFn: attemptSummaryData,
  validate: validateSummaryData,
  web: (props, ctx) => <AttemptSummaryWeb data={props.data as AttemptSummaryData} locale={ctx.locale} className={props.className} />,
  text: (props, ctx) => attemptSummaryText(props.data as AttemptSummaryData, ctx),
});

// ───────────────────────── AttemptError ─────────────────────────

export function validateErrorData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.code !== "string") return '"code" must be a string';
  if (typeof data.message !== "string") return '"message" must be a string';
  if (typeof data.phase !== "string") return '"phase" must be a string';
  return null;
}

export const AttemptError = makeAttemptComponent<AttemptErrorData>({
  name: "AttemptError",
  dataFnName: "attemptErrorData",
  shapeName: "AttemptErrorData",
  dataFn: attemptErrorData,
  validate: validateErrorData,
  web: (props, ctx) => <AttemptErrorWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptErrorText(props.data, ctx),
});

// ───────────────────────── AttemptAssertions ─────────────────────────

export function validateAssertionsData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  const attentionProblem = arrayProblem(data.attention, "attention", assertionResultProblem);
  if (attentionProblem !== null) return attentionProblem;
  return arrayProblem(data.passedGroups, "passedGroups", (group, path) => {
    if (!isObject(group) || typeof group.group !== "string") {
      return `"${path}" must be an object with a string "group"`;
    }
    return arrayProblem(group.items, `${path}.items`, assertionResultProblem);
  });
}

export const AttemptAssertions = makeAttemptComponent<AttemptAssertionsData>({
  name: "AttemptAssertions",
  dataFnName: "attemptAssertionsData",
  shapeName: "AttemptAssertionsData",
  dataFn: attemptAssertionsData,
  validate: validateAssertionsData,
  web: (props, ctx) => <AttemptAssertionsWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptAssertionsText(props.data, ctx),
});

// ───────────────────────── AttemptSource ─────────────────────────

/** AnnotatedSourceLine(src/results/annotated-source.ts):一行源码 + 映射到这一行的断言 / send 标注。 */
function annotatedSourceLineProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptSourceLineData { line, text, assertions, sends, turns }`;
  if (typeof value.line !== "number") return `"${path}.line" must be a number`;
  if (typeof value.text !== "string") return `"${path}.text" must be a string`;
  const assertionsProblem = arrayProblem(value.assertions, `${path}.assertions`, assertionResultProblem);
  if (assertionsProblem !== null) return assertionsProblem;
  if (!Array.isArray(value.sends)) return `"${path}.sends" must be an array`;
  return arrayProblem(value.turns, `${path}.turns`, sourceTurnProblem);
}

function sourceTurnProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptSourceTurn`;
  if (typeof value.label !== "string") return `"${path}.label" must be a string`;
  if (value.status !== "completed" && value.status !== "failed" && value.status !== "waiting") {
    return `"${path}.status" must be "completed", "failed", or "waiting"`;
  }
  if (value.durationMs !== undefined && typeof value.durationMs !== "number") return `"${path}.durationMs" must be a number`;
  if (typeof value.sentText !== "string") return `"${path}.sentText" must be a string`;
  return arrayProblem(value.replies, `${path}.replies`, conversationReplyProblem);
}

/** AnnotatedEvalSourceSummary(src/results/annotated-source.ts):全是计数字段。 */
function sourceSummaryProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AnnotatedEvalSourceSummary`;
  for (const key of [
    "totalAssertions",
    "mappedAssertions",
    "unmappedAssertions",
    "passed",
    "failed",
    "gate",
    "soft",
    "totalLines",
    "annotatedLines",
  ] as const) {
    if (typeof value[key] !== "number") return `"${path}.${key}" must be a number`;
  }
  return null;
}

export function validateSourceData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (typeof data.sourcePath !== "string") return 'missing "sourcePath" (string)';
  const linesProblem = arrayProblem(data.lines, "lines", annotatedSourceLineProblem);
  if (linesProblem !== null) return linesProblem;
  const unmappedProblem = arrayProblem(data.unmapped, "unmapped", assertionResultProblem);
  if (unmappedProblem !== null) return unmappedProblem;
  const turnsProblem = arrayProblem(data.unlocatedTurns, "unlocatedTurns", sourceTurnProblem);
  if (turnsProblem !== null) return turnsProblem;
  return sourceSummaryProblem(data.summary, "summary");
}

export const AttemptSource = makeAttemptComponent<AttemptSourceData>({
  name: "AttemptSource",
  dataFnName: "attemptSourceData",
  shapeName: "AttemptSourceData",
  dataFn: attemptSourceData,
  validate: validateSourceData,
  web: (props, ctx) => <AttemptSourceWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptSourceText(props.data, ctx),
});

// ───────────────────────── AttemptFixPrompt ─────────────────────────

export function validateFixPromptData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.prompt !== "string") return 'missing "prompt" (string)';
  return null;
}

export const AttemptFixPrompt = makeAttemptComponent<AttemptFixPromptData>({
  name: "AttemptFixPrompt",
  dataFnName: "attemptFixPromptData",
  shapeName: "AttemptFixPromptData",
  dataFn: attemptFixPromptData,
  validate: validateFixPromptData,
  web: (props, ctx) => <AttemptFixPromptWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptFixPromptText(props.data, ctx),
});

// ───────────────────────── AttemptTimeline ─────────────────────────

/** PhaseTiming(src/runner/types.ts):runner 阶段计时,按执行顺序。 */
function phaseTimingProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a PhaseTiming { name, durationMs }`;
  if (typeof value.name !== "string") return `"${path}.name" must be a string`;
  if (typeof value.durationMs !== "number") return `"${path}.durationMs" must be a number`;
  return null;
}

export function validateTimelineData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  const phasesProblem = arrayProblem(data.phases, "phases", phaseTimingProblem);
  if (phasesProblem !== null) return phasesProblem;
  if (data.trace !== null) return arrayProblem(data.trace, "trace", traceSpanProblem);
  return null;
}

export const AttemptTimeline = makeAttemptComponent<AttemptTimelineData>({
  name: "AttemptTimeline",
  dataFnName: "attemptTimelineData",
  shapeName: "AttemptTimelineData",
  dataFn: attemptTimelineData,
  validate: validateTimelineData,
  web: (props, ctx) => <AttemptTimelineWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptTimelineText(props.data, ctx),
});

// ───────────────────────── AttemptConversation ─────────────────────────

const CONVERSATION_REPLY_KINDS = [
  "assistant",
  "user",
  "thinking",
  "error",
  "tool",
  "skill",
  "subagent",
  "input",
  "compaction",
  "raw",
];

/**
 * AttemptConversationReply(src/report/model/types.ts):按 `kind` 判别的联合,每支自己的必填
 * 字段各自校验——`raw` 是未识别事件类型的兜底分支,不吞没其余 kind 的校验。
 */
function conversationReplyProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptConversationReply object`;
  switch (value.kind) {
    case "assistant":
    case "user":
    case "thinking":
    case "error":
      if (typeof value.text !== "string") return `"${path}.text" must be a string`;
      return null;
    case "tool":
      if (typeof value.callId !== "string") return `"${path}.callId" must be a string`;
      if (typeof value.name !== "string") return `"${path}.name" must be a string`;
      if (!("input" in value)) return `"${path}.input" is required`;
      return null;
    case "skill":
      if (typeof value.skill !== "string") return `"${path}.skill" must be a string`;
      return null;
    case "subagent":
      if (typeof value.callId !== "string") return `"${path}.callId" must be a string`;
      if (typeof value.name !== "string") return `"${path}.name" must be a string`;
      return null;
    case "input":
      if (!isObject(value.request)) return `"${path}.request" must be an InputRequest object`;
      return null;
    case "compaction":
      return null;
    case "raw":
      if (!("raw" in value)) return `"${path}.raw" is required`;
      return null;
    default:
      return `"${path}.kind" must be one of ${JSON.stringify(CONVERSATION_REPLY_KINDS)}`;
  }
}

function conversationRoundProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptConversationRound { sentText, replies }`;
  if (typeof value.sentText !== "string") return `"${path}.sentText" must be a string`;
  if (value.loc !== undefined) {
    const locProblem = sourceLocProblem(value.loc, `${path}.loc`);
    if (locProblem !== null) return locProblem;
  }
  return arrayProblem(value.replies, `${path}.replies`, conversationReplyProblem);
}

export function validateConversationData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  return arrayProblem(data.rounds, "rounds", conversationRoundProblem);
}

export const AttemptConversation = makeAttemptComponent<AttemptConversationData>({
  name: "AttemptConversation",
  dataFnName: "attemptConversationData",
  shapeName: "AttemptConversationData",
  dataFn: attemptConversationData,
  validate: validateConversationData,
  web: (props, ctx) => <AttemptConversationWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptConversationText(props.data, ctx),
});

// ───────────────────────── AttemptDiagnostics ─────────────────────────

/** DiagnosticRecord(src/runner/types.ts):`level` 是消息严重度,不是 verdict 的别名。 */
function diagnosticRecordProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a DiagnosticRecord { code, level, message, phase }`;
  if (typeof value.code !== "string") return `"${path}.code" must be a string`;
  if (value.level !== "warning" && value.level !== "error") return `"${path}.level" must be "warning" or "error"`;
  if (typeof value.message !== "string") return `"${path}.message" must be a string`;
  if (typeof value.phase !== "string") return `"${path}.phase" must be a string`;
  return null;
}

export function validateDiagnosticsData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  return arrayProblem(data.groups, "groups", (group, path) => {
    if (!isObject(group) || typeof group.phase !== "string") {
      return `"${path}" must be an object with a string "phase"`;
    }
    return arrayProblem(group.items, `${path}.items`, diagnosticRecordProblem);
  });
}

export const AttemptDiagnostics = makeAttemptComponent<AttemptDiagnosticsData>({
  name: "AttemptDiagnostics",
  dataFnName: "attemptDiagnosticsData",
  shapeName: "AttemptDiagnosticsData",
  dataFn: attemptDiagnosticsData,
  validate: validateDiagnosticsData,
  web: (props, ctx) => <AttemptDiagnosticsWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptDiagnosticsText(props.data, ctx),
});

// ───────────────────────── AttemptUsage ─────────────────────────

/** Usage(src/o11y/types.ts):cacheReadTokens / cacheWriteTokens / requests / costUSD 均可选。 */
function usageProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a Usage { inputTokens, outputTokens }`;
  if (typeof value.inputTokens !== "number") return `"${path}.inputTokens" must be a number`;
  if (typeof value.outputTokens !== "number") return `"${path}.outputTokens" must be a number`;
  return null;
}

export function validateUsageData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  const usageProb = usageProblem(data.usage, "usage");
  if (usageProb !== null) return usageProb;
  if (!(data.costUSD === null || typeof data.costUSD === "number")) return '"costUSD" must be a number or null';
  return null;
}

export const AttemptUsage = makeAttemptComponent<AttemptUsageData>({
  name: "AttemptUsage",
  dataFnName: "attemptUsageData",
  shapeName: "AttemptUsageData",
  dataFn: attemptUsageData,
  validate: validateUsageData,
  web: (props, ctx) => <AttemptUsageWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptUsageText(props.data, ctx),
});

// ───────────────────────── AttemptTrace ─────────────────────────

export function validateTraceData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  return arrayProblem(data.spans, "spans", traceSpanProblem);
}

export const AttemptTrace = makeAttemptComponent<AttemptTraceData>({
  name: "AttemptTrace",
  dataFnName: "attemptTraceData",
  shapeName: "AttemptTraceData",
  dataFn: attemptTraceData,
  validate: validateTraceData,
  web: (props, ctx) => <AttemptTraceWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptTraceText(props.data, ctx),
});

// ───────────────────────── AttemptDiff ─────────────────────────

const DIFF_FILE_NET = ["added", "modified", "deleted"];

/** AttemptDiffFileEntry(src/report/model/types.ts):`net` 恒 !== "none"(净无变化不进这份列表)。 */
function diffFileEntryProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptDiffFileEntry { path, net, lines, windows }`;
  if (typeof value.path !== "string") return `"${path}.path" must be a string`;
  if (typeof value.net !== "string" || !DIFF_FILE_NET.includes(value.net)) {
    return `"${path}.net" must be one of ${JSON.stringify(DIFF_FILE_NET)}`;
  }
  if (!isObject(value.lines) || typeof value.lines.added !== "number" || typeof value.lines.deleted !== "number") {
    return `"${path}.lines" must be an object { added, deleted }`;
  }
  if (!Array.isArray(value.windows)) return `"${path}.windows" must be an array`;
  return null;
}

export function validateDiffData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  return arrayProblem(data.files, "files", diffFileEntryProblem);
}

export const AttemptDiff = makeAttemptComponent<AttemptDiffData>({
  name: "AttemptDiff",
  dataFnName: "attemptDiffData",
  shapeName: "AttemptDiffData",
  dataFn: attemptDiffData,
  validate: validateDiffData,
  web: (props, ctx) => <AttemptDiffWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptDiffText(props.data, ctx),
});

// ───────────────────────── 两个普通组合组件 ─────────────────────────

/** source / assertions fallback:有 source 放 AttemptSource,否则放 AttemptAssertions。 */
export const AttemptAssessment = defineComponent((_props: Record<string, never>, ctx) => {
  if (ctx.page.input !== "attempt") {
    throw new Error(
      "AttemptAssessment requires an attempt-input page (input: \"attempt\") — it reads ctx.page.evidence to choose between AttemptSource and AttemptAssertions.",
    );
  }
  return (
    <Col>
      <AttemptError />
      {ctx.page.evidence.capabilities.source ? <AttemptSource /> : <AttemptAssertions />}
    </Col>
  );
});
AttemptAssessment.displayName = "AttemptAssessment";

/** 内建排列顺序;有 source 时回复已按 loc 展开在 AttemptSource 行内，不再重复一份 round 卡。 */
export const AttemptDetail = defineComponent((_props: Record<string, never>, ctx) => {
  const conversationLivesInSource =
    ctx.page.input === "attempt" && ctx.page.evidence.capabilities.source && ctx.page.evidence.evalSource !== null;
  return (
    <Col>
      <AttemptSummary />
      <AttemptAssessment />
      <AttemptFixPrompt />
      <AttemptTimeline />
      <AttemptDiagnostics />
      <AttemptUsage />
      {conversationLivesInSource ? null : <AttemptConversation />}
      <AttemptTrace />
      <AttemptDiff />
    </Col>
  );
});
AttemptDetail.displayName = "AttemptDetail";
