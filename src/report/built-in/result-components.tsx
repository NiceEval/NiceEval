/**
 * Built-in report composition over already-closed values.
 *
 * Nothing in this module accepts a Sample, storage capability, attachment, or
 * Effect Scope. Page loaders own Analysis and DomainView acquisition; these
 * components only arrange their rows and views into the report product.
 */

import type {
  AttemptEvidenceDomainView,
  AttemptObservabilityDomainView,
  ClosedCommandEntry,
  ClosedConversationItem,
  ClosedUsageObservation,
  ExperimentId,
  FileChangesDomainView,
  JsonValue,
  MetricValue,
  SandboxHistoryDomainView,
  SourcesDomainView,
} from "../../analysis/index.ts";
import type { AttemptLocator } from "../../attempt-locator.ts";
import { Hero, type HeroData } from "../components/site-components/index.tsx";
import { defineComponent } from "../definition/tree.ts";
import {
  Bars,
  Col,
  Grid,
  Section,
  Stat,
  Table,
  Text,
} from "../definition/primitives.tsx";
import type { Cell } from "../definition/cell.tsx";
import { evidenceRow } from "../model/metrics.ts";
import { experimentDetailTarget } from "../library/details.ts";
import type {
  BuiltInAttemptRows,
  BuiltInExperimentRows,
  BuiltInSummaryRows,
} from "./analysis-values.ts";

const DETAIL_ROWS_MAX = 200;
const SOURCE_TEXT_MAX = 12_000;

export interface OverviewCounts {
  readonly experiments: number;
  readonly attempts: number;
  readonly expectedResults: number;
}

/** Display-safe membership facts prepared by the Page loader from Snapshot. */
export interface MembershipRow {
  readonly key: string;
  readonly experiment: string;
  readonly eval: string;
  readonly attempt: number;
  readonly selectedRun: string;
  readonly slot: string;
  readonly state: string;
  readonly relation: string | null;
  readonly locator: string | null;
  readonly outcome?: string | null;
  readonly verdict?: string | null;
  readonly phase?: string | null;
  readonly error?: string | null;
  readonly sharedFailure?: string | null;
}

export interface RunErrorRow {
  readonly key: string;
  readonly failure: string;
  readonly phase: string;
  readonly affected: string;
  readonly affectedCount: number;
  readonly error: string;
  readonly message: string;
  readonly fix: string | null;
}

export interface StandardOverviewResult {
  readonly hero: HeroData;
  readonly summary: BuiltInSummaryRows;
  readonly experiments: BuiltInExperimentRows;
  readonly counts: OverviewCounts;
}

export interface StandardAttemptsResult {
  readonly hero: HeroData;
  readonly attempts: BuiltInAttemptRows;
}

export interface ExperimentDetailResult {
  readonly hero: HeroData;
  readonly experiment: string;
  readonly rows: BuiltInExperimentRows;
  readonly members: readonly MembershipRow[];
}

export interface AttemptDetailResult {
  readonly hero: HeroData;
  readonly locator: AttemptLocator | null;
  readonly members: readonly MembershipRow[];
  readonly evidence: AttemptEvidenceDomainView;
  readonly observability: AttemptObservabilityDomainView;
  readonly fileChanges: FileChangesDomainView;
  readonly sources: SourcesDomainView;
  readonly sandbox: SandboxHistoryDomainView;
}

export interface RunMembershipResult {
  readonly hero: HeroData;
  readonly summary: BuiltInSummaryRows;
  readonly members: readonly MembershipRow[];
  readonly errors: readonly RunErrorRow[];
  readonly evidence: AttemptEvidenceDomainView;
}

export interface AttemptTraceProps {
  readonly view: AttemptObservabilityDomainView;
  readonly locator?: AttemptLocator;
  readonly mode: "execution" | "timing";
  readonly grep?: string;
  readonly timingMode?: "summary" | "full";
}

export interface FileChangesTrajectoryProps {
  readonly view: FileChangesDomainView;
  readonly locator?: AttemptLocator;
}

