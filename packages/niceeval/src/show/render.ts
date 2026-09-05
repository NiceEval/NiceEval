import {
  renderTerminal,
  type TerminalBlock,
  type TerminalPanelContentBlock,
} from "../terminal/index.ts";
import type {
  Aggregate,
  AttemptView,
  DiffView,
  ExperimentView,
  ExecutionValue,
  Metric,
  OverviewView,
  RunView,
  ScoredValue,
  SourcesView,
  TimingView,
  TraceDetailView,
  TraceItem,
  TraceView,
  UsageView,
} from "./model.ts";

const TERMINAL_OPTIONS = Object.freeze({ width: 80, mode: "plain" as const });

const terminal = (blocks: readonly TerminalBlock[]): string =>
  renderTerminal(blocks, TERMINAL_OPTIONS);

const fmt = (value: number): string =>
  Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");

const metric = (
  value: Metric,
  formatValue: (value: number) => string = fmt,
): string => {
  if (value.value === null) return value.state;
  const rendered = formatValue(value.value);
  return value.state === "available"
    ? rendered
    : `${rendered} (${value.state})`;
};

const passRate = (value: Metric): string =>
  metric(value, (rate) => `${fmt(rate * 100)}%`);

const duration = (value: Metric): string => metric(value, (milliseconds) => {
  if (milliseconds < 1_000) return `${fmt(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${fmt(milliseconds / 1_000)} s`;
  if (milliseconds < 3_600_000) return `${fmt(milliseconds / 60_000)} min`;
  return `${fmt(milliseconds / 3_600_000)} h`;
});

const score = (value: ScoredValue): string =>
  value.state === "not-scored"
    ? value.state
    : `${fmt(value.earned)}/${fmt(value.possible)} (${value.state}${
      value.state === "unavailable"
        ? `; ${value.unavailable} unavailable`
        : ""
    })`;

const aggregateEntries = (
  value: Aggregate,
): TerminalPanelContentBlock & { readonly kind: "keyValue" } => ({
  kind: "keyValue",
  entries: [
    { key: "Observed", value: `${value.observed}/${value.expected}` },
    ...(value.evaluationKind === "points"
      ? [{
        key: "Outcomes",
        value: `${value.passed} scored; ${value.errored} errored; ${value.skipped} skipped`,
      }]
      : [{
        key: "Verdicts",
        value: value.failed === 0 && value.errored === 0 && value.skipped === 0
          ? `${value.passed} passed`
          : `${value.passed} passed; ${value.failed} failed; ${value.errored} errored; ${value.skipped} skipped`,
      }, { key: "Pass rate", value: passRate(value.passRate) }]),
    ...(value.evaluationKind === "pass"
      ? []
      : [{ key: "Score", value: metric(value.score) }]),
    { key: "Duration", value: duration(value.durationMs) },
    { key: "Tokens", value: metric(value.tokens) },
  ],
});

interface ExperimentGroup {
  readonly name: string | null;
  readonly experiments: OverviewView["experiments"];
}

function experimentGroup(experimentId: string): string | null {
  const separator = experimentId.indexOf("/");
  return separator <= 0 ? null : experimentId.slice(0, separator);
}

