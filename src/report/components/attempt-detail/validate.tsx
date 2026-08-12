// Attempt 详情 Content / Data 形状校验(供 validate.test 与组件共用)。
import { arrayProblem, isObject } from "../shared.ts";

// ───────────────────────── 跨叶子复用的字段路径校验 ─────────────────────────

/** SourceLoc(src/shared/types.ts):`t.send` / 断言在 eval 源码里的调用点。 */
function sourceLocProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a SourceLoc { file, line }`;
  if (typeof value.file !== "string") return `"${path}.file" must be a string`;
  if (typeof value.line !== "number") return `"${path}.line" must be a number`;
  return null;
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
    return `"${path}" must be an AttemptIdentity { runId, evalId, attempt }`;
  }
  if (typeof value.runId !== "string") return `"${path}.runId" must be a string`;
  if (typeof value.evalId !== "string") return `"${path}.evalId" must be a string`;
  if (typeof value.attempt !== "number") return `"${path}.attempt" must be a number`;
  return null;
}

/** Detail-data plan availability flags: four independently declared evidence views. */
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
  if (typeof data.experimentId !== "string") return 'missing "experimentId" (string)';
  const identityProblem = attemptIdentityProblem(data.identity, "identity");
  if (identityProblem !== null) return identityProblem;
  if (typeof data.verdict !== "string") return 'missing "verdict" (string)';
  if (typeof data.terminal !== "string") return 'missing "terminal" (string)';
  if (typeof data.durationMs !== "number") return '"durationMs" must be a number';
  if (!(data.costUSD === null || typeof data.costUSD === "number")) return '"costUSD" must be a number or null';
  if (data.score !== undefined) {
    const scoreProblem = attachmentEntryProblem(data.score, "score", scoreProjectionProblem);
    if (scoreProblem !== null) return scoreProblem;
  }
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

function assertionEntryProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an Assertion entry object`;
  if (value.state !== "available" && value.state !== "unsupported" && value.state !== "invalid") {
    return `"${path}.state" must be available, unsupported, or invalid`;
  }
  if (!isObject(value.entry)) return `"${path}.entry" must be an object`;
  if (typeof value.entry.entryId !== "string") return `"${path}.entry.entryId" must be a string`;
  if (!isObject(value.entry.display)) return `"${path}.entry.display" must be an object`;
  if (!Array.isArray(value.entry.display.groupPath)) return `"${path}.entry.display.groupPath" must be an array`;
  if (!isObject(value.entry.result) || typeof value.entry.result.state !== "string") {
    return `"${path}.entry.result.state" must be a string`;
  }
  if (value.state !== "available" && typeof value.reason !== "string") {
    return `"${path}.reason" must be a string`;
  }
  return null;
}

function scoreProjectionProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a Score projection object`;
  if (value.state === "complete") {
    if (typeof value.earned !== "number") return `"${path}.earned" must be a number`;
    if (value.comparable !== true) return `"${path}.comparable" must be true`;
    return null;
  }
  if (value.state === "partial") {
    if (typeof value.earned !== "number") return `"${path}.earned" must be a number`;
    if (!Array.isArray(value.reasons) || value.reasons.length === 0) return `"${path}.reasons" must be a non-empty array`;
    if (value.comparable !== false) return `"${path}.comparable" must be false`;
    return null;
  }
  if (value.state === "unavailable") {
    if (!Array.isArray(value.reasons) || value.reasons.length === 0) return `"${path}.reasons" must be a non-empty array`;
    if (value.comparable !== false) return `"${path}.comparable" must be false`;
    return null;
  }
  return `"${path}.state" must be complete, partial, or unavailable`;
}

type PathValidator = (value: unknown, path: string) => string | null;

function attachmentEntryProblem(
  value: unknown,
  path: string,
  available: PathValidator,
): string | null {
  if (!isObject(value)) return `"${path}" must be a projected Attempt slot`;
  if (value.state === "excluded" || value.state === "not-recorded" || value.state === "core-invalid") return null;
  if (value.state !== "attachment-result") {
    return `"${path}.state" must be an Attempt-slot projection state`;
  }
  if (!isObject(value.attachment)) return `"${path}.attachment" must be an object`;
  switch (value.attachment.state) {
    case "available":
      return available(value.attachment.value, `${path}.attachment.value`);
    case "unavailable":
      return null;
    case "migration-required":
      return typeof value.attachment.command === "string" ? null : `"${path}.attachment.command" must be a string`;
    case "migration-unavailable":
      return typeof value.attachment.reason === "string" ? null : `"${path}.attachment.reason" must be a string`;
    case "unsupported":
      return typeof value.attachment.schemaId === "string" ? null : `"${path}.attachment.schemaId" must be a string`;
    case "invalid":
      return Array.isArray(value.attachment.issues) ? null : `"${path}.attachment.issues" must be an array`;
    default:
      return `"${path}.attachment.state" must be a projected Attachment state`;
  }
}

function assertionEntriesProblem(value: unknown, path: string): string | null {
  return arrayProblem(value, path, assertionEntryProblem);
}

function verdictProblem(value: unknown, path: string): string | null {
  return value === "passed" || value === "failed" || value === "errored" || value === "skipped"
    ? null
    : `"${path}" must be a four-state Verdict`;
}

const ASSERTION_SOURCE_SITE_ROLES = new Set([
  "declaration",
  "threshold",
  "score",
  "gate",
  "optional",
  "stop",
]);

function assertionSourceSiteProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an Assertion source site object`;
  if (typeof value.entryId !== "string") return `"${path}.entryId" must be a string`;
  const locationProblem = sourceLocProblem(value.location, `${path}.location`);
  if (locationProblem !== null) return locationProblem;
  if (!Array.isArray(value.roles) || value.roles.length === 0) {
    return `"${path}.roles" must be a non-empty array`;
  }
  for (const [index, role] of value.roles.entries()) {
    if (typeof role !== "string" || !ASSERTION_SOURCE_SITE_ROLES.has(role)) {
      return `"${path}.roles[${index}]" must be a known Assertion source role`;
    }
  }
  return null;
}