export interface SourcesResultProps {
  readonly view: SourcesDomainView;
  readonly locator?: AttemptLocator;
  readonly file?: string;
}

export interface SandboxHistoryResultProps {
  readonly view: SandboxHistoryDomainView;
  readonly locator?: AttemptLocator;
}

function metricCell(metric: MetricValue): Cell {
  return { kind: "metric", metric };
}

function metricValueOnlyCell(metric: MetricValue): Cell {
  return { kind: "metric", metric, showCoverage: false };
}

function limited<Row>(rows: readonly Row[], maximum = DETAIL_ROWS_MAX): readonly Row[] {
  return rows.slice(0, maximum);
}

function omittedText(total: number, visible: number, label: string) {
  return total === visible ? null : <Text>{`${total - visible} additional ${label} omitted from this page.`}</Text>;
}

function issueRows(view: { readonly issues: readonly { readonly code: string; readonly message: string }[] }) {
  return view.issues.map((issue, index) => ({
    key: `${issue.code}:${index}`,
    code: issue.code,
    message: issue.message,
  }));
}

function issueSection(view: { readonly issues: readonly { readonly code: string; readonly message: string }[] }) {
  const rows = issueRows(view);
  return rows.length === 0 ? null : (
    <Section title="Analysis notes" meta={`${rows.length}`}>
      <Table rows={rows} columns={["code", "message"]} />
    </Section>
  );
}

function heroAndKpis(input: StandardOverviewResult) {
  const summary = input.summary[0];
  const hasScore = input.experiments.some((row) => row.evaluationKind !== "pass");
  const hasPassSummary = input.experiments.length > 0 && input.experiments.every((row) => row.evaluationKind === "pass");
  const scores = input.experiments.flatMap((row) => row.totalScore === undefined ? [] : [row.totalScore]);
  const meanScore = scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return (
    <>
      <Hero data={input.hero} />
      <Grid>
        {hasPassSummary ? <Stat label="Pass rate" value={summary === undefined ? null : metricValueOnlyCell(summary.passRate)} /> : null}
        {hasScore ? <Stat label="Mean score" value={meanScore} /> : null}
        <Stat label="Mean duration" value={summary === undefined ? null : metricValueOnlyCell(summary.durationMs)} />
        <Stat label="Mean tokens" value={summary === undefined ? null : metricValueOnlyCell(summary.tokens)} />
        <Stat label="Experiments" value={input.counts.experiments} />
        <Stat label="Included attempts" value={input.counts.attempts} />
      </Grid>
    </>
  );
}

function resultCoverageSection(counts: OverviewCounts) {
  if (counts.attempts >= counts.expectedResults) return null;
  return (
    <Section
      title="Result coverage"
      meta={`${counts.attempts} of ${counts.expectedResults} results available`}
    >
      <Text>Some expected results do not have an analyzable Attempt. Result coverage is not a score or pass rate.</Text>
    </Section>
  );
}

function experimentPoints(rows: BuiltInExperimentRows) {
  return rows.filter((row) => row.passRate !== null).map((row) => evidenceRow({
    experiment: String(row.experiment),
    passRate: row.passRate!,
    durationMs: row.durationMs,
  }));
}

function experimentTarget(experiment: string) {
  return { page: "experiment", params: experimentDetailTarget(experiment as ExperimentId) };
}

