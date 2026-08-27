import { Data } from "effect";
import type {
  InspectionDocument,
  InspectionJson,
} from "../inspection/index.ts";

export class ShowProjectionError extends Data.TaggedError(
  "ShowProjectionError",
)<{
  readonly operation: string;
  readonly path: string;
  readonly reason: string;
}> {}
export type MetricState =
  | "available"
  | "partial"
  | "unavailable"
  | "empty"
  | "unsupported"
  | "failed";
export type Verdict = "passed" | "failed" | "errored" | "skipped";
export type MembershipAction =
  | "executed"
  | "carried"
  | "accepted"
  | "not-dispatched"
  | "interrupted";
export type AttemptOutcome =
  | "completed"
  | "errored"
  | "cancelled"
  | "interrupted";
export type AgentTurnOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type SectionState =
  | "available"
  | "not-recorded"
  | "partial"
  | "unavailable";
export type ProjectionState =
  | "complete"
  | "partial"
  | "not-recorded"
  | "invalid";
export type SourceState = "available" | "not-recorded" | "invalid";
export type ScoreState = "not-scored" | "complete" | "unavailable";
export type ScoredValue =
  | { readonly state: "not-scored" }
  | {
      readonly state: "complete";
      readonly earned: number;
      readonly possible: number;
    }
  | {
      readonly state: "unavailable";
      readonly earned: number;
      readonly possible: number;
      readonly unavailable: number;
    };
export type SourceContent =
  | { readonly state: "available"; readonly text: string }
  | {
      readonly state: "omitted";
      readonly reason: "inspection-result-byte-limit";
      readonly byteLength: number;
      readonly byteLimit: number;
    };
export type AssertionSource =
  | {
      readonly state: "mapped";
      readonly sourceItemId: string;
      readonly sha256: string;
    }
  | {
      readonly state: "unmapped";
      readonly reason:
        | "source-snapshot-not-recorded"
        | "position-unrepresentable";
    };
export type TraceItemKind =
  | "message"
  | "thinking-summary"
  | "compaction"
  | "context-injection"
  | "subagent"
  | "input-request"
  | "skill-load"
  | "conversation-error"
  | "tool-call"
  | "tool-result";
export type CommandPhase =
  | "attempt.setup"
  | "sandbox.prepare"
  | "agent.ensure"
  | "eval.run"
  | "sandbox.command"
  | "attempt.teardown";
export type CommandOutcome = "exited" | "terminated" | "not-started";
export type Metric = {
  readonly state: MetricState;
  readonly value: number | null;
};
export type Aggregate = {
  readonly expected: number;
  readonly observed: number;
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
  readonly passRate: Metric;
  readonly score: Metric;
};
export interface OverviewView {
  readonly totals: Aggregate;
  readonly experiments: readonly {
    readonly experimentId: string;
    readonly aggregate: Aggregate;
  }[];
  readonly cells: readonly {
    readonly experimentId: string;
    readonly evalId: string;
    readonly aggregate: Aggregate;
    readonly members: readonly {
      readonly locator: string | null;
      readonly action: MembershipAction;
      readonly relation: "origin" | "reference" | null;
      readonly score: Metric;
    }[];
  }[];
}
export interface RunView {
  readonly runId: string;
  readonly experimentId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly expected: number;
  readonly observed: number;
  readonly members: readonly {
    readonly evalId: string;
    readonly locator: string | null;
    readonly state: MembershipAction | "missing";
    readonly verdict: Verdict | null;
    readonly score?: ScoredValue;
  }[];
}
export interface AttemptView {
  readonly locator: string;
  readonly verdict: Verdict | null;
  readonly attemptId: string;
  readonly evalId: string;
  readonly slotId: string;
  readonly outcome: AttemptOutcome;
  readonly originRunId: string;
  readonly experimentId: string;
  readonly score: ScoredValue;
  readonly sections: {
    readonly assertions: SectionState;
    readonly sources: SectionState;
    readonly trace: SectionState;
  };
  readonly assertions: {
    readonly state: SourceState;
    readonly entries: readonly {
      readonly entryId: string;
      readonly label?: string;
      readonly key?: string;
      readonly groupPath: readonly string[];
    }[];
  };
  readonly evidenceCoverage: readonly string[];
  readonly limitations: readonly string[];
}
export interface SourcesView {
  readonly locator: string;
  readonly state: SourceState;
  readonly items: readonly {
    readonly path: string;
    readonly sourceItemId: string;
    readonly byteLength: number;
    readonly content: SourceContent;
  }[];
  readonly assertions: {
    readonly state: SourceState;
    readonly sites: readonly {
      readonly entryId: string;
      readonly role:
        | "declaration"
        | "threshold"
        | "score"
        | "gate"
        | "optional"
        | "stop";
      readonly source: AssertionSource;
    }[];
  };
  readonly hasMore: boolean;
  readonly omittedItemCount: number;
}
type TraceItemBase = { readonly itemId: string; readonly sequence: number };
export type TraceItem = TraceItemBase &
  (
    | {
        readonly kind: "message";
        readonly role: "user" | "assistant";
        readonly text: string;
      }
    | {
        readonly kind: "tool-call";
        readonly tool: string;
        readonly input: string;
        readonly toolOccurrenceId?: string;
      }
    | {
        readonly kind: "tool-result";
        readonly outcome: "completed" | "rejected" | "failed" | "cancelled";
        readonly output: string;
        readonly toolOccurrenceId?: string;
      }
    | {
        readonly kind: "thinking-summary" | "compaction" | "context-injection";
        readonly summary: string;
      }
    | {
        readonly kind: "subagent";
        readonly state: "started" | "completed" | "failed";
        readonly label: string;
        readonly summary: string;
      }
    | {
        readonly kind: "input-request";
        readonly state: "requested" | "answered" | "cancelled";
        readonly prompt: string;
        readonly response: string | null;
      }
    | {
        readonly kind: "skill-load" | "conversation-error";
        readonly code: string;
        readonly summary: string;
      }
  );