function relativeToGroup(id: string, group: string | null): string {
  const prefix = group === null ? "" : `${group}/`;
  return prefix !== "" && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function groupExperiments(value: OverviewView): readonly ExperimentGroup[] {
  const groups = new Map<string | null, OverviewView["experiments"][number][]>();
  for (const experiment of value.experiments) {
    const group = experimentGroup(experiment.experimentId);
    const members = groups.get(group) ?? [];
    members.push(experiment);
    groups.set(group, members);
  }
  return [...groups].map(([name, experiments]) => ({ name, experiments }));
}

const attemptBlocks = (
  cells: OverviewView["cells"],
  group: string | null,
  all: boolean,
): readonly TerminalPanelContentBlock[] => {
  let shownErrors = 0;
  return cells.flatMap((cell) => {
    const showScore = cell.aggregate.evaluationKind !== "pass";
    const showScoreOutcome = cell.aggregate.evaluationKind === "points";
    const members = all
      ? cell.members
      : cell.members.filter((member) => {
        if (member.publication.state !== "published") return true;
        if (
          member.publication.verdict === "passed" ||
          member.publication.verdict === "failed"
        ) return false;
        if (member.publication.verdict !== "errored") return true;
        shownErrors += 1;
        return shownErrors <= 5;
      });
    if (cell.members.length > 0 && members.length === 0) return [];
    return [
    {
      kind: "divider" as const,
      title: `Eval ${relativeToGroup(cell.evalId, group)}`,
      attachNext: true,
    },
    {
      kind: "table" as const,
      columns: [
        { header: "Attempt", maxWidth: 14 },
        { header: showScoreOutcome ? "Outcome" : "Verdict" },
        { header: "Duration" },
        ...(showScore ? [{ header: "Score" }] : []),
      ],
      overflow: "wrap" as const,
      rows: members.length === 0
        ? [[
          "not-recorded",
          "not-recorded",
          duration(cell.aggregate.durationMs),
          ...(showScore ? [metric(cell.aggregate.score)] : []),
        ]]
        : members.map((member) => [
          member.publication.state === "published"
            ? member.publication.attemptLocator
            : member.publication.state === "absent"
              ? `absent (${member.publication.reason})`
              : "pending",
          member.publication.state === "published"
            ? showScoreOutcome
              ? member.publication.verdict === "passed"
                ? "scored"
                : member.publication.verdict ?? "not-recorded"
              : member.publication.verdict ?? "not-recorded"
            : member.publication.state,
          member.publication.state === "published"
            ? duration(member.publication.durationMs)
            : member.publication.state,
          ...(showScore
            ? [member.publication.state === "published"
              ? metric(member.publication.score)
              : member.publication.state]
            : []),
        ]),
    },
    ];
  });
};

const hiddenAttemptSummary = (cells: OverviewView["cells"]): string | null => {
  const counts = { passed: 0, failed: 0, scored: 0, errored: 0 };
  for (const cell of cells) {
    for (const member of cell.members) {
      if (member.publication.state !== "published") continue;
      const verdict = member.publication.verdict;
      if (verdict === "passed") {
        counts[cell.aggregate.evaluationKind === "points" ? "scored" : "passed"] += 1;
      } else if (verdict === "failed" || verdict === "errored") {
        counts[verdict] += 1;
      }
    }
  }
  const hidden = [
    ...(counts.passed > 0 ? [`${counts.passed} passed`] : []),
    ...(counts.failed > 0 ? [`${counts.failed} failed`] : []),
    ...(counts.scored > 0 ? [`${counts.scored} scored`] : []),
    ...(counts.errored > 5 ? [`${counts.errored - 5} errored`] : []),
  ];
  return hidden.length === 0 ? null : `${hidden.join("; ")} Attempts hidden`;
};

const compactContinuation = (
  cells: OverviewView["cells"],
  experimentId: string,
  all: boolean,
): readonly TerminalPanelContentBlock[] => {
  if (all) return [];
  const hidden = hiddenAttemptSummary(cells);
  return hidden === null
    ? []
    : [
      {
        kind: "divider",
        title: hidden,
        attachNext: true,
      },
      {
        kind: "keyValue",
        entries: [{
          key: "See more",
          value: `niceeval show --experiment ${experimentId}`,
        }],
      },
    ];
};

const stateCount = (state: string, count: number, noun: string): string =>
  `${state}; ${count} ${noun}s`;

const textOrNotRecorded = (value: string | null | undefined): string =>
  value ?? "not-recorded";

export function renderOverview(
  value: OverviewView,
  options: { readonly all?: boolean } = {},
): string {
  const all = options.all === true;
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: "NiceEval results",
      blocks: [
        { kind: "divider", title: "Totals" },
        aggregateEntries(value.totals),
      ],
    },
  ];
  if (value.experiments.length > 0) {
    const groups = groupExperiments(value);
    blocks.push({
      kind: "panel",
      title: "Experiments",
      blocks: groups.flatMap((group) => {
        const showPassRate = group.experiments.some(({ aggregate }) =>
          aggregate.evaluationKind !== "points"
        );
        const showScore = group.experiments.some(({ aggregate }) =>
          aggregate.evaluationKind !== "pass"
        );
        return [
          ...(group.name === null
            ? []
            : [{ kind: "divider" as const, title: group.name }]),
          {
            kind: "table" as const,
            columns: [
              { header: "Experiment" },
              { header: "Observed" },
              { header: "Agent" },
              { header: "Model" },
              ...(showPassRate ? [{ header: "Pass rate" }] : []),
              ...(showScore ? [{ header: "Score" }] : []),
            ],
            rows: group.experiments.map((experiment) => [
              relativeToGroup(experiment.experimentId, group.name),
              `${experiment.aggregate.observed}/${experiment.aggregate.expected}`,
              executionValue(experiment.agent),
              executionValue(experiment.model),
              ...(showPassRate ? [passRate(experiment.aggregate.passRate)] : []),
              ...(showScore ? [metric(experiment.aggregate.score)] : []),
            ]),
          },
        ];
      }),
    });
  }
  if (value.cells.length > 0) {
    for (const group of groupExperiments(value)) {
      const experimentIds = new Set(group.experiments.map(({ experimentId }) => experimentId));
      const cells = value.cells.filter(({ experimentId }) => experimentIds.has(experimentId));
      blocks.push({
        kind: "panel",
        title: group.name === null ? "Attempts" : `Attempts · ${group.name}`,
        blocks: group.experiments.flatMap((experiment) => {
          const experimentCells = cells.filter(({ experimentId }) =>
            experimentId === experiment.experimentId
          );
          return [
            {
              kind: "divider" as const,
              title: `Experiment ${experiment.experimentId}`,
              attachNext: true,
            },
            ...attemptBlocks(experimentCells, group.name, all),
            ...compactContinuation(experimentCells, experiment.experimentId, all),
          ];
        }),
      });
    }
  }
  return terminal(blocks);
}

export function renderExperiment(value: ExperimentView): string {
  return terminal([
    {
      kind: "panel",
      title: `Experiment ${value.experimentId}`,
      blocks: [
        { kind: "divider", title: "Summary" },
        aggregateEntries(value.aggregate),
        { kind: "divider", title: "Attempts" },
        ...attemptBlocks(value.cells, null, true),
      ],
    },
  ]);
}

