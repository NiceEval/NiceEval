/**
 * Explicit acceptance is a Record v1 reference-only producer. It deliberately
 * has no dependency on the retired result graph: locator resolution, planning
 * and write-session publication all operate on one frozen Record v1 view.
 */
import { Effect } from "effect";

import type { SandboxPlanningServices } from "../sandbox/plan.ts";
import {
  type AdoptionProjectInput,
  type AdoptionProject,
  type CurrentAdoptionTarget,
  ExplicitAdoptionError,
  type ExplicitAdoptionOpenError,
  type ExplicitAdoptionReadError,
  type ExplicitAdoptionMember,
  type ExplicitAdoptionRunPlan,
  type ExplicitAdoptionRunReceipt,
  type ResolvedAdoptionAttempt,
  adoptionRecordRoot,
  adoptionStartedAt,
  buildExplicitAdoptionRunPlan,
  commitExplicitAdoptionRunPlans,
  createExplicitAdoptionInvocationId,
  loadAdoptionProject,
  prepareCurrentAdoptionTarget,
  prepareExplicitAdoptionMember,
  resolveExplicitAttemptLocator,
  withAdoptionCommitScope,
  withAdoptionReader,
} from "./adoption.ts";
import type {
  Config,
  DiscoveredEval,
  DiscoveredExperiment,
} from "./types.ts";

export type AcceptFailureCode =
  | "malformed-locator"
  | "locator-not-found"
  | "accept-ineligible"
  | "duplicate-accept-member"
  | "planning-failed"
  | "batch-mismatch";

/** Compatibility adapter for the current CLI boundary only. */
export class AcceptError extends Error {
  readonly name = "AcceptError";

