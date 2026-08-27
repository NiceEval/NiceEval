import type {
  Aggregate,
  AttemptView,
  Metric,
  OverviewView,
  RunView,
  ScoredValue,
  SourcesView,
  TraceDetailView,
  TraceItem,
  TraceView,
} from "./model.ts";
const fmt = (n: number) =>
  Number.isInteger(n)
    ? String(n)
    : n.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
const metric = (m: Metric) =>
  m.value === null ? m.state : `${fmt(m.value)} (${m.state})`;
const agg = (a: Aggregate) =>
  `${a.observed}/${a.expected} observed · ${a.passed} passed · ${a.failed} failed · ${a.errored} errored · ${a.skipped} skipped · pass rate ${metric(a.passRate)} · score ${metric(a.score)}`;
const score = (s: ScoredValue) =>
  s.state === "not-scored"
    ? s.state
    : `${fmt(s.earned)}/${fmt(s.possible)} (${s.state}${s.state === "unavailable" ? ` · ${s.unavailable} unavailable` : ""})`;
const indent = (v: string, n: number) =>
  v
    .split("\n")
    .map((x) => `${" ".repeat(n)}${x}`)
    .join("\n");
const table = (rows: readonly (readonly string[])[]) => {
  const w = rows[0]!.map((_, i) =>
    Math.min(40, Math.max(...rows.map((r) => (r[i] ?? "").length))),
  );
  return rows
    .map((r) =>
      r
        .map((c, i) =>
          (c.length <= w[i]! ? c : `${c.slice(0, w[i]! - 1)}…`).padEnd(w[i]!),
        )
        .join("  ")
        .trimEnd(),
    )
    .flatMap((x, i) =>
      i === 0 ? [x, w.map((n) => "─".repeat(n)).join("  ")] : [x],
    );
};
export function renderOverview(v: OverviewView): string {
  const lines = ["NiceEval results", "", `Totals  ${agg(v.totals)}`];
  if (v.experiments.length)
    lines.push(
      "",
      "Experiments",
      ...v.experiments.map((e) => `  ${e.experimentId}  ${agg(e.aggregate)}`),
    );
  if (v.cells.length) {
    const rows: string[][] = [
      ["Experiment", "Eval", "Attempt", "Action", "Relation", "Score"],
    ];
    for (const c of v.cells) {
      if (!c.members.length)
        rows.push([
          c.experimentId,
          c.evalId,
          "—",
          "missing",
          "—",
          metric(c.aggregate.score),
        ]);
      for (const m of c.members)
        rows.push([
          c.experimentId,
          c.evalId,
          m.locator ?? "—",
          m.action,
          m.relation ?? "—",
          metric(m.score),
        ]);
    }
    lines.push("", ...table(rows));
  }
  return `${lines.join("\n")}\n`;
}
export function renderRun(v: RunView): string {
  const lines = [
    `Run ${v.runId}`,
    `Experiment  ${v.experimentId}`,
    "State       sealed",
    `Started     ${new Date(v.startedAt).toISOString()}`,
    `Completed   ${new Date(v.completedAt).toISOString()}`,
    `Summary     ${v.observed}/${v.expected} attempts observed`,
  ];
  if (v.members.length)
    lines.push(
      "",
      ...table([
        ["Eval", "Attempt", "State", "Verdict", "Score"],
        ...v.members.map((m) => [
          m.evalId,
          m.locator ?? "—",
          m.state,
          m.verdict ?? "—",
          m.score === undefined ? "—" : score(m.score),
        ]),
      ]),
    );
  return `${lines.join("\n")}\n`;
}
export function renderAttempt(v: AttemptView): string {
  return `${[`${v.locator} · ${v.verdict ?? v.outcome}`, `Experiment  ${v.experimentId}`, `Eval        ${v.evalId}`, `Attempt     ${v.attemptId}`, `Slot        ${v.slotId}`, `Outcome     ${v.outcome}`, `Score       ${score(v.score)}`, "", "Evidence", `  assertions  ${v.sections.assertions} · ${v.assertions.entries.length} entries`, ...v.assertions.entries.map((entry) => `    ${entry.label ?? entry.key ?? entry.entryId}${entry.groupPath.length === 0 ? "" : ` · ${entry.groupPath.join(" / ")}`}`), `  source      ${v.sections.sources}`, `  execution   ${v.sections.trace}`, `  coverage    ${v.evidenceCoverage.length === 0 ? "none" : v.evidenceCoverage.join("; ")}`, `  limitations ${v.limitations.length === 0 ? "none" : v.limitations.join("; ")}`, "", "Next", `  niceeval show ${v.locator} --source`, `  niceeval show ${v.locator} --execution`, `  niceeval view --run ${v.originRunId}`].join("\n")}\n`;
}
export function renderSources(v: SourcesView): string {
  const lines = [`Captured source ${v.locator} · ${v.state}`];
  for (const x of v.items)
    lines.push(
      "",
      `${x.path} · ${x.sourceItemId} · ${x.byteLength} bytes`,
      indent(
        x.content.state === "available"
          ? x.content.text
          : `[omitted · ${x.content.reason} · ${x.content.byteLength}/${x.content.byteLimit} bytes]`,
        2,
      ),
    );
  lines.push(
    "",
    `Assertion source facts · ${v.assertions.state}`,
    ...v.assertions.sites.map(
      (s) =>
        `  ${s.entryId} · ${s.role} · ${s.source.state}${s.source.state === "mapped" ? ` · ${s.source.sourceItemId} · ${s.source.sha256}` : ` · ${s.source.reason}`}`,
    ),
  );
  if (v.hasMore)
    lines.push(
      `  … ${v.omittedItemCount} captured source items omitted by the fixed operation limit`,
    );
  return `${lines.join("\n")}\n`;
}
export function renderTrace(v: TraceView): string {
  const lines = [
    `Execution ${v.locator}`,
    "",
    `Conversation · ${v.conversation.state}`,
  ];
  for (const t of v.conversation.turns) {
    lines.push(`  ${t.turnId} · sequence ${t.sequence} · ${t.outcome}`);
    for (const x of t.items) {
      lines.push(`    ${x.itemId} · ${x.kind}${traceItemHeader(x)}`);
      lines.push(...renderTraceItemFields(x));
    }
  }
  lines.push(
    "",
    `Commands · ${v.commands.state}`,
    ...v.commands.items.map(
      (x) => `  ${x.commandId} · ${x.phase} · ${x.outcome}`,
    ),
    "",
    "Stable identities",
    ...v.identities.itemIds.map((x) => `  item             ${x}`),
    ...v.identities.toolOccurrenceIds.map((x) => `  tool occurrence  ${x}`),
    ...v.identities.commandIds.map((x) => `  command          ${x}`),
  );
  return `${lines.join("\n")}\n`;
}
function traceItemHeader(item: TraceItem): string {
  if (item.kind === "message") return ` · ${item.role}`;
  if (item.kind === "tool-call")
    return ` · ${item.tool}${item.toolOccurrenceId === undefined ? "" : ` · ${item.toolOccurrenceId}`}`;
  if (item.kind === "tool-result")
    return item.toolOccurrenceId === undefined
      ? ""
      : ` · ${item.toolOccurrenceId}`;
  return "";
}
function renderTraceItemFields(item: TraceItem): string[] {
  const field = (name: string, value: string | null) =>
    indent(`${name}: ${value === null ? "not-recorded" : value}`, 6);
  switch (item.kind) {
    case "message":
      return [field("text", item.text)];
    case "tool-call":
      return [field("input", item.input)];
    case "tool-result":
      return [field("outcome", item.outcome), field("output", item.output)];
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      return [field("summary", item.summary)];
    case "subagent":
      return [
        field("state", item.state),
        field("label", item.label),
        field("summary", item.summary),
      ];
    case "input-request":
      return [
        field("state", item.state),
        field("prompt", item.prompt),
        field("response", item.response),
      ];
    case "skill-load":
    case "conversation-error":
      return [field("code", item.code), field("summary", item.summary)];
  }
}
export function renderTraceDetail(v: TraceDetailView): string {
  return `Execution detail ${v.locator} · ${v.kind} · ${v.stableId}\n\n${JSON.stringify(v.body, null, 2)}\n`;
}
export function traceSelector(v: TraceView, id: string) {
  if (v.identities.itemIds.includes(id))
    return { kind: "item" as const, itemId: id };
  if (v.identities.toolOccurrenceIds.includes(id))
    return { kind: "tool-occurrence" as const, toolOccurrenceId: id };
  if (v.identities.commandIds.includes(id))
    return { kind: "command" as const, commandId: id };
  return undefined;
}