function standardOverviewTree(input: StandardOverviewResult) {
  const hasScore = input.experiments.some((row) => row.evaluationKind !== "pass");
  const hasPass = input.experiments.some((row) => row.evaluationKind === "pass");
  const points = experimentPoints(input.experiments);
  const columns = [
    { field: "experiment", label: "Experiment" },
    ...(hasPass ? [{ field: "passRate", label: "Pass rate" }] : []),
    ...(hasScore ? [{ field: "totalScore", label: "Score" }] : []),
    { field: "durationMs", label: "Mean duration" },
    { field: "tokens", label: "Mean tokens" },
  ];
  const tableRows = input.experiments.map((row) => ({
    ...row,
    passRate: row.passRate === null ? null : metricValueOnlyCell(row.passRate),
    totalScore: row.totalScore ?? null,
    durationMs: metricValueOnlyCell(row.durationMs),
    tokens: metricValueOnlyCell(row.tokens),
  }));
  return (
    <Col>
      {heroAndKpis(input)}
      {resultCoverageSection(input.counts)}
      <Section title="Experiment results" meta={`${input.experiments.length} experiments`}>
        {input.experiments.length === 0 ? <Text>No experiment rows are available for this selection.</Text> : !hasPass ? null : (
          <Col>
            <Bars
              points={points}
              x="experiment"
              y="passRate"
              point="experiment"
              pointTarget={(point) => experimentTarget(point.key)}
              sort={{ field: "passRate", direction: "desc" }}
              layout="horizontal"
            />
          </Col>
        )}
        <Table
          rows={tableRows}
          columns={columns}
        />
      </Section>
      {issueSection(input.experiments)}
    </Col>
  );
}

/** The default product overview: Hero, exactly six KPIs, Bars, Scatter, and Table. */
export const StandardOverviewResultView = defineComponent<StandardOverviewResult>((input) => standardOverviewTree(input));
StandardOverviewResultView.displayName = "StandardOverviewResultView";

function standardAttemptsTree(input: StandardAttemptsResult) {
  const rows = input.attempts.map((row) => ({
    ...row,
    attempt: typeof row.attempt === "string"
      ? { kind: "locator" as const, locator: row.attempt as AttemptLocator }
      : row.attempt,
  }));
  return (
    <Col>
      <Hero data={input.hero} />
      <Section title="Attempts" meta={`${input.attempts.length} attempts`}>
        <Table
          rows={rows}
          columns={[
            { field: "experiment", label: "Experiment" },
            { field: "evalId", label: "Eval" },
            { field: "attempt", label: "Attempt" },
            { field: "passRate", label: "Pass rate" },
            { field: "durationMs", label: "Mean duration" },
            { field: "tokens", label: "Mean tokens" },
          ]}
        />
      </Section>
      {issueSection(input.attempts)}
    </Col>
  );
}

export const StandardAttemptsResultView = defineComponent<StandardAttemptsResult>((input) => standardAttemptsTree(input));
StandardAttemptsResultView.displayName = "StandardAttemptsResultView";

function membershipTable(rows: readonly MembershipRow[]) {
  const normalized = rows.map((row) => ({
    ...row,
    outcome: row.outcome ?? null,
    phase: row.phase ?? null,
    error: row.error ?? null,
    sharedFailure: row.sharedFailure ?? null,
  }));
  return (
    <Table
      rows={normalized}
      columns={[
        { field: "experiment", label: "Experiment" },
        { field: "eval", label: "Eval" },
        { field: "attempt", label: "Attempt" },
        { field: "state", label: "Membership" },
        { field: "outcome", label: "Outcome" },
        { field: "error", label: "Error" },
        { field: "phase", label: "Phase" },
        { field: "sharedFailure", label: "Shared failure" },
        { field: "locator", label: "Attempt locator" },
        { field: "selectedRun", label: "Selected run" },
        { field: "slot", label: "Slot" },
        { field: "relation", label: "Relation" },
      ]}
    />
  );
}

function runErrorsSection(rows: readonly RunErrorRow[]) {
  const notStarted = rows.reduce((total, row) => total + row.affectedCount, 0);
  return rows.length === 0 ? null : (
    <Section title="Run errors" meta={`${notStarted} attempt${notStarted === 1 ? "" : "s"} not started`}>
      {rows.map((row) => (
        <Section key={row.key} title="Sandbox image build failed">
          <Text>{`affected: ${row.affected}`}</Text>
          <Text>{`error: ${row.message}`}</Text>
        </Section>
      ))}
    </Section>
  );
}

