import { Either } from "effect";
import type { AnalysisSlot } from "../../analysis/index.ts";
import {
  attemptSlotProjection,
  type ProjectedRecordAttachmentResult,
  type ProjectedSample,
} from "../../projection/index.ts";
import {
  attemptCommandsProjector,
  attemptConversationProjector,
  attemptDiagnosticsProjector,
  attemptTimingProjector,
  attemptUsageProjector,
  type AttemptDiagnosticsView,
  type AttemptTimingView,
  type CommandsView,
  type ConversationView,
  type UsageView,
} from "../../o11y/record/family-projectors.ts";
import type { ObservabilityLimitationV1 } from "../../o11y/record/model.ts";
import {
  definePage,
  defineReport,
  reportComponentId,
  reportId,
  reportInputs,
  reportRoute,
  type Report,
} from "../author/index.ts";
import {
  reportCodeBlock,
  reportDocument,
  reportList,
  reportSection,
  reportStatus,
  reportTable,
  reportText,
  type ReportBlock,
} from "../semantic/index.ts";

const executionInputs = reportInputs({
  conversation: attemptSlotProjection(attemptConversationProjector),
  commands: attemptSlotProjection(attemptCommandsProjector),
  usage: attemptSlotProjection(attemptUsageProjector),
  timing: attemptSlotProjection(attemptTimingProjector),
  diagnostics: attemptSlotProjection(attemptDiagnosticsProjector),
});

type ExecutionInputs = {
  readonly conversation: ProjectedSample<"attempt-slot", ConversationView>;
  readonly commands: ProjectedSample<"attempt-slot", CommandsView>;
  readonly usage: ProjectedSample<"attempt-slot", UsageView>;
  readonly timing: ProjectedSample<"attempt-slot", AttemptTimingView>;
  readonly diagnostics: ProjectedSample<"attempt-slot", AttemptDiagnosticsView>;
};

type AttemptSlotEntry<Value> = ProjectedSample<"attempt-slot", Value>["entries"][number];
type CollectionDisplay =
  | { readonly state: "complete"; readonly limitations: readonly ObservabilityLimitationV1[] }
  | { readonly state: "partial"; readonly limitations: readonly ObservabilityLimitationV1[] };

/** Consumer-local presentation options; they never add Record inputs or I/O. */
export interface ExecutionEvidenceReportOptions {
  /** Match against complete retained transcript, tool, and command card text. */
  readonly grep?: string;
  /** A legacy evidence handle; neutral views retain no compatible handle namespace. */
  readonly expand?: string;
}

/**
 * An ordinary, capability-free Report over the public Attempt observability
 * projectors. All Record reads are declared statically above; the renderer
 * receives only completed projected values.
 */
export function executionEvidenceReport(input: ExecutionEvidenceReportOptions = {}): Report {
  if (input.grep !== undefined) new RegExp(input.grep);
  const options: ExecutionEvidenceReportOptions = Object.freeze({
    ...(input.grep === undefined ? {} : { grep: input.grep }),
    ...(input.expand === undefined ? {} : { expand: input.expand }),
  });
  const page = definePage({
    id: Either.getOrThrow(reportComponentId("execution-evidence")),
    route: Either.getOrThrow(reportRoute("/")),
    inputs: executionInputs,
    completeness: "allow-partial",
    render: ({ inputs }) => executionEvidenceDocument(inputs, options),
  });
  return defineReport({
    id: Either.getOrThrow(reportId("execution-evidence")),
    pages: [page],
  });
}

/** The built-in execution evidence Report with no private reader capability. */
export const defaultExecutionEvidenceReport = executionEvidenceReport();

