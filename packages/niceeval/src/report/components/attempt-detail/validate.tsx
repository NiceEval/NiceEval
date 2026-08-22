// Attempt 详情 Content / Data 形状校验。
// 数据契约照 docs/feature/reports/library.md;这些不是持久化
// 格式,没有 format / schemaVersion 信封,兼容性跟随 npm 版本(组件消费 data 时校验
// 结构,不符按完整用户反馈报错并提示版本漂移)。

import { arrayProblem, isObject, type Validator } from "../../definition/primitives/shared.ts";

// ───────────────────────── 跨叶子复用的字段路径校验 ─────────────────────────

/** AttemptIdentityView(compute.ts):locator 派生自的不可变身份元组。 */
function attemptIdentityProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) {
    return `"${path}" must be an AttemptIdentityView { runId, evalId, attempt }`;
  }
  if (typeof value.runId !== "string") return `"${path}.runId" must be a string`;
  if (typeof value.evalId !== "string") return `"${path}.evalId" must be a string`;
  if (typeof value.attempt !== "number") return `"${path}.attempt" must be a number`;
  return null;
}

/** AttemptCapabilitiesView(compute.ts):四个证据切面开关。 */
function capabilitiesProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { source, execution, timing, diff }`;
  for (const key of ["source", "execution", "timing", "diff"] as const) {
    if (typeof value[key] !== "boolean") return `"${path}.${key}" must be a boolean`;
  }
  return null;
}

function assertionFactProblem(value: unknown, path: string): string | null {
  if (!isObject(value) || typeof value.kind !== "string") return `"${path}" must be a closed assertion fact`;
  switch (value.kind) {
    case "unavailable":
      return typeof value.reason === "string" ? null : `"${path}.reason" must be a string`;
    case "value":
      return value.value === null || typeof value.value === "string" || typeof value.value === "number" ||
          typeof value.value === "boolean"
        ? null
        : `"${path}.value" must be a JSON scalar`;
    case "text":
      return typeof value.text === "string" ? null : `"${path}.text" must be a string`;
    case "list":
      return arrayProblem(value.items, `${path}.items`, assertionFactProblem);
    case "fields":
      return arrayProblem(value.fields, `${path}.fields`, (field, fieldPath) => {
        if (!isObject(field) || typeof field.label !== "string") return `"${fieldPath}.label" must be a string`;
        return assertionFactProblem(field.value, `${fieldPath}.value`);
      });
    default:
      return `"${path}.kind" is unsupported`;
  }
}

function assertionEvidenceProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AssertionEvidenceContent object`;
  for (const key of ["source", "check", "observed", "expected", "explanation"] as const) {
    const problem = assertionFactProblem(value[key], `${path}.${key}`);
    if (problem !== null) return problem;
  }
  return null;
}

/** AttemptAssertionView(compute.ts):sealed 断言 entry 的展示投影。 */
function assertionViewProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptAssertionView object`;
  if (typeof value.entryId !== "string") return `"${path}.entryId" must be a string`;
  if (typeof value.name !== "string") return `"${path}.name" must be a string`;
  if (value.severity !== "gate" && value.severity !== "recorded" && value.severity !== "soft") {
    return `"${path}.severity" must be "gate" | "recorded" | "soft"`;
  }
  if (value.outcome !== "passed" && value.outcome !== "failed" && value.outcome !== "unavailable") {
    return `"${path}.outcome" must be "passed" | "failed" | "unavailable"`;
  }
  if (typeof value.detail !== "string") return `"${path}.detail" must be a string`;
  const evidenceProblem = assertionEvidenceProblem(value.evidence, `${path}.evidence`);
  if (evidenceProblem !== null) return evidenceProblem;
  if (!Array.isArray(value.groupPath) || !value.groupPath.every((segment: unknown) => typeof segment === "string")) {
    return `"${path}.groupPath" must be an array of strings`;
  }
  if (value.score !== undefined) {
    if (!isObject(value.score)) return `"${path}.score" must be an AttemptScoreView object`;
    if (value.score.state !== "earned" && value.score.state !== "unavailable") {
      return `"${path}.score.state" must be "earned" | "unavailable"`;
    }
    if (typeof value.score.points !== "number") return `"${path}.score.points" must be a number`;
    if (value.score.state === "earned" && typeof value.score.earned !== "number") {
      return `"${path}.score.earned" must be a number for an earned contribution`;
    }
    if (value.score.state === "unavailable" && value.score.earned !== undefined) {
      return `"${path}.score.earned" must be omitted for an unavailable contribution`;
    }
  }
  return null;
}

/** ClosedTraceCollection(src/analysis/domain-view.ts):collection 状态与限制清单。 */
function traceCollectionProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a ClosedTraceCollection object`;
  if (value.state !== "complete" && value.state !== "partial") return `"${path}.state" must be "complete" | "partial"`;
  if (!Array.isArray(value.limitations)) return `"${path}.limitations" must be an array`;
  return null;
}