export interface TraceView {
  readonly locator: string;
  readonly conversation: {
    readonly state: ProjectionState;
    readonly turns: readonly {
      readonly turnId: string;
      readonly sequence: number;
      readonly outcome: AgentTurnOutcome;
      readonly items: readonly TraceItem[];
    }[];
  };
  readonly commands: {
    readonly state: ProjectionState;
    readonly items: readonly {
      readonly commandId: string;
      readonly phase: CommandPhase;
      readonly outcome: CommandOutcome;
    }[];
  };
  readonly identities: {
    readonly itemIds: readonly string[];
    readonly toolOccurrenceIds: readonly string[];
    readonly commandIds: readonly string[];
  };
}
export interface TraceDetailView {
  readonly locator: string;
  readonly kind: "item" | "tool-occurrence" | "command";
  readonly stableId: string;
  readonly body: InspectionJson;
}
type O = Readonly<Record<string, InspectionJson>>;
const fail = (operation: string, path: string, reason: string): never => {
  throw new ShowProjectionError({ operation, path, reason });
};
const obj = (v: InspectionJson | undefined, o: string, p: string): O =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as O)
    : fail(o, p, "expected object");
const arr = (
  v: InspectionJson | undefined,
  o: string,
  p: string,
): readonly InspectionJson[] =>
  Array.isArray(v) ? v : fail(o, p, "expected array");
const str = (v: InspectionJson | undefined, o: string, p: string): string =>
  typeof v === "string" ? v : fail(o, p, "expected string");
const num = (v: InspectionJson | undefined, o: string, p: string): number =>
  typeof v === "number" ? v : fail(o, p, "expected number");
const bool = (v: InspectionJson | undefined, o: string, p: string): boolean =>
  typeof v === "boolean" ? v : fail(o, p, "expected boolean");
const nullable = (
  v: InspectionJson | undefined,
  o: string,
  p: string,
): string | null => (v === null ? null : str(v, o, p));
const optional = (
  v: InspectionJson | undefined,
  o: string,
  p: string,
): string | undefined => (v === undefined ? undefined : str(v, o, p));
function literal<const Values extends readonly string[]>(
  value: InspectionJson | undefined,
  operation: string,
  path: string,
  values: Values,
): Values[number] {
  const decoded = str(value, operation, path);
  return values.includes(decoded)
    ? decoded
    : fail(operation, path, `expected one of ${values.join(", ")}`);
}
const metricState = (v: InspectionJson | undefined, o: string, p: string) =>
  literal(v, o, p, [
    "available",
    "partial",
    "unavailable",
    "empty",
    "unsupported",
    "failed",
  ] as const);