  constructor(
    readonly code: AcceptFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AcceptLocatorOptions {
  readonly cwd: string;
  readonly locator: string;
  readonly recordRoot?: string;
  readonly config?: Config;
  readonly evals?: readonly DiscoveredEval[];
  readonly experiments?: readonly DiscoveredExperiment[];
  readonly planningServices?: SandboxPlanningServices;
  readonly now?: () => string | number;
  /** Durable accepted-action context; never copied into the source Attempt. */
  readonly operatorReason?: string;
}

export interface AcceptLocatorsOptions extends Omit<AcceptLocatorOptions, "locator"> {
  readonly locators: readonly string[];
}

export interface AcceptedAttempt {
  readonly invocationId: string;
  readonly runId: string;
  readonly slotId: string;
  /** A reference has the source Attempt's exact locator; it never mints one. */
  readonly locator: string;
  readonly sourceLocator: string;
  readonly fingerprint: string;
}

export interface AcceptedAttemptPreview {
  readonly locator: string;
  readonly sourceLocator: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly fingerprint: string;
}

export interface AcceptPreflight {
  readonly groups: readonly AcceptPreflightGroup[];
}

/** All native Record v1 failures before/while the formal publication runs. */
export type AcceptNativeError =
  | ExplicitAdoptionOpenError;

interface AcceptPreflightGroup {
  readonly target: CurrentAdoptionTarget;
  readonly members: readonly ExplicitAdoptionMember[];
  readonly plan: ExplicitAdoptionRunPlan;
}

interface AcceptSourceGroup {
  readonly experimentId: string;
  readonly sources: readonly ResolvedAdoptionAttempt[];
}

function explicitError(
  code: ExplicitAdoptionError["code"],
  message: string,
): ExplicitAdoptionError {
  return new ExplicitAdoptionError(code, message);
}

function assertUniqueLocators(
  locators: readonly string[],
): Effect.Effect<void, ExplicitAdoptionError> {
  return Effect.sync(() => {
    const seen = new Set<string>();
    for (const locator of locators) {
      if (seen.has(locator)) {
        return false;
      }
      seen.add(locator);
    }
    return locators.length > 0;
  }).pipe(
    Effect.flatMap((valid) => valid
      ? Effect.void
      : Effect.fail(explicitError(
          locators.length === 0
            ? "adoption-target-invalid"
            : "adoption-batch-locator-duplicate",
          locators.length === 0
            ? "Explicit adoption requires at least one complete Attempt locator."
            : "One explicit adoption locator was supplied more than once.",
        ))),
  );
}

function groupAcceptSources(
  sources: readonly ResolvedAdoptionAttempt[],
): readonly AcceptSourceGroup[] {
  const grouped = new Map<string, ResolvedAdoptionAttempt[]>();
  for (const source of sources) {
    const group = grouped.get(source.originExperimentId);
    if (group === undefined) {
      grouped.set(source.originExperimentId, [source]);
    } else {
      group.push(source);
    }
  }
  return Object.freeze([...grouped.entries()].map(([experimentId, group]) => Object.freeze({
    experimentId,
    sources: Object.freeze(group),
  })));
}

/**
 * Shared frozen-reader preflight used by both dry and formal flows. The caller
 * supplies either a reader or the one write-session view; this keeps all
 * locators, source facts and target planning in one immutable Record view.
 */
function prepareAcceptPreflight(input: {
  readonly reader: Parameters<typeof resolveExplicitAttemptLocator>[0];
  readonly project: AdoptionProject;
  readonly locators: readonly string[];
  readonly startedAt: Parameters<typeof prepareCurrentAdoptionTarget>[0]["startedAt"];
  readonly operatorReason?: string;
}): Effect.Effect<AcceptPreflight, ExplicitAdoptionReadError> {
  return Effect.gen(function* () {
    yield* assertUniqueLocators(input.locators);
    const sources = yield* Effect.forEach(
      input.locators,
      (locator) => resolveExplicitAttemptLocator(input.reader, locator),
      { concurrency: 1 },
    );
    const groups = yield* Effect.forEach(
      groupAcceptSources(sources),
      (sourceGroup) => Effect.gen(function* () {
        const target = yield* prepareCurrentAdoptionTarget({
          project: input.project,
          experimentId: sourceGroup.experimentId,
          startedAt: input.startedAt,
        });
        const members = yield* Effect.forEach(
          sourceGroup.sources,
          (source) => prepareExplicitAdoptionMember({
            reader: input.reader,
            target,
            source,
            evalId: source.originEvalId,
            attempt: source.originAttempt,
            ...(input.operatorReason === undefined
              ? {}
              : { operatorReason: input.operatorReason }),
          }),
          { concurrency: 1 },
        );
        const plan = yield* buildExplicitAdoptionRunPlan({
          intent: "accept",
          target,
          members,
        });
        return Object.freeze({
          target,
          members: Object.freeze(members),
          plan,
        });
      }),
      // Physical planning can be costly; retain one complete target at a time.
      { concurrency: 1 },
    );
    return Object.freeze({ groups: Object.freeze(groups) });
  });
}

function projectAcceptPreview(
  preflight: AcceptPreflight,
): readonly AcceptedAttemptPreview[] {
  return Object.freeze(preflight.groups.flatMap((group) =>
    group.members.map((member) => Object.freeze({
      locator: member.locator,
      sourceLocator: member.locator,
      experimentId: group.target.experimentId,
      evalId: member.target.evalId,
      attempt: member.target.attempt,
      fingerprint: member.target.inputIdentity.value,
    }))));
}

function receiptsForAccept(input: {
  readonly invocationId: string;
  readonly locators: readonly string[];
  readonly preflight: AcceptPreflight;
  readonly receipts: readonly ExplicitAdoptionRunReceipt[];
}): Effect.Effect<readonly AcceptedAttempt[], ExplicitAdoptionError> {
  return Effect.gen(function* () {
    if (input.receipts.length !== input.preflight.groups.length) {
      return yield* Effect.fail(explicitError(
        "adoption-provenance-invalid",
        "Explicit adoption publication returned a receipt for an unexpected target Run set.",
      ));
    }
    const receiptsByExperiment = new Map<string, ExplicitAdoptionRunReceipt>();
    for (const receipt of input.receipts) {
      if (receiptsByExperiment.has(receipt.experimentId)) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          "Explicit adoption publication returned duplicate target-Experiment receipts.",
        ));
      }
      receiptsByExperiment.set(receipt.experimentId, receipt);
    }
    const byLocator = new Map<string, AcceptedAttempt>();
    for (const group of input.preflight.groups) {
      const receipt = receiptsByExperiment.get(group.target.experimentId);
      if (receipt === undefined || receipt.members.length !== group.members.length) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          "Explicit adoption publication returned incomplete Member receipts.",
        ));
      }
      const membersByLocator = new Map<string, ExplicitAdoptionRunReceipt["members"][number]>();
      for (const memberReceipt of receipt.members) {
        if (membersByLocator.has(memberReceipt.locator)) {
          return yield* Effect.fail(explicitError(
            "adoption-provenance-invalid",
            "Explicit adoption publication returned duplicate Member receipt locators.",
          ));
        }
        membersByLocator.set(memberReceipt.locator, memberReceipt);
      }
      for (const member of group.members) {
        const memberReceipt = membersByLocator.get(member.locator);
        if (
          memberReceipt === undefined ||
          memberReceipt.locator !== member.locator ||
          memberReceipt.slotId !== member.target.slotId ||
          memberReceipt.sourceRunId !== member.source.origin.runId ||
          memberReceipt.attemptId !== member.source.attempt.attemptId
        ) {
          return yield* Effect.fail(explicitError(
            "adoption-provenance-invalid",
            "Explicit adoption publication returned a Member receipt with mismatched identity provenance.",
          ));
        }
        if (byLocator.has(member.locator)) {
          return yield* Effect.fail(explicitError(
            "adoption-provenance-invalid",
            "Explicit adoption publication reused one locator across target Members.",
          ));
        }
        byLocator.set(member.locator, Object.freeze({
          invocationId: input.invocationId,
          runId: receipt.runId,
          slotId: memberReceipt.slotId,
          locator: member.locator,
          sourceLocator: member.locator,
          fingerprint: member.target.inputIdentity.value,
        }));
      }
      if (membersByLocator.size !== group.members.length) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          "Explicit adoption publication returned an unexpected Member receipt.",
        ));
      }
    }
    const ordered: AcceptedAttempt[] = [];
    for (const locator of input.locators) {
      const receipt = byLocator.get(locator);
      if (receipt === undefined) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          `Explicit adoption did not publish a receipt for locator "${locator}".`,
        ));
      }
      ordered.push(receipt);
    }
    return Object.freeze(ordered);
  });
}