export function validateAssertionsData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  const entriesProblem = attachmentEntryProblem(data.entries, "entries", assertionEntriesProblem);
  if (entriesProblem !== null) return entriesProblem;
  const verdictProjectionProblem = attachmentEntryProblem(data.verdict, "verdict", verdictProblem);
  if (verdictProjectionProblem !== null) return verdictProjectionProblem;
  if (data.score !== undefined) {
    const scoreProblem = attachmentEntryProblem(data.score, "score", scoreProjectionProblem);
    if (scoreProblem !== null) return scoreProblem;
  }
  return data.sites === undefined ? null : arrayProblem(data.sites, "sites", assertionSourceSiteProblem);
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
];

/**
 * AttemptConversationReply(src/report/model/types.ts):按 `kind` 判别的联合,每支自己的必填字段各自校验。
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
      if (typeof value.operationId !== "string") return `"${path}.operationId" must be a string`;
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
      if (typeof value.operationId !== "string") return `"${path}.operationId" must be a string`;
      if (typeof value.name !== "string") return `"${path}.name" must be a string`;
      return null;
    case "input":
      if (!isObject(value.request)) return `"${path}.request" must be an InputRequest object`;
      return null;
    case "compaction":
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

/** CommandExitEvidence(src/runner/types.ts) 的报告卡投影。 */
function commandEvidenceProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a CommandExitEvidence card`;
  if (typeof value.key !== "string") return `"${path}.key" must be a string`;
  if (typeof value.timingNodeId !== "string") return `"${path}.timingNodeId" must be a string`;
  if (typeof value.phase !== "string") return `"${path}.phase" must be a string`;
  if (typeof value.display !== "string") return `"${path}.display" must be a string`;
  if (typeof value.exitCode !== "number") return `"${path}.exitCode" must be a number`;
  if (value.classification !== "succeeded" && value.classification !== "observed" && value.classification !== "failed") {
    return `"${path}.classification" must be succeeded | observed | failed`;
  }
  if (value.durationMs !== undefined && typeof value.durationMs !== "number") return `"${path}.durationMs" must be a number`;
  if (typeof value.stdout !== "string") return `"${path}.stdout" must be a string`;
  if (typeof value.stderr !== "string") return `"${path}.stderr" must be a string`;
  return null;
}

export function validateConversationData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  const roundsProblem = arrayProblem(data.rounds, "rounds", conversationRoundProblem);
  if (roundsProblem !== null) return roundsProblem;
  return null;
}

export function validateCommandEvidenceData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  return arrayProblem(data.commands, "commands", commandEvidenceProblem);
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

const DIFF_FILE_CHANGE = ["added", "modified", "deleted"];

/** DiffFile(src/report/definition/primitives/diff-lines.ts):净无变化的文件不进这份列表。 */
function diffFileEntryProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a DiffFile { path, change, added, removed, windows }`;
  if (typeof value.path !== "string") return `"${path}.path" must be a string`;
  if (typeof value.change !== "string" || !DIFF_FILE_CHANGE.includes(value.change)) {
    return `"${path}.change" must be one of ${JSON.stringify(DIFF_FILE_CHANGE)}`;
  }
  if (typeof value.added !== "number" || typeof value.removed !== "number") {
    return `"${path}.added" and "${path}.removed" must be numbers`;
  }
  if (!Array.isArray(value.windows)) return `"${path}.windows" must be an array`;
  return null;
}

export function validateDiffData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  return arrayProblem(data.files, "files", diffFileEntryProblem);
}