function executionEvidenceDocument(
  inputs: ExecutionInputs,
  options: ExecutionEvidenceReportOptions,
) {
  const grep = options.grep === undefined ? undefined : new RegExp(options.grep);
  const conversationBySlot = entriesBySlot(inputs.conversation);
  const commandsBySlot = entriesBySlot(inputs.commands);
  const usageBySlot = entriesBySlot(inputs.usage);
  const timingBySlot = entriesBySlot(inputs.timing);
  const diagnosticsBySlot = entriesBySlot(inputs.diagnostics);
  const slots = inputs.conversation.sample.slots;

  return reportDocument({
    title: "Attempt execution",
    children: slots.length === 0
      ? [reportStatus({
        tone: "warning",
        label: "The selected sample has no Slots to display",
      })]
      : [
        ...(grep === undefined ? [] : [grepStatusBlock(inputs, grep)]),
        ...(options.expand === undefined ? [] : [legacyExpandWarningBlock(options.expand)]),
        ...slots.map((slot) => {
          const key = slotKey(slot);
          return reportSection({
            heading: `Slot ${slot.runId}/${slot.slotId}`,
            children: [
              slotStateBlock(slot),
              ...projectionBlocks(
                "Conversation",
                conversationBySlot.get(key),
                (view) => conversationBlocks(view, grep),
              ),
              ...projectionBlocks(
                "Commands",
                commandsBySlot.get(key),
                (view) => commandsBlocks(view, grep),
              ),
              ...(grep === undefined
                ? [
                  ...projectionBlocks("Usage", usageBySlot.get(key), usageBlocks),
                  ...projectionBlocks("Timing", timingBySlot.get(key), timingBlocks),
                  ...projectionBlocks("Diagnostics", diagnosticsBySlot.get(key), diagnosticsBlocks),
                ]
                : []),
            ],
          });
        }),
      ],
  });
}

function grepStatusBlock(inputs: ExecutionInputs, grep: RegExp): ReportBlock {
  const matches = grepMatchCount(inputs, grep);
  return reportStatus({
    tone: matches === 0 ? "warning" : "neutral",
    label: `Grep /${grep.source}/: ${matches} matching evidence card${matches === 1 ? "" : "s"}`,
  });
}

function legacyExpandWarningBlock(handle: string): ReportBlock {
  return reportStatus({
    tone: "warning",
    label: `Legacy --expand handle "${handle}" cannot be mapped to this neutral execution view`,
    detail: [reportText("The Report already displays the full unfiltered retained evidence; no content was hidden.")],
  });
}

function grepMatchCount(inputs: ExecutionInputs, grep: RegExp): number {
  return availableProjectionValues(inputs.conversation)
    .reduce((total, view) => total + view.items.filter((item) => grepMatches(grep, conversationItemSearchText(item))).length, 0)
    + availableProjectionValues(inputs.commands)
      .reduce((total, view) => total + view.commands.filter((command) => grepMatches(grep, commandSearchText(command))).length, 0);
}

function availableProjectionValues<Value>(
  projection: ProjectedSample<"attempt-slot", Value>,
): readonly Value[] {
  const values: Value[] = [];
  for (const entry of projection.entries) {
    if (entry.state === "attachment-result" && entry.attachment.state === "available") {
      values.push(entry.attachment.value);
    }
  }
  return values;
}

function entriesBySlot<Value>(
  projection: ProjectedSample<"attempt-slot", Value>,
): ReadonlyMap<string, AttemptSlotEntry<Value>> {
  const entries = new Map<string, AttemptSlotEntry<Value>>();
  for (const entry of projection.entries) {
    entries.set(slotKey(entry.slot), entry);
  }
  return entries;
}

function slotKey(slot: Pick<AnalysisSlot, "runId" | "slotId">): string {
  return `${slot.runId}\u0000${slot.slotId}`;
}

function slotStateBlock(slot: AnalysisSlot): ReportBlock {
  switch (slot.state) {
    case "included":
      return reportStatus({ tone: "positive", label: "Slot: included" });
    case "not-recorded":
      return reportStatus({
        tone: "warning",
        label: "Slot: not recorded",
        detail: [reportText("No Member was published for this expected Slot.")],
      });
    case "core-invalid":
      return reportStatus({
        tone: "negative",
        label: "Slot: Record Core invalid",
        detail: [reportText(issueCodes(slot.issues))],
      });
    case "excluded":
      return reportStatus({
        tone: "neutral",
        label: "Slot: excluded from the selected denominator",
        detail: [reportText(excludedSlotDetail(slot))],
      });
    default:
      return unreachable(slot);
  }
}

function excludedSlotDetail(slot: Extract<AnalysisSlot, { readonly state: "excluded" }>): string {
  return slot.base.state === "core-invalid"
    ? `Underlying state is core-invalid: ${issueCodes(slot.base.issues)}`
    : `Underlying state is ${slot.base.state}.`;
}

