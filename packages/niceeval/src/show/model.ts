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
export type TraceItemKind =
  | "message"
  | "data"
  | "skill"
  | "subagent"
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
    readonly score: ScoredValue;
  }[];
}
export interface ScoredValue {
  readonly state: ScoreState;
  readonly earned?: number;
  readonly possible?: number;
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
}
export interface SourcesView {
  readonly locator: string;
  readonly state: SourceState;
  readonly items: readonly {
    readonly path: string;
    readonly sourceItemId: string;
    readonly byteLength: number;
    readonly content: {
      readonly state: "available" | "omitted";
      readonly text?: string;
    };
  }[];
  readonly assertions: {
    readonly state: SourceState;
    readonly sites: readonly {
      readonly entryId: string;
      readonly role: "declaration" | "threshold" | "score";
      readonly state: "mapped" | "unmapped";
      readonly sourceItemId?: string;
    }[];
  };
  readonly hasMore: boolean;
  readonly omittedItemCount: number;
}
export interface TraceItem {
  readonly itemId: string;
  readonly kind: TraceItemKind;
  readonly role?: string;
  readonly tool?: string;
  readonly toolOccurrenceId?: string;
  readonly text?: string;
  readonly input?: string;
  readonly output?: string;
}
export interface TraceView {
  readonly locator: string;
  readonly conversation: {
    readonly state: ProjectionState;
    readonly turns: readonly {
      readonly turnId: string;
      readonly sequence: number;
      readonly outcome: AttemptOutcome;
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
  return {
    state: scoreState(x.state, o, `${p}.state`),
    ...(typeof x.earned === "number" ? { earned: x.earned } : {}),
    ...(typeof x.possible === "number" ? { possible: x.possible } : {}),
  };
};

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
        score: scored(m.score, "run.summary", "score"),
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
        content: {
          state: literal(c.state, o, "content.state", [
            "available",
            "omitted",
          ] as const),
          ...(c.text === undefined
            ? {}
            : { text: str(c.text, o, "content.text") }),
        },
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
                ] as const),
                state: literal(src.state, o, "source.state", [
                  "mapped",
                  "unmapped",
                ] as const),
                ...(src.sourceItemId === undefined
                  ? {}
                  : { sourceItemId: str(src.sourceItemId, o, "sourceItemId") }),
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
    flat = arr(c.items, o, "items").map((v) => obj(v, o, "item")),
    commands = obj(t.commands, o, "commands"),
    idx = obj(t.identityIndex, o, "identityIndex"),
    tools = obj(idx.toolOccurrenceIds, o, "toolOccurrenceIds");
  return {
    locator,
    conversation: {
      state: projectionState(c.state, o, "conversation.state"),
      turns: arr(c.turns, o, "turns").map((v) => {
        const turn = obj(v, o, "turn"),
          turnId = str(turn.turnId, o, "turnId");
        return {
          turnId,
          sequence: num(turn.sequence, o, "sequence"),
          outcome: outcome(turn.outcome, o, "outcome"),
          items: flat
            .filter((x) => x.turnId === turnId)
            .map((x) => {
              const occurrence =
                typeof x.occurrence === "object" &&
                x.occurrence !== null &&
                !Array.isArray(x.occurrence)
                  ? (x.occurrence as O)
                  : undefined;
              return {
                itemId: str(x.itemId, o, "itemId"),
                kind: literal(x.kind, o, "kind", [
                  "message",
                  "data",
                  "skill",
                  "subagent",
                  "tool-call",
                  "tool-result",
                ] as const),
                ...(x.role === undefined
                  ? {}
                  : { role: str(x.role, o, "role") }),
                ...(x.tool === undefined
                  ? {}
                  : { tool: str(x.tool, o, "tool") }),
                ...(occurrence?.toolOccurrenceId === undefined
                  ? {}
                  : {
                      toolOccurrenceId: str(
                        occurrence.toolOccurrenceId,
                        o,
                        "toolOccurrenceId",
                      ),
                    }),
                ...(x.text === undefined
                  ? {}
                  : { text: str(x.text, o, "text") }),
                ...(x.input === undefined
                  ? {}
                  : { input: str(x.input, o, "input") }),
                ...(x.output === undefined
                  ? {}
                  : { output: str(x.output, o, "output") }),
              };
            }),
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
