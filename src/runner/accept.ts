/**
 * Explicit acceptance is a Record v1 reference-only producer. It deliberately
 * has no dependency on the retired result graph: locator resolution, planning
 * and write-session publication all operate on one frozen Record v1 view.
 */
import { Effect } from "effect";

import type { SandboxPlanningServices } from "../sandbox/plan.ts";
import {
  type AdoptionProjectInputV1,
  type AdoptionProjectV1,
  type CurrentAdoptionTargetV1,
  ExplicitAdoptionErrorV1,
  type ExplicitAdoptionOpenErrorV1,
  type ExplicitAdoptionReadErrorV1,
  type ExplicitAdoptionMemberV1,
  type ExplicitAdoptionRunPlanV1,
  type ExplicitAdoptionRunReceiptV1,
  type ResolvedAdoptionAttemptV1,
  adoptionRecordRootV1,
  adoptionStartedAtV1,
  buildExplicitAdoptionRunPlanV1,
  commitExplicitAdoptionRunPlansV1,
  createExplicitAdoptionInvocationIdV1,
  loadAdoptionProjectV1,
  mapExplicitAdoptionCommitFailureV1,
  prepareCurrentAdoptionTargetV1,
  prepareExplicitAdoptionMemberV1,
  resolveExplicitAttemptLocatorV1,
  withAdoptionReaderV1,
  withAdoptionWriteSessionV1,
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

export interface AcceptedAttemptPreviewV1 {
  readonly locator: string;
  readonly sourceLocator: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly fingerprint: string;
}

export interface AcceptPreflightV1 {
  readonly groups: readonly AcceptPreflightGroupV1[];
}

/** All native Record v1 failures before/while the formal publication runs. */
export type AcceptNativeErrorV1 =
  | ExplicitAdoptionOpenErrorV1;

interface AcceptPreflightGroupV1 {
  readonly target: CurrentAdoptionTargetV1;
  readonly members: readonly ExplicitAdoptionMemberV1[];
  readonly plan: ExplicitAdoptionRunPlanV1;
}

interface AcceptSourceGroupV1 {
  readonly experimentId: string;
  readonly sources: readonly ResolvedAdoptionAttemptV1[];
}

function explicitError(
  code: ExplicitAdoptionErrorV1["code"],
  message: string,
): ExplicitAdoptionErrorV1 {
  return new ExplicitAdoptionErrorV1(code, message);
}

function assertUniqueLocatorsV1(
  locators: readonly string[],
): Effect.Effect<void, ExplicitAdoptionErrorV1> {
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

function groupAcceptSourcesV1(
  sources: readonly ResolvedAdoptionAttemptV1[],
): readonly AcceptSourceGroupV1[] {
  const grouped = new Map<string, ResolvedAdoptionAttemptV1[]>();
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
function prepareAcceptPreflightV1(input: {
  readonly view: Parameters<typeof resolveExplicitAttemptLocatorV1>[0];
  readonly project: AdoptionProjectV1;
  readonly locators: readonly string[];
  readonly startedAt: Parameters<typeof prepareCurrentAdoptionTargetV1>[0]["startedAt"];
  readonly operatorReason?: string;
}): Effect.Effect<AcceptPreflightV1, ExplicitAdoptionReadErrorV1> {
  return Effect.gen(function* () {
    yield* assertUniqueLocatorsV1(input.locators);
    const sources = yield* Effect.forEach(
      input.locators,
      (locator) => resolveExplicitAttemptLocatorV1(input.view, locator),
      { concurrency: 1 },
    );
    const groups = yield* Effect.forEach(
      groupAcceptSourcesV1(sources),
      (sourceGroup) => Effect.gen(function* () {
        const target = yield* prepareCurrentAdoptionTargetV1({
          project: input.project,
          experimentId: sourceGroup.experimentId,
          startedAt: input.startedAt,
        });
        const members = yield* Effect.forEach(
          sourceGroup.sources,
          (source) => prepareExplicitAdoptionMemberV1({
            view: input.view,
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
        const plan = yield* buildExplicitAdoptionRunPlanV1({
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

function projectAcceptPreviewV1(
  preflight: AcceptPreflightV1,
): readonly AcceptedAttemptPreviewV1[] {
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

function receiptsForAcceptV1(input: {
  readonly invocationId: string;
  readonly locators: readonly string[];
  readonly preflight: AcceptPreflightV1;
  readonly receipts: readonly ExplicitAdoptionRunReceiptV1[];
}): Effect.Effect<readonly AcceptedAttempt[], ExplicitAdoptionErrorV1> {
  return Effect.gen(function* () {
    if (input.receipts.length !== input.preflight.groups.length) {
      return yield* Effect.fail(explicitError(
        "adoption-provenance-invalid",
        "Explicit adoption publication returned a receipt for an unexpected target Run set.",
      ));
    }
    const byLocator = new Map<string, AcceptedAttempt>();
    for (const [groupIndex, group] of input.preflight.groups.entries()) {
      const receipt = input.receipts[groupIndex];
      if (receipt === undefined || receipt.members.length !== group.members.length) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          "Explicit adoption publication returned incomplete Member receipts.",
        ));
      }
      for (const [memberIndex, member] of group.members.entries()) {
        const memberReceipt = receipt.members[memberIndex];
        if (memberReceipt === undefined) {
          return yield* Effect.fail(explicitError(
            "adoption-provenance-invalid",
            "Explicit adoption publication omitted an accepted Member receipt.",
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

function projectInputV1(input: AcceptLocatorsOptions): AdoptionProjectInputV1 {
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
export function planAcceptLocatorsV1(
  input: AcceptLocatorsOptions,
) {
  return Effect.gen(function* () {
    const root = yield* adoptionRecordRootV1(input);
    const startedAt = yield* adoptionStartedAtV1(input.now);
    const project = yield* loadAdoptionProjectV1(projectInputV1(input));
    const preflight = yield* withAdoptionReaderV1({
      root,
      use: (view) => prepareAcceptPreflightV1({
        view,
        project,
        locators: input.locators,
        startedAt,
        ...(input.operatorReason === undefined
          ? {}
          : { operatorReason: input.operatorReason }),
      }),
    });
    return projectAcceptPreviewV1(preflight);
  });
}

/**
 * Effect-native formal acceptance. A reader preflight happens first; then one
 * scoped RecordWriteSession freezes a second view, repeats the entire
 * preflight, and only then publishes reference-only target Runs.
 */
export function acceptLocatorsV1(
  input: AcceptLocatorsOptions,
) {
  return Effect.gen(function* () {
    const root = yield* adoptionRecordRootV1(input);
    const startedAt = yield* adoptionStartedAtV1(input.now);
    const projectInput = projectInputV1(input);
    const previewProject = yield* loadAdoptionProjectV1(projectInput);
    yield* withAdoptionReaderV1({
      root,
      use: (view) => prepareAcceptPreflightV1({
        view,
        project: previewProject,
        locators: input.locators,
        startedAt,
        ...(input.operatorReason === undefined
          ? {}
          : { operatorReason: input.operatorReason }),
      }),
    });

    const invocationId = yield* createExplicitAdoptionInvocationIdV1();
    return yield* withAdoptionWriteSessionV1({
      root,
      use: (session) => Effect.gen(function* () {
        // Discovery and target planning are deliberately refreshed while the
        // writer lock owns this frozen Record view.
        const project = yield* loadAdoptionProjectV1(projectInput);
        const preflight = yield* prepareAcceptPreflightV1({
          view: session.view,
          project,
          locators: input.locators,
          startedAt,
          ...(input.operatorReason === undefined
            ? {}
            : { operatorReason: input.operatorReason }),
        });
        const receipts = yield* commitExplicitAdoptionRunPlansV1(
          session,
          preflight.groups.map((group) => group.plan),
        ).pipe(Effect.mapError(mapExplicitAdoptionCommitFailureV1));
        return yield* receiptsForAcceptV1({
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
export function acceptLocatorV1(input: AcceptLocatorOptions) {
  return acceptLocatorsV1({ ...input, locators: [input.locator] }).pipe(
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

function acceptCompatibilityCode(error: ExplicitAdoptionErrorV1): AcceptFailureCode {
  switch (error.code) {
    case "adoption-locator-malformed":
      return "malformed-locator";
    case "adoption-locator-not-found":
    case "adoption-locator-ambiguous":
      return "locator-not-found";
    case "adoption-batch-locator-duplicate":
    case "adoption-target-member-duplicate":
      return "duplicate-accept-member";
    case "adoption-target-planning-failed":
    case "adoption-target-experiment-not-found":
      return "planning-failed";
    case "adoption-source-verdict-ineligible":
    case "adoption-source-eligibility-unavailable":
    case "adoption-source-verdict-unavailable":
    case "adoption-duration-domain-mismatch":
    case "adoption-timeout-exceeded":
      return "accept-ineligible";
    default:
      return "batch-mismatch";
  }
}

function withAcceptCompatibility<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.mapError((error) => error instanceof ExplicitAdoptionErrorV1
      ? new AcceptError(acceptCompatibilityCode(error), error.message)
      : error),
  );
}

/** Current CLI compatibility adapter; it is intentionally the outermost layer. */
export function acceptLocators(input: AcceptLocatorsOptions) {
  return withAcceptCompatibility(acceptLocatorsV1(input));
}

export function acceptLocator(input: AcceptLocatorOptions) {
  return withAcceptCompatibility(acceptLocatorV1(input));
}