function projectionBlocks<Value>(
  name: string,
  entry: AttemptSlotEntry<Value> | undefined,
  availableBlocks: (value: Value) => readonly ReportBlock[],
): readonly ReportBlock[] {
  if (entry === undefined) {
    return [reportStatus({
      tone: "warning",
      label: `${name}: no projected entry was supplied for this Slot`,
    })];
  }

  switch (entry.state) {
    case "excluded":
      return [reportStatus({
        tone: "neutral",
        label: `${name}: excluded with this Slot`,
      })];
    case "not-recorded":
      return [reportStatus({
        tone: "warning",
        label: `${name}: not recorded because this Slot has no Member`,
      })];
    case "core-invalid":
      return [reportStatus({
        tone: "negative",
        label: `${name}: unavailable because Record Core is invalid`,
        detail: [reportText(issueCodes(entry.slot.issues))],
      })];
    case "attachment-result":
      return attachmentBlocks(name, entry.attachment, availableBlocks);
    default:
      return unreachable(entry);
  }
}

function attachmentBlocks<Value>(
  name: string,
  attachment: ProjectedRecordAttachmentResult<Value>,
  availableBlocks: (value: Value) => readonly ReportBlock[],
): readonly ReportBlock[] {
  switch (attachment.state) {
    case "available":
      return [reportStatus({ tone: "positive", label: `${name}: available` }), ...availableBlocks(attachment.value)];
    case "unavailable":
      return [reportStatus({ tone: "warning", label: `${name}: attachment unavailable` })];
    case "migration-required":
      return [reportStatus({
        tone: "warning",
        label: `${name}: migration required`,
        detail: [reportText(`${attachment.from} → ${attachment.to}; ${attachment.command}`)],
      })];
    case "migration-unavailable":
      return [reportStatus({
        tone: "warning",
        label: `${name}: migration unavailable`,
        detail: [reportText(`${attachment.from} → ${attachment.to}; ${attachment.reason}`)],
      })];
    case "unsupported":
      return [reportStatus({
        tone: "warning",
        label: `${name}: unsupported attachment`,
        detail: [reportText(attachment.schemaId)],
      })];
    case "invalid":
      return [reportStatus({
        tone: "negative",
        label: `${name}: invalid attachment`,
        detail: [reportText(issueCodes(attachment.issues))],
      })];
    default:
      return unreachable(attachment);
  }
}

function conversationBlocks(view: ConversationView, grep: RegExp | undefined): readonly ReportBlock[] {
  const turns = [...view.turns].sort((left, right) => left.sequence - right.sequence);
  const itemsByTurn = new Map<string, typeof view.items>();
  for (const item of view.items) {
    const current = itemsByTurn.get(item.turnId) ?? [];
    itemsByTurn.set(item.turnId, [...current, item]);
  }

  return [reportSection({
    heading: "Conversation",
    children: [
      collectionStatus("Conversation", view.collection),
      ...(turns.length === 0
        ? [reportStatus({
          tone: "warning",
          label: "No recorded conversation turns or items",
        })]
        : matchedConversationTurns(turns, itemsByTurn, grep)),
    ],
  })];
}

function matchedConversationTurns(
  turns: readonly ConversationView["turns"][number][],
  itemsByTurn: ReadonlyMap<string, ConversationView["items"]>,
  grep: RegExp | undefined,
): readonly ReportBlock[] {
  const sections = turns.flatMap((turn) => {
    const items = (itemsByTurn.get(turn.turnId) ?? [])
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .filter((item) => grep === undefined || grepMatches(grep, conversationItemSearchText(item)));
    if (grep !== undefined && items.length === 0) return [];
    return [reportSection({
      heading: `Turn ${turn.sequence} · ${turn.outcome}`,
      children: items.map(conversationItemBlock),
    })];
  });
  if (sections.length > 0 || grep === undefined) return sections;
  return [reportStatus({
    tone: "warning",
    label: `No recorded conversation items match /${grep.source}/`,
  })];
}