function executionValue(value: ExecutionValue): string {
  return value.state === "available" ? value.value : value.state;
}

export function renderRun(value: RunView): string {
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: `Run ${value.runId}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Experiment", value: value.experimentId },
            { key: "State", value: "sealed" },
            { key: "Started", value: new Date(value.startedAt).toISOString() },
            {
              key: "Completed",
              value: new Date(value.completedAt).toISOString(),
            },
            {
              key: "Summary",
              value: `${value.observed}/${value.expected} attempts observed`,
            },
          ],
        },
        { kind: "divider", title: "Coverage" },
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: value.coverage.state },
            {
              key: "Members",
              value: `${value.coverage.observedMemberCount}/${value.coverage.expectedMemberCount} observed; ${value.coverage.completeMemberCount} complete`,
            },
            { key: "Facts", value: String(value.coverage.factCount) },
            {
              key: "Limitations",
              value: String(value.coverage.limitations.length),
            },
          ],
        },
        { kind: "divider", title: "Usage" },
        runUsageBlocks(value.usage),
        { kind: "divider", title: "Limitations" },
        runLocatedLimitationTable(value.limitations),
      ],
    },
  ];
  for (const member of value.members) {
    blocks.push({
      kind: "panel",
      title: `Member ${member.slotId}`,
      meta: member.state,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Eval", value: member.evalId },
            { key: "Attempt ordinal", value: String(member.attemptOrdinal) },
            { key: "Attempt", value: member.locator ?? "not-recorded" },
            { key: "Relation", value: member.relation ?? "not-recorded" },
            { key: "Outcome", value: member.outcome ?? "not-recorded" },
            { key: "Verdict", value: member.verdict ?? "not-recorded" },
            {
              key: "Score",
              value: member.score === null ? "not-recorded" : score(member.score),
            },
          ],
        },
        { kind: "divider", title: "Coverage" },
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: member.coverage.state },
            { key: "Facts", value: String(member.coverage.facts.length) },
            {
              key: "Limitations",
              value: String(member.coverage.limitations.length),
            },
          ],
        },
        { kind: "divider", title: "Usage" },
        memberUsageBlocks(member.usage),
        { kind: "divider", title: "Limitations" },
        runMemberLimitationTable(member.limitations),
      ],
    });
  }
  return terminal(blocks);
}

function runUsageBlocks(
  value: RunView["usage"],
): TerminalPanelContentBlock & { readonly kind: "keyValue" } {
  return {
    kind: "keyValue",
    entries: [
      { key: "State", value: value.state },
      {
        key: "Members",
        value: `${value.observedMemberCount}/${value.expectedMemberCount} observed; ${value.recordedAttemptCount} recorded attempts`,
      },
      ...usageTotalEntries(value.totals),
      { key: "Limitations", value: String(value.limitations.length) },
    ],
  };
}

function memberUsageBlocks(
  value: RunView["members"][number]["usage"],
): TerminalPanelContentBlock & { readonly kind: "keyValue" } {
  return {
    kind: "keyValue",
    entries: [
      { key: "State", value: value.state },
      {
        key: "Summary",
        value: value.summary === null
          ? "not-recorded"
          : `${value.summary.turnCount} turns; ${value.summary.observationCount} observations`,
      },
      ...usageTotalEntries(value.totals),
      {
        key: "Limitations",
        value: boundedPreview(
          value.limitations.length,
          value.limitationsTruncated,
          value.omittedLimitationCount,
        ),
      },
    ],
  };
}

type RunMemberLimitation = RunView["members"][number]["limitations"][number];

function runMemberLimitationTable(
  values: readonly RunMemberLimitation[],
): TerminalPanelContentBlock & { readonly kind: "table" } {
  return {
    kind: "table",
    columns: [{ header: "Limitation" }],
    rows: values.map((value) => [formatRunMemberLimitation(value)]),
    overflow: "wrap",
  };
}

function runLocatedLimitationTable(
  values: RunView["limitations"],
): TerminalPanelContentBlock & { readonly kind: "table" } {
  return {
    kind: "table",
    columns: [
      { header: "Slot" },
      { header: "Attempt" },
      { header: "Limitation" },
    ],
    rows: values.map((value) => [
      value.slotId,
      value.locator ?? "not-recorded",
      formatRunMemberLimitation(value.limitation),
    ]),
    overflow: "wrap",
  };
}

function formatRunMemberLimitation(value: RunMemberLimitation): string {
  switch (value.kind) {
    case "member-not-observed":
      return `${value.kind}; ${value.state}`;
    case "attempt-unresolved":
      return `${value.kind}; run ${value.originRunId}; attempt ${value.attemptId}`;
    case "coverage":
      return `${value.kind}; ${formatAttemptLimitation(value.detail)}`;
    case "usage":
      return `${value.kind}; ${formatUsageLimitation(value.detail)}`;
  }
}

type AttemptLimitation = RunView["members"][number]["coverage"]["limitations"][number];

function formatAttemptLimitation(value: AttemptLimitation): string {
  if ("channel" in value) {
    return `${value.channel}; ${value.status}${value.reason === undefined ? "" : `; ${value.reason}`}`;
  }
  return `assertion-material; ${value.state}; ${value.reason}; ${value.limitations.length} material limitations`;
}

export function renderAttempt(value: AttemptView): string {
  return terminal([
    {
      kind: "panel",
      title: `Attempt ${value.locator}`,
      meta: value.verdict ?? value.outcome,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Experiment", value: value.experimentId },
            { key: "Eval", value: value.evalId },
            { key: "Run", value: value.originRunId },
            { key: "Attempt", value: value.attemptId },
            { key: "Slot", value: value.slotId },
            { key: "Outcome", value: value.outcome },
            { key: "Verdict", value: value.verdict ?? "not-available" },
            { key: "Score", value: score(value.score) },
          ],
        },
        {
          kind: "divider",
          title: `assertions ${value.sections.assertions} · ${value.assertions.entries.length} entries`,
        },
        {
          kind: "keyValue",
          entries: [
            {
              key: "Summary",
              value: stateCount(
                value.sections.assertions,
                value.assertions.entries.length,
                "entry",
              ),
            },
          ],
        },
        {
          kind: "table",
          columns: [
            { header: "Assertion" },
            { header: "Entry ID" },
            { header: "Group" },
          ],
          rows: value.assertions.entries.map((entry) => [
            entry.label ?? entry.key ?? entry.entryId,
            entry.entryId,
            entry.groupPath.length === 0 ? "root" : entry.groupPath.join(" / "),
          ]),
        },
        { kind: "divider", title: "Evidence" },
        {
          kind: "keyValue",
          entries: [
            {
              key: "coverage",
              value: value.evidenceCoverage.length === 0
                ? "none"
                : value.evidenceCoverage.join("; "),
            },
            {
              key: "limitations",
              value: value.limitations.length === 0
                ? "none"
                : value.limitations.join("; "),
            },
          ],
        },
        { kind: "divider", title: "Sections" },
        {
          kind: "keyValue",
          entries: [
            { key: "Source", value: value.sections.sources },
            { key: "Execution", value: value.sections.trace },
            { key: "Timing", value: value.sections.timing },
            { key: "Usage", value: value.sections.usage },
            { key: "Diff", value: value.sections.diff },
          ],
        },
        { kind: "divider", title: "Next" },
        { kind: "command", command: `niceeval show ${value.locator} --source` },
        {
          kind: "command",
          command: `niceeval show ${value.locator} --execution`,
        },
        { kind: "command", command: `niceeval show ${value.locator} --timing` },
        { kind: "command", command: `niceeval show ${value.locator} --usage` },
        { kind: "command", command: `niceeval show ${value.locator} --diff` },
      ],
    },
  ]);
}

export function renderSources(value: SourcesView): string {
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: `Captured source ${value.locator}`,
      meta: value.state,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: value.state },
            { key: "Captured items", value: String(value.items.length) },
            {
              key: "Omitted items",
              value: value.hasMore ? String(value.omittedItemCount) : "0",
            },
          ],
        },
      ],
    },
  ];
  for (const item of value.items) {
    blocks.push({
      kind: "panel",
      title: `${item.path} · ${item.sourceItemId} · ${item.byteLength} bytes`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Bytes", value: String(item.byteLength) },
            { key: "Content", value: item.content.state },
            ...(item.content.state === "omitted"
              ? [
                { key: "Reason", value: item.content.reason },
                {
                  key: "Byte limit",
                  value: `${item.content.byteLimit}/${item.content.byteLength} retained`,
                },
              ]
              : []),
          ],
        },
      ],
    });
    if (item.content.state === "available") {
      blocks.push({ kind: "code", text: item.content.text });
    }
  }
  blocks.push(
    {
      kind: "panel",
      title: "Assertion source facts",
      meta: value.assertions.state,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            {
              key: "Source sites",
              value: String(value.assertions.sites.length),
            },
            {
              key: "Omitted source sites",
              value: value.assertions.hasMoreSourceSites === true
                ? String(value.assertions.omittedSourceSiteCount ?? 0)
                : "0",
            },
          ],
        },
      ],
    },
    {
      kind: "raw",
      text: value.assertions.sites.map((site) =>
        `${site.entryId} · ${site.role} · ${sourceRange(site.start, site.end)} · ${
          site.source.state === "mapped"
            ? `mapped · ${site.source.sourceItemId} · ${site.source.sha256}`
            : `unmapped · ${site.source.reason}`
        }`
      ).join("\n"),
    },
  );
  return terminal(blocks);
}

function sourceRange(
  start: SourcesView["assertions"]["sites"][number]["start"],
  end: SourcesView["assertions"]["sites"][number]["end"],
): string {
  return `start ${start.line}:${start.column} · end ${end.line}:${end.column}`;
}

export function renderTrace(value: TraceView): string {
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: `Execution ${value.locator}`,
      blocks: [],
    },
    {
      kind: "panel",
      title: `Conversation · ${value.conversation.state}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            {
              key: "Turns",
              value: boundedPreview(
                value.conversation.turns.length,
                value.conversation.turnsTruncated,
                value.conversation.omittedTurnCount,
              ),
            },
            {
              key: "Items",
              value: boundedPreview(
                value.conversation.itemCount,
                value.conversation.itemsTruncated,
                value.conversation.omittedItemCount,
              ),
            },
            {
              key: "Limitations",
              value: boundedPreview(
                value.conversation.limitations.length,
                value.conversation.limitationsTruncated,
                value.conversation.omittedLimitationCount,
              ),
            },
          ],
        },
        { kind: "divider", title: "Limitations" },
        limitationTable(value.conversation.limitations),
      ],
    },
  ];
  for (const turn of value.conversation.turns) {
    blocks.push({
      kind: "panel",
      title: `Turn ${turn.turnId}`,
      meta: turn.outcome,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Sequence", value: String(turn.sequence) },
            { key: "Items", value: String(turn.items.length) },
          ],
        },
      ],
    });
    for (const item of turn.items) blocks.push(...traceItemBlocks(item));
  }
  blocks.push({
    kind: "panel",
    title: `Commands · ${value.commands.state}`,
    blocks: [
      {
        kind: "keyValue",
        entries: [
          {
            key: "Items",
            value: boundedPreview(
              value.commands.items.length,
              value.commands.hasMore,
              value.commands.omittedCommandCount,
            ),
          },
          {
            key: "Limitations",
            value: boundedPreview(
              value.commands.limitations.length,
              value.commands.limitationsTruncated,
              value.commands.omittedLimitationCount,
            ),
          },
        ],
      },
      { kind: "divider", title: "Limitations" },
      limitationTable(value.commands.limitations),
      { kind: "divider", title: "Command outline" },
      {
        kind: "table",
        columns: [
          { header: "Command ID" },
          { header: "Phase" },
          { header: "Outcome" },
        ],
        rows: value.commands.items.map((command) => [
          command.commandId,
          command.phase,
          command.outcome,
        ]),
      },
    ],
  });
  blocks.push({
    kind: "panel",
    title: `Diagnostics · ${value.diagnostics.state}`,
    blocks: [
      {
        kind: "keyValue",
        entries: [
          {
            key: "Items",
            value: boundedPreview(
              value.diagnostics.items.length,
              value.diagnostics.hasMore,
              value.diagnostics.omittedDiagnosticCount,
            ),
          },
          {
            key: "Limitations",
            value: boundedPreview(
              value.diagnostics.limitations.length,
              value.diagnostics.limitationsTruncated,
              value.diagnostics.omittedLimitationCount,
            ),
          },
        ],
      },
      { kind: "divider", title: "Limitations" },
      limitationTable(value.diagnostics.limitations),
      { kind: "divider", title: "Diagnostic outline" },
      {
        kind: "table",
        columns: [
          { header: "Diagnostic ID" },
          { header: "Phase" },
          { header: "Kind" },
          { header: "Code" },
          { header: "Summary" },
        ],
        rows: value.diagnostics.items.map((diagnostic) => [
          diagnostic.diagnosticId,
          diagnostic.phase,
          diagnostic.kind,
          diagnostic.code,
          diagnostic.summary,
        ]),
        overflow: "wrap",
      },
    ],
  });
  blocks.push(
    { kind: "panel", title: "Stable identities", blocks: [] },
    {
      kind: "raw",
      text: [
        ...value.identities.itemIds.map((id) => `item ${id}`),
        ...value.identities.toolOccurrenceIds.map((id) =>
          `tool occurrence ${id}`
        ),
        ...value.identities.commandIds.map((id) => `command ${id}`),
      ].join("\n"),
    },
  );
  return terminal(blocks);
}

