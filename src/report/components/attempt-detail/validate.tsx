// Attempt 详情 Content / Data 形状校验(供 validate.test 与组件共用)。
import { arrayProblem, isObject, type Validator } from "../shared.ts";

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

/** AttemptIdentity(src/record/locator.ts):locator 派生自的不可变身份元组。 */
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

/** AttemptEvidenceCapabilities(src/record/attempt-evidence.ts):四个证据切面开关。 */
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
  if (data.totalScore !== undefined && typeof data.totalScore !== "number") return '"totalScore" must be a number';
  return capabilitiesProblem(data.capabilities, "capabilities");
}


// ───────────────────────── AttemptError ─────────────────────────

export function validateErrorData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.code !== "string") return '"code" must be a string';
  if (typeof data.message !== "string") return '"message" must be a string';
  if (typeof data.phase !== "string") return '"phase" must be a string';
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (data.commandEvidenceHint !== undefined && data.commandEvidenceHint !== true) {
    return '"commandEvidenceHint" must be true or omitted';
  }
  return null;
}


// ───────────────────────── AttemptAssertions ─────────────────────────

/** ScoreEntry(src/scoring/types.ts):t.score(label, n) 的直接给分记录。 */
function scoreEntryProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a ScoreEntry { label, points }`;
  if (typeof value.label !== "string") return `"${path}.label" must be a string`;
  if (typeof value.points !== "number") return `"${path}.points" must be a number`;
  return null;
}

/** `{ group, items: ScoreEntry[] }[]` 分组结构;AttemptAssertionsData.scoreEntries 与
 *  AttemptSourceData.unmappedScoreEntries 共用同一套算法(groupByPath)与同一份校验。 */
function scoreEntryGroupsProblem(value: unknown, path: string): string | null {
  return arrayProblem(value, path, (group, groupPath) => {
    if (!isObject(group) || typeof group.group !== "string") {
      return `"${groupPath}" must be an object with a string "group"`;
    }
    return arrayProblem(group.items, `${groupPath}.items`, scoreEntryProblem);
  });
}

/** `{ group, items: AssertionResult[] }[]` 分组结构;AttemptAssertionsData.passedGroups 与
 *  AttemptSourceData.passedGroups 共用同一套算法(groupByPath)与同一份校验。 */
function assertionGroupsProblem(value: unknown, path: string): string | null {
  return arrayProblem(value, path, (group, groupPath) => {
    if (!isObject(group) || typeof group.group !== "string") {
      return `"${groupPath}" must be an object with a string "group"`;
    }
    return arrayProblem(group.items, `${groupPath}.items`, assertionResultProblem);
  });
}

/** 得分点挣满计数;AttemptAssertionsData 与 AttemptSourceData 共用同一条判据(源码不可用时
 *  换成 AttemptAssertions「规则完全一致」,见 docs/feature/reports/show/attempt.md)。 */
function scorePointsEarnedProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { earned, total }`;
  if (typeof value.earned !== "number") return `"${path}.earned" must be a number`;
  if (typeof value.total !== "number") return `"${path}.total" must be a number`;
  return null;
}

export function validateAssertionsData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  const attentionProblem = arrayProblem(data.attention, "attention", assertionResultProblem);
  if (attentionProblem !== null) return attentionProblem;
  const passedGroupsProblem = assertionGroupsProblem(data.passedGroups, "passedGroups");
  if (passedGroupsProblem !== null) return passedGroupsProblem;
  if (data.scoreEntries !== undefined) {
    const scoreEntriesProblem = scoreEntryGroupsProblem(data.scoreEntries, "scoreEntries");
    if (scoreEntriesProblem !== null) return scoreEntriesProblem;
  }
  if (data.scorePointsEarned === undefined) return null;
  return scorePointsEarnedProblem(data.scorePointsEarned, "scorePointsEarned");
}


// ───────────────────────── AttemptSource ─────────────────────────

