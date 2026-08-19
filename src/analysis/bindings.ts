import { Either } from "effect";
import { foldRecordedAttemptVerdict } from "../eval/record/verdict.ts";
import type {
  RecordAttachmentBlobs,
  RecordAttachmentPayloadSnapshot,
  RecordBlobRef,
} from "../record/attachment/types.ts";
import type { AssertionsAttachment } from "../record/family/assertions.ts";
import {
  assertionsRecordFamily,
  attemptObservabilityRecordFamily,
  fileChangesRecordFamily,
  sourceNavigationRecordFamily,
  sourcesRecordFamily,
} from "../record/family/catalog.ts";
import type { FileChangesAttachment } from "../record/family/file-changes.ts";
import type { AttemptObservabilityAttachment } from "../record/family/observability.ts";
import type { SourceNavigationAttachment } from "../record/family/source-navigation.ts";
import type { SourcesAttachment } from "../record/family/sources.ts";
import type {
  FixedFamilyRead,
  RecordReadSession,
  SelectedOwnerRef,
} from "../record/host/types.ts";
import type {
  JsonValue,
} from "./contracts.ts";
import type {
  AttemptEvidenceDomainDetail,
  AttemptObservabilityDomainDetail,
  BuiltinDomainDetail,
  BuiltinDomainViewKind,
  ClosedAttemptCore,
  ClosedBlobContent,
  ClosedCommandInvocation,
  ClosedCommandOutcome,
  ClosedCommandStream,
  ClosedCommandWorkingDirectory,
  ClosedConversationDetail,
  ClosedConversationItem,
  ClosedDiagnosticsDetail,
  ClosedFileChangesCollectionLimitation,
  ClosedTimingDetail,
  ClosedTraceCollection,
  ClosedUsageDetail,
  FileChangesDomainDetail,
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

/**
 * Static only: each binding retains the exact declaration-owned descriptor.
 * There is no runtime family lookup or field-token surface.
 */
export interface FixedFamilyBinding<
  Owner extends FixedFamilyOwnerRequirement,
  Payload,
  Descriptor extends {
    readonly family: string;
    readonly owner: "attempt" | "run";
  },
> {
  readonly owner: Owner;
  readonly descriptor: Descriptor;
  readonly read: (
    reader: RecordReadSession,
    owner: SelectedOwnerRef,
  ) => import("effect").Effect.Effect<FixedFamilyRead<Payload>, import("../record/reader/errors.ts").RecordReaderReadError>;
}

export type InputProjection<Value> =
  | { readonly state: "value"; readonly value: Value }
  | {
      readonly state: "missing" | "unsupported" | "failed";
      readonly message: string;
    };

/** One semantic input owns an immutable owner/family requirement and projector. */
export interface PublishedAnalysisInputBinding<
  Value,
  Payload,
  Family extends FixedFamilyBinding<FixedFamilyOwnerRequirement, Payload, any>,
> {
  readonly id: string;
  readonly family: Family;
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
  Family extends FixedFamilyBinding<FixedFamilyOwnerRequirement, Payload, any>,
> {
  readonly id: string;
  readonly kind: Kind;
  readonly family: Family;
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

type DomainBindingFamily<Binding extends AnyBuiltinDomainViewBinding> =
  Binding extends BuiltinDomainViewBinding<BuiltinDomainViewKind, any, infer Family>
    ? Family
    : never;

function fixedFamilyBinding<
  Owner extends FixedFamilyOwnerRequirement,
  Payload,
  Descriptor extends {
    readonly family: string;
    readonly owner: "attempt" | "run";
  },
>(input: FixedFamilyBinding<Owner, Payload, Descriptor>): FixedFamilyBinding<Owner, Payload, Descriptor> {
  return Object.freeze({ ...input });
}

const assertionsFamily = fixedFamilyBinding({
  owner: "attempt" as const,
  descriptor: assertionsRecordFamily,
  read: (reader, owner) => reader.readAssertions(owner),
});

/** @internal Cost projection owns this sealed, attempt-scoped Usage seam. */
export const attemptObservabilityFamily = fixedFamilyBinding({
  owner: "attempt" as const,
  descriptor: attemptObservabilityRecordFamily,
  read: (reader, owner) => reader.readAttemptObservability(owner),
});

const fileChangesFamily = fixedFamilyBinding({
  owner: "attempt" as const,
  descriptor: fileChangesRecordFamily,
  read: (reader, owner) => reader.readFileChanges(owner),
});

const sourceNavigationFamily = fixedFamilyBinding({
  owner: "attempt" as const,
  descriptor: sourceNavigationRecordFamily,
  read: (reader, owner) => reader.readSourceNavigation(owner),
});

const originSourcesFamily = fixedFamilyBinding({
  owner: "origin-run" as const,
  descriptor: sourcesRecordFamily,
  read: (reader, owner) => reader.readSources(owner),
});

/** The complete published input catalog; ids are semantic, never schema ids. */
export const publishedAnalysisInputBindings = Object.freeze({
  attemptPassed: Object.freeze({
    id: "niceeval.attempt-passed",
    family: assertionsFamily,
    project: ({ core, payload }: {
      readonly member: LogicalSlot;
      readonly core: ClosedAttemptCore;
      readonly payload: RecordAttachmentPayloadSnapshot<AssertionsAttachment>;
    }): InputProjection<boolean> => {
      const verdict = foldRecordedAttemptVerdict({ outcome: core.outcome, assertions: payload });
      if (verdict === "passed" || verdict === "failed") {
        return Object.freeze({ state: "value" as const, value: verdict === "passed" });
      }
      return Object.freeze({
        state: "unsupported" as const,
        message: `Attempt verdict ${verdict} has no pass/fail reading`,
      });
    },
  }),
  attemptLatencyMs: Object.freeze({
    id: "niceeval.attempt-latency-ms",
    family: attemptObservabilityFamily,
    project: ({ payload }: {
      readonly member: LogicalSlot;
      readonly core: ClosedAttemptCore;
      readonly payload: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>;
    }): InputProjection<number> => {
      const timing = payload.timing;
      if (timing.collection.state !== "complete") {
        return collectionProjection(timing.collection, "timing", "timing collection is incomplete");
      }
      const intervals = timing.intervals.filter((interval) => interval.phase === "eval.run");
      if (intervals.length === 0) {
        return Object.freeze({ state: "value" as const, value: 0 });
      }
      return Object.freeze({
        state: "value" as const,
        value: intervals.reduce((total, interval) => total + interval.durationMs, 0),
      });
    },
  }),
  /**
   * The final token reading is `inputTokens + outputTokens`. It keeps that
   * exact, non-overlapping pair from the fixed Usage family: cache buckets
   * are separately accounted input and reasoning is already included in the
   * output bucket, so neither belongs in this total.
   */
  attemptTokens: Object.freeze({
    id: "niceeval.attempt-input-output-tokens",
    family: attemptObservabilityFamily,
    project: ({ payload }: {
      readonly member: LogicalSlot;
      readonly core: ClosedAttemptCore;
      readonly payload: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>;
    }): InputProjection<number> => {
      const usage = payload.usage;
      if (usage.collection.state !== "complete") {
        return collectionProjection(usage.collection, "usage", "usage collection is incomplete");
      }
      let input = 0;
      let output = 0;
      let hasInput = false;
      let hasOutput = false;
      for (const observation of usage.observations) {
        if (observation.kind !== "token-bucket") continue;
        if (observation.bucket === "input") {
          input += observation.tokens;
          hasInput = true;
        } else if (observation.bucket === "output") {
          output += observation.tokens;
          hasOutput = true;
        }
      }
      if (!hasInput && !hasOutput && usage.observations.every((observation) => observation.kind !== "token-bucket")) {
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
    family: attemptObservabilityFamily,
    project: ({ payload }: {
      readonly member: LogicalSlot;
      readonly core: ClosedAttemptCore;
      readonly payload: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>;
    }): InputProjection<boolean> => {
      const commands = payload.commands;
      const failed = commands.commands.some((command) =>
        command.result.outcome.kind !== "exited" || command.result.outcome.exitCode !== 0
      );
      if (failed) return Object.freeze({ state: "value" as const, value: true });
      if (commands.collection.state === "complete") {
        return Object.freeze({ state: "value" as const, value: false });
      }
      return collectionProjection(commands.collection, "command", "command collection is incomplete");
    },
  }),
});

export const attemptEvidenceDomainBinding = Object.freeze({
  id: "niceeval.domain.attempt-evidence",
  kind: "attempt-evidence" as const,
  family: assertionsFamily,
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
  family: attemptObservabilityFamily,
  project: ({ payload, blobs }: {
    readonly payload: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>;
    readonly blobs: RecordAttachmentBlobs;
  }): AttemptObservabilityDomainDetail => closeObservability(payload, blobs, false),
}) satisfies BuiltinDomainViewBinding<
  "attempt-observability",
  AttemptObservabilityAttachment,
  typeof attemptObservabilityFamily
>;

export const fileChangesDomainBinding = Object.freeze({
  id: "niceeval.domain.file-changes",
  kind: "file-changes" as const,
  family: fileChangesFamily,
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
  family: sourceNavigationFamily,
  project: ({ payload }: {
    readonly payload: RecordAttachmentPayloadSnapshot<SourceNavigationAttachment>;
    readonly blobs: RecordAttachmentBlobs;
  }): SourceNavigationDomainDetail => closeSourceNavigation(payload),
}) satisfies BuiltinDomainViewBinding<
  "source-navigation",
  SourceNavigationAttachment,
  typeof sourceNavigationFamily
>;

export const sourcesDomainBinding = Object.freeze({
  id: "niceeval.domain.sources",
  kind: "sources" as const,
  family: originSourcesFamily,
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
  family: attemptObservabilityFamily,
  project: ({ payload, blobs }: {
    readonly payload: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>;
    readonly blobs: RecordAttachmentBlobs;
  }): AttemptObservabilityDomainDetail => closeObservability(payload, blobs, true),
}) satisfies BuiltinDomainViewBinding<
  "sandbox-history",
  AttemptObservabilityAttachment,
  typeof attemptObservabilityFamily
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

/** @internal Keeps the exact payload/family correlation inside Sample. */
export type { DomainBindingFamily, DomainBindingPayload };

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
      display: closeJson(entry.display),
      criterion: closeJson(entry.criterion),
      result: closeJson(entry.result),
      coverage: closeJson(entry.coverage),
      limitations: closeJson(entry.limitations),
      subject: closeAssertionMaterial(entry.subject),
      evidence: Object.freeze(entry.evidence.map(closeAssertionMaterial)),
    }))),
    sourceSites: Object.freeze(payload.sourceSites.map(closeJson)),
  });
}