const scoreState = (v: InspectionJson | undefined, o: string, p: string) =>
  literal(v, o, p, ["not-scored", "complete", "unavailable"] as const);
const verdict = (
  v: InspectionJson | undefined,
  o: string,
  p: string,
): Verdict | null =>
  v === null
    ? null
    : literal(v, o, p, ["passed", "failed", "errored", "skipped"] as const);
const action = (v: InspectionJson | undefined, o: string, p: string) =>
  literal(v, o, p, [
    "executed",
    "carried",
    "accepted",
    "not-dispatched",
    "interrupted",
  ] as const);
const outcome = (v: InspectionJson | undefined, o: string, p: string) =>
  literal(v, o, p, [
    "completed",
    "errored",
    "cancelled",
    "interrupted",
  ] as const);
const turnOutcome = (v: InspectionJson | undefined, o: string, p: string) =>
  literal(v, o, p, [
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ] as const);
const sectionState = (v: InspectionJson | undefined, o: string, p: string) =>
  literal(v, o, p, [
    "available",
    "not-recorded",
    "partial",
    "unavailable",
  ] as const);
const projectionState = (v: InspectionJson | undefined, o: string, p: string) =>
  literal(v, o, p, ["complete", "partial", "not-recorded", "invalid"] as const);
function root(d: InspectionDocument, o: string, f: string): O {
  if (d.operation !== o) fail(o, "operation", `expected ${o}`);
  return obj((d as unknown as O)[f], o, f);
}
function metric(v: InspectionJson | undefined, o: string, p: string): Metric {
  const x = obj(v, o, p),
    value = x.value;
  if (value !== null && typeof value !== "number")
    fail(o, `${p}.value`, "expected number or null");
  return {
    state: metricState(x.state, o, `${p}.state`),
    value: value as number | null,
  };
}
function aggregate(
  v: InspectionJson | undefined,
  o: string,
  p: string,
): Aggregate {
  const x = obj(v, o, p),
    d = obj(x.denominator, o, `${p}.denominator`),
    ver = obj(x.verdict, o, `${p}.verdict`),
    t = obj(ver.tally, o, `${p}.verdict.tally`);
  return {
    expected: num(d.expected, o, `${p}.expected`),
    observed: num(d.observed, o, `${p}.observed`),
    passed: num(t.passed, o, `${p}.passed`),
    failed: num(t.failed, o, `${p}.failed`),
    errored: num(t.errored, o, `${p}.errored`),
    skipped: num(t.skipped, o, `${p}.skipped`),
    passRate: metric(ver.passRate, o, `${p}.passRate`),
    score: metric(x.score, o, `${p}.score`),
  };
}
const scored = (
  v: InspectionJson | undefined,
  o: string,
  p: string,
): ScoredValue => {
  const x = obj(v, o, p);
  const state = scoreState(x.state, o, `${p}.state`);
  if (state === "not-scored") return { state };
  const earned = num(x.earned, o, `${p}.earned`);
  const possible = num(x.possible, o, `${p}.possible`);
  return state === "complete"
    ? { state, earned, possible }
    : {
        state,
        earned,
        possible,
        unavailable: num(x.unavailable, o, `${p}.unavailable`),
      };
};