function boundedPreview(
  shown: number,
  truncated: boolean,
  omitted: number,
): string {
  return `${shown} shown; ${truncated ? `bounded preview, ${omitted} omitted` : "complete preview, 0 omitted"}`;
}

type ProjectionLimitation =
  | TimingView["limitations"][number]
  | TraceView["conversation"]["limitations"][number]
  | TraceView["diagnostics"]["limitations"][number];

function limitationTable(
  limitations: readonly ProjectionLimitation[],
): TerminalPanelContentBlock & { readonly kind: "table" } {
  return {
    kind: "table",
    columns: [{ header: "Limitation" }],
    rows: limitations.map((limitation) => [formatProjectionLimitation(limitation)]),
    overflow: "wrap",
  };
}

function projectionLimitationTable(
  limitations: readonly ProjectionLimitation[],
): TerminalPanelContentBlock & { readonly kind: "table" } {
  return limitationTable(limitations);
}

function formatProjectionLimitation(value: ProjectionLimitation): string {
  if ("issue" in value) return `invalid projection; ${value.issue}`;
  if ("source" in value) {
    if (value.source === "agent-turns") {
      return `${value.source}; turn ${value.turnId}; ${value.channel}; ${value.state}; ${value.reason}`;
    }
    const details = value.limitations.map(formatProjectionLimitation).join("; ");
    return `${value.source}; ${value.state}${details.length === 0 ? "" : `; ${details}`}`;
  }
  switch (value.code) {
    case "capture-failed":
    case "capture-interrupted":
      return `${value.code}; stage ${value.stage}; target ${value.target}`;
    case "collection-cap-reached":
    case "unsupported-input":
      return `${value.code}; target ${value.target}; omitted at least ${value.omittedAtLeast}`;
    case "text-truncated":
    case "redacted":
    case "invalid-utf8-replaced":
    case "unsafe-control-stripped":
      return `${value.code}; target ${value.target}; replaced or omitted ${value.replacementOrOmittedCount}`;
  }
}