/** AnnotatedSourceLine(src/record/annotated-source.ts):一行源码 + 映射到这一行的断言 / send 标注。 */
function annotatedSourceLineProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptSourceLineData { line, text, assertions, sends, turns }`;
  if (typeof value.line !== "number") return `"${path}.line" must be a number`;
  if (typeof value.text !== "string") return `"${path}.text" must be a string`;
  const assertionsProblem = arrayProblem(value.assertions, `${path}.assertions`, assertionResultProblem);
  if (assertionsProblem !== null) return assertionsProblem;
  if (!Array.isArray(value.sends)) return `"${path}.sends" must be an array`;
  const turnsProblem = arrayProblem(value.turns, `${path}.turns`, sourceTurnProblem);
  if (turnsProblem !== null) return turnsProblem;
  const scoreEntriesProblem = arrayProblem(value.scoreEntries, `${path}.scoreEntries`, scoreEntryProblem);
  if (scoreEntriesProblem !== null) return scoreEntriesProblem;
  if (value.aborted !== undefined && value.aborted !== true) return `"${path}.aborted" must be true or omitted`;
  if (value.unreached !== undefined && value.unreached !== true) return `"${path}.unreached" must be true or omitted`;
  return null;
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

/** AnnotatedEvalSourceSummary(src/record/annotated-source.ts):全是计数字段。 */
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
  const passedGroupsProblem = assertionGroupsProblem(data.passedGroups, "passedGroups");
  if (passedGroupsProblem !== null) return passedGroupsProblem;
  if (data.unmappedScoreEntries !== undefined) {
    const unmappedScoreEntriesProblem = scoreEntryGroupsProblem(data.unmappedScoreEntries, "unmappedScoreEntries");
    if (unmappedScoreEntriesProblem !== null) return unmappedScoreEntriesProblem;
  }
  const turnsProblem = arrayProblem(data.unlocatedTurns, "unlocatedTurns", sourceTurnProblem);
  if (turnsProblem !== null) return turnsProblem;
  const summaryProblem = sourceSummaryProblem(data.summary, "summary");
  if (summaryProblem !== null) return summaryProblem;
  if (data.scorePointsEarned === undefined) return null;
  return scorePointsEarnedProblem(data.scorePointsEarned, "scorePointsEarned");
}


// ───────────────────────── AttemptFixPrompt ─────────────────────────

export function validateFixPromptData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.prompt !== "string") return 'missing "prompt" (string)';
  return null;
}


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


// ───────────────────────── AttemptConversation ─────────────────────────

const CONVERSATION_REPLY_KINDS = [
  "assistant",
  "user",
  "thinking",
  "error",
  "tool",
  "skill",
  "context",
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
    case "context":
      if (typeof value.text !== "string") return `"${path}.text" must be a string`;
      if (value.source !== undefined && typeof value.source !== "string") return `"${path}.source" must be a string`;
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

/** FailedCommandEvidence(src/runner/types.ts):commands.json 的一条落盘记录。 */
function failedCommandEvidenceProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a FailedCommandEvidence { timingNodeId, phase, display, exitCode, stdout, stderr }`;
  if (typeof value.timingNodeId !== "string") return `"${path}.timingNodeId" must be a string`;
  if (typeof value.phase !== "string") return `"${path}.phase" must be a string`;
  if (typeof value.display !== "string") return `"${path}.display" must be a string`;
  if (typeof value.exitCode !== "number") return `"${path}.exitCode" must be a number`;
  if (typeof value.stdout !== "string") return `"${path}.stdout" must be a string`;
  if (typeof value.stderr !== "string") return `"${path}.stderr" must be a string`;
  return null;
}

export function validateConversationData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  const roundsProblem = arrayProblem(data.rounds, "rounds", conversationRoundProblem);
  if (roundsProblem !== null) return roundsProblem;
  if (data.failedCommands === undefined) return null;
  return arrayProblem(data.failedCommands, "failedCommands", failedCommandEvidenceProblem);
}


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


// ───────────────────────── UsageTable ─────────────────────────

/** Usage(落盘形状,src/types.ts):每个字段只在协议真实提供时存在,不校验必填。 */
function usageProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a Usage object`;
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheCreationTokens",
    "reasoningTokens",
    "requests",
    "costUSD",
  ] as const) {
    if (value[key] !== undefined && typeof value[key] !== "number") return `"${path}.${key}" must be a number`;
  }
  return null;
}

export function validateUsageData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (typeof data.experimentId !== "string") return 'missing "experimentId" (string)';
  if (typeof data.evalId !== "string") return 'missing "evalId" (string)';
  if (typeof data.attempt !== "number") return '"attempt" must be a number';
  if (typeof data.verdict !== "string") return 'missing "verdict" (string)';
  if (data.turns !== undefined && typeof data.turns !== "number") return '"turns" must be a number';
  if (data.toolCalls !== undefined && typeof data.toolCalls !== "number") return '"toolCalls" must be a number';
  if (data.usage !== undefined) {
    const usageProb = usageProblem(data.usage, "usage");
    if (usageProb !== null) return usageProb;
  }
  if (data.estimatedCostUSD !== undefined && typeof data.estimatedCostUSD !== "number") {
    return '"estimatedCostUSD" must be a number';
  }
  return null;
}

// ───────────────────────── AttemptTrace ─────────────────────────

export function validateTraceData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  return arrayProblem(data.spans, "spans", traceSpanProblem);
}


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