function projectTraceItem(x: O, operation: string): TraceItem {
  const itemId = str(x.itemId, operation, "item.itemId");
  const sequence = num(x.sequence, operation, "item.sequence");
  const kind = literal(x.kind, operation, "item.kind", [
    "message",
    "thinking-summary",
    "compaction",
    "context-injection",
    "subagent",
    "input-request",
    "skill-load",
    "conversation-error",
    "tool-call",
    "tool-result",
  ] as const);
  const base = { itemId, sequence };
  if (kind === "message")
    return {
      ...base,
      kind,
      role: literal(x.role, operation, "item.role", [
        "user",
        "assistant",
      ] as const),
      text: str(x.text, operation, "item.text"),
    };
  if (
    kind === "thinking-summary" ||
    kind === "compaction" ||
    kind === "context-injection"
  )
    return {
      ...base,
      kind,
      summary: str(x.summary, operation, "item.summary"),
    };
  if (kind === "subagent")
    return {
      ...base,
      kind,
      state: literal(x.state, operation, "item.state", [
        "started",
        "completed",
        "failed",
      ] as const),
      label: str(x.label, operation, "item.label"),
      summary: str(x.summary, operation, "item.summary"),
    };
  if (kind === "input-request")
    return {
      ...base,
      kind,
      state: literal(x.state, operation, "item.state", [
        "requested",
        "answered",
        "cancelled",
      ] as const),
      prompt: str(x.prompt, operation, "item.prompt"),
      response: nullable(x.response, operation, "item.response"),
    };
  if (kind === "skill-load" || kind === "conversation-error")
    return {
      ...base,
      kind,
      code: str(x.code, operation, "item.code"),
      summary: str(x.summary, operation, "item.summary"),
    };
  const occurrence =
    typeof x.occurrence === "object" &&
    x.occurrence !== null &&
    !Array.isArray(x.occurrence)
      ? (x.occurrence as O)
      : undefined;
  const toolOccurrenceId =
    x.toolOccurrenceId !== undefined
      ? str(x.toolOccurrenceId, operation, "item.toolOccurrenceId")
      : occurrence?.state === "exact" &&
          occurrence.toolOccurrenceId !== undefined
        ? str(
            occurrence.toolOccurrenceId,
            operation,
            "item.occurrence.toolOccurrenceId",
          )
        : undefined;
  if (kind === "tool-call")
    return {
      ...base,
      kind,
      tool: str(x.tool, operation, "item.tool"),
      input: str(x.input, operation, "item.input"),
      ...(toolOccurrenceId === undefined ? {} : { toolOccurrenceId }),
    };
  return {
    ...base,
    kind,
    outcome: literal(x.outcome, operation, "item.outcome", [
      "completed",
      "rejected",
      "failed",
      "cancelled",
    ] as const),
    output: str(x.output, operation, "item.output"),
    ...(toolOccurrenceId === undefined ? {} : { toolOccurrenceId }),
  };
}

