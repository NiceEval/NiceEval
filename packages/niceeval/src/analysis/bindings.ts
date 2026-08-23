import { Effect, Either } from "effect";
import { foldRecordedAttemptVerdict } from "../eval/record/verdict.ts";
import type {
  RecordAttachmentBlobs,
  RecordAttachmentPayloadSnapshot,
  RecordBlobRef,
} from "../record/attachment/types.ts";
import type { AssertionsAttachment } from "../record/family/assertions/definition.ts";
import {
  agentTurnsRecordFamily,
  assertionsRecordFamily,
  attemptRunnerActivitiesRecordFamily,
  fileChangesRecordFamily,
  sandboxCommandsRecordFamily,
  sourcesRecordFamily,
} from "../record/family/catalog.ts";
import type { AgentTurnsAttachment } from "../record/family/agent-turns/definition.ts";
import type { FileChangesAttachment } from "../record/family/file-changes.ts";
import type { AttemptRunnerActivitiesAttachment } from "../record/family/runner-activities/definition.ts";
import type { AttemptRunnerDiagnosticsAttachment } from "../record/family/runner-diagnostics/definition.ts";
import type { SandboxCommandsAttachment } from "../record/family/sandbox-commands/definition.ts";
import type { SourcesAttachment } from "../record/family/sources.ts";
import type { TurnContextsAttachment } from "../record/family/turn-contexts/definition.ts";
import type {
  FixedFamilyRead,
  ReadableAttempt,
  RecordReadSession,
  SelectedOwnerRef,
} from "../record/host/types.ts";
import type { SourceNavigationRelation } from "../record/host/source-navigation-relation.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type {
  JsonValue,
} from "./contracts.ts";
import type {
  AttemptEvidenceDomainDetail,
  AttemptObservabilityDomainDetail,
  BuiltinDomainDetail,
  BuiltinDomainViewKind,
  ClosedAttemptCore,
  ClosedAssertionObserved,
  ClosedAssertionFactValue,
  ClosedBlobContent,
  ClosedCommandInvocation,
  ClosedCommandOutcome,
  ClosedCommandStream,
  ClosedCommandWorkingDirectory,
  ClosedCommandsDetail,
  ClosedConversationDetail,
  ClosedConversationItem,
  ClosedDiagnosticsDetail,
  ClosedFileChangesCollectionLimitation,
  ClosedTimingDetail,
  ClosedTraceCollection,
  ClosedSourceDependency,
  ClosedUsageDetail,
  FileChangesDomainDetail,
  SandboxHistoryDomainDetail,
  SourceNavigationDomainDetail,
  SourcesDomainDetail,
} from "./domain-view.ts";
import {
  projectFileChangesDomainDetail,
} from "./file-changes.ts";
import type {
  FileChangesProjectionInput,
} from "./file-changes.ts";
import type { LogicalSlot } from "./definitions.ts";

/**
 * The closed catalog's only owner routes.  `origin-run` deliberately means
 * the owner capability verified on ReadableAttempt.origin, never a new
 * selection or a guessed Run id.
 */
export type FixedFamilyOwnerRequirement = "attempt" | "origin-run";

type ReaderSourceState<Payload> =
  | Readonly<{
      readonly state: "complete" | "partial";
      readonly limitations: readonly unknown[];
      readonly value: RecordAttachmentPayloadSnapshot<Payload>;
    }>
  | Readonly<{
      readonly state: "not-recorded" | "migration-required" | "unsupported" | "invalid";
    }>;

/** Logical fields assembled by Analysis from source receipts; never durable. */
interface AttemptObservabilityReaderView {
  readonly agentTurns: ReaderSourceState<AgentTurnsAttachment>;
  readonly turnContexts: ReaderSourceState<TurnContextsAttachment>;
  readonly sandboxCommands: ReaderSourceState<SandboxCommandsAttachment>;
  readonly runnerActivities: ReaderSourceState<AttemptRunnerActivitiesAttachment>;
  readonly runnerDiagnostics: ReaderSourceState<AttemptRunnerDiagnosticsAttachment>;
}

interface SandboxHistoryReaderView {
  readonly sandboxCommands: ReaderSourceState<SandboxCommandsAttachment>;
  readonly runnerActivities: ReaderSourceState<AttemptRunnerActivitiesAttachment>;
  readonly runnerDiagnostics: ReaderSourceState<AttemptRunnerDiagnosticsAttachment>;
}

/** Fact relation assembled from Turn Contexts, Runner Activities, and origin Sources; never durable. */
interface SourceNavigationReaderView {
  readonly relation: ReaderSourceState<SourceNavigationRelation>;
  readonly turnContexts: ReaderSourceState<TurnContextsAttachment>;
  readonly runnerActivities: ReaderSourceState<AttemptRunnerActivitiesAttachment>;
  readonly originSources: ReaderSourceState<SourcesAttachment>;
}

/**
 * Static only: each binding retains an exact declaration-owned descriptor or
 * an explicit reader-side view identity. There is no runtime family lookup or
 * field-token surface.
 */
export interface RecordReadBinding<
  Owner extends FixedFamilyOwnerRequirement,
  Payload,
> {
  readonly owner: Owner;
  /** Exact fixed descriptor or an explicit reader-side view identity. */
  readonly cacheKey: object;
  readonly read: (
    reader: RecordReadSession,
    attempt: ReadableAttempt,
  ) => import("effect").Effect.Effect<FixedFamilyRead<Payload>, import("../record/reader/errors.ts").RecordReaderReadError>;
}

export type InputProjection<Value> =
  | { readonly state: "value"; readonly value: Value }
  | {
      readonly state: "missing" | "migration-required" | "unsupported" | "failed";
      readonly message: string;
    };

/** One semantic input owns an immutable owner/source requirement and projector. */
export interface PublishedAnalysisInputBinding<
  Value,
  Payload,
  Source extends RecordReadBinding<FixedFamilyOwnerRequirement, Payload>,