function evidenceEntryRows(view: AttemptEvidenceDomainView, locator?: AttemptLocator) {
  return view.entries
    .filter((entry) => locator === undefined || entry.attempt.locator === locator)
    .map((entry) => ({
      key: entry.attempt.locator,
      locator: entry.attempt.locator,
      originRun: entry.attempt.originRunId,
      state: entry.state,
      outcome: entry.state === "available" ? entry.detail.outcome : null,
      verdict: entry.state === "available" ? entry.detail.verdict : null,
      assertions: entry.state === "available" ? entry.detail.entries.length : null,
      sourceSites: entry.state === "available" ? entry.detail.sourceSites.length : null,
    }));
}

function assertionRows(entry: Extract<AttemptEvidenceDomainView["entries"][number], { readonly state: "available" }>) {
  return entry.detail.entries.map((assertion) => ({
    key: assertion.entryId,
    assertion: assertion.entryId,
    display: jsonText(assertion.display),
    criterion: jsonText(assertion.criterion),
    result: jsonText(assertion.result),
    coverage: jsonText(assertion.coverage),
  }));
}

function attemptEvidenceTree(props: { readonly view: AttemptEvidenceDomainView; readonly locator?: AttemptLocator }) {
  const entries = evidenceEntryRows(props.view, props.locator);
  const visible = limited(entries);
  const available = props.view.entries.filter((entry): entry is Extract<typeof entry, { readonly state: "available" }> =>
    (props.locator === undefined || entry.attempt.locator === props.locator) && entry.state === "available"
  );
  return (
    <Section title="Assessment evidence" meta={`${entries.length} attempt${entries.length === 1 ? "" : "s"}`}>
      {visible.length === 0 ? <Text>No closed assessment evidence matches this target.</Text> : (
        <Table
          rows={visible}
          columns={["locator", "originRun", "state", "outcome", "verdict", "assertions", "sourceSites"]}
        />
      )}
      {omittedText(entries.length, visible.length, "assessment evidence rows")}
      {available.map((entry) => {
        const assertions = limited(assertionRows(entry));
        return (
          <Section key={entry.attempt.locator} title={`Assertions · ${entry.attempt.locator}`}>
            {assertions.length === 0 ? <Text>No recorded assertions.</Text> : (
              <Table rows={assertions} columns={["assertion", "display", "criterion", "result", "coverage"]} />
            )}
            {omittedText(entry.detail.entries.length, assertions.length, "assertions")}
          </Section>
        );
      })}
      {issueSection(props.view)}
    </Section>
  );
}

export const AttemptEvidenceResultView = defineComponent<{
  readonly view: AttemptEvidenceDomainView;
  readonly locator?: AttemptLocator;
}>((props) => attemptEvidenceTree(props));
AttemptEvidenceResultView.displayName = "AttemptEvidenceResultView";

function conversationText(item: ClosedConversationItem): string {
  switch (item.kind) {
    case "message":
      return `${item.role}: ${item.text}`;
    case "tool-call":
      return `${item.tool}(${item.inputSummary})`;
    case "tool-result":
      return `${item.outcome}: ${item.outputSummary}`;
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      return item.summary;
    case "subagent":
      return `${item.label} · ${item.state} · ${item.summary}`;
    case "input-request":
      return `${item.state} · ${item.promptSummary}${item.responseSummary === null ? "" : ` · ${item.responseSummary}`}`;
    case "skill-load":
    case "conversation-error":
      return `${item.code} · ${item.summary}`;
  }
}

function commandText(command: ClosedCommandEntry) {
  const invocation = command.manifest.invocation.kind === "argv"
    ? [command.manifest.invocation.executable, ...command.manifest.invocation.arguments].join(" ")
    : command.manifest.invocation.command;
  const outcome = command.result.outcome.kind === "exited"
    ? `exit ${command.result.outcome.exitCode}`
    : `${command.result.outcome.kind}: ${command.result.outcome.reason}`;
  return { invocation, outcome };
}