type UsageLimitation = UsageView["limitations"][number];

function formatUsageLimitation(value: UsageLimitation): string {
  if ("source" in value) {
    return `${value.source}; turn ${value.turnId}; ${value.channel}; ${value.state}; ${value.reason}`;
  }
  return formatProjectionLimitation(value);
}

function traceItemBlocks(item: TraceItem): readonly TerminalBlock[] {
  const entries: { key: string; value: string }[] = [
    { key: "Kind", value: item.kind },
    { key: "Sequence", value: String(item.sequence) },
  ];
  let content: string | null = null;
  switch (item.kind) {
    case "message":
      entries.push({ key: "Role", value: item.role });
      content = item.text;
      break;
    case "tool-call":
      entries.push(
        { key: "Tool", value: item.tool },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not-recorded",
        },
      );
      content = item.input;
      break;
    case "tool-result":
      entries.push(
        { key: "Outcome", value: item.outcome },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not-recorded",
        },
      );
      content = item.output;
      break;
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      content = item.summary;
      break;
    case "subagent":
      entries.push(
        { key: "State", value: item.state },
        { key: "Label", value: item.label },
      );
      content = item.summary;
      break;
    case "input-request":
      entries.push({ key: "State", value: item.state });
      content = `Prompt: ${item.prompt}\nResponse: ${textOrNotRecorded(item.response)}`;
      break;
    case "skill-load":
    case "conversation-error":
      entries.push({ key: "Code", value: item.code });
      content = item.summary;
      break;
  }
  return [
    {
      kind: "panel",
      title: `Item ${item.itemId}`,
      blocks: [{ kind: "keyValue", entries }],
    },
    ...(content === null ? [] : [{ kind: "code" as const, text: content }]),
  ];
}