> {
  readonly id: string;
  readonly source: Source;
  readonly project: (input: {
    readonly member: LogicalSlot;
    /** Closed with the successful ReadableAttempt resolution. */
    readonly core: ClosedAttemptCore;
    readonly payload: RecordAttachmentPayloadSnapshot<Payload>;
  }) => InputProjection<Value>;
}

/** One static DomainView binding; detail closes before reaching Report. */
export interface BuiltinDomainViewBinding<
  Kind extends BuiltinDomainViewKind,
  Payload,
  Source extends RecordReadBinding<FixedFamilyOwnerRequirement, Payload>,
> {
  readonly id: string;
  readonly kind: Kind;
  readonly source: Source;
  readonly project: (input: {
    /** Closed with the successful ReadableAttempt resolution, never exposed as a capability. */
    readonly core: ClosedAttemptCore;
    readonly payload: RecordAttachmentPayloadSnapshot<Payload>;
    readonly blobs: RecordAttachmentBlobs;
  }) => BuiltinDomainDetail<Kind>;
}

type DomainBindingPayload<Binding extends AnyBuiltinDomainViewBinding> =
  Binding extends BuiltinDomainViewBinding<BuiltinDomainViewKind, infer Payload, any>
    ? Payload
    : never;

type DomainBindingSource<Binding extends AnyBuiltinDomainViewBinding> =
  Binding extends BuiltinDomainViewBinding<BuiltinDomainViewKind, any, infer Source>
    ? Source
    : never;

function fixedFamilyBinding<
  Owner extends FixedFamilyOwnerRequirement,
  Payload,
  Descriptor extends {
    readonly family: string;
    readonly owner: "attempt" | "run";
  },
>(input: {
  readonly owner: Owner;
  readonly descriptor: Descriptor;
  readonly read: (
    reader: RecordReadSession,
    owner: SelectedOwnerRef,
  ) => Effect.Effect<FixedFamilyRead<Payload>, RecordReaderReadError>;
}): RecordReadBinding<Owner, Payload> {
  return Object.freeze({
    owner: input.owner,
    cacheKey: input.descriptor,
    read: (reader: RecordReadSession, attempt: ReadableAttempt) => input.read(
      reader,
      input.owner === "attempt" ? attempt.owner : attempt.origin.owner,
    ),
  });
}

function readerSideViewBinding<Owner extends FixedFamilyOwnerRequirement, Payload>(input: {
  readonly owner: Owner;
  readonly cacheKey: object;
  readonly read: RecordReadBinding<Owner, Payload>["read"];
}): RecordReadBinding<Owner, Payload> {
  return Object.freeze({ ...input });
}

const assertionsFamily = fixedFamilyBinding({
  owner: "attempt" as const,
  descriptor: assertionsRecordFamily,
  read: (reader, owner) => reader.readAssertions(owner),
});

export const agentTurnsSource = fixedFamilyBinding({
  owner: "attempt" as const,
  descriptor: agentTurnsRecordFamily,
  read: (reader, owner) => reader.readAgentTurns(owner),
});

const sandboxCommandsSource = fixedFamilyBinding({
  owner: "attempt" as const,
  descriptor: sandboxCommandsRecordFamily,
  read: (reader, owner) => reader.readSandboxCommands(owner),
});

const attemptRunnerActivitiesSource = fixedFamilyBinding({
  owner: "attempt" as const,
  descriptor: attemptRunnerActivitiesRecordFamily,
  read: (reader, owner) => reader.readAttemptRunnerActivities(owner),
});

const fileChangesFamily = fixedFamilyBinding({
  owner: "attempt" as const,
  descriptor: fileChangesRecordFamily,
  read: (reader, owner) => reader.readFileChanges(owner),
});

const attemptObservabilityViewKey = Object.freeze({ kind: "reader-side-attempt-observability" });
const attemptObservabilityViewSource = readerSideViewBinding<"attempt", AttemptObservabilityReaderView>({
  owner: "attempt" as const,
  cacheKey: attemptObservabilityViewKey,
  read: readAttemptObservabilityView,
});

const sandboxHistoryViewKey = Object.freeze({ kind: "reader-side-sandbox-history" });
const sandboxHistoryViewSource = readerSideViewBinding<"attempt", SandboxHistoryReaderView>({
  owner: "attempt" as const,
  cacheKey: sandboxHistoryViewKey,
  read: readSandboxHistoryView,
});

const sourceNavigationViewKey = Object.freeze({ kind: "reader-side-source-navigation" });
const sourceNavigationViewSource = readerSideViewBinding<"attempt", SourceNavigationReaderView>({
  owner: "attempt" as const,
  cacheKey: sourceNavigationViewKey,
  read: readSourceNavigationView,
});

const originSourcesFamily = fixedFamilyBinding({
  owner: "origin-run" as const,
  descriptor: sourcesRecordFamily,
  read: (reader, owner) => reader.readSources(owner),
});

const emptyRecordBlobs: RecordAttachmentBlobs = Object.freeze({
  refs: () => Object.freeze([]),
  bytes: (_ref: RecordBlobRef) => Either.left(Object.freeze({ code: "record-blob-handle-invalid" as const })),
});

function receiptSourceState<Payload extends {
  readonly collection: {
    readonly state: "complete" | "partial";
    readonly limitations: readonly unknown[];
  };
}>(read: FixedFamilyRead<Payload>): ReaderSourceState<Payload> {
  if (read.state !== "available") return Object.freeze({ state: read.state });
  return Object.freeze({
    state: read.value.collection.state,
    limitations: Object.freeze([...read.value.collection.limitations]),
    value: read.value,
  });
}

function completeSourceState<Payload>(read: FixedFamilyRead<Payload>): ReaderSourceState<Payload> {
  if (read.state !== "available") return Object.freeze({ state: read.state });
  return Object.freeze({
    state: "complete" as const,
    limitations: Object.freeze([]),
    value: read.value,
  });
}