function usageValue(observation: ClosedUsageObservation) {
  switch (observation.kind) {
    case "token-bucket":
      return `${observation.bucket}: ${observation.tokens}`;
    case "request":
      return observation.requestKind;
    case "provider-cost":
      return `${observation.amount} ${observation.currency}`;
  }
}

function traceEntryTree(
  entry: Extract<AttemptObservabilityDomainView["entries"][number], { readonly state: "available" }>,
  props: AttemptTraceProps,
) {
  const detail = entry.detail;
  const filter = props.grep === undefined ? undefined : new RegExp(props.grep);
  const conversationRows = detail.conversation.items
    .map((item) => ({
      key: item.itemId,
      sequence: item.sequence,
      turn: item.turnId,
      event: item.kind,
      detail: conversationText(item),
    }))
    .filter((row) => filter === undefined || filter.test(`${row.event}\n${row.detail}`));
  const commands = detail.commands.entries.map((command) => ({
    key: command.commandId,
    phase: command.manifest.phase,
    command: commandText(command).invocation,
    outcome: commandText(command).outcome,
    workingDirectory: command.manifest.workingDirectory.kind === "project-relative"
      ? command.manifest.workingDirectory.path
      : command.manifest.workingDirectory.kind,
  })).filter((row) => filter === undefined || filter.test(`${row.command}\n${row.outcome}`));
  const timings = detail.timing.intervals.map((interval) => ({
    key: interval.intervalId,
    phase: interval.phase,
    label: interval.label,
    startMs: interval.startOffsetMs,
    durationMs: interval.durationMs,
    outcome: interval.outcome,
    parent: props.timingMode === "full" ? interval.parentIntervalId : null,
  }));
  const usage = detail.usage.observations.map((observation, index) => ({
    key: `${observation.provider}:${observation.kind}:${index}`,
    provider: observation.provider,
    kind: observation.kind,
    value: usageValue(observation),
  }));
  const diagnostics = detail.diagnostics.diagnostics.map((diagnostic) => ({
    key: diagnostic.diagnosticId,
    kind: diagnostic.kind,
    phase: diagnostic.phase,
    code: diagnostic.code,
    summary: diagnostic.summary,
    redaction: diagnostic.redaction.state === "applied" ? `${diagnostic.redaction.replacements} replacements` : "none",
  }));

  if (props.mode === "timing") {
    return (
      <Section title={`Timing · ${entry.attempt.locator}`} meta={detail.timing.collection.state}>
        {timings.length === 0 ? <Text>No recorded timing intervals.</Text> : (
          <Table rows={timings} columns={props.timingMode === "full"
            ? ["phase", "label", "startMs", "durationMs", "outcome", "parent"]
            : ["phase", "label", "durationMs", "outcome"]} />
        )}
      </Section>
    );
  }

  return (
    <Section title={`Execution trace · ${entry.attempt.locator}`} meta={detail.conversation.collection.state}>
      <Table
        rows={[{
          key: entry.attempt.locator,
          turns: detail.conversation.turns.length,
          conversationItems: detail.conversation.items.length,
          commands: detail.commands.entries.length,
          timingIntervals: detail.timing.intervals.length,
          diagnostics: detail.diagnostics.diagnostics.length,
        }]}
        columns={["turns", "conversationItems", "commands", "timingIntervals", "diagnostics"]}
      />
      <Section title="Conversation" meta={detail.conversation.collection.state}>
        {conversationRows.length === 0 ? <Text>No recorded conversation entries match this view.</Text> : (
          <Table rows={limited(conversationRows)} columns={["sequence", "turn", "event", "detail"]} />
        )}
        {omittedText(conversationRows.length, Math.min(conversationRows.length, DETAIL_ROWS_MAX), "conversation entries")}
      </Section>
      <Section title="Commands" meta={detail.commands.collection.state}>
        {commands.length === 0 ? <Text>No recorded commands match this view.</Text> : (
          <Table rows={limited(commands)} columns={["phase", "command", "outcome", "workingDirectory"]} />
        )}
        {omittedText(commands.length, Math.min(commands.length, DETAIL_ROWS_MAX), "commands")}
      </Section>
      <Section title="Timing" meta={detail.timing.collection.state}>
        {timings.length === 0 ? <Text>No recorded timing intervals.</Text> : (
          <Table rows={limited(timings)} columns={["phase", "label", "startMs", "durationMs", "outcome"]} />
        )}
      </Section>
      <Section title="Usage" meta={detail.usage.collection.state}>
        {usage.length === 0 ? <Text>No recorded provider usage.</Text> : <Table rows={limited(usage)} columns={["provider", "kind", "value"]} />}
      </Section>
      <Section title="Diagnostics" meta={detail.diagnostics.collection.state}>
        {diagnostics.length === 0 ? <Text>No recorded diagnostics.</Text> : (
          <Table rows={limited(diagnostics)} columns={["kind", "phase", "code", "summary", "redaction"]} />
        )}
      </Section>
    </Section>
  );
}

