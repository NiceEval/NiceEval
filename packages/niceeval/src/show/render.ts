import type {
  Aggregate,
  AttemptView,
  Metric,
  OverviewView,
  RunView,
  ScoredValue,
  SourcesView,
  TraceDetailView,
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
  s.earned !== undefined && s.possible !== undefined
    ? `${fmt(s.earned)}/${fmt(s.possible)} (${s.state})`
    : s.state;
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
          score(m.score),
        ]),
      ]),
    );
  return `${lines.join("\n")}\n`;
}
export function renderAttempt(v: AttemptView): string {
  return `${[`${v.locator} · ${v.verdict ?? v.outcome}`, `Experiment  ${v.experimentId}`, `Eval        ${v.evalId}`, `Attempt     ${v.attemptId}`, `Slot        ${v.slotId}`, `Outcome     ${v.outcome}`, `Score       ${score(v.score)}`, "", "Evidence", `  assertions  ${v.sections.assertions}`, `  source      ${v.sections.sources}`, `  execution   ${v.sections.trace}`, "", "Next", `  niceeval show ${v.locator} --source`, `  niceeval show ${v.locator} --execution`, `  niceeval view --run ${v.originRunId}`].join("\n")}\n`;
}
export function renderSources(v: SourcesView): string {
  const lines = [`Captured source ${v.locator} · ${v.state}`];
  for (const x of v.items)
    lines.push(
      "",
      `${x.path} · ${x.sourceItemId} · ${x.byteLength} bytes`,
      indent(x.content.text ?? `[${x.content.state}]`, 2),
    );
  lines.push(
    "",
    `Assertion source facts · ${v.assertions.state}`,
    ...v.assertions.sites.map(
      (s) =>
        `  ${s.entryId} · ${s.role} · ${s.state}${s.sourceItemId === undefined ? "" : ` · ${s.sourceItemId}`}`,
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
      lines.push(
        `    ${x.itemId} · ${x.kind}${x.role ? ` · ${x.role}` : ""}${x.tool ? ` · ${x.tool}` : ""}${x.toolOccurrenceId ? ` · ${x.toolOccurrenceId}` : ""}`,
      );
      for (const [k, z] of [
        ["text", x.text],
        ["input", x.input],
        ["output", x.output],
      ] as const)
        if (z !== undefined) lines.push(indent(`${k}: ${z}`, 6));
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