function closeSourceNavigation(
  payload: RecordAttachmentPayloadSnapshot<SourceNavigationAttachment>,
): SourceNavigationDomainDetail {
  return Object.freeze({
    collection: Object.freeze({
      state: payload.collection.state,
      limitations: Object.freeze(payload.collection.limitations.map((limitation) => Object.freeze({
        code: limitation.code,
        target: limitation.target,
        omittedAtLeast: limitation.omittedAtLeast,
      }))),
    }),
    rows: Object.freeze(payload.rows.map((row) => Object.freeze({
      turnId: row.turnId,
      sourceOrder: row.sourceOrder,
      source: row.source.state === "mapped"
        ? Object.freeze({
            state: "mapped" as const,
            sourceItemId: row.source.sourceItemId,
            sha256: row.source.sha256,
            start: Object.freeze({ line: row.source.start.line, column: row.source.start.column }),
            end: Object.freeze({ line: row.source.end.line, column: row.source.end.column }),
          })
        : Object.freeze({ state: "unmapped" as const, reason: row.source.reason }),
      timing: row.timing.state === "linked"
        ? Object.freeze({ state: "linked" as const, intervalId: row.timing.intervalId })
        : Object.freeze({ state: "unavailable" as const, reason: row.timing.reason }),
    }))),
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
  payload: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>,
  blobs: RecordAttachmentBlobs,
  sandboxOnly: boolean,
): AttemptObservabilityDomainDetail {
  const isSandboxPhase = (phase: string): boolean =>
    phase === "sandbox.prepare" || phase === "sandbox.command";
  const commands = payload.commands.commands
    .filter((command) => !sandboxOnly || isSandboxPhase(command.manifest.phase))
    .map((command) => closeCommand(command, blobs));
  const timing = payload.timing.intervals
    .filter((interval) => !sandboxOnly || isSandboxPhase(interval.phase))
    .map(closeTimingInterval);
  const diagnostics = payload.diagnostics.diagnostics
    .filter((diagnostic) => !sandboxOnly || isSandboxPhase(diagnostic.phase))
    .map(closeDiagnostic);
  return Object.freeze({
    conversation: sandboxOnly
      ? Object.freeze({
        collection: closeTraceCollection(payload.conversation.collection),
        turns: Object.freeze([]),
        items: Object.freeze([]),
      })
      : closeConversation(payload.conversation),
    commands: Object.freeze({
      collection: closeTraceCollection(payload.commands.collection),
      entries: Object.freeze(commands),
    }),
    usage: sandboxOnly
      ? Object.freeze({
        collection: closeTraceCollection(payload.usage.collection),
        observations: Object.freeze([]),
      })
      : closeUsage(payload.usage),
    timing: Object.freeze({
      collection: closeTraceCollection(payload.timing.collection),
      intervals: Object.freeze(timing),
    }),
    diagnostics: Object.freeze({
      collection: closeTraceCollection(payload.diagnostics.collection),
      diagnostics: Object.freeze(diagnostics),
    }),
  });
}

function closeConversation(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["conversation"],
): ClosedConversationDetail {
  return Object.freeze({
    collection: closeTraceCollection(value.collection),
    turns: Object.freeze(value.turns.map((turn) => Object.freeze({
      turnId: turn.turnId,
      sequence: turn.sequence,
      outcome: turn.outcome,
    }))),
    items: Object.freeze(value.items.map(closeConversationItem)),
  });
}

function closeConversationItem(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["conversation"]["items"][number],
): ClosedConversationItem {
  const base = {
    itemId: value.itemId,
    turnId: value.turnId,
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

function closeCommand(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["commands"]["commands"][number],
  blobs: RecordAttachmentBlobs,
) {
  return Object.freeze({
    commandId: value.commandId,
    manifest: Object.freeze({
      phase: value.manifest.phase,
      invocation: closeCommandInvocation(value.manifest.invocation),
      workingDirectory: closeWorkingDirectory(value.manifest.workingDirectory),
    }),
    result: Object.freeze({
      outcome: closeCommandOutcome(value.result.outcome),
      stdout: closeCommandStream(value.result.stdout, blobs),
      stderr: closeCommandStream(value.result.stderr, blobs),
    }),
  });
}

function closeCommandInvocation(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["commands"]["commands"][number]["manifest"]["invocation"],
): ClosedCommandInvocation {
  return value.kind === "argv"
    ? Object.freeze({ kind: "argv" as const, executable: value.executable, arguments: Object.freeze([...value.arguments]) })
    : Object.freeze({ kind: "shell" as const, command: value.command });
}

function closeWorkingDirectory(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["commands"]["commands"][number]["manifest"]["workingDirectory"],
): ClosedCommandWorkingDirectory {
  if (value.kind === "project-relative") return Object.freeze({ kind: value.kind, path: value.path });
  return Object.freeze({ kind: value.kind });
}

function closeCommandOutcome(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["commands"]["commands"][number]["result"]["outcome"],
): ClosedCommandOutcome {
  if (value.kind === "exited") return Object.freeze({ kind: value.kind, exitCode: value.exitCode });
  return Object.freeze({ kind: value.kind, reason: value.reason });
}

function closeCommandStream(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["commands"]["commands"][number]["result"]["stdout"],
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
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["usage"],
): ClosedUsageDetail {
  return Object.freeze({
    collection: closeTraceCollection(value.collection),
    observations: Object.freeze(value.observations.map((observation) => {
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

function closeTimingInterval(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["timing"]["intervals"][number],
) {
  return Object.freeze({
    intervalId: value.intervalId,
    phase: value.phase,
    label: value.label,
    startOffsetMs: value.startOffsetMs,
    durationMs: value.durationMs,
    parentIntervalId: value.parentIntervalId,
    outcome: value.outcome,
  });
}

function closeDiagnostic(
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["diagnostics"]["diagnostics"][number],
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
  value: RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["conversation"]["collection"],
): ClosedTraceCollection {
  return Object.freeze({ state: value.state, limitations: Object.freeze(value.limitations.map(closeJson)) });
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

function closeAssertionMaterial(value: { readonly kind: string }): JsonValue {
  if (value.kind === "snapshot") {
    return Object.freeze({ kind: "snapshot", value: closeJson((value as unknown as { readonly value: unknown }).value) });
  }
  const blob = value as unknown as { readonly encoding: string; readonly byteLength: number; readonly preview: string };
  return Object.freeze({ kind: "blob", encoding: blob.encoding, byteLength: blob.byteLength, preview: blob.preview });
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
