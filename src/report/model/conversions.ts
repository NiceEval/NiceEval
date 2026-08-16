import type {
  AnalysisIssue,
  AttemptEvidenceDomainView,
  AttemptObservabilityDomainView,
  EvidenceRef,
  FileChangesDomainView,
  MetricValue,
  Sample,
  SandboxHistoryDomainView,
  SourceNavigationDomainView,
  SourcesDomainView,
} from "../../analysis/index.ts";
import {
  attemptEvidenceView,
  attemptObservabilityView,
  fileChangesView,
  query,
  sandboxHistoryView,
  sourceNavigationView,
  sourcesView,
} from "../../analysis/index.ts";
import type { AttemptLocator } from "../../attempt-locator.ts";
import { formatMetricScalar, missingText } from "./format.ts";
import type { ReportLocale } from "./locale.ts";

/** A table-safe projection that still contains the original complete metric. */
export interface MetricDetailRow {
  readonly metric: MetricValue;
  readonly value: string;
  readonly state: MetricValue["state"];
  readonly samples: number;
  readonly total: number;
  readonly basis: MetricValue["basis"];
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}

/** Converts a metric for display without splitting it into a new statistical value. */
export function toMetricDetailRow(metric: MetricValue, locale?: ReportLocale): MetricDetailRow {
  const value = metric.value === null
    ? missingText("noSamples", locale)
    : formatMetricScalar(metric.value, metric.unit, metric.format, locale);
  return Object.freeze({
    metric,
    value,
    state: metric.state,
    samples: metric.samples,
    total: metric.total,
    basis: metric.basis,
    issues: metric.issues,
    refs: metric.refs,
  });
}

/** Closed Analysis issues become plain rows without suppressing linked evidence. */
export function toIssueRows(issues: readonly AnalysisIssue[]): readonly Readonly<{
  readonly code: string;
  readonly message: string;
  readonly evidence: string;
}>[] {
  return Object.freeze(issues.map((issue) => Object.freeze({
    code: issue.code,
    message: issue.message,
    evidence: issue.refs.map(evidenceRefText).join(", "),
  })));
}

/** Evidence references become readable rows while keeping their canonical identity text. */
export function toEvidenceRows(refs: readonly EvidenceRef[]): readonly Readonly<{
  readonly reference: string;
}>[] {
  return Object.freeze(refs.map((reference) => Object.freeze({ reference: evidenceRefText(reference) })));
}

/** One string for constrained text surfaces; it includes all references. */
export function toIssueText(issue: AnalysisIssue): string {
  const evidence = issue.refs.map(evidenceRefText).join(", ");
  return evidence === "" ? issue.message : `${issue.message} (${evidence})`;
}

/** Evidence identity is already closed by Analysis; Report only formats its locator. */
function evidenceRefText(reference: EvidenceRef): string {
  return reference.identity.locator;
}

/** Closes Assertions / Evidence through the one published Analysis DomainView. */
export function toAttemptEvidence(
  sample: Sample,
  locator?: AttemptLocator,
): Promise<AttemptEvidenceDomainView> {
  return query(sample, {
    kind: "domain-view",
    view: attemptEvidenceView,
    ...(locator === undefined ? {} : { locator }),
  });
}

/** Closes conversation, commands, usage, timing and diagnostics for selected Attempts. */
export function toAttemptObservability(
  sample: Sample,
  locator?: AttemptLocator,
): Promise<AttemptObservabilityDomainView> {
  return query(sample, {
    kind: "domain-view",
    view: attemptObservabilityView,
    ...(locator === undefined ? {} : { locator }),
  });
}

/** Closes the fixed Attempt file-change DomainView. */
export function toFileChanges(
  sample: Sample,
  locator?: AttemptLocator,
): Promise<FileChangesDomainView> {
  return query(sample, {
    kind: "domain-view",
    view: fileChangesView,
    ...(locator === undefined ? {} : { locator }),
  });
}

/** Closes exact physical send-to-source and send-to-timing navigation. */
export function toSourceNavigation(
  sample: Sample,
  locator?: AttemptLocator,
): Promise<SourceNavigationDomainView> {
  return query(sample, {
    kind: "domain-view",
    view: sourceNavigationView,
    ...(locator === undefined ? {} : { locator }),
  });
}

/** Closes the origin-Run Sources DomainView for selected Attempts. */
export function toSources(
  sample: Sample,
  locator?: AttemptLocator,
): Promise<SourcesDomainView> {
  return query(sample, {
    kind: "domain-view",
    view: sourcesView,
    ...(locator === undefined ? {} : { locator }),
  });
}

/** Closes sandbox-only command, timing and diagnostic history. */
export function toSandboxHistory(
  sample: Sample,
  locator?: AttemptLocator,
): Promise<SandboxHistoryDomainView> {
  return query(sample, {
    kind: "domain-view",
    view: sandboxHistoryView,
    ...(locator === undefined ? {} : { locator }),
  });
}
