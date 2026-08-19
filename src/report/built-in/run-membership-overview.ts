/** The stable explicit-Run membership selector. */

import type {
  Sample,
  SampleSnapshot,
} from "../../analysis/index.ts";
import { query } from "../../analysis/index.ts";
import {
  runDiagnosticsView,
  type RunDiagnosticsDomainView,
} from "../../analysis/api.ts";
import { jsx } from "react/jsx-runtime";
import type { Page } from "../definition/report.ts";
import { type HeroData } from "../components/site-components/index.tsx";
import { toAttemptEvidence } from "../model/conversions.ts";
import {
  loadBuiltInSummaryRows,
  type BuiltInSummaryRows,
} from "./analysis-values.ts";
import {
  RunMembershipResultView,
  type MembershipRow,
  type RunErrorRow,
} from "./result-components.tsx";
import {
  builtInMachineProducerIds,
  defineBuiltInReport,
} from "./machine.ts";

interface RunMembershipPageInput {
  readonly hero: HeroData;
  readonly summary: BuiltInSummaryRows;
  readonly members: readonly MembershipRow[];
  readonly errors: readonly RunErrorRow[];
  readonly evidence: Awaited<ReturnType<typeof toAttemptEvidence>>;
}

function heroData(snapshot: SampleSnapshot): HeroData {
  const latest = snapshot.runs.reduce<number | null>(
    (current, run) => current === null || Number(run.startedAt) > current ? Number(run.startedAt) : current,
    null,
  );
  return Object.freeze({
    latestStartedAt: latest === null ? null : new Date(latest).toISOString(),
    runs: snapshot.runs.length,
  });
}

interface SharedBuildFailureDiagnostic {
  readonly schema: "niceeval.shared-build-failure/v1";
  readonly failureId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly phase: "sandbox.image.build";
  readonly errorCode: string;
  readonly message: string;
  readonly remediation?: "pnpm-allow-builds";
}

function sharedBuildFailure(summary: string): SharedBuildFailureDiagnostic | undefined {
  let value: unknown;
  try {
    value = JSON.parse(summary);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const item = value as Partial<SharedBuildFailureDiagnostic>;
  return item.schema === "niceeval.shared-build-failure/v1"
    && typeof item.failureId === "string"
    && typeof item.evalId === "string"
    && Number.isSafeInteger(item.attemptOrdinal)
    && item.phase === "sandbox.image.build"
    && typeof item.errorCode === "string"
    && typeof item.message === "string"
    && (item.remediation === undefined || item.remediation === "pnpm-allow-builds")
    ? item as SharedBuildFailureDiagnostic
    : undefined;
}

function failureBySlot(view: RunDiagnosticsDomainView): ReadonlyMap<string, SharedBuildFailureDiagnostic> {
  const failures = new Map<string, SharedBuildFailureDiagnostic>();
  for (const entry of view.entries) {
    if (entry.state !== "available") continue;
    for (const diagnostic of entry.detail.diagnostics) {
      if (diagnostic.code !== "sandbox-build-failed") continue;
      const failure = sharedBuildFailure(diagnostic.summary);
      if (failure !== undefined) {
        failures.set(`${entry.runId}\u0000${failure.evalId}\u0000${failure.attemptOrdinal}`, failure);
      }
    }
  }
  return failures;
}

function runErrorRows(view: RunDiagnosticsDomainView): readonly RunErrorRow[] {
  const groups = new Map<string, {
    readonly runId: string;
    readonly experimentId: string;
    readonly failure: SharedBuildFailureDiagnostic;
    readonly affected: string[];
  }>();
  for (const entry of view.entries) {
    if (entry.state !== "available") continue;
    for (const diagnostic of entry.detail.diagnostics) {
      if (diagnostic.code !== "sandbox-build-failed") continue;
      const failure = sharedBuildFailure(diagnostic.summary);
      if (failure === undefined) continue;
      const key = `${entry.runId}\u0000${failure.failureId}`;
      const group = groups.get(key);
      const affected = `${failure.evalId}#${failure.attemptOrdinal + 1}`;
      if (group === undefined) {
        groups.set(key, {
          runId: entry.runId,
          experimentId: entry.experimentId,
          failure,
          affected: [affected],
        });
      } else {
        group.affected.push(affected);
      }
    }
  }
  return Object.freeze([...groups.entries()].map(([key, group]) => Object.freeze({
    key,
    failure: group.failure.failureId,
    phase: group.failure.phase,
    affected: `${group.experimentId} · ${group.affected.join(", ")}`,
    error: group.failure.errorCode,
    message: group.failure.message,
    fix: group.failure.remediation === "pnpm-allow-builds"
      ? "Review these dependencies and configure pnpm allowBuilds."
      : null,
  })));
}

function membershipRows(
  snapshot: SampleSnapshot,
  diagnostics: RunDiagnosticsDomainView,
  evidence: Awaited<ReturnType<typeof toAttemptEvidence>>,
): readonly MembershipRow[] {
  const failures = failureBySlot(diagnostics);
  const outcomes = new Map(evidence.entries.flatMap((entry) =>
    entry.state === "available" ? [[entry.attempt.locator, entry.detail.outcome] as const] : []
  ));
  return Object.freeze(snapshot.slots.map((slot) => Object.freeze({
    key: `${slot.runId}:${slot.slotId}`,
    experiment: String(slot.experimentId),
    eval: String(slot.evalId),
    attempt: slot.attemptOrdinal,
    selectedRun: String(slot.runId),
    slot: String(slot.slotId),
    state: slot.state === "included" ? slot.action : slot.state === "not-recorded" ? slot.action ?? slot.state : slot.state,
    relation: slot.state === "included" ? slot.relation : null,
    locator: slot.state === "included" ? slot.attempt.locator : null,
    outcome: slot.state === "included" ? outcomes.get(slot.attempt.locator) ?? null : null,
    phase: null,
    error: null,
    sharedFailure: null,
    ...(() => {
      const failure = failures.get(`${slot.runId}\u0000${slot.evalId}\u0000${slot.attemptOrdinal}`);
      return failure === undefined ? {} : {
        outcome: "errored",
        phase: failure.phase,
        error: failure.errorCode,
        sharedFailure: failure.failureId,
      };
    })(),
  })));
}

const runMembershipPage = {
  id: "run-membership",
  path: "/",
  title: "Run results",
  load: async (sample: Sample): Promise<RunMembershipPageInput> => {
    const [summary, evidence, diagnostics] = await Promise.all([
      loadBuiltInSummaryRows(sample),
      toAttemptEvidence(sample),
      query(sample, { kind: "domain-view", view: runDiagnosticsView }),
    ]);
    return Object.freeze({
      hero: heroData(sample.snapshot),
      summary,
      members: membershipRows(sample.snapshot, diagnostics, evidence),
      errors: runErrorRows(diagnostics),
      evidence,
    });
  },
  render: (input: RunMembershipPageInput) => jsx(RunMembershipResultView, input),
} satisfies Page<void, RunMembershipPageInput>;

/** The bounded default for explicit historical Run selectors. */
export function runMembershipOverviewReport() {
  return defineBuiltInReport(builtInMachineProducerIds.runMembershipOverview, {
    title: "Run results",
    pages: [runMembershipPage],
  });
}

/** The CLI default Report for one or more explicit `--run` selectors. */
export const defaultRunMembershipOverviewReport = runMembershipOverviewReport();

export default defaultRunMembershipOverviewReport;