function conversationItemBlock(
  item: ConversationView["items"][number],
): ReportBlock {
  switch (item.kind) {
    case "message":
      return reportSection({
        heading: `${item.sequence} · ${item.role} message`,
        children: [reportCodeBlock({ value: item.text })],
      });
    case "tool-call":
      return reportSection({
        heading: `${item.sequence} · TOOL · ${item.tool}`,
        children: [
          reportStatus({ tone: "neutral", label: `Call: ${item.callId}` }),
          reportSection({
            heading: "Input",
            children: [reportCodeBlock({ value: item.inputSummary })],
          }),
        ],
      });
    case "tool-result":
      return reportSection({
        heading: `${item.sequence} · TOOL RESULT · ${item.outcome}`,
        children: [
          reportStatus({ tone: "neutral", label: `Call: ${item.callId}` }),
          reportSection({
            heading: "Output",
            children: [reportCodeBlock({ value: item.outputSummary })],
          }),
        ],
      });
    case "thinking-summary":
      return reportSection({
        heading: `${item.sequence} · thinking summary`,
        children: [reportCodeBlock({ value: item.summary })],
      });
    case "subagent":
      return reportSection({
        heading: `${item.sequence} · subagent ${item.label} · ${item.state}`,
        children: [reportCodeBlock({ value: item.summary })],
      });
    case "input-request":
      return reportSection({
        heading: `${item.sequence} · input request · ${item.state}`,
        children: [
          reportSection({
            heading: "Prompt",
            children: [reportCodeBlock({ value: item.promptSummary })],
          }),
          ...(item.responseSummary === null
            ? [reportStatus({ tone: "neutral", label: "Response: none recorded" })]
            : [reportSection({
              heading: "Response",
              children: [reportCodeBlock({ value: item.responseSummary })],
            })]),
        ],
      });
    case "skill-load":
      return reportStatus({
        tone: item.outcome === "loaded" ? "positive" : "negative",
        label: `${item.sequence} · skill ${item.skill}: ${item.outcome}`,
      });
    case "context-injection":
      return reportSection({
        heading: `${item.sequence} · ${item.source} context injection`,
        children: [reportCodeBlock({ value: item.summary })],
      });
    case "compaction":
      return reportSection({
        heading: `${item.sequence} · compaction (${item.compactedItemCount} item(s))`,
        children: [reportCodeBlock({ value: item.summary })],
      });
    case "conversation-error":
      return reportSection({
        heading: `${item.sequence} · conversation error ${item.code}`,
        children: [reportCodeBlock({ value: item.summary })],
      });
    default:
      return unreachable(item);
  }
}

function commandsBlocks(view: CommandsView, grep: RegExp | undefined): readonly ReportBlock[] {
  const commands = grep === undefined
    ? view.commands
    : view.commands.filter((command) => grepMatches(grep, commandSearchText(command)));
  return [reportSection({
    heading: "Commands",
    children: [
      collectionStatus("Commands", view.collection),
      ...(commands.length === 0
        ? [reportStatus({
          tone: "warning",
          label: grep === undefined ? "No recorded commands" : `No recorded commands match /${grep.source}/`,
        })]
        : commands.map((command) => reportSection({
          heading: `Command ${command.commandId}`,
          children: [
            reportStatus({ tone: "neutral", label: `Phase: ${command.manifest.phase}` }),
            commandInvocationBlock(command.manifest.invocation),
            reportStatus({
              tone: "neutral",
              label: `Working directory: ${workingDirectoryText(command.manifest.workingDirectory)}`,
            }),
            commandOutcomeBlock(command.result.outcome),
            commandStreamBlock("stdout", command.result.stdout),
            commandStreamBlock("stderr", command.result.stderr),
          ],
        }))),
    ],
  })];
}

function conversationItemSearchText(item: ConversationView["items"][number]): string {
  switch (item.kind) {
    case "message":
      return `${item.role}\n${item.text}`;
    case "tool-call":
      return `${item.tool}\n${item.callId}\n${item.inputSummary}`;
    case "tool-result":
      return `${item.callId}\n${item.outcome}\n${item.outputSummary}`;
    case "thinking-summary":
      return item.summary;
    case "subagent":
      return `${item.label}\n${item.state}\n${item.summary}`;
    case "input-request":
      return [item.state, item.promptSummary, item.responseSummary ?? ""].join("\n");
    case "skill-load":
      return `${item.skill}\n${item.outcome}`;
    case "context-injection":
      return `${item.source}\n${item.summary}`;
    case "compaction":
      return `${item.compactedItemCount}\n${item.summary}`;
    case "conversation-error":
      return `${item.code}\n${item.summary}`;
    default:
      return unreachable(item);
  }
}