export function projectOverview(d: InspectionDocument): OverviewView {
  const o = "overview.get",
    x = root(d, o, "overview");
  return {
    totals: aggregate(x.totals, o, "totals"),
    experiments: arr(x.experiments, o, "experiments").map((v, i) => {
      const e = obj(v, o, `experiments.${i}`);
      return {
        experimentId: str(e.experimentId, o, "experimentId"),
        aggregate: aggregate(e, o, `experiments.${i}`),
      };
    }),
    cells: arr(x.cells, o, "cells").map((v, i) => {
      const c = obj(v, o, `cells.${i}`);
      return {
        experimentId: str(c.experimentId, o, "cell.experimentId"),
        evalId: str(c.evalId, o, "cell.evalId"),
        aggregate: aggregate(c, o, `cells.${i}`),
        members: arr(c.members, o, "cell.members").map((v) => {
          const m = obj(v, o, "member");
          return {
            locator: nullable(m.locator, o, "member.locator"),
            action: action(m.action, o, "member.action"),
            relation:
              m.relation === null
                ? null
                : literal(m.relation, o, "member.relation", [
                    "origin",
                    "reference",
                  ] as const),
            score: metric(m.score, o, "member.score"),
          };
        }),
      };
    }),
  };
}
export function projectRun(
  a: InspectionDocument,
  b: InspectionDocument,
): RunView {
  const o = "run.get",
    x = root(a, o, "run"),
    r = obj(x.value, o, "run.value"),
    s = root(b, "run.summary", "summary"),
    den = obj(s.denominator, "run.summary", "denominator");
  return {
    runId: str(r.runId, o, "runId"),
    experimentId: str(r.experimentId, o, "experimentId"),
    startedAt: num(r.startedAt, o, "startedAt"),
    completedAt: num(r.completedAt, o, "completedAt"),
    expected: num(den.expected, "run.summary", "expected"),
    observed: num(den.observed, "run.summary", "observed"),
    members: arr(s.members, "run.summary", "members").map((v) => {
      const m = obj(v, "run.summary", "member");
      return {
        evalId: str(m.evalId, "run.summary", "evalId"),
        locator: nullable(m.locator, "run.summary", "locator"),
        state:
          m.state === "missing"
            ? "missing"
            : action(m.state, "run.summary", "state"),
        verdict: verdict(m.verdict, "run.summary", "verdict"),
        ...(m.score === undefined
          ? {}
          : { score: scored(m.score, "run.summary", "score") }),
      };
    }),
  };
}
export function projectAttempt(d: InspectionDocument): AttemptView {
  const o = "attempt.get",
    a = root(d, o, "attempt"),
    c = obj(a.core, o, "core"),
    r = obj(a.originRun, o, "originRun"),
    s = obj(a.sections, o, "sections");
  const assertions = obj(a.assertions, o, "assertions");
  return {
    locator: str(a.locator, o, "locator"),
    verdict: verdict(a.verdict, o, "verdict"),
    attemptId: str(c.attemptId, o, "attemptId"),
    evalId: str(c.evalId, o, "evalId"),
    slotId: str(c.slotId, o, "slotId"),
    outcome: outcome(c.outcome, o, "outcome"),
    originRunId: str(c.originRunId, o, "originRunId"),
    experimentId: str(r.experimentId, o, "experimentId"),
    score: scored(a.score, o, "score"),
    sections: {
      assertions: sectionState(
        obj(s.assertions, o, "assertions").state,
        o,
        "assertions.state",
      ),
      sources: sectionState(
        obj(s.sources, o, "sources").state,
        o,
        "sources.state",
      ),
      trace: sectionState(obj(s.trace, o, "trace").state, o, "trace.state"),
    },
    assertions: {
      state: literal(assertions.state, o, "assertions.state", [
        "available",
        "not-recorded",
        "invalid",
      ] as const),
      entries: arr(assertions.entries, o, "assertions.entries").map(
        (value, index) => {
          const entry = obj(value, o, `assertions.entries.${index}`);
          const display = obj(
            entry.display,
            o,
            `assertions.entries.${index}.display`,
          );
          return {
            entryId: str(
              entry.entryId,
              o,
              `assertions.entries.${index}.entryId`,
            ),
            ...(display.label === undefined
              ? {}
              : {
                  label: str(
                    display.label,
                    o,
                    `assertions.entries.${index}.display.label`,
                  ),
                }),
            ...(display.key === undefined
              ? {}
              : {
                  key: str(
                    display.key,
                    o,
                    `assertions.entries.${index}.display.key`,
                  ),
                }),
            groupPath: arr(
              display.groupPath,
              o,
              `assertions.entries.${index}.display.groupPath`,
            ).map((value, part) =>
              str(
                value,
                o,
                `assertions.entries.${index}.display.groupPath.${part}`,
              ),
            ),
          };
        },
      ),
    },
    evidenceCoverage: arr(a.evidenceCoverage, o, "evidenceCoverage").map(
      (value) => JSON.stringify(value),
    ),
    limitations: arr(a.limitations, o, "limitations").map((value) =>
      JSON.stringify(value),
    ),
  };
}
export function projectSources(
  d: InspectionDocument,
  locator: string,
): SourcesView {
  const o = "attempt.sources",
    s = root(d, o, "sources"),
    a = obj(s.assertions, o, "assertions");
  return {
    locator,
    state: literal(s.state, o, "state", [
      "available",
      "not-recorded",
      "invalid",
    ] as const),
    items: arr(s.items, o, "items").map((v) => {
      const x = obj(v, o, "item"),
        c = obj(x.content, o, "content");
      return {
        path: str(x.path, o, "path"),
        sourceItemId: str(x.sourceItemId, o, "sourceItemId"),
        byteLength: num(x.byteLength, o, "byteLength"),
        content:
          c.state === "available"
            ? {
                state: "available" as const,
                text: str(c.text, o, "content.text"),
              }
            : c.state === "omitted"
              ? {
                  state: "omitted" as const,
                  reason: literal(c.reason, o, "content.reason", [
                    "inspection-result-byte-limit",
                  ] as const),
                  byteLength: num(c.byteLength, o, "content.byteLength"),
                  byteLimit: num(c.byteLimit, o, "content.byteLimit"),
                }
              : fail(o, "content.state", "expected available or omitted"),
      };
    }),
    assertions: {
      state: literal(a.state, o, "assertions.state", [
        "available",
        "not-recorded",
        "invalid",
      ] as const),
      sites:
        a.state === "available"
          ? arr(a.sourceSites, o, "sourceSites").map((v) => {
              const x = obj(v, o, "site"),
                src = obj(x.source, o, "site.source");
              return {
                entryId: str(x.entryId, o, "entryId"),
                role: literal(x.role, o, "role", [
                  "declaration",
                  "threshold",
                  "score",
                  "gate",
                  "optional",
                  "stop",
                ] as const),
                source:
                  src.state === "mapped"
                    ? {
                        state: "mapped" as const,
                        sourceItemId: str(src.sourceItemId, o, "sourceItemId"),
                        sha256: str(src.sha256, o, "source.sha256"),
                      }
                    : src.state === "unmapped"
                      ? {
                          state: "unmapped" as const,
                          reason: literal(src.reason, o, "source.reason", [
                            "source-snapshot-not-recorded",
                            "position-unrepresentable",
                          ] as const),
                        }
                      : fail(o, "source.state", "expected mapped or unmapped"),
              };
            })
          : [],
    },
    hasMore: bool(s.hasMore, o, "hasMore"),
    omittedItemCount: num(s.omittedItemCount, o, "omittedItemCount"),
  };
}
export function projectTrace(
  d: InspectionDocument,
  locator: string,
): TraceView {
  const o = "attempt.trace",
    t = root(d, o, "trace"),
    c = obj(t.conversation, o, "conversation"),
    flat = arr(c.items, o, "items").map((v, index) => {
      const item = obj(v, o, `items.${index}`);
      return {
        value: item,
        turnId: str(item.turnId, o, `items.${index}.turnId`),
      };
    }),
    commands = obj(t.commands, o, "commands"),
    idx = obj(t.identityIndex, o, "identityIndex"),
    tools = obj(idx.toolOccurrenceIds, o, "toolOccurrenceIds");
  const turns = arr(c.turns, o, "turns").map((v, index) => {
    const turn = obj(v, o, `turns.${index}`);
    return {
      value: turn,
      turnId: str(turn.turnId, o, `turns.${index}.turnId`),
    };
  });
  const turnIds = new Set(turns.map(({ turnId }) => turnId));
  const orphan = flat.find((item) => !turnIds.has(item.turnId));
  if (orphan !== undefined) {
    fail(
      o,
      "conversation.items.turnId",
      `orphan item references ${orphan.turnId}`,
    );
  }
  return {
    locator,
    conversation: {
      state: projectionState(c.state, o, "conversation.state"),
      turns: turns.map(({ value: turn, turnId }) => {
        return {
          turnId,
          sequence: num(turn.sequence, o, "sequence"),
          outcome: turnOutcome(turn.outcome, o, "outcome"),
          items: flat
            .filter((item) => item.turnId === turnId)
            .map(({ value }) => projectTraceItem(value, o)),
        };
      }),
    },
    commands: {
      state: projectionState(commands.state, o, "commands.state"),
      items: arr(commands.items, o, "commands.items").map((v) => {
        const x = obj(v, o, "command"),
          outcomeObject = obj(x.outcome, o, "outcome");
        return {
          commandId: str(x.commandId, o, "commandId"),
          phase: literal(x.phase, o, "phase", [
            "attempt.setup",
            "sandbox.prepare",
            "agent.ensure",
            "eval.run",
            "sandbox.command",
            "attempt.teardown",
          ] as const),
          outcome: literal(outcomeObject.kind, o, "outcome.kind", [
            "exited",
            "terminated",
            "not-started",
          ] as const),
        };
      }),
    },
    identities: {
      itemIds: arr(idx.itemIds, o, "itemIds").map((v) => str(v, o, "itemId")),
      toolOccurrenceIds: arr(tools.ids, o, "toolIds").map((v) =>
        str(v, o, "toolId"),
      ),
      commandIds: arr(idx.commandIds, o, "commandIds").map((v) =>
        str(v, o, "commandId"),
      ),
    },
  };
}
export function projectTraceDetail(
  d: InspectionDocument,
  locator: string,
): TraceDetailView {
  const o = "attempt.trace.detail",
    x = root(d, o, "detail"),
    raw = str(x.kind, o, "kind");
  const kind: TraceDetailView["kind"] =
    raw === "item"
      ? "item"
      : raw === "tool-occurrence"
        ? "tool-occurrence"
        : raw === "command"
          ? "command"
          : fail(o, "kind", "unknown detail kind");
  const key =
    kind === "item"
      ? "itemId"
      : kind === "tool-occurrence"
        ? "toolOccurrenceId"
        : "commandId";
  return { locator, kind, stableId: str(x[key], o, key), body: x };
}
