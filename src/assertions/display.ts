// Fact/use display projections shared by CLI, report, and feedback surfaces.

import type {
  EvaluationFactResult,
  PrimaryFactSummary,
  ScoreFactAttemptOutcome,
  ScoreFactUseResult,
  VerdictFactUseResult,
} from "./types.ts";

const SUMMARY_TEXT_MAX_CHARS = 240;

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001B(?:\[[0-9;:?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\))/g;
// eslint-disable-next-line no-control-regex
const OTHER_CONTROL = /[\u0000-\u0008\u000B\u000E-\u001F\u007F-\u009F]/g;

/** Strip terminal control bytes before rendering captured evidence. */
export function stripControl(value: string): string {
  return value.replace(ANSI_ESCAPE, "").replace(OTHER_CONTROL, "");
}

/** A bounded single-line rendering of captured material. */
export function summaryText(value: string): string {
  const singleLine = stripControl(value).replace(/\s+/g, " ").trim();
  return singleLine.length <= SUMMARY_TEXT_MAX_CHARS
    ? singleLine
    : `${singleLine.slice(0, SUMMARY_TEXT_MAX_CHARS - 1)}…`;
}

function shrinkTo(text: string, target: number): string {
  return text.length <= target ? text : `${text.slice(0, Math.max(0, target - 1))}…`;
}

/** Compact feedback text for one causal Fact/use. */
export function compactFactSummary(summary: PrimaryFactSummary): string {
  const parts = [summary.title];
  if (summary.matcher !== undefined) parts.push(summary.matcher);
  if (summary.expected !== undefined) parts.push(`expected ${summary.expected}`);
  if (summary.received !== undefined) parts.push(`received ${summary.received}`);
  if (summary.reason !== undefined) parts.push(`reason ${summary.reason}`);
  if (summary.additionalFailures > 0) parts.push(`+${summary.additionalFailures} more`);
  return parts.join(" · ");
}

/** Preserve the Fact/use identity while fitting a terminal feedback budget. */
export function fitCompactFactSummary(summary: PrimaryFactSummary, maxChars: number): string {
  const budget = Math.max(24, Math.floor(maxChars));
  let full = compactFactSummary(summary);
  if (full.length <= budget) return full;
  let fitted: PrimaryFactSummary = {
    ...summary,
    title: shrinkTo(summary.title, Math.max(24, summary.title.length - (full.length - budget))),
  };
  full = compactFactSummary(fitted);
  if (full.length <= budget) return full;
  if (fitted.matcher !== undefined) {
    fitted = { ...fitted, matcher: shrinkTo(fitted.matcher, Math.max(16, fitted.matcher.length - (full.length - budget))) };
    full = compactFactSummary(fitted);
    if (full.length <= budget) return full;
  }
  return shrinkTo(full, budget);
}

/** A compact, format-neutral projection of a native Fact/use graph. */
export interface FactDisplaySummary {
  readonly text: string;
  readonly more: number;
}

type FactUse = VerdictFactUseResult | ScoreFactUseResult;

function factUseId(use: FactUse): string | undefined {
  return use.useKind === "verdict"
    ? use.target.factId
    : use.input.kind === "fact"
      ? use.input.factId
      : undefined;
}

function factUseTitle(use: FactUse): string {
  return use.useKind === "score" ? use.label : use.label ?? use.key ?? use.method;
}

function factUseDetail(use: FactUse): string | undefined {
  if (use.outcome === "errored") return `${use.error.code}: ${summaryText(use.error.message)}`;
  if (use.outcome === "unavailable" || use.outcome === "notApplicable" || use.outcome.startsWith("notReached")) {
    return summaryText((use as { readonly reason: string }).reason);
  }
  return undefined;
}

/**
 * One-line summary shared by report lists, `show --history`, and CLI history.
 * Every phrase names a Fact, a use, or the score terminal in the graph.
 */
export function factDisplaySummary(input: {
  readonly factResults: readonly EvaluationFactResult[];
  readonly factUses: readonly FactUse[];
  readonly scoreResult?: ScoreFactAttemptOutcome;
}): FactDisplaySummary | undefined {
  const score = input.scoreResult;
  if (score !== undefined && score.status !== "scored") {
    const first = score.status === "errored"
      ? score.errors[0]?.error.message ?? score.issues[0]?.reason
      : score.status === "invalid" || score.status === "unavailable"
        ? score.issues[0]?.kind === "error"
          ? score.issues[0].error.message
          : score.issues[0]?.reason
        : score.reason;
    const count = score.status === "errored"
      ? score.errors.length + score.issues.length
      : score.status === "invalid" || score.status === "unavailable"
        ? score.issues.length
        : 1;
    return {
      text: summaryText([
        score.status,
        `earned ${score.earnedScore}`,
        `credited ${score.creditedScore === null ? "unavailable" : score.creditedScore}`,
        first,
      ].filter((part): part is string => part !== undefined).join(" · ")),
      more: Math.max(0, count - 1),
    };
  }

  const problemUses = input.factUses
    .filter((use) => use.outcome !== "passed" && use.outcome !== "scored" && use.outcome !== "notApplicable")
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
  if (problemUses.length > 0) {
    const first = problemUses[0]!;
    return {
      text: summaryText([factUseTitle(first), first.outcome, factUseDetail(first)].filter((part): part is string => part !== undefined).join(" · ")),
      more: problemUses.length - 1,
    };
  }

  const consumed = new Set(input.factUses.map(factUseId).filter((id): id is string => id !== undefined));
  const problemFacts = input.factResults
    .filter((fact) => consumed.has(fact.factId) && (fact.outcome === "unavailable" || fact.outcome === "errored" || fact.outcome.startsWith("notReached")))
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
  if (problemFacts.length > 0) {
    const first = problemFacts[0]!;
    const detail = first.outcome === "errored"
      ? `${first.error.code}: ${first.error.message}`
      : (first as { readonly reason: string }).reason;
    return { text: summaryText([first.name, first.outcome, detail].join(" · ")), more: problemFacts.length - 1 };
  }

  if (score?.status === "scored") {
    return { text: summaryText(`scored · earned ${score.earnedScore} · credited ${score.creditedScore}`), more: 0 };
  }

  const successfulScores = input.factResults
    .flatMap((fact) => fact.factKind === "score" && fact.outcome === "scored" && consumed.has(fact.factId) ? [fact] : [])
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
  if (successfulScores.length === 0) return undefined;
  const first = successfulScores[0]!;
  return { text: summaryText(`${first.name} · score ${first.normalizedScore}`), more: successfulScores.length - 1 };
}