function readAttemptObservabilityView(
  reader: RecordReadSession,
  attempt: ReadableAttempt,
): Effect.Effect<FixedFamilyRead<AttemptObservabilityReaderView>, RecordReaderReadError> {
  return Effect.gen(function* () {
    const owner = attempt.owner;
    const turns = yield* reader.readAgentTurns(owner);
    const contexts = yield* reader.readTurnContexts(owner);
    const commands = yield* reader.readSandboxCommands(owner);
    const activities = yield* reader.readAttemptRunnerActivities(owner);
    const diagnostics = yield* reader.readAttemptRunnerDiagnostics(owner);

    return Object.freeze({
      state: "available" as const,
      value: Object.freeze({
        agentTurns: receiptSourceState(turns),
        turnContexts: receiptSourceState(contexts),
        sandboxCommands: receiptSourceState(commands),
        runnerActivities: receiptSourceState(activities),
        runnerDiagnostics: receiptSourceState(diagnostics),
      }),
      blobs: commands.state === "available" ? commands.blobs : emptyRecordBlobs,
    });
  });
}

function readSandboxHistoryView(
  reader: RecordReadSession,
  attempt: ReadableAttempt,
): Effect.Effect<FixedFamilyRead<SandboxHistoryReaderView>, RecordReaderReadError> {
  return Effect.gen(function* () {
    const owner = attempt.owner;
    const commands = yield* reader.readSandboxCommands(owner);
    const activities = yield* reader.readAttemptRunnerActivities(owner);
    const diagnostics = yield* reader.readAttemptRunnerDiagnostics(owner);
    return Object.freeze({
      state: "available" as const,
      value: Object.freeze({
        sandboxCommands: receiptSourceState(commands),
        runnerActivities: receiptSourceState(activities),
        runnerDiagnostics: receiptSourceState(diagnostics),
      }),
      blobs: commands.state === "available" ? commands.blobs : emptyRecordBlobs,
    });
  });
}

function readSourceNavigationView(
  reader: RecordReadSession,
  attempt: ReadableAttempt,
): Effect.Effect<FixedFamilyRead<SourceNavigationReaderView>, RecordReaderReadError> {
  return Effect.gen(function* () {
    const relation = yield* reader.readSourceNavigationRelation(attempt.owner);
    const contexts = yield* reader.readTurnContexts(attempt.owner);
    const activities = yield* reader.readAttemptRunnerActivities(attempt.owner);
    const sources = yield* reader.readSources(attempt.origin.owner);
    return Object.freeze({
      state: "available" as const,
      value: Object.freeze({
        relation: receiptSourceState(relation),
        turnContexts: receiptSourceState(contexts),
        runnerActivities: receiptSourceState(activities),
        originSources: completeSourceState(sources),
      }),
      blobs: emptyRecordBlobs,
    });
  });
}

/** The complete published input catalog; ids are semantic, never schema ids. */
export const publishedAnalysisInputBindings = Object.freeze({
  attemptPassed: Object.freeze({
    id: "niceeval.attempt-passed",
    source: assertionsFamily,
    project: ({ core, payload }: {
      readonly member: LogicalSlot;
      readonly core: ClosedAttemptCore;
      readonly payload: RecordAttachmentPayloadSnapshot<AssertionsAttachment>;
    }): InputProjection<boolean> => {
      const verdict = foldRecordedAttemptVerdict({ outcome: core.outcome, assertions: payload });
      return Object.freeze({ state: "value" as const, value: verdict === "passed" });
    },
  }),
  attemptLatencyMs: Object.freeze({
    id: "niceeval.attempt-latency-ms",
    source: attemptRunnerActivitiesSource,
    project: ({ payload }: {
      readonly member: LogicalSlot;
      readonly core: ClosedAttemptCore;
      readonly payload: RecordAttachmentPayloadSnapshot<AttemptRunnerActivitiesAttachment>;
    }): InputProjection<number> => {
      if (payload.collection.state !== "complete") {
        return collectionProjection(payload.collection, "activity", "activity collection is incomplete");
      }
      const activities = payload.segments.filter((activity) => activity.phase === "eval.run");
      if (activities.length === 0) {
        return Object.freeze({ state: "value" as const, value: 0 });
      }
      return Object.freeze({
        state: "value" as const,
        value: activities.reduce((total, activity) => total + activity.durationMs, 0),
      });
    },
  }),
  /**
   * The final token reading is `inputTokens + outputTokens`. It keeps that
   * exact, non-overlapping pair from Agent Turn usage observations: cache buckets
   * are separately accounted input and reasoning is already included in the
   * output bucket, so neither belongs in this total.
   */
  attemptTokens: Object.freeze({
    id: "niceeval.attempt-input-output-tokens",
    source: agentTurnsSource,
    project: ({ payload }: {
      readonly member: LogicalSlot;
      readonly core: ClosedAttemptCore;
      readonly payload: RecordAttachmentPayloadSnapshot<AgentTurnsAttachment>;
    }): InputProjection<number> => {
      if (payload.collection.state !== "complete") {
        return collectionProjection(payload.collection, "usage-observation", "usage collection is incomplete");
      }
      const observations = payload.segments.flatMap((segment) => segment.usage);
      let input = 0;
      let output = 0;
      let hasInput = false;
      let hasOutput = false;
      for (const observation of observations) {
        if (observation.kind !== "token-bucket") continue;
        if (observation.bucket === "input") {
          input += observation.tokens;
          hasInput = true;
        } else if (observation.bucket === "output") {
          output += observation.tokens;
          hasOutput = true;
        }
      }
      if (!hasInput && !hasOutput && observations.every((observation) => observation.kind !== "token-bucket")) {
        return Object.freeze({ state: "value" as const, value: 0 });
      }
      if (!hasInput || !hasOutput) {
        return Object.freeze({
          state: "missing" as const,
          message: "recorded usage does not contain both input and output token buckets",
        });
      }
      const total = input + output;
      if (!Number.isSafeInteger(total)) {
        return Object.freeze({
          state: "failed" as const,
          message: "recorded input plus output tokens exceed the safe integer range",
        });
      }
      return Object.freeze({ state: "value" as const, value: total });
    },
  }),
  attemptToolFailure: Object.freeze({
    id: "niceeval.attempt-tool-failure",
    source: sandboxCommandsSource,
    project: ({ payload }: {
      readonly member: LogicalSlot;
      readonly core: ClosedAttemptCore;
      readonly payload: RecordAttachmentPayloadSnapshot<SandboxCommandsAttachment>;
    }): InputProjection<boolean> => {
      const failed = payload.segments.some((segment) =>
        segment.outcome.kind !== "exited" || segment.outcome.exitCode !== 0
      );
      if (failed) return Object.freeze({ state: "value" as const, value: true });
      if (payload.collection.state === "complete") {
        return Object.freeze({ state: "value" as const, value: false });
      }
      return collectionProjection(payload.collection, "command", "command collection is incomplete");
    },
  }),
});

