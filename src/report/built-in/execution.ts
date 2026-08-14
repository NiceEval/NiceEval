import { Either } from "effect";
import { encodeAttemptLocator } from "../../attempt-locator.ts";
import type { AnalysisSlot, IncludedAnalysisSlot } from "../../analysis/index.ts";
import {
  attemptSlotProjection,
  type ProjectedRecordAttachmentResult,
  type ProjectedSample,
} from "../../projection/index.ts";
import {
  attemptTimingProjector,
  type AttemptDiagnosticsView,
  type AttemptTimingView,
  type CommandsView,
  type ConversationView,
  type ObservabilityLimitationView,
  type UsageView,
} from "../../o11y/record/family-projectors.ts";
import {
  defineCalculation,
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

import {
  executionEvidenceInputs,
  executionShowJsonInputs,
  publicExecutionEvidenceJson,
} from "./attempt-evidence-json.ts";

const executionInputs = executionEvidenceInputs;

const timingEvidenceInputs = reportInputs({
  timing: attemptSlotProjection(attemptTimingProjector),
});

const PUBLIC_TIMING_PHASES = [
  "sandbox.queue",
  "sandbox.create",
  "sandbox.prepare",
  "agent.ensure",
  "workspace.baseline",
  "agent.setup",
  "telemetry.configure",
  "eval.run",
  "workspace.diff",
  "assertions.evaluate",
  "telemetry.collect",
  "agent.teardown",
  "sandbox.cleanup",
  "sandbox.stop",
] as const;

type PublicTimingPhase = (typeof PUBLIC_TIMING_PHASES)[number];

export interface PublicTimingPhaseRow {
  readonly name: PublicTimingPhase;
  readonly durationMs: number;
}

export interface PublicTimingJson {
  readonly kind: "attempt";
  readonly locator: string;
  readonly durationMs: number | null;
  readonly phases: readonly PublicTimingPhaseRow[];
}

type ExecutionInputs = {
  readonly conversation: ProjectedSample<"attempt-slot", ConversationView>;
  readonly commands: ProjectedSample<"attempt-slot", CommandsView>;
  readonly usage: ProjectedSample<"attempt-slot", UsageView>;
  readonly timing: ProjectedSample<"attempt-slot", AttemptTimingView>;
  readonly diagnostics: ProjectedSample<"attempt-slot", AttemptDiagnosticsView>;
};

type AttemptSlotEntry<Value> = ProjectedSample<"attempt-slot", Value>["entries"][number];
type CollectionDisplay =
  | { readonly state: "complete"; readonly limitations: readonly ObservabilityLimitationView[] }
  | { readonly state: "partial"; readonly limitations: readonly ObservabilityLimitationView[] };

/** Consumer-local presentation options; they never add Record inputs or I/O. */
export interface ExecutionEvidenceReportOptions {
  /** Match against complete retained transcript, tool, and command card text. */
  readonly grep?: string;
}

export interface TimingEvidenceReportOptions {
  /** Summary omits opaque interval identity and offsets; full retains every projected field. */
  readonly mode?: "summary" | "full";
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

/** JSON keeps the complete execution projection even when text uses --grep. */
export function executionShowJsonReport(
  input: ExecutionEvidenceReportOptions = {},
): Report {
  const human = executionEvidenceReport(input);
  const executionJson = defineCalculation({
    id: Either.getOrThrow(reportComponentId("execution-json")),
    inputs: executionShowJsonInputs,
    completeness: "allow-partial",
    calculate: ({ sample, inputs }) => publicExecutionEvidenceJson(sample, inputs),
  });
  return defineReport({
    id: Either.getOrThrow(reportId("execution-json")),
    calculations: { executionJson },
    pages: human.pages,
  });
}

/**
 * The dedicated Attempt timing Report. It deliberately declares only the
 * timing projection, so `show --timing` cannot accidentally depend on the
 * broader execution-evidence surface.
 */
export function timingEvidenceReport(input: TimingEvidenceReportOptions = {}): Report {
  const mode = input.mode ?? "summary";
  const timingJson = defineCalculation({
    id: Either.getOrThrow(reportComponentId("timing-json")),
    inputs: timingEvidenceInputs,
    completeness: "require-complete",
    calculate: ({ sample, inputs }) => publicTimingJson(sample.slots, inputs.timing),
  });
  const page = definePage({
    id: Either.getOrThrow(reportComponentId("timing-evidence")),
    route: Either.getOrThrow(reportRoute("/")),
    inputs: timingEvidenceInputs,
    completeness: "allow-partial",
    calculations: { timingJson },
    render: ({ calculations, inputs }) =>
      timingEvidenceDocument(calculations.timingJson, inputs.timing, mode),
  });
  return defineReport({
    id: Either.getOrThrow(reportId("timing-evidence")),
    calculations: { timingJson },
    pages: [page],
  });
}

export const defaultTimingEvidenceReport = timingEvidenceReport();

function timingEvidenceDocument(
  result:
    | { readonly state: "available"; readonly value: PublicTimingJson }
    | { readonly state: "data-unavailable" | "execution-failed"; readonly problemIds: readonly number[] },
  timing: ProjectedSample<"attempt-slot", AttemptTimingView>,
  mode: "summary" | "full",
) {
  switch (result.state) {
    case "data-unavailable":
      return timingEvidenceTextDocument("phase timing unavailable");
    case "execution-failed":
      return timingEvidenceTextDocument("timing calculation/projection failed");
    case "available":
      return reportDocument({
        title: "Attempt timing",
        presentation: "evidence-text",
        children: [reportCodeBlock({
          value: renderPublicTimingText(result.value, firstAvailableTimingView(timing), mode),
        })],
      });
  }
}

function timingEvidenceTextDocument(value: string) {
  return reportDocument({
    title: "Attempt timing",
    presentation: "evidence-text",
    children: [reportCodeBlock({ value })],
  });
}

function firstAvailableTimingView(
  timing: ProjectedSample<"attempt-slot", AttemptTimingView>,
): AttemptTimingView | undefined {
  const included = timing.sample.slots.find((slot) => slot.state === "included");
  return included === undefined
    ? undefined
    : availableTimingView(timing, included.runId, included.slotId);
}

function publicTimingJson(
  slots: readonly AnalysisSlot[],
  timing: ProjectedSample<"attempt-slot", AttemptTimingView>,
): PublicTimingJson {
  const included = requireSingleIncludedTimingSlot(slots);
  const view = requireAvailableTimingView(timing, included);
  const phases = publicPhasesFromTiming(view);
  const durationMs = phases.reduce((sum, phase) => sum + phase.durationMs, 0);
  return Object.freeze({
    kind: "attempt" as const,
    locator: encodeAttemptLocator(included.attempt.attemptId),
    durationMs: phases.length === 0 ? null : durationMs,
    phases,
  });
}

function requireSingleIncludedTimingSlot(
  slots: readonly AnalysisSlot[],
): IncludedAnalysisSlot {
  const included = slots.filter((slot): slot is IncludedAnalysisSlot => slot.state === "included");
  if (included.length !== 1) {
    throw new Error("timing calculation requires exactly one included Slot");
  }
  return included[0]!;
}

function requireAvailableTimingView(
  timing: ProjectedSample<"attempt-slot", AttemptTimingView>,
  slot: IncludedAnalysisSlot,
): AttemptTimingView {
  const view = availableTimingView(timing, slot.runId, slot.slotId);
  if (view === undefined) {
    throw new Error("timing calculation requires an available timing view for its included Slot");
  }
  return view;
}

function availableTimingView(
  timing: ProjectedSample<"attempt-slot", AttemptTimingView>,
  runId: string,
  slotId: AnalysisSlot["slotId"],
): AttemptTimingView | undefined {
  for (const entry of timing.entries) {
    if (
      entry.state === "attachment-result"
      && entry.slot.runId === runId
      && entry.slot.slotId === slotId
      && entry.attachment.state === "available"
    ) {
      return entry.attachment.value;
    }
  }
  return undefined;
}

function publicPhasesFromTiming(view: AttemptTimingView): readonly PublicTimingPhaseRow[] {
  const rows: PublicTimingPhaseRow[] = [];
  const seen = new Set<string>();
  for (const interval of view.intervals) {
    if (interval.parentIntervalId !== null) continue;
    const name = publicPhaseName(interval.phase, interval.label);
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    rows.push(Object.freeze({ name, durationMs: interval.durationMs }));
  }
  return Object.freeze(rows);
}

function publicPhaseName(phase: string, label: string): PublicTimingPhase | undefined {
  if (isPublicTimingPhase(label)) return label;
  switch (phase) {
    case "sandbox.prepare":
      return "sandbox.prepare";
    case "agent.ensure":
      return "agent.ensure";
    case "eval.run":
      return "eval.run";
    case "assertion.evaluate":
      return "assertions.evaluate";
    case "attempt.teardown":
      return "agent.teardown";
    default:
      return undefined;
  }
}

function isPublicTimingPhase(value: string): value is PublicTimingPhase {
  return (PUBLIC_TIMING_PHASES as readonly string[]).includes(value);
}

function renderPublicTimingText(
  value: PublicTimingJson,
  view: AttemptTimingView | undefined,
  mode: "summary" | "full",
): string {
  if (value.phases.length === 0) {
    return `${value.locator}\n\nno public phase timing recorded`;
  }
  const lines = [value.locator, "", `total ${formatTimingDuration(value.durationMs)}`, ""];
  const roots = view === undefined
    ? []
    : view.intervals
      .filter((interval) => interval.parentIntervalId === null)
      .sort(compareTimingIntervals);
  const rootsByPhase = new Map<PublicTimingPhase, AttemptTimingView["intervals"][number]>();
  for (const root of roots) {
    const phase = publicPhaseName(root.phase, root.label);
    if (phase !== undefined && !rootsByPhase.has(phase)) rootsByPhase.set(phase, root);
  }
  const rendered = new Set<string>();
  for (const phase of value.phases) {
    lines.push(`${phase.name.padEnd(22)}${formatTimingDuration(phase.durationMs)}`);
    const root = rootsByPhase.get(phase.name);
    if (root !== undefined && view !== undefined) {
      rendered.add(root.intervalId);
      lines.push(...renderTimingChildren(view.intervals, root.intervalId, 1, mode, rendered));
    }
  }
  if (view !== undefined) {
    // The producer keeps an activity as a factual root when independently
    // rounded spans cannot prove containment. Do not hide those orphan roots.
    for (const root of roots) {
      if (rendered.has(root.intervalId)) continue;
      lines.push(renderTimingInterval(root, 0, mode));
      rendered.add(root.intervalId);
      lines.push(...renderTimingChildren(view.intervals, root.intervalId, 1, mode, rendered));
    }
  }
  return lines.join("\n");
}

function renderTimingChildren(
  intervals: AttemptTimingView["intervals"],
  parentIntervalId: string,
  depth: number,
  mode: "summary" | "full",
  rendered: Set<string>,
): readonly string[] {
  const lines: string[] = [];
  const children = intervals
    .filter((interval) => interval.parentIntervalId === parentIntervalId)
    .sort(compareTimingIntervals);
  for (const child of children) {
    lines.push(renderTimingInterval(child, depth, mode));
    rendered.add(child.intervalId);
    lines.push(...renderTimingChildren(intervals, child.intervalId, depth + 1, mode, rendered));
  }
  return lines;
}

function renderTimingInterval(
  interval: AttemptTimingView["intervals"][number],
  depth: number,
  mode: "summary" | "full",
): string {
  const outcome = interval.outcome === "completed" ? "" : ` · ${interval.outcome}`;
  const full = mode === "full"
    ? ` · interval ${interval.intervalId} · parent ${interval.parentIntervalId ?? "root"} · start ${formatTimingDuration(interval.startOffsetMs)}`
    : "";
  return `${"  ".repeat(depth)}${timingIntervalLabel(interval)}  ${formatTimingDuration(interval.durationMs)}${outcome}${full}`;
}

function compareTimingIntervals(
  left: AttemptTimingView["intervals"][number],
  right: AttemptTimingView["intervals"][number],
): number {
  return left.startOffsetMs - right.startOffsetMs || left.intervalId.localeCompare(right.intervalId);
}

function formatTimingDuration(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

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
        // `item.tool` is the source-native name supplied by the public
        // Conversation projector, not a Report-owned canonical fallback.
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

function timingBlocks(
  view: AttemptTimingView,
  mode: "summary" | "full" = "full",
): readonly ReportBlock[] {
  const depths = timingDepths(view.intervals);
  return [reportSection({
    heading: "Timing tree",
    children: [
      collectionStatus("Timing", view.collection),
      ...(view.intervals.length === 0
        ? [reportStatus({ tone: "warning", label: "No recorded timing intervals" })]
        : [mode === "summary" ? reportTable({
          caption: "Timing tree summary (record order)",
          columns: [
            { key: "depth", label: "Depth", align: "end" },
            { key: "phase", label: "Phase" },
            { key: "label", label: "Label" },
            { key: "duration", label: "Duration (ms)", align: "end" },
            { key: "outcome", label: "Outcome" },
          ],
          rows: view.intervals.map((interval) => ({
            depth: depths.get(interval.intervalId) ?? 0,
            phase: interval.phase,
            label: timingIntervalLabel(interval),
            duration: interval.durationMs,
            outcome: interval.outcome,
          })),
        }) : reportTable({
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
            label: timingIntervalLabel(interval),
            start: interval.startOffsetMs,
            duration: interval.durationMs,
            outcome: interval.outcome,
          })),
        })]),
    ],
  })];
}

function timingIntervalLabel(interval: AttemptTimingView["intervals"][number]): string {
  return interval.phase === "agent.send" ? `turn ${interval.label}` : interval.label;
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

function limitationText(limitation: ObservabilityLimitationView): string {
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