function attemptTraceTree(props: AttemptTraceProps) {
  const entries = props.view.entries
    .filter((entry) => props.locator === undefined || entry.attempt.locator === props.locator)
    .slice(0, DETAIL_ROWS_MAX);
  return (
    <Col>
      {entries.length === 0 ? <Section title={props.mode === "timing" ? "Timing" : "Execution trace"}><Text>No matching closed trace data.</Text></Section> : null}
      {entries.map((entry) => entry.state === "available"
        ? <>{traceEntryTree(entry, props)}</>
        : <Section key={entry.attempt.locator} title={`${props.mode === "timing" ? "Timing" : "Execution trace"} · ${entry.attempt.locator}`}><Text>{`Trace data is ${entry.state}.`}</Text></Section>)}
      {issueSection(props.view)}
    </Col>
  );
}

/** Execution and timing never query: their only input is a closed observability DomainView. */
export const AttemptTrace = defineComponent<AttemptTraceProps>((props) => attemptTraceTree(props));
AttemptTrace.displayName = "AttemptTrace";

function endpointText(endpoint: { readonly state: "absent" } | { readonly state: "present"; readonly revision: { readonly kind: string } }): string {
  return endpoint.state === "absent" ? "absent" : endpoint.revision.kind;
}

function fileChangesTree(props: FileChangesTrajectoryProps) {
  const entries = props.view.entries.filter((entry) => props.locator === undefined || entry.attempt.locator === props.locator);
  return (
    <Col>
      {entries.length === 0 ? <Section title="File changes"><Text>No matching closed file-change data.</Text></Section> : null}
      {entries.map((entry) => {
        if (entry.state !== "available") {
          return <Section key={entry.attempt.locator} title={`File changes · ${entry.attempt.locator}`}><Text>{`File changes are ${entry.state}.`}</Text></Section>;
        }
        const changes = entry.detail.trajectory.flatMap((window) => window.changes.map((change) => ({
          key: `${window.windowId}:${change.changeId}`,
          window: window.sequence,
          path: change.path,
          kind: change.kind,
          before: endpointText(change.before),
          after: endpointText(change.after),
        })));
        const paths = entry.detail.paths.map((path) => ({
          key: path.path,
          path: path.path,
          changes: path.changes.length,
          net: path.net.state === "available" ? path.net.kind : path.net.reason,
        }));
        return (
          <Section key={entry.attempt.locator} title={`File changes · ${entry.attempt.locator}`} meta={entry.detail.collection.state}>
            <Table
              rows={[{
                key: entry.attempt.locator,
                attribution: entry.detail.attribution.kind,
                windows: entry.detail.trajectory.length,
                paths: entry.detail.paths.length,
                limitations: entry.detail.collection.limitations.length,
              }]}
              columns={["attribution", "windows", "paths", "limitations"]}
            />
            <Section title="Change trajectory">
              {changes.length === 0 ? <Text>No retained changed paths.</Text> : <Table rows={limited(changes)} columns={["window", "path", "kind", "before", "after"]} />}
              {omittedText(changes.length, Math.min(changes.length, DETAIL_ROWS_MAX), "file changes")}
            </Section>
            <Section title="Path summary">
              {paths.length === 0 ? <Text>No retained path summaries.</Text> : <Table rows={limited(paths)} columns={["path", "changes", "net"]} />}
            </Section>
          </Section>
        );
      })}
      {issueSection(props.view)}
    </Col>
  );
}