export const attemptEvidenceDomainBinding = Object.freeze({
  id: "niceeval.domain.attempt-evidence",
  kind: "attempt-evidence" as const,
  source: assertionsFamily,
  project: ({ core, payload, blobs }: {
    readonly core: ClosedAttemptCore;
    readonly payload: RecordAttachmentPayloadSnapshot<AssertionsAttachment>;
    readonly blobs: RecordAttachmentBlobs;
  }): AttemptEvidenceDomainDetail => closeAssertions(core, payload, blobs),
}) satisfies BuiltinDomainViewBinding<
  "attempt-evidence",
  AssertionsAttachment,
  typeof assertionsFamily
>;

export const attemptObservabilityDomainBinding = Object.freeze({
  id: "niceeval.domain.attempt-observability",
  kind: "attempt-observability" as const,
  source: attemptObservabilityViewSource,
  project: ({ payload, blobs }: {
    readonly payload: RecordAttachmentPayloadSnapshot<AttemptObservabilityReaderView>;
    readonly blobs: RecordAttachmentBlobs;
  }): AttemptObservabilityDomainDetail => closeObservability(payload, blobs),
}) satisfies BuiltinDomainViewBinding<
  "attempt-observability",
  AttemptObservabilityReaderView,
  typeof attemptObservabilityViewSource
>;

export const fileChangesDomainBinding = Object.freeze({
  id: "niceeval.domain.file-changes",
  kind: "file-changes" as const,
  source: fileChangesFamily,
  project: ({ payload, blobs }: {
    readonly payload: RecordAttachmentPayloadSnapshot<FileChangesAttachment>;
    readonly blobs: RecordAttachmentBlobs;
  }): FileChangesDomainDetail => closeFileChanges(payload, blobs),
}) satisfies BuiltinDomainViewBinding<
  "file-changes",
  FileChangesAttachment,
  typeof fileChangesFamily
>;

export const sourceNavigationDomainBinding = Object.freeze({
  id: "niceeval.domain.source-navigation",
  kind: "source-navigation" as const,
  source: sourceNavigationViewSource,
  project: ({ payload }: {
    readonly payload: RecordAttachmentPayloadSnapshot<SourceNavigationReaderView>;
    readonly blobs: RecordAttachmentBlobs;
  }): SourceNavigationDomainDetail => closeSourceNavigation(payload),
}) satisfies BuiltinDomainViewBinding<
  "source-navigation",
  SourceNavigationReaderView,
  typeof sourceNavigationViewSource
>;

export const sourcesDomainBinding = Object.freeze({
  id: "niceeval.domain.sources",
  kind: "sources" as const,
  source: originSourcesFamily,
  project: ({ payload, blobs }: {
    readonly payload: RecordAttachmentPayloadSnapshot<SourcesAttachment>;
    readonly blobs: RecordAttachmentBlobs;
  }): SourcesDomainDetail => closeSources(payload, blobs),
}) satisfies BuiltinDomainViewBinding<
  "sources",
  SourcesAttachment,
  typeof originSourcesFamily
>;

export const sandboxHistoryDomainBinding = Object.freeze({
  id: "niceeval.domain.sandbox-history",
  kind: "sandbox-history" as const,
  source: sandboxHistoryViewSource,
  project: ({ payload, blobs }: {
    readonly payload: RecordAttachmentPayloadSnapshot<SandboxHistoryReaderView>;
    readonly blobs: RecordAttachmentBlobs;
  }): SandboxHistoryDomainDetail => closeSandboxHistory(payload, blobs),
}) satisfies BuiltinDomainViewBinding<
  "sandbox-history",
  SandboxHistoryReaderView,
  typeof sandboxHistoryViewSource
>;

export const builtinDomainViewBindings = Object.freeze({
  "attempt-evidence": attemptEvidenceDomainBinding,
  "attempt-observability": attemptObservabilityDomainBinding,
  "file-changes": fileChangesDomainBinding,
  "source-navigation": sourceNavigationDomainBinding,
  sources: sourcesDomainBinding,
  "sandbox-history": sandboxHistoryDomainBinding,
});

export type AnyBuiltinDomainViewBinding =
  | typeof attemptEvidenceDomainBinding
  | typeof attemptObservabilityDomainBinding
  | typeof fileChangesDomainBinding
  | typeof sourceNavigationDomainBinding
  | typeof sourcesDomainBinding
  | typeof sandboxHistoryDomainBinding;

/** @internal Keeps the exact payload/source correlation inside Sample. */
export type { DomainBindingSource, DomainBindingPayload };