export function renderTraceDetail(value: TraceDetailView): string {
  const body = value.body;
  const heading: TerminalBlock = {
    kind: "panel",
    title: `Execution detail ${value.locator}`,
    meta: `${value.kind} ${value.stableId}`,
    blocks: [],
  };
  if (body.kind === "item") {
    return terminal([heading, ...traceDetailItemBlocks(body.item)]);
  }
  if (body.kind === "tool-occurrence") {
    return terminal([
      heading,
      {
        kind: "panel",
        title: "Occurrence turns",
        blocks: [
          {
            kind: "keyValue",
            entries: [
              {
                key: "Call",
                value: body.turn.call === null
                  ? "not-recorded"
                  : `${body.turn.call.turnId}; sequence ${body.turn.call.sequence}; ${body.turn.call.outcome}`,
              },
              {
                key: "Result",
                value: body.turn.result === null
                  ? "not-recorded"
                  : `${body.turn.result.turnId}; sequence ${body.turn.result.sequence}; ${body.turn.result.outcome}`,
              },
            ],
          },
        ],
      },
      ...(body.call === null
        ? [{
          kind: "panel" as const,
          title: "Call",
          meta: "not-recorded",
          blocks: [],
        }]
        : traceDetailItemBlocks(body.call, "Call")),
      ...(body.result === null
        ? [{
          kind: "panel" as const,
          title: "Result",
          meta: "not-recorded",
          blocks: [],
        }]
        : traceDetailItemBlocks(body.result, "Result")),
    ]);
  }
  return terminal([
    heading,
    {
      kind: "panel",
      title: `Command ${body.commandId}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Invocation", value: commandInvocation(body.invocation) },
            {
              key: "Working directory",
              value: workingDirectory(body.workingDirectory),
            },
            { key: "Outcome", value: commandOutcome(body.outcome) },
            { key: "Turn", value: body.turnId ?? "not-recorded" },
            { key: "Phase", value: body.phase },
            { key: "Sequence", value: String(body.sequence) },
          ],
        },
        { kind: "divider", title: "stdout" },
        streamMetadata(body.stdout),
        { kind: "divider", title: "stderr" },
        streamMetadata(body.stderr),
      ],
    },
    { kind: "code", text: body.stdout.text },
    { kind: "code", text: body.stderr.text },
  ]);
}

type TraceDetailItem = Extract<
  TraceDetailView["body"],
  { readonly kind: "item" }
>["item"];

function traceDetailItemBlocks(
  item: TraceDetailItem,
  title = `Item ${item.itemId}`,
): readonly TerminalBlock[] {
  const entries: { key: string; value: string }[] = [
    { key: "Item ID", value: item.itemId },
    { key: "Kind", value: item.kind },
    { key: "Turn", value: item.turnId },
    { key: "Turn sequence", value: String(item.turnSequence) },
    { key: "Turn outcome", value: item.turnOutcome },
    { key: "Session", value: item.sessionId ?? "not-recorded" },
    { key: "Event", value: item.eventId ?? "not-recorded" },
    {
      key: "Sequence",
      value: item.sequence === undefined ? "not-recorded" : String(item.sequence),
    },
  ];
  let content: string | null = null;
  switch (item.kind) {
    case "message":
      entries.push({ key: "Role", value: item.role });
      content = item.text;
      break;
    case "tool-call":
      entries.push(
        { key: "Tool", value: item.tool },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not-recorded",
        },
      );
      content = item.input;
      break;
    case "tool-result":
      entries.push(
        { key: "Outcome", value: item.outcome },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not-recorded",
        },
      );
      content = item.output;
      break;
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      content = item.summary;
      break;
    case "subagent":
      entries.push(
        { key: "State", value: item.state },
        { key: "Label", value: item.label },
      );
      content = item.summary;
      break;
    case "input-request":
      entries.push({ key: "State", value: item.state });
      content = `Prompt: ${item.prompt}\nResponse: ${textOrNotRecorded(item.response)}`;
      break;
    case "skill-load":
    case "conversation-error":
      entries.push({ key: "Code", value: item.code });
      content = item.summary;
      break;
  }
  return [
    {
      kind: "panel",
      title,
      blocks: [{ kind: "keyValue", entries }],
    },
    ...(content === null ? [] : [{ kind: "code" as const, text: content }]),
  ];
}

type CommandDetail = Extract<
  TraceDetailView["body"],
  { readonly kind: "command" }
>;

function streamMetadata(
  stream: CommandDetail["stdout"],
): TerminalPanelContentBlock & { readonly kind: "keyValue" } {
  return {
    kind: "keyValue",
    entries: [
      { key: "Retained bytes", value: String(stream.retainedBytes) },
      { key: "Total safe UTF-8 bytes", value: String(stream.totalSafeUtf8Bytes) },
      { key: "SHA-256", value: stream.sha256 },
      { key: "Truncation", value: stream.truncation.state },
      {
        key: "Omitted safe UTF-8 bytes",
        value: String(stream.truncation.omittedSafeUtf8Bytes),
      },
    ],
  };
}

function commandInvocation(value: CommandDetail["invocation"]): string {
  return value.kind === "shell"
    ? value.command
    : [value.executable, ...value.arguments].join(" ");
}

function workingDirectory(value: CommandDetail["workingDirectory"]): string {
  return value.kind === "project-relative" ? value.path : value.kind;
}

function commandOutcome(value: CommandDetail["outcome"]): string {
  if (value.kind === "exited") return `exited; code ${value.exitCode}`;
  return `${value.kind}; ${value.reason}`;
}

export function renderTiming(value: TimingView): string {
  return terminal([
    {
      kind: "panel",
      title: `Timing ${value.locator}`,
      meta: value.state,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: value.state },
            { key: "Activities", value: String(value.activities.length) },
            {
              key: "Omitted activities",
              value: value.hasMore ? String(value.omittedActivityCount) : "0",
            },
            { key: "Limitations", value: String(value.limitations.length) },
          ],
        },
        { kind: "divider", title: "Limitations" },
        projectionLimitationTable(value.limitations),
        { kind: "divider", title: "Activities" },
        {
          kind: "table",
          columns: [
            { header: "Activity ID" },
            { header: "Parent" },
            { header: "Turn" },
            { header: "Phase" },
            { header: "Label" },
            { header: "Start" },
            { header: "Duration" },
            { header: "Outcome" },
          ],
          rows: value.activities.map((activity) => [
            activity.activityId,
            activity.parentActivityId ?? "none",
            activity.turnId ?? "none",
            activity.phase,
            activity.label,
            `${fmt(activity.startOffsetMs)} ms`,
            `${fmt(activity.durationMs)} ms`,
            activity.outcome,
          ]),
        },
      ],
    },
  ]);
}

type UsageTotals = UsageView["totals"];

function numericUsageTotal(
  total: UsageTotals["inputTokens"],
): string {
  return `${total.value === null ? "not-recorded" : fmt(total.value)} (${total.state}; ${total.observationCount} observations)`;
}

function usageTotalEntries(
  totals: UsageTotals,
): readonly { readonly key: string; readonly value: string }[] {
  return [
    { key: "Input tokens", value: numericUsageTotal(totals.inputTokens) },
    { key: "Output tokens", value: numericUsageTotal(totals.outputTokens) },
    { key: "Requests", value: numericUsageTotal(totals.requests) },
    {
      key: "Provider costs",
      value: `${totals.providerCosts.state}; ${totals.providerCosts.observationCount} observations${
        totals.providerCosts.values.length === 0
          ? "; no recorded values"
          : `; ${totals.providerCosts.values.map((cost) =>
            `${cost.value} ${cost.currency} (${cost.observationCount} observations)`
          ).join("; ")}`
      }`,
    },
  ];
}

export function renderUsage(value: UsageView): string {
  return terminal([
    {
      kind: "panel",
      title: `Usage ${value.locator}`,
      meta: value.state,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: value.state },
            ...usageTotalEntries(value.totals),
            {
              key: "Limitations",
              value: boundedPreview(
                value.limitations.length,
                value.limitationsTruncated,
                value.omittedLimitationCount,
              ),
            },
            {
              key: "Turns",
              value: boundedPreview(
                value.turns.length,
                value.turnsTruncated,
                value.omittedTurnCount,
              ),
            },
            {
              key: "Omitted observations",
              value: value.hasMore ? String(value.omittedObservationCount) : "0",
            },
          ],
        },
        { kind: "divider", title: "Limitations" },
        {
          kind: "table",
          columns: [{ header: "Limitation" }],
          rows: value.limitations.map((limitation) => [
            formatUsageLimitation(limitation),
          ]),
          overflow: "wrap",
        },
        { kind: "divider", title: "Provider costs" },
        {
          kind: "table",
          columns: [
            { header: "Currency" },
            { header: "Value" },
            { header: "State" },
            { header: "Observations" },
          ],
          rows: value.totals.providerCosts.values.map((cost) => [
            cost.currency,
            cost.value,
            value.totals.providerCosts.state,
            String(cost.observationCount),
          ]),
        },
        { kind: "divider", title: "Turn coverage" },
        {
          kind: "table",
          columns: [
            { header: "Turn" },
            { header: "Coverage" },
            { header: "Reason" },
          ],
          rows: value.turns.map((turn) => [
            turn.turnId,
            turn.coverage.state,
            turn.coverage.state === "complete" ? "none" : turn.coverage.reason,
          ]),
        },
        { kind: "divider", title: "Observation provenance" },
        {
          kind: "table",
          columns: [
            { header: "Turn" },
            { header: "Observation ID" },
            { header: "Kind" },
            { header: "Provider" },
            { header: "Recorded value" },
          ],
          rows: value.observations.map((observation) => [
            observation.turnId,
            observation.usageObservationId,
            observation.kind,
            observation.provider,
            usageObservationValue(observation),
          ]),
          overflow: "wrap",
        },
      ],
    },
  ]);
}

function usageObservationValue(
  value: UsageView["observations"][number],
): string {
  switch (value.kind) {
    case "token-bucket":
      return `${value.bucket}; ${value.tokens} tokens`;
    case "request":
      return value.requestKind;
    case "provider-cost":
      return `${value.amount} ${value.currency}`;
  }
}

export function renderDiff(value: DiffView): string {
  const statusBlocks: TerminalPanelContentBlock[] = [
    {
      kind: "keyValue",
      entries: [
        { key: "State", value: value.state },
        { key: "Windows", value: String(value.windows.length) },
      ],
    },
  ];
  if (value.state === "invalid") {
    statusBlocks.push(
      { kind: "divider", title: "Issues" },
      {
        kind: "table",
        columns: [{ header: "Issue" }],
        rows: value.issues.map((issue) => [issue]),
        overflow: "wrap",
      },
    );
  }
  if (value.state === "complete" || value.state === "partial") {
    statusBlocks.push(
      { kind: "divider", title: "Limitations" },
      {
        kind: "table",
        columns: [{ header: "Limitation" }],
        rows: value.limitations.map((limitation) => [
          formatDiffLimitation(limitation),
        ]),
        overflow: "wrap",
      },
    );
  }
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: `Diff ${value.locator}`,
      meta: value.state,
      blocks: statusBlocks,
    },
  ];
  for (const window of value.windows) {
    blocks.push({
      kind: "panel",
      title: `Window ${window.windowId}`,
      meta: `sequence ${window.sequence}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [{ key: "Changes", value: String(window.changes.length) }],
        },
      ],
    });
    for (const change of window.changes) {
      blocks.push({
        kind: "panel",
        title: `Change ${change.changeId}`,
        meta: change.kind,
        blocks: [
          {
            kind: "keyValue",
            entries: [
              { key: "Path", value: change.path },
              { key: "Before", value: fileEndpoint(change.before) },
              { key: "After", value: fileEndpoint(change.after) },
            ],
          },
        ],
      });
    }
  }
  return terminal(blocks);
}