// ───────────────────────── AttemptSummary(恒非空) ─────────────────────────

export function validateSummaryData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (typeof data.experimentId !== "string") return 'missing "experimentId" (string)';
  const identityProblem = attemptIdentityProblem(data.identity, "identity");
  if (identityProblem !== null) return identityProblem;
  const verdict = data.verdict;
  if (verdict !== "passed" && verdict !== "failed" && verdict !== "errored" && verdict !== "skipped" && verdict !== "unknown") {
    return '"verdict" must be passed | failed | errored | skipped | unknown';
  }
  if (data.startedAt !== undefined && typeof data.startedAt !== "string") return '"startedAt" must be a string';
  if (!(data.durationMs === null || typeof data.durationMs === "number")) return '"durationMs" must be a number or null';
  if (data.observedCostUSD !== undefined && typeof data.observedCostUSD !== "number") {
    return '"observedCostUSD" must be a number';
  }
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

/** `{ group, items: AttemptAssertionView[] }[]` 分组结构。 */
function assertionGroupsProblem(value: unknown, path: string): string | null {
  return arrayProblem(value, path, (group, groupPath) => {
    if (!isObject(group) || typeof group.group !== "string") {
      return `"${groupPath}" must be an object with a string "group"`;
    }
    return arrayProblem(group.items, `${groupPath}.items`, assertionViewProblem);
  });
}

/** AttemptAssertionsData 的得分点挣满计数。 */
function scorePointsEarnedProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { earned, total }`;
  if (typeof value.earned !== "number") return `"${path}.earned" must be a number`;
  if (typeof value.total !== "number") return `"${path}.total" must be a number`;
  return null;
}

export function validateAssertionsData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  const attentionProblem = arrayProblem(data.attention, "attention", assertionViewProblem);
  if (attentionProblem !== null) return attentionProblem;
  const passedGroupsProblem = assertionGroupsProblem(data.passedGroups, "passedGroups");
  if (passedGroupsProblem !== null) return passedGroupsProblem;
  if (data.scorePointsEarned !== undefined) {
    const problem = scorePointsEarnedProblem(data.scorePointsEarned, "scorePointsEarned");
    if (problem !== null) return problem;
  }
  if (data.totalScore !== undefined && typeof data.totalScore !== "number") return '"totalScore" must be a number';
  if (data.evaluationKind !== "pass" && data.evaluationKind !== "points") {
    return '"evaluationKind" must be "pass" | "points"';
  }
  return null;
}

// ───────────────────────── AttemptFixPrompt ─────────────────────────

export function validateFixPromptData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.prompt !== "string") return 'missing "prompt" (string)';
  return null;
}

// ───────────────────────── AttemptTimeline / AttemptTrace ─────────────────────────

/** ClosedTimingInterval(src/analysis/domain-view.ts):闭合 timing 区间。 */
function timingIntervalProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a ClosedTimingInterval object`;
  if (typeof value.intervalId !== "string") return `"${path}.intervalId" must be a string`;
  if (value.parentIntervalId !== null && typeof value.parentIntervalId !== "string") {
    return `"${path}.parentIntervalId" must be a string or null`;
  }
  if (typeof value.phase !== "string") return `"${path}.phase" must be a string`;
  if (typeof value.label !== "string") return `"${path}.label" must be a string`;
  if (typeof value.startOffsetMs !== "number") return `"${path}.startOffsetMs" must be a number`;
  if (typeof value.durationMs !== "number") return `"${path}.durationMs" must be a number`;
  if (typeof value.outcome !== "string") return `"${path}.outcome" must be a string`;
  return null;
}

function validateTimelineShape(data: unknown, kind: string): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  const collectionProblem = traceCollectionProblem(data.collection, "collection");
  if (collectionProblem !== null) return collectionProblem;
  return arrayProblem(data.intervals, kind, timingIntervalProblem);
}

export function validateTimelineData(data: unknown): string | null {
  return validateTimelineShape(data, "intervals");
}