function closeAssertions(
  core: ClosedAttemptCore,
  payload: RecordAttachmentPayloadSnapshot<AssertionsAttachment>,
  _blobs: RecordAttachmentBlobs,
): AttemptEvidenceDomainDetail {
  return Object.freeze({
    outcome: core.outcome,
    verdict: foldRecordedAttemptVerdict({ outcome: core.outcome, assertions: payload }),
    entries: Object.freeze(payload.entries.map((entry) => Object.freeze({
      entryId: entry.entryId,
      display: Object.freeze({ ...entry.display, groupPath: Object.freeze([...entry.display.groupPath]) }),
      source: Object.freeze({
        kind: "fields" as const,
        fields: Object.freeze([Object.freeze({
          label: "input",
          value: assertionMaterialFact(entry.materials.source),
        }), ...(entry.materials.evidence.length === 0 ? [] : [Object.freeze({
          label: "evidence",
          value: Object.freeze({
            kind: "list" as const,
            items: Object.freeze(entry.materials.evidence.map(assertionMaterialFact)),
          }),
        })])]),
        coverage: entry.materials.coverage,
        limitations: entry.materials.limitations,
      }),
      check: entry.criterion.state === "available"
        ? assertionFact(entry.criterion.value)
        : Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" as const }),
      observed: Object.freeze({
        kind: "fields" as const,
        fields: entry.evaluation.observed.kind === "fields"
          ? entry.evaluation.observed.fields
          : Object.freeze([Object.freeze({ label: "value", value: entry.evaluation.observed })]),
        ...(entry.evaluation.receipt === undefined ? {} : { receipt: entry.evaluation.receipt }),
      }),
      expected: entry.policy.condition.state === "available"
        ? assertionFact(entry.policy.condition.value)
        : Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" as const }),
      explanation: entry.explanationRetention.state === "retained"
        ? entry.explanationRetention.value
        : Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" as const }),
      decision: Object.freeze({
        result: entry.decision.result,
        reason: entry.decision.reason,
        gate: entry.decision.gate,
        policy: entry.policy,
        contribution: entry.contribution,
      }),
    }))),
    sourceSites: Object.freeze(payload.sourceSites.map((site) => Object.freeze({
      ...site,
      start: Object.freeze({ ...site.start }),
      end: Object.freeze({ ...site.end }),
    }))),
  });
}

function closeSourceNavigation(
  payload: RecordAttachmentPayloadSnapshot<SourceNavigationReaderView>,
): SourceNavigationDomainDetail {
  const relation = payload.relation;
  return Object.freeze({
    dependencies: Object.freeze([
      "niceeval.turn-contexts",
      "niceeval.runner-activities",
      "niceeval.sources",
    ] as const),
    sources: Object.freeze({
      turnContexts: closeSourceDependency("niceeval.turn-contexts", payload.turnContexts),
      runnerActivities: closeSourceDependency("niceeval.runner-activities", payload.runnerActivities),
      originSources: closeSourceDependency("niceeval.sources", payload.originSources),
    }),
    collection: closeTraceCollection(relation),
    rows: Object.freeze((relation.state === "complete" || relation.state === "partial"
      ? relation.value.rows
      : []).map((row) => Object.freeze({
      turnId: row.turnId,
      sourceOrder: row.sourceOrder,
      source: row.source.state === "mapped"
        ? Object.freeze({
            state: "mapped" as const,
            sourceItemId: row.source.sourceItemId,
            sha256: row.source.sha256,
            start: Object.freeze({ line: row.source.start.line, column: row.source.start.column }),
            end: Object.freeze({ line: row.source.end.line, column: row.source.end.column }),
            verification: closeSourceAnchorVerification(
              payload.originSources,
              row.source.sourceItemId,
              row.source.sha256,
            ),
          })
        : Object.freeze({ state: "unmapped" as const, reason: row.source.reason }),
      timing: row.timing.state === "linked"
        ? Object.freeze({ state: "linked" as const, intervalId: row.timing.intervalId })
        : Object.freeze({ state: "unavailable" as const, reason: row.timing.reason }),
    }))),
  });
}

function closeSourceAnchorVerification(
  sources: RecordAttachmentPayloadSnapshot<SourceNavigationReaderView>["originSources"],
  sourceItemId: string,
  sha256: string,
): Extract<SourceNavigationDomainDetail["rows"][number]["source"], { readonly state: "mapped" }>["verification"] {
  if (sources.state !== "complete" && sources.state !== "partial") {
    return Object.freeze({
      state: sources.state,
      reason: "source-dependency-unavailable" as const,
    });
  }
  const source = sources.value.items.find((item) => item.sourceItemId === sourceItemId);
  return source?.sha256 === sha256
    ? Object.freeze({ state: "verified" as const })
    : Object.freeze({ state: "invalid" as const, reason: "source-anchor-mismatch" as const });
}

function closeSourceDependency<Source extends string>(
  source: Source,
  value: { readonly state: "complete" | "partial"; readonly limitations: readonly unknown[] }
    | { readonly state: "not-recorded" | "migration-required" | "unsupported" | "invalid" },
): ClosedSourceDependency<Source> {
  return value.state === "complete" || value.state === "partial"
    ? Object.freeze({
        source,
        state: value.state,
        limitations: Object.freeze(value.limitations.map(closeJson)),
      })
    : Object.freeze({
        source,
        state: value.state,
        limitations: Object.freeze([]) as readonly [],
      });
}

function collectionProjection(
  collection: { readonly limitations: readonly unknown[] },
  target: string,
  fallback: string,
): InputProjection<never> {
  if (collection.limitations.some((limitation) => isObservationLimitation(limitation, "unsupported-input", target))) {
    return Object.freeze({ state: "unsupported" as const, message: `${target} is unsupported by the recorded collector` });
  }
  if (collection.limitations.some((limitation) =>
    isObservationLimitation(limitation, "capture-failed", target) || isObservationLimitation(limitation, "capture-interrupted", target)
  )) {
    return Object.freeze({ state: "failed" as const, message: `${target} capture failed` });
  }
  return Object.freeze({ state: "missing" as const, message: fallback });
}

function isObservationLimitation(value: unknown, code: string, target: string): boolean {
  return typeof value === "object" && value !== null
    && (value as { readonly code?: unknown }).code === code
    && (value as { readonly target?: unknown }).target === target;
}

function closeObservability(
  payload: RecordAttachmentPayloadSnapshot<AttemptObservabilityReaderView>,
  blobs: RecordAttachmentBlobs,
): AttemptObservabilityDomainDetail {
  return Object.freeze({
    sources: Object.freeze({
      agentTurns: closeSourceDependency("niceeval.agent-turns", payload.agentTurns),
      turnContexts: closeSourceDependency("niceeval.turn-contexts", payload.turnContexts),
      sandboxCommands: closeSourceDependency("niceeval.sandbox-commands", payload.sandboxCommands),
      runnerActivities: closeSourceDependency("niceeval.runner-activities", payload.runnerActivities),
      runnerDiagnostics: closeSourceDependency("niceeval.runner-diagnostics", payload.runnerDiagnostics),
    }),
    conversation: closeConversation(payload.agentTurns),
    commands: closeCommands(payload.sandboxCommands, blobs, false),
    usage: closeUsage(payload.agentTurns),
    timing: closeTiming(payload.runnerActivities, false),
    diagnostics: closeDiagnostics(payload.runnerDiagnostics, false),
  });
}