export const FileChangesTrajectory = defineComponent<FileChangesTrajectoryProps>((props) => fileChangesTree(props));
FileChangesTrajectory.displayName = "FileChangesTrajectory";

function sourceContentText(content: { readonly state: "available"; readonly text: string } | { readonly state: "unavailable" | "binary" }): string {
  if (content.state !== "available") return content.state;
  return content.text.length <= SOURCE_TEXT_MAX
    ? content.text
    : `${content.text.slice(0, SOURCE_TEXT_MAX)}\n… source text truncated for this page.`;
}

function sourcesTree(props: SourcesResultProps) {
  const entries = props.view.entries.filter((entry) => props.locator === undefined || entry.attempt.locator === props.locator);
  return (
    <Col>
      {entries.length === 0 ? <Section title="Recorded source"><Text>No matching closed source data.</Text></Section> : null}
      {entries.map((entry) => {
        if (entry.state !== "available") {
          return <Section key={entry.attempt.locator} title={`Recorded source · ${entry.attempt.locator}`}><Text>{`Sources are ${entry.state}.`}</Text></Section>;
        }
        const items = entry.detail.items.filter((item) => props.file === undefined || item.path === props.file);
        return (
          <Section key={entry.attempt.locator} title={`Recorded source · ${entry.attempt.locator}`}>
            {items.length === 0 ? <Text>{props.file === undefined ? "No recorded source files." : `No recorded source matches ${props.file}.`}</Text> : null}
            {items.map((item) => (
              <Section key={item.sourceItemId} title={item.path} meta={item.sha256}>
                <Table
                  rows={[{
                    key: item.sourceItemId,
                    sourceItem: item.sourceItemId,
                    content: item.content.state,
                  }]}
                  columns={["sourceItem", "content"]}
                />
                <Text>{sourceContentText(item.content)}</Text>
              </Section>
            ))}
          </Section>
        );
      })}
      {issueSection(props.view)}
    </Col>
  );
}

export const SourcesResultView = defineComponent<SourcesResultProps>((props) => sourcesTree(props));
SourcesResultView.displayName = "SourcesResultView";

function sandboxTree(props: SandboxHistoryResultProps) {
  const entries = props.view.entries.filter((entry) => props.locator === undefined || entry.attempt.locator === props.locator);
  const rows = entries.map((entry) => ({
    key: entry.attempt.locator,
    locator: entry.attempt.locator,
    state: entry.state,
    commands: entry.state === "available" ? entry.detail.commands.entries.length : null,
    timingIntervals: entry.state === "available" ? entry.detail.timing.intervals.length : null,
    diagnostics: entry.state === "available" ? entry.detail.diagnostics.diagnostics.length : null,
  }));
  return (
    <Section title="Sandbox history" meta={`${rows.length} attempt${rows.length === 1 ? "" : "s"}`}>
      {rows.length === 0 ? <Text>No matching closed sandbox history.</Text> : (
        <Table rows={limited(rows)} columns={["locator", "state", "commands", "timingIntervals", "diagnostics"]} />
      )}
      {omittedText(rows.length, Math.min(rows.length, DETAIL_ROWS_MAX), "sandbox history rows")}
      {issueSection(props.view)}
    </Section>
  );
}

export const SandboxHistoryResultView = defineComponent<SandboxHistoryResultProps>((props) => sandboxTree(props));
SandboxHistoryResultView.displayName = "SandboxHistoryResultView";

