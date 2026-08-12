// Format-neutral projections for sealed Assertion, Verdict, and Score data.
// Consumers must pass the exact attachment-derived values they hold; this
// module never reconstructs details from a historical result graph.

import type { Verdict } from "../shared/types.ts";

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

/** The portable fields required for a compact Assertion line. */
export interface CompactAssertionSummary {
  readonly title: string;
  readonly matcher?: string;
  readonly expected?: string;
  readonly received?: string;
  readonly reason?: string;
  readonly additionalFailures: number;
}

/** Compact feedback text for one sealed Assertion result. */
export function compactAssertionSummary(summary: CompactAssertionSummary): string {
  const parts = [summary.title];
  if (summary.matcher !== undefined) parts.push(summary.matcher);
  if (summary.expected !== undefined) parts.push(`expected ${summary.expected}`);
  if (summary.received !== undefined) parts.push(`received ${summary.received}`);
  if (summary.reason !== undefined) parts.push(`reason ${summary.reason}`);
  if (summary.additionalFailures > 0) parts.push(`+${summary.additionalFailures} more`);
  return parts.join(" · ");
}

/** Preserve Assertion identity while fitting a terminal feedback budget. */
export function fitCompactAssertionSummary(summary: CompactAssertionSummary, maxChars: number): string {
  const budget = Math.max(24, Math.floor(maxChars));
  let full = compactAssertionSummary(summary);
  if (full.length <= budget) return full;
  let fitted: CompactAssertionSummary = {
    ...summary,
    title: shrinkTo(summary.title, Math.max(24, summary.title.length - (full.length - budget))),
  };
  full = compactAssertionSummary(fitted);
  if (full.length <= budget) return full;
  if (fitted.matcher !== undefined) {
    fitted = { ...fitted, matcher: shrinkTo(fitted.matcher, Math.max(16, fitted.matcher.length - (full.length - budget))) };
    full = compactAssertionSummary(fitted);
    if (full.length <= budget) return full;
  }
  return shrinkTo(full, budget);
}

/** A compact, format-neutral projection of sealed evaluation data. */
export interface AssertionDisplaySummary {
  readonly text: string;
  readonly more: number;
}

/**
 * Result-only consumers can still report the durable Verdict and structured
 * execution reason. They intentionally cannot invent Assertion or Score
 * detail before their input is migrated to attachment projections.
 */
export function verdictDisplaySummary(input: {
  readonly verdict: Verdict;
  readonly error?: { readonly code: string; readonly message: string };
  readonly skipReason?: string;
}): AssertionDisplaySummary | undefined {
  if (input.verdict === "passed") return undefined;
  if (input.verdict === "errored" && input.error !== undefined) {
    return { text: summaryText(`${input.error.code} · ${input.error.message}`), more: 0 };
  }
  if (input.verdict === "skipped" && input.skipReason !== undefined) {
    return { text: summaryText(input.skipReason), more: 0 };
  }
  return { text: input.verdict, more: 0 };
}