function commandSearchText(command: CommandsView["commands"][number]): string {
  const invocation = command.manifest.invocation.kind === "argv"
    ? [command.manifest.invocation.executable, ...command.manifest.invocation.arguments].join("\n")
    : command.manifest.invocation.command;
  return [
    command.commandId,
    command.manifest.phase,
    invocation,
    workingDirectoryText(command.manifest.workingDirectory),
    commandOutcomeSearchText(command.result.outcome),
    command.result.stdout.text,
    command.result.stderr.text,
  ].join("\n");
}

function commandOutcomeSearchText(
  outcome: CommandsView["commands"][number]["result"]["outcome"],
): string {
  switch (outcome.kind) {
    case "exited":
      return `exited ${outcome.exitCode}`;
    case "terminated":
      return `terminated ${outcome.reason}`;
    case "not-started":
      return `not started ${outcome.reason}`;
    default:
      return unreachable(outcome);
  }
}

function grepMatches(grep: RegExp, text: string): boolean {
  grep.lastIndex = 0;
  return grep.test(text);
}

function commandInvocationBlock(
  invocation: CommandsView["commands"][number]["manifest"]["invocation"],
): ReportBlock {
  switch (invocation.kind) {
    case "argv":
      return reportSection({
        heading: "Invocation · argv",
        children: [
          reportSection({
            heading: "Executable",
            children: [reportCodeBlock({ value: invocation.executable })],
          }),
          reportSection({
            heading: "Arguments",
            children: invocation.arguments.length === 0
              ? [reportStatus({ tone: "neutral", label: "No arguments" })]
              : [reportCodeBlock({ value: JSON.stringify(invocation.arguments) })],
          }),
        ],
      });
    case "shell":
      return reportSection({
        heading: "Invocation · shell",
        children: [reportCodeBlock({ value: invocation.command, language: "shell" })],
      });
    default:
      return unreachable(invocation);
  }
}

function workingDirectoryText(
  directory: CommandsView["commands"][number]["manifest"]["workingDirectory"],
): string {
  switch (directory.kind) {
    case "sandbox-default":
      return "sandbox default";
    case "project-relative":
      return directory.path;
    case "redacted":
      return "redacted";
    default:
      return unreachable(directory);
  }
}

function commandOutcomeBlock(
  outcome: CommandsView["commands"][number]["result"]["outcome"],
): ReportBlock {
  switch (outcome.kind) {
    case "exited":
      return reportStatus({
        tone: outcome.exitCode === 0 ? "positive" : "negative",
        label: `Outcome: exited (${outcome.exitCode})`,
      });
    case "terminated":
      return reportStatus({ tone: "warning", label: `Outcome: terminated (${outcome.reason})` });
    case "not-started":
      return reportStatus({ tone: "warning", label: `Outcome: not started (${outcome.reason})` });
    default:
      return unreachable(outcome);
  }
}

function commandStreamBlock(
  name: "stdout" | "stderr",
  stream: CommandsView["commands"][number]["result"]["stdout"],
): ReportBlock {
  const count = `${stream.retainedBytes}/${stream.totalSafeUtf8Bytes} byte(s)`;
  return reportSection({
    heading: `${name} · ${count}`,
    children: stream.text.length === 0
      ? [reportStatus({ tone: "neutral", label: `${name} is empty` })]
      : [reportCodeBlock({ value: stream.text })],
  });
}

function usageBlocks(view: UsageView): readonly ReportBlock[] {
  return [reportSection({
    heading: "Usage",
    children: [
      collectionStatus("Usage", view.collection),
      ...(view.observations.length === 0
        ? [reportStatus({ tone: "warning", label: "No recorded usage observations" })]
        : [reportTable({
          caption: "Usage observations (record order)",
          columns: [
            { key: "provider", label: "Provider" },
            { key: "kind", label: "Kind" },
            { key: "value", label: "Value" },
          ],
          rows: view.observations.map((observation) => ({
            provider: observation.provider,
            kind: observation.kind,
            value: usageObservationText(observation),
          })),
        })]),
    ],
  })];
}