type DiffLimitation = Extract<
  DiffView,
  { readonly state: "complete" | "partial" }
>["limitations"][number];

function formatDiffLimitation(value: DiffLimitation): string {
  switch (value.code) {
    case "capture-failed":
    case "capture-interrupted":
      return `${value.code}; stage ${value.stage}; window ${value.atWindowId ?? "not-recorded"}`;
    case "collection-cap-reached":
      return `${value.code}; target ${value.target}; omitted at least ${value.omittedAtLeast}; window ${value.atWindowId ?? "not-recorded"}`;
    case "unsupported-input":
      return `${value.code}; target ${value.target}; omitted at least ${value.omittedAtLeast}`;
  }
}

type DiffEndpoint = Extract<
  DiffView["windows"][number]["changes"][number]["before"],
  { readonly state: "absent" | "present" }
>;

function fileEndpoint(value: DiffEndpoint): string {
  if (value.state === "absent") return "absent";
  const revision = value.revision;
  if (revision.kind === "text") {
    return `text; ${revision.content}; ${revision.byteLength} bytes; ${revision.sha256}`;
  }
  if (revision.kind === "elided") {
    return `elided; ${revision.reason}; ${revision.byteLength} bytes`;
  }
  return `unavailable; ${revision.reason}`;
}

export function traceSelector(value: TraceView, id: string) {
  if (value.identities.itemIds.includes(id)) {
    return { kind: "item" as const, itemId: id };
  }
  if (value.identities.toolOccurrenceIds.includes(id)) {
    return { kind: "tool-occurrence" as const, toolOccurrenceId: id };
  }
  if (value.identities.commandIds.includes(id)) {
    return { kind: "command" as const, commandId: id };
  }
  return undefined;
}