function projectInput(input: AcceptLocatorsOptions): AdoptionProjectInput {
  return {
    cwd: input.cwd,
    ...(input.config === undefined ? {} : { config: input.config }),
    ...(input.evals === undefined ? {} : { evals: input.evals }),
    ...(input.experiments === undefined ? {} : { experiments: input.experiments }),
    ...(input.planningServices === undefined
      ? {}
      : { planningServices: input.planningServices }),
  };
}

/**
 * Effect-native, reader-only acceptance planning. It opens only the shared
 * reader lease and creates neither a writer lock nor a Run.
 */
export function planAcceptLocators(
  input: AcceptLocatorsOptions,
) {
  return Effect.gen(function* () {
    const root = yield* adoptionRecordRoot(input);
    const startedAt = yield* adoptionStartedAt(input.now);
    const project = yield* loadAdoptionProject(projectInput(input));
    const preflight = yield* withAdoptionReader({
      root,
      use: (reader) => prepareAcceptPreflight({
        reader,
        project,
        locators: input.locators,
        startedAt,
        ...(input.operatorReason === undefined
          ? {}
          : { operatorReason: input.operatorReason }),
      }),
    });
    return projectAcceptPreview(preflight);
  });
}

/**
 * Effect-native formal acceptance. A reader preflight happens first; then one
 * scoped Host read session repeats the entire preflight and publishes
 * reference-only target Runs through createReferenceRun.
 */
export function acceptLocators(
  input: AcceptLocatorsOptions,
) {
  return Effect.gen(function* () {
    const root = yield* adoptionRecordRoot(input);
    const startedAt = yield* adoptionStartedAt(input.now);
    const resolvedProjectInput = projectInput(input);
    const previewProject = yield* loadAdoptionProject(resolvedProjectInput);
    yield* withAdoptionReader({
      root,
      use: (reader) => prepareAcceptPreflight({
        reader,
        project: previewProject,
        locators: input.locators,
        startedAt,
        ...(input.operatorReason === undefined
          ? {}
          : { operatorReason: input.operatorReason }),
      }),
    });

    const invocationId = yield* createExplicitAdoptionInvocationId();
    return yield* withAdoptionCommitScope({
      root,
      use: (reader) => Effect.gen(function* () {
        // Discovery and target planning are deliberately refreshed while the
        // Host reader keeps SelectedAttemptRefs live for the reference write.
        const project = yield* loadAdoptionProject(resolvedProjectInput);
        const preflight = yield* prepareAcceptPreflight({
          reader,
          project,
          locators: input.locators,
          startedAt,
          ...(input.operatorReason === undefined
            ? {}
            : { operatorReason: input.operatorReason }),
        });
        const receipts = yield* commitExplicitAdoptionRunPlans(
          reader,
          root,
          preflight.groups.map((group) => group.plan),
        );
        return yield* receiptsForAccept({
          invocationId,
          locators: input.locators,
          preflight,
          receipts,
        });
      }),
    });
  });
}

/** One-item native convenience without reconstructing a legacy result object. */
export function acceptLocator(input: AcceptLocatorOptions) {
  return acceptLocators({ ...input, locators: [input.locator] }).pipe(
    Effect.flatMap((receipts) => {
      const [receipt] = receipts;
      return receipt === undefined
        ? Effect.fail(explicitError(
            "adoption-provenance-invalid",
            "Explicit adoption published no receipt for its requested locator.",
          ))
        : Effect.succeed(receipt);
    }),
  );
}