function runMembershipTree(input: RunMembershipResult) {
  const hasAttempts = input.members.some((member) => member.locator !== null);
  const rows = input.members.map((member) => ({
    key: member.key,
    experiment: member.experiment,
    eval: member.eval,
    attempt: `#${member.attempt + 1}`,
    result: member.locator === null
      ? member.outcome === "errored" ? "errored" : "not started"
      : member.relation === "reference" || member.state === "carried" || member.state === "accepted"
        ? `using result ${member.locator}`
        : member.verdict ?? member.outcome ?? member.state,
    details: member.locator === null
      ? null
      : { kind: "locator" as const, locator: member.locator as AttemptLocator },
  }));
  return (
    <Col>
      <Hero data={input.hero} />
      {runErrorsSection(input.errors)}
      <Section title="Planned attempts" meta={`${input.members.length} attempt${input.members.length === 1 ? "" : "s"}`}>
        <Table
          rows={limited(rows)}
          columns={[
            { field: "experiment", label: "Experiment" },
            { field: "eval", label: "Eval" },
            { field: "attempt", label: "Attempt" },
            { field: "result", label: "Result" },
            { field: "details", label: "Details" },
          ]}
        />
        {omittedText(rows.length, Math.min(rows.length, DETAIL_ROWS_MAX), "planned attempts")}
      </Section>
      {hasAttempts ? <AttemptEvidenceResultView view={input.evidence} /> : null}
      {hasAttempts ? issueSection(input.summary) : null}
    </Col>
  );
}

export const RunMembershipResultView = defineComponent<RunMembershipResult>((input) => runMembershipTree(input));
RunMembershipResultView.displayName = "RunMembershipResultView";

function attemptDetailTree(input: AttemptDetailResult) {
  const locator = input.locator ?? undefined;
  return (
    <Col>
      <Hero data={input.hero} />
      <Section title={`Attempt · ${input.locator ?? "unavailable"}`}>
        {membershipTable(input.members)}
      </Section>
      <AttemptEvidenceResultView view={input.evidence} locator={locator} />
      <AttemptTrace view={input.observability} locator={locator} mode="execution" timingMode="full" />
      <FileChangesTrajectory view={input.fileChanges} locator={locator} />
      <SourcesResultView view={input.sources} locator={locator} />
      <SandboxHistoryResultView view={input.sandbox} locator={locator} />
    </Col>
  );
}

export const AttemptDetailResultView = defineComponent<AttemptDetailResult>((input) => attemptDetailTree(input));
AttemptDetailResultView.displayName = "AttemptDetailResultView";

function experimentDetailTree(input: ExperimentDetailResult) {
  const rows = input.rows.filter((row) => String(row.experiment) === input.experiment);
  const hasScore = rows.some((row) => row.evaluationKind !== "pass");
  const hasPass = rows.some((row) => row.evaluationKind === "pass");
  const columns = [
    "experiment",
    ...(hasPass ? ["passRate"] : []),
    ...(hasScore ? ["totalScore"] : []),
    "durationMs",
    "tokens",
  ];
  return (
    <Col>
      <Hero data={input.hero} />
      <Section title={`Experiment · ${input.experiment}`}>
        <Table rows={rows} columns={columns} />
      </Section>
      <Section title="Experiment members" meta={`${input.members.length} slots`}>
        {membershipTable(limited(input.members))}
        {omittedText(input.members.length, Math.min(input.members.length, DETAIL_ROWS_MAX), "member rows")}
      </Section>
      {issueSection(input.rows)}
    </Col>
  );
}

export const ExperimentDetailResultView = defineComponent<ExperimentDetailResult>((input) => experimentDetailTree(input));
ExperimentDetailResultView.displayName = "ExperimentDetailResultView";

function jsonText(value: JsonValue): string {
  const text = JSON.stringify(value);
  return text.length <= 1_000 ? text : `${text.slice(0, 1_000)}…`;
}