function closeSandboxHistory(
  payload: RecordAttachmentPayloadSnapshot<SandboxHistoryReaderView>,
  blobs: RecordAttachmentBlobs,
): SandboxHistoryDomainDetail {
  return Object.freeze({
    sources: Object.freeze({
      sandboxCommands: closeSourceDependency("niceeval.sandbox-commands", payload.sandboxCommands),
      runnerActivities: closeSourceDependency("niceeval.runner-activities", payload.runnerActivities),
      runnerDiagnostics: closeSourceDependency("niceeval.runner-diagnostics", payload.runnerDiagnostics),
    }),
    commands: closeCommands(payload.sandboxCommands, blobs, true),
    timing: closeTiming(payload.runnerActivities, true),
    diagnostics: closeDiagnostics(payload.runnerDiagnostics, true),
  });
}

function closeConversation(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityReaderView>["agentTurns"],
): ClosedConversationDetail {
  const segments = value.state === "complete" || value.state === "partial"
    ? value.value.segments
    : [];
  return Object.freeze({
    dependencies: Object.freeze(["niceeval.agent-turns", "niceeval.turn-contexts"] as const),
    collection: closeTraceCollection(value),
    turns: Object.freeze(segments.map((segment) => Object.freeze({
      turnId: segment.turnId,
      sequence: segment.sequence,
      outcome: segment.outcome,
    }))),
    items: Object.freeze(segments.flatMap((segment) =>
      segment.items.map((item) => closeConversationItem(item, segment.turnId))
    )),
  });
}

function closeConversationItem(
  value: RecordAttachmentPayloadSnapshot<AgentTurnsAttachment>["segments"][number]["items"][number],
  turnId: string,
): ClosedConversationItem {
  const base = {
    itemId: value.itemId,
    turnId,
    sequence: value.sequence,
  };
  switch (value.kind) {
    case "message":
      return Object.freeze({ ...base, kind: value.kind, role: value.role, text: value.text });
    case "tool-call":
      return Object.freeze({ ...base, kind: value.kind, callId: value.callId, tool: value.tool, inputSummary: value.inputSummary });
    case "tool-result":
      return Object.freeze({ ...base, kind: value.kind, callId: value.callId, outcome: value.outcome, outputSummary: value.outputSummary });
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      return Object.freeze({ ...base, kind: value.kind, summary: value.summary });
    case "subagent":
      return Object.freeze({ ...base, kind: value.kind, state: value.state, label: value.label, summary: value.summary });
    case "input-request":
      return Object.freeze({
        ...base,
        kind: value.kind,
        state: value.state,
        promptSummary: value.promptSummary,
        responseSummary: value.responseSummary,
      });
    case "skill-load":
    case "conversation-error":
      return Object.freeze({ ...base, kind: value.kind, code: value.code, summary: value.summary });
  }
}

function closeCommands(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityReaderView>["sandboxCommands"],
  blobs: RecordAttachmentBlobs,
  sandboxOnly: boolean,
): ClosedCommandsDetail {
  const segments = value.state === "complete" || value.state === "partial"
    ? value.value.segments
    : [];
  return Object.freeze({
    dependencies: Object.freeze(["niceeval.sandbox-commands"] as const),
    collection: closeTraceCollection(value),
    entries: Object.freeze(segments
      .filter((command) => !sandboxOnly || isSandboxPhase(command.phase))
      .map((command) => closeCommand(command, blobs))),
  });
}

function closeCommand(
  value: RecordAttachmentPayloadSnapshot<SandboxCommandsAttachment>["segments"][number],
  blobs: RecordAttachmentBlobs,
) {
  return Object.freeze({
    commandId: value.commandId,
    manifest: Object.freeze({
      phase: value.phase,
      invocation: closeCommandInvocation(value.invocation),
      workingDirectory: closeWorkingDirectory(value.workingDirectory),
    }),
    result: Object.freeze({
      outcome: closeCommandOutcome(value.outcome),
      stdout: closeCommandStream(value.stdout, blobs),
      stderr: closeCommandStream(value.stderr, blobs),
    }),
  });
}

function closeCommandInvocation(
  value: RecordAttachmentPayloadSnapshot<SandboxCommandsAttachment>["segments"][number]["invocation"],
): ClosedCommandInvocation {
  return value.kind === "argv"
    ? Object.freeze({ kind: "argv" as const, executable: value.executable, arguments: Object.freeze([...value.arguments]) })
    : Object.freeze({ kind: "shell" as const, command: value.command });
}

function closeWorkingDirectory(
  value: RecordAttachmentPayloadSnapshot<SandboxCommandsAttachment>["segments"][number]["workingDirectory"],
): ClosedCommandWorkingDirectory {
  if (value.kind === "project-relative") return Object.freeze({ kind: value.kind, path: value.path });
  return Object.freeze({ kind: value.kind });
}

function closeCommandOutcome(
  value: RecordAttachmentPayloadSnapshot<SandboxCommandsAttachment>["segments"][number]["outcome"],
): ClosedCommandOutcome {
  if (value.kind === "exited") return Object.freeze({ kind: value.kind, exitCode: value.exitCode });
  return Object.freeze({ kind: value.kind, reason: value.reason });
}