function usageObservationText(observation: UsageView["observations"][number]): string {
  switch (observation.kind) {
    case "token-bucket":
      return `${observation.bucket}: ${observation.tokens} token(s)`;
    case "request":
      return `${observation.requestKind} request`;
    case "provider-cost":
      return `${observation.amount} ${observation.currency}`;
    default:
      return unreachable(observation);
  }
}

function timingBlocks(view: AttemptTimingView): readonly ReportBlock[] {
  const depths = timingDepths(view.intervals);
  return [reportSection({
    heading: "Timing tree",
    children: [
      collectionStatus("Timing", view.collection),
      ...(view.intervals.length === 0
        ? [reportStatus({ tone: "warning", label: "No recorded timing intervals" })]
        : [reportTable({
          caption: "Timing tree (record order)",
          columns: [
            { key: "interval", label: "Interval" },
            { key: "parent", label: "Parent" },
            { key: "depth", label: "Depth", align: "end" },
            { key: "phase", label: "Phase" },
            { key: "label", label: "Label" },
            { key: "start", label: "Start (ms)", align: "end" },
            { key: "duration", label: "Duration (ms)", align: "end" },
            { key: "outcome", label: "Outcome" },
          ],
          rows: view.intervals.map((interval) => ({
            interval: interval.intervalId,
            parent: interval.parentIntervalId ?? "root",
            depth: depths.get(interval.intervalId) ?? 0,
            phase: interval.phase,
            label: interval.label,
            start: interval.startOffsetMs,
            duration: interval.durationMs,
            outcome: interval.outcome,
          })),
        })]),
    ],
  })];
}

function timingDepths(
  intervals: AttemptTimingView["intervals"],
): ReadonlyMap<string, number> {
  const parentById = new Map<string, string | null>();
  for (const interval of intervals) {
    parentById.set(interval.intervalId, interval.parentIntervalId);
  }

  const depthById = new Map<string, number>();
  const resolving = new Set<string>();
  const depthOf = (intervalId: string): number => {
    const known = depthById.get(intervalId);
    if (known !== undefined) return known;
    if (resolving.has(intervalId)) return 0;
    resolving.add(intervalId);
    const parent = parentById.get(intervalId);
    const depth = parent === undefined || parent === null ? 0 : depthOf(parent) + 1;
    resolving.delete(intervalId);
    depthById.set(intervalId, depth);
    return depth;
  };
  for (const interval of intervals) {
    depthOf(interval.intervalId);
  }
  return depthById;
}

function diagnosticsBlocks(view: AttemptDiagnosticsView): readonly ReportBlock[] {
  return [reportSection({
    heading: "Diagnostics",
    children: [
      collectionStatus("Diagnostics", view.collection),
      ...(view.diagnostics.length === 0
        ? [reportStatus({ tone: "warning", label: "No recorded diagnostics" })]
        : view.diagnostics.map((diagnostic) => reportSection({
          heading: `Diagnostic ${diagnostic.diagnosticId} · ${diagnostic.kind} · ${diagnostic.code}`,
          children: [
            reportStatus({ tone: diagnostic.kind === "execution-error" ? "negative" : "warning", label: `Phase: ${diagnostic.phase}` }),
            reportSection({
              heading: "Summary",
              children: [reportCodeBlock({ value: diagnostic.summary })],
            }),
            diagnosticCausesBlock(diagnostic.causes),
            diagnosticContextBlock(diagnostic.context),
            diagnosticRedactionBlock(diagnostic.redaction),
            diagnosticSourceFrameBlock(diagnostic.sourceFrame),
          ],
        }))),
    ],
  })];
}

function diagnosticCausesBlock(
  causes: AttemptDiagnosticsView["diagnostics"][number]["causes"],
): ReportBlock {
  return reportSection({
    heading: "Causes",
    children: causes.length === 0
      ? [reportStatus({ tone: "neutral", label: "No recorded causes" })]
      : [reportList({
        ordered: false,
        items: causes.map((cause) => [reportStatus({
          tone: "neutral",
          label: cause.code,
          detail: [reportText(cause.summary)],
        })]),
      })],
  });
}