export function validateTraceData(data: unknown): string | null {
  return validateTimelineShape(data, "intervals");
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

/** AttemptConversationReply(compute.ts):按 `kind` 判别的联合,每支自己的必填字段各自校验。 */
function conversationReplyProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptConversationReply object`;
  switch (value.kind) {
    case "assistant":
    case "user":
    case "thinking":
    case "error":
    case "compaction":
      if (typeof value.text !== "string") return `"${path}.text" must be a string`;
      return null;
    case "context":
      if (typeof value.text !== "string") return `"${path}.text" must be a string`;
      return null;
    case "tool":
      if (typeof value.callId !== "string") return `"${path}.callId" must be a string`;
      if (typeof value.name !== "string") return `"${path}.name" must be a string`;
      if (typeof value.inputSummary !== "string") return `"${path}.inputSummary" must be a string`;
      if (value.outputSummary !== undefined && typeof value.outputSummary !== "string") {
        return `"${path}.outputSummary" must be a string`;
      }
      if (value.failed !== undefined && typeof value.failed !== "boolean") return `"${path}.failed" must be a boolean`;
      return null;
    case "skill":
      if (typeof value.skill !== "string") return `"${path}.skill" must be a string`;
      if (value.text !== undefined && typeof value.text !== "string") return `"${path}.text" must be a string`;
      return null;
    case "subagent":
      if (typeof value.name !== "string") return `"${path}.name" must be a string`;
      if (typeof value.summary !== "string") return `"${path}.summary" must be a string`;
      return null;
    case "input":
      if (!isObject(value.request)) return `"${path}.request" must be an AttemptInputRequestView object`;
      if (typeof value.request.promptSummary !== "string") return `"${path}.request.promptSummary" must be a string`;
      return null;
    default:
      return `"${path}.kind" must be one of ${JSON.stringify(CONVERSATION_REPLY_KINDS)}`;
  }
}

function conversationRoundProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptConversationRound object`;
  if (typeof value.turnId !== "string") return `"${path}.turnId" must be a string`;
  if (typeof value.sequence !== "number") return `"${path}.sequence" must be a number`;
  if (value.outcome !== "completed" && value.outcome !== "failed" &&
    value.outcome !== "cancelled" && value.outcome !== "interrupted") {
    return `"${path}.outcome" must be completed | failed | cancelled | interrupted`;
  }
  return arrayProblem(value.replies, `${path}.replies`, conversationReplyProblem);
}

export function validateConversationData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  const collectionProblem = traceCollectionProblem(data.collection, "collection");
  if (collectionProblem !== null) return collectionProblem;
  return arrayProblem(data.rounds, "rounds", conversationRoundProblem);
}

/** AttemptCommandCard(compute.ts):闭合命令证据的展示卡。 */
function commandCardProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptCommandCard object`;
  if (typeof value.key !== "string") return `"${path}.key" must be a string`;
  if (typeof value.timingNodeId !== "string") return `"${path}.timingNodeId" must be a string`;
  if (typeof value.phase !== "string") return `"${path}.phase" must be a string`;
  if (typeof value.display !== "string") return `"${path}.display" must be a string`;
  if (typeof value.exitCode !== "number") return `"${path}.exitCode" must be a number`;
  if (value.classification !== "succeeded" && value.classification !== "observed" && value.classification !== "failed") {
    return `"${path}.classification" must be succeeded | observed | failed`;
  }
  if (value.stdout !== undefined && typeof value.stdout !== "string") return `"${path}.stdout" must be a string`;
  if (value.stderr !== undefined && typeof value.stderr !== "string") return `"${path}.stderr" must be a string`;
  return null;
}

export function validateCommandEvidenceData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  const collectionProblem = traceCollectionProblem(data.collection, "collection");
  if (collectionProblem !== null) return collectionProblem;
  return arrayProblem(data.commands, "commands", commandCardProblem);
}

// ───────────────────────── AttemptDiagnostics ─────────────────────────

function diagnosticViewProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an AttemptDiagnosticView object`;
  if (typeof value.code !== "string") return `"${path}.code" must be a string`;
  if (value.kind !== "advisory" && value.kind !== "execution-error") {
    return `"${path}.kind" must be "advisory" | "execution-error"`;
  }
  if (typeof value.phase !== "string") return `"${path}.phase" must be a string`;
  if (typeof value.summary !== "string") return `"${path}.summary" must be a string`;
  if (value.level !== "warning" && value.level !== "error") return `"${path}.level" must be "warning" | "error"`;
  return null;
}