function closeCommandStream(
  value: RecordAttachmentPayloadSnapshot<SandboxCommandsAttachment>["segments"][number]["stdout"],
  blobs: RecordAttachmentBlobs,
): ClosedCommandStream {
  if (value.storage.kind === "inline") {
    return Object.freeze({
      kind: "inline" as const,
      text: value.storage.text,
      retainedBytes: value.retainedBytes,
      totalSafeUtf8Bytes: value.totalSafeUtf8Bytes,
    });
  }
  return Object.freeze({
    kind: "blob" as const,
    retainedBytes: value.retainedBytes,
    totalSafeUtf8Bytes: value.totalSafeUtf8Bytes,
    content: closeBlob(value.storage.ref, blobs),
  });
}

function closeUsage(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityReaderView>["agentTurns"],
): ClosedUsageDetail {
  const observations = value.state === "complete" || value.state === "partial"
    ? value.value.segments.flatMap((segment) => segment.usage)
    : [];
  return Object.freeze({
    dependencies: Object.freeze(["niceeval.agent-turns"] as const),
    collection: closeTraceCollection(value),
    observations: Object.freeze(observations.map((observation) => {
      switch (observation.kind) {
        case "token-bucket":
          return Object.freeze({
            provider: observation.provider,
            kind: observation.kind,
            bucket: observation.bucket,
            tokens: observation.tokens,
          });
        case "request":
          return Object.freeze({
            provider: observation.provider,
            kind: observation.kind,
            requestKind: observation.requestKind,
          });
        case "provider-cost":
          return Object.freeze({
            provider: observation.provider,
            kind: observation.kind,
            amount: observation.amount,
            currency: observation.currency,
          });
      }
    })),
  });
}

function closeTiming(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityReaderView>["runnerActivities"],
  sandboxOnly: boolean,
): ClosedTimingDetail {
  const segments = value.state === "complete" || value.state === "partial"
    ? value.value.segments
    : [];
  return Object.freeze({
    dependencies: Object.freeze(["niceeval.runner-activities"] as const),
    collection: closeTraceCollection(value),
    intervals: Object.freeze(segments
      .filter((activity) => !sandboxOnly || isSandboxPhase(activity.phase))
      .map(closeTimingInterval)),
  });
}

function closeTimingInterval(
  value: RecordAttachmentPayloadSnapshot<AttemptRunnerActivitiesAttachment>["segments"][number],
) {
  return Object.freeze({
    intervalId: value.activityId,
    phase: value.phase,
    label: value.label,
    startOffsetMs: value.startOffsetMs,
    durationMs: value.durationMs,
    parentIntervalId: value.parentActivityId,
    outcome: value.outcome,
  });
}

function closeDiagnostics(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityReaderView>["runnerDiagnostics"],
  sandboxOnly: boolean,
): ClosedDiagnosticsDetail {
  const segments = value.state === "complete" || value.state === "partial"
    ? value.value.segments
    : [];
  return Object.freeze({
    dependencies: Object.freeze(["niceeval.runner-diagnostics"] as const),
    collection: closeTraceCollection(value),
    diagnostics: Object.freeze(segments
      .filter((diagnostic) => !sandboxOnly || isSandboxPhase(diagnostic.phase))
      .map(closeDiagnostic)),
  });
}

function closeDiagnostic(
  value: RecordAttachmentPayloadSnapshot<AttemptRunnerDiagnosticsAttachment>["segments"][number],
) {
  return Object.freeze({
    diagnosticId: value.diagnosticId,
    kind: value.kind,
    code: value.code,
    phase: value.phase,
    summary: value.summary,
    causes: Object.freeze(value.causes.map((cause) => Object.freeze({ code: cause.code, summary: cause.summary }))),
    redaction: value.redaction.state === "none"
      ? Object.freeze({ state: "none" as const })
      : Object.freeze({ state: "applied" as const, replacements: value.redaction.replacements }),
    sourceFrame: value.sourceFrame === null
      ? null
      : Object.freeze({
        sourceItemId: value.sourceFrame.sourceItemId,
        sha256: value.sourceFrame.sha256,
        start: Object.freeze({ ...value.sourceFrame.start }),
        end: Object.freeze({ ...value.sourceFrame.end }),
      }),
  });
}

function closeTraceCollection(
  value: { readonly state: "complete" | "partial"; readonly limitations: readonly unknown[] }
    | { readonly state: "not-recorded" | "migration-required" | "unsupported" | "invalid" },
): ClosedTraceCollection {
  return value.state === "complete" || value.state === "partial"
    ? Object.freeze({ state: value.state, limitations: Object.freeze(value.limitations.map(closeJson)) })
    : Object.freeze({ state: value.state, limitations: Object.freeze([]) as readonly [] });
}

function isSandboxPhase(phase: string): boolean {
  return phase === "sandbox.prepare" || phase === "sandbox.command";
}

function closeFileChanges(
  payload: RecordAttachmentPayloadSnapshot<FileChangesAttachment>,
  blobs: RecordAttachmentBlobs,
): FileChangesDomainDetail {
  return projectFileChangesDomainDetail({
    attribution: Object.freeze({
      kind: payload.attribution.kind,
      policy: Object.freeze({
        defaultPolicy: payload.attribution.policy.defaultPolicy,
        include: Object.freeze([...payload.attribution.policy.include]),
        ignore: Object.freeze([...payload.attribution.policy.ignore]),
      }),
    }),
    collection: closeFileChangesCollection(payload.collection),
    windows: Object.freeze(payload.windows.map((window) => Object.freeze({
      windowId: window.windowId,
      sequence: window.sequence,
      changes: Object.freeze(window.changes.map((change) => Object.freeze({
        changeId: change.changeId,
        path: change.path,
        kind: change.kind,
        before: closeFileChangesEndpoint(change.before, blobs),
        after: closeFileChangesEndpoint(change.after, blobs),
      }))),
    }))),
    structuralPartial: hasStructuralFileChangesPartial(payload.collection),
  });
}

function closeFileChangesCollection(
  value: RecordAttachmentPayloadSnapshot<FileChangesAttachment>["collection"],
): FileChangesProjectionInput["collection"] {
  return Object.freeze({
    state: value.state,
    limitations: Object.freeze(value.limitations.map(closeFileChangesLimitation)),
  });
}

/**
 * The snapshot conditional type intentionally erases some Schema union
 * details. Re-establish the already-validated durable shape while closing it,
 * rather than letting an unknown limitation escape the DomainView.
 */
