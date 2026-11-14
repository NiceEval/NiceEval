// niceeval/expect：只导出纯 Match factories。Fact、verdict 与 score use 由 context 负责。

export { defineJudge, binaryJudge } from "../assertions/judge.ts";
export { defineAgentJudge } from "../assertions/agent-judge-definition.ts";
export type { AgentJudge, AgentJudgeDefinition, AgentJudgeReview } from "../assertions/agent-judge-definition.ts";
export type { JudgeAnchor, JudgeDefinition, JudgeOptions, BinaryJudgeOptions } from "../assertions/judge.ts";

export {
  and,
  atLeast,
  atMost,
  between,
  commandMatch,
  commandSucceeded,
  countWhere,
  defineScoreMatch,
  defineValueMatch,
  equals,
  eventMatch,
  excludes,
  filterWhere,
  greaterThan,
  includes,
  includesUrl,
  inOrder,
  isDefined,
  isFalse,
  isTrue,
  jsonMatch,
  hasSections,
  lessThan,
  matches,
  mapEach,
  mapValue,
  not,
  or,
  pattern,
  referencesAnyPath,
  satisfies,
  similarity,
  toolMatch,
} from "../assertions/match.ts";

export type {
  BooleanMatch,
  CollectionMatch,
  CollectionValue,
  CommandMatchOptions,
  EventMatch,
  EventOccurrenceMatch,
  EventOccurrenceQuantifiers,
  EventOccurrenceView,
  EventSequenceMatch,
  EventUpperBoundOccurrenceMatch,
  EventOptionsByType,
  LogicalCommandOccurrence,
  ManagedToolCalls,
  ManagedEventOccurrences,
  Match,
  MatchDomain,
  NumericComparisonMatch,
  TextMatchOptions,
  ToolMatch,
  ToolOccurrenceMatch,
  ToolSequenceMatch,
  ToolUpperBoundOccurrenceMatch,
  ToolMatchOptions,
  ToolOccurrenceQuantifiers,
  ToolOccurrenceView,
  ToolStatus,
  ValueMatch,
  ManagedScoreMatchOptions,
  ScoreMatch,
  ScoreMatchContext,
  ScoreMatchLlmFailure,
  ScoreMatchResult,
  ScoreMatchAnchor,
} from "../assertions/match.ts";

export { factuality, faithfulness, instructionFollowing, pairwisePreference } from "../assertions/judge-presets.ts";
export type {
  JudgePresetOptions,
  FactualityMaterial,
  FaithfulnessMaterial,
  InstructionFollowingMaterial,
  PairwisePreferenceMaterial,
} from "../assertions/judge-presets.ts";

export { defineMaterialMatch, defineContextMatch } from "../assertions/context-match.ts";
export type {
  MaterialMatch,
  ContextBooleanMatch,
  ContextScoreMatch,
  MatchContext,
  ReadonlyMaterial,
  MatchFact,
  MaterialCollection,
  MaterialItem,
  MaterialCaptureBudget,
  FactCaptureBudget,
} from "../assertions/context-match.ts";

export type { NumericMaterial } from "../assertions/match.ts";
export { measured, quantile } from "../assertions/measurements.ts";
export type { QuantileMethod, QuantileMaterial } from "../assertions/measurements.ts";

export type { EvalUsage, EvalCacheRead } from "../o11y/eval-usage.ts";
export type { CacheReadReport, CacheReadSummary } from "../o11y/cache-read.ts";

export type { AgentMatchContext } from "../context/assert-first.ts";

export { ms, seconds, tokens, usd, ratio, count, bytes } from "../assertions/quantity.ts";
export type { Quantity, Unit } from "../assertions/quantity.ts";