function diagnosticContextBlock(
  context: AttemptDiagnosticsView["diagnostics"][number]["context"],
): ReportBlock {
  return reportSection({
    heading: "Context",
    children: context.length === 0
      ? [reportStatus({ tone: "neutral", label: "No recorded context" })]
      : [reportList({
        ordered: false,
        items: context.map((item) => [reportStatus({
          tone: "neutral",
          label: diagnosticContextText(item),
        })]),
      })],
  });
}

function diagnosticContextText(
  context: AttemptDiagnosticsView["diagnostics"][number]["context"][number],
): string {
  switch (context.kind) {
    case "entity":
      return `Entity: ${context.target.family}/${context.target.kind}/${context.target.id}`;
    case "limit":
      return `Limit ${context.limit}: maximum ${context.maximum}, observed at least ${context.observedAtLeast}`;
    case "provider":
      return `Provider: ${context.provider}`;
    default:
      return unreachable(context);
  }
}

function diagnosticRedactionBlock(
  redaction: AttemptDiagnosticsView["diagnostics"][number]["redaction"],
): ReportBlock {
  switch (redaction.state) {
    case "none":
      return reportStatus({ tone: "neutral", label: "Redaction: none" });
    case "applied":
      return reportStatus({
        tone: "warning",
        label: "Redaction: applied",
        detail: [reportText(
          `summary ${redaction.summaryReplacements}, causes ${redaction.causeReplacements}, context ${redaction.contextReplacements}`,
        )],
      });
    default:
      return unreachable(redaction);
  }
}

function diagnosticSourceFrameBlock(
  sourceFrame: AttemptDiagnosticsView["diagnostics"][number]["sourceFrame"],
): ReportBlock {
  if (sourceFrame === null) {
    return reportStatus({ tone: "neutral", label: "Source frame: none" });
  }
  return reportStatus({
    tone: "neutral",
    label: `Source frame: ${sourceFrame.sourceItemId}`,
    detail: [reportText(
      `${sourceFrame.start.line}:${sourceFrame.start.column}–${sourceFrame.end.line}:${sourceFrame.end.column}`,
    )],
  });
}

function collectionStatus(name: string, collection: CollectionDisplay): ReportBlock {
  switch (collection.state) {
    case "complete":
      return reportStatus({ tone: "positive", label: `${name} collection: complete` });
    case "partial":
      return reportStatus({
        tone: "warning",
        label: `${name} collection: partial`,
        detail: [reportText(collection.limitations.map(limitationText).join("; "))],
      });
    default:
      return unreachable(collection);
  }
}

function limitationText(limitation: ObservabilityLimitationV1): string {
  switch (limitation.code) {
    case "capture-failed":
      return `${limitation.target}: capture failed at ${limitation.stage}`;
    case "capture-interrupted":
      return `${limitation.target}: capture interrupted at ${limitation.stage}`;
    case "collection-cap-reached":
      return `${limitation.target}: retained ${limitation.retained}, omitted at least ${limitation.omittedAtLeast}`;
    case "unsupported-input":
      return `${limitation.target}: unsupported input, omitted at least ${limitation.omittedAtLeast}`;
    case "text-truncated":
      return `${limitation.target}: text truncated, retained ${limitation.retainedBytes} byte(s), omitted ${limitation.omittedBytes} byte(s)`;
    case "stream-truncated":
      return `${limitation.stream}: truncated, retained ${limitation.retainedBytes} byte(s), omitted ${limitation.omittedBytes} byte(s)`;
    case "invalid-utf8-replaced":
      return `${limitation.stream}: replaced ${limitation.replacementCount} invalid UTF-8 sequence(s)`;
    case "unsafe-control-stripped":
      return `${limitation.stream}: stripped ${limitation.strippedCount} unsafe control character(s)`;
    case "redacted":
      return `${limitation.target}: redacted ${limitation.replacementCount} value(s)`;
    default:
      return unreachable(limitation);
  }
}

function issueCodes(issues: readonly { readonly code: string }[]): string {
  return issues.map((issue) => issue.code).join(", ");
}

function unreachable(value: never): never {
  throw new Error(`Unexpected execution evidence value: ${String(value)}`);
}
