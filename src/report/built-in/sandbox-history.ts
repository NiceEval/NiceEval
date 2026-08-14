import {
  query,
  sandboxHistoryView,
  type Sample,
  type SampleSnapshot,
  type SandboxHistoryDomainView,
} from "../../analysis/index.ts";
import {
  Callout,
  defineReport,
  Stack,
  Table,
  Text,
  type Report,
} from "../author/index.ts";

const ORIGIN_ROWS_MAX = 500;

const sandboxHistoryPage = {
  id: "sandbox-history",
  path: "/",
  title: "Sandbox history",
  load: async (sample: Sample) => Object.freeze({
    snapshot: sample.snapshot,
    history: await query(sample, { kind: "domain-view", view: sandboxHistoryView }),
  }),
  render: (input: {
    readonly snapshot: SampleSnapshot;
    readonly history: SandboxHistoryDomainView;
  }) => sandboxHistoryNode(input),
};

/**
 * A history page over frozen membership plus the closed sandbox-history
 * DomainView. Report never reads a sandbox attachment itself.
 */
export function sandboxHistoryReport(): Report {
  return defineReport({
    title: "Sandbox history",
    pages: [sandboxHistoryPage],
  });
}

/** The built-in, closed-value Sandbox history Report. */
export const defaultSandboxHistoryReport = sandboxHistoryReport();

export default defaultSandboxHistoryReport;

function sandboxHistoryNode(input: {
  readonly snapshot: SampleSnapshot;
  readonly history: SandboxHistoryDomainView;
}) {
  const historyByLocator = new Map(
    input.history.entries.map((entry) => [entry.attempt.locator, entry] as const),
  );
  const origins = input.snapshot.slots
    .filter((slot) => slot.state === "included")
    .slice(0, ORIGIN_ROWS_MAX);
  const omitted = input.snapshot.slots.filter((slot) => slot.state === "included").length - origins.length;
  return Stack({
    children: [
      Table({
        caption: "Origin Attempts",
        columns: [
          { key: "locator", label: "Attempt" },
          { key: "originRunId", label: "Origin Run" },
          { key: "runId", label: "Selected Run" },
          { key: "slotId", label: "Slot" },
          { key: "relation", label: "Member relation" },
          { key: "historyState", label: "Sandbox history" },
        ],
        rows: origins.map((slot) => ({
          locator: slot.attempt.locator,
          originRunId: slot.attempt.originRunId,
          runId: slot.runId,
          slotId: slot.slotId,
          relation: slot.relation,
          historyState: historyByLocator.get(slot.attempt.locator)?.state ?? "not-recorded",
        })),
      }),
      Callout({
        tone: omitted === 0 ? "neutral" : "warning",
        title: "Bounded history",
        children: [Text({ value: `Omitted origin Attempts: ${omitted}` })],
      }),
    ],
  });
}