export function validateDiagnosticsData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  const collectionProblem = traceCollectionProblem(data.collection, "collection");
  if (collectionProblem !== null) return collectionProblem;
  return arrayProblem(data.groups, "groups", (group, path) => {
    if (!isObject(group) || typeof group.phase !== "string") {
      return `"${path}" must be an object with a string "phase"`;
    }
    return arrayProblem(group.items, `${path}.items`, diagnosticViewProblem);
  });
}

// ───────────────────────── UsageTable ─────────────────────────

export function validateUsageData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (typeof data.experimentId !== "string") return 'missing "experimentId" (string)';
  if (typeof data.evalId !== "string") return 'missing "evalId" (string)';
  if (typeof data.attempt !== "number") return '"attempt" must be a number';
  const verdict = data.verdict;
  if (verdict !== "passed" && verdict !== "failed" && verdict !== "errored" && verdict !== "skipped" && verdict !== "unknown") {
    return '"verdict" must be passed | failed | errored | skipped | unknown';
  }
  if (data.turns !== undefined && typeof data.turns !== "number") return '"turns" must be a number';
  if (data.toolCalls !== undefined && typeof data.toolCalls !== "number") return '"toolCalls" must be a number';
  if (data.observations !== undefined) {
    const problem = arrayProblem(data.observations, "observations", (observation, path) => {
      if (!isObject(observation) || typeof observation.provider !== "string" || typeof observation.kind !== "string") {
        return `"${path}" must be a ClosedUsageObservation object`;
      }
      return null;
    });
    if (problem !== null) return problem;
  }
  if (data.observedCostUSD !== undefined && typeof data.observedCostUSD !== "number") {
    return '"observedCostUSD" must be a number';
  }
  return null;
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
  for (let i = 0; i < value.windows.length; i += 1) {
    const window = value.windows[i];
    if (!isObject(window) || typeof window.window !== "string") {
      return `"${path}.windows[${i}].window" must be a string`;
    }
    if (window.patch !== undefined && typeof window.patch !== "string") {
      return `"${path}.windows[${i}].patch" must be a string`;
    }
  }
  return null;
}

export function validateDiffData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (!isObject(data.collection) || typeof data.collection.state !== "string") {
    return '"collection" must be a ClosedFileChangesCollection object';
  }
  return arrayProblem(data.files, "files", diffFileEntryProblem);
}

// ───────────────────────── AttemptSource ─────────────────────────

export function validateSourceData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  const itemsProblem = arrayProblem(data.items, "items", (item, path) => {
    if (!isObject(item)) return `"${path}" must be an AttemptSourceItemView object`;
    if (typeof item.sourceItemId !== "string") return `"${path}.sourceItemId" must be a string`;
    if (typeof item.path !== "string") return `"${path}.path" must be a string`;
    if (typeof item.sha256 !== "string") return `"${path}.sha256" must be a string`;
    if (!Array.isArray(item.lines) || !item.lines.every((line: unknown) => typeof line === "string")) {
      return `"${path}.lines" must be an array of strings`;
    }
    if (item.unavailable !== undefined && item.unavailable !== "unavailable" && item.unavailable !== "binary") {
      return `"${path}.unavailable" must be "unavailable" | "binary"`;
    }
    return null;
  });
  if (itemsProblem !== null) return itemsProblem;
  const sitesProblem = arrayProblem(data.sites, "sites", (site, path) => {
    if (!isObject(site)) return `"${path}" must be an AttemptSourceSiteView object`;
    if (typeof site.entryId !== "string") return `"${path}.entryId" must be a string`;
    if (typeof site.role !== "string") return `"${path}.role" must be a string`;
    if (typeof site.sourceItemId !== "string") return `"${path}.sourceItemId" must be a string`;
    if (typeof site.startLine !== "number") return `"${path}.startLine" must be a number`;
    if (typeof site.endLine !== "number") return `"${path}.endLine" must be a number`;
    return null;
  });
  if (sitesProblem !== null) return sitesProblem;
  return arrayProblem(data.entries, "entries", assertionViewProblem);
}

export const attemptDetailValidators: Readonly<Record<string, Validator>> = Object.freeze({
  summary: validateSummaryData,
  error: validateErrorData,
  assertions: validateAssertionsData,
  fixPrompt: validateFixPromptData,
  timeline: validateTimelineData,
  trace: validateTraceData,
  conversation: validateConversationData,
  commandEvidence: validateCommandEvidenceData,
  diagnostics: validateDiagnosticsData,
  usage: validateUsageData,
  diff: validateDiffData,
  source: validateSourceData,
});