function closeFileChangesLimitation(
  limitation: unknown,
): ClosedFileChangesCollectionLimitation {
  if (typeof limitation !== "object" || limitation === null || Array.isArray(limitation)) {
    throw new TypeError("a File Changes collection limitation must be an object");
  }
  const value = limitation as Readonly<Record<string, unknown>>;
  switch (value.code) {
    case "capture-failed":
    case "capture-interrupted":
      if (
        !isCaptureLimitationStage(value.stage)
        || !(typeof value.atWindowId === "string" || value.atWindowId === null)
      ) {
        throw new TypeError("a File Changes capture limitation has an invalid durable shape");
      }
      return Object.freeze({
        code: value.code,
        stage: value.stage,
        atWindowId: value.atWindowId,
      });
    case "collection-cap-reached":
      if (
        !isFileChangesCapTarget(value.target)
        || !isPositiveSafeInteger(value.omittedAtLeast)
        || !(typeof value.atWindowId === "string" || value.atWindowId === null)
      ) {
        throw new TypeError("a File Changes cap limitation has an invalid durable shape");
      }
      return Object.freeze({
        code: "collection-cap-reached" as const,
        target: value.target,
        omittedAtLeast: value.omittedAtLeast,
        atWindowId: value.atWindowId,
      });
    case "unsupported-input":
      if (value.target !== "endpoint-metadata" || !isPositiveSafeInteger(value.omittedAtLeast)) {
        throw new TypeError("a File Changes unsupported-input limitation has an invalid durable shape");
      }
      return Object.freeze({
        code: "unsupported-input" as const,
        target: "endpoint-metadata" as const,
        omittedAtLeast: value.omittedAtLeast,
      });
    default:
      throw new TypeError("a File Changes collection limitation has an unknown code");
  }
}

function closeFileChangesEndpoint(
  value: RecordAttachmentPayloadSnapshot<FileChangesAttachment>["windows"][number]["changes"][number]["before"],
  blobs: RecordAttachmentBlobs,
): FileChangesProjectionInput["windows"][number]["changes"][number]["before"] {
  if (value.state === "absent") return Object.freeze({ state: "absent" as const });
  const revision = value.revision;
  switch (revision.kind) {
    case "text":
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({
          kind: "text" as const,
          sha256: revision.sha256,
          byteLength: revision.byteLength,
          content: revision.content.state === "available"
            ? Object.freeze({ state: "available" as const, content: closeBlob(revision.content.ref, blobs) })
            : Object.freeze({ state: "omitted" as const, reason: "collection-cap" as const }),
        }),
      });
    case "elided":
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({
          kind: "elided" as const,
          reason: revision.reason,
          byteLength: revision.byteLength,
        }),
      });
    case "unavailable":
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({ kind: "unavailable" as const, reason: revision.reason }),
      });
  }
}

function hasStructuralFileChangesPartial(
  collection: RecordAttachmentPayloadSnapshot<FileChangesAttachment>["collection"],
): boolean {
  return collection.state === "partial" && collection.limitations
    .map(closeFileChangesLimitation)
    .some((limitation) => {
      switch (limitation.code) {
        case "capture-failed":
        case "capture-interrupted":
        case "unsupported-input":
          return true;
        case "collection-cap-reached":
          return limitation.target === "window" || limitation.target === "change" || limitation.target === "json-byte";
      }
    });
}

function isCaptureLimitationStage(
  value: unknown,
): value is "checkpoint" | "export" | "finalizer-export" | "normalize" {
  return value === "checkpoint" || value === "export" || value === "finalizer-export" || value === "normalize";
}

function isFileChangesCapTarget(
  value: unknown,
): value is "window" | "change" | "content-blob" | "content-byte" | "json-byte" {
  return value === "window" || value === "change" || value === "content-blob" || value === "content-byte" || value === "json-byte";
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function closeSources(
  payload: RecordAttachmentPayloadSnapshot<SourcesAttachment>,
  blobs: RecordAttachmentBlobs,
): SourcesDomainDetail {
  return Object.freeze({
    items: Object.freeze(payload.items.map((item) => Object.freeze({
      sourceItemId: item.sourceItemId,
      path: item.path,
      sha256: item.sha256,
      content: closeBlob(item.content, blobs),
    }))),
  });
}

function assertionFact(value: unknown): ClosedAssertionFactValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return Object.freeze({ kind: "value" as const, value });
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? Object.freeze({ kind: "value" as const, value })
      : Object.freeze({ kind: "unavailable" as const, reason: "source-unavailable" as const });
  }
  if (Array.isArray(value)) {
    return Object.freeze({ kind: "list" as const, items: Object.freeze(value.map(assertionFact)) });
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze({
      kind: "fields" as const,
      fields: Object.freeze(Object.entries(value).map(([label, item]) => Object.freeze({
        label,
        value: assertionFact(item),
      }))),
    });
  }
  return Object.freeze({ kind: "unavailable" as const, reason: "source-unavailable" as const });
}

function assertionMaterialFact(
  value: AssertionsAttachment["entries"][number]["materials"]["source"],
): ClosedAssertionFactValue {
  if (value.kind === "snapshot") {
    return assertionFact(value.value);
  }
  if (value.kind === "unavailable") {
    return Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" as const });
  }
  return assertionFact({ encoding: value.encoding, byteLength: value.byteLength, preview: value.preview });
}

function closeBlob(ref: RecordBlobRef, blobs: RecordAttachmentBlobs): ClosedBlobContent {
  const bytes = blobs.bytes(ref);
  if (Either.isLeft(bytes)) return Object.freeze({ state: "unavailable" as const });
  try {
    return Object.freeze({
      state: "available" as const,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.right),
    });
  } catch {
    return Object.freeze({ state: "binary" as const });
  }
}

function closeJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return Object.freeze(value.map(closeJson));
  if (typeof value === "object" && value !== null) {
    const closed: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) closed[key] = closeJson(item);
    return Object.freeze(closed);
  }
  return null;
}
