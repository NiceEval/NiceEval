

import type { E2ECommand, ProcessReceipt, InspectionSuccessDocumentFor, RunProcessOptions } from "@niceeval/testkit";

export type AttemptInspectionOperation =
  | "attempt.get"
  | "attempt.trace"
  | "attempt.timing"
  | "attempt.diff";

export type AssertionIndexEntry = InspectionSuccessDocumentFor<"attempt.get">["attempt"]["assertions"]["entries"][number];

/** Optional mechanical checkpoints; callers retain ownership of logs and deadlines. */
export type AssertionInspectionCheckpoint = (
  stage: "prepare" | "invoke" | "observe" | "outcome",
  entryId: string,
) => void | Promise<void>;

export function assertionEntry(
  document: InspectionSuccessDocumentFor<"attempt.assertion.detail">,
  diagnostic: string,
) {
  if (!("entry" in document.assertion)) {
    throw new Error(`Expected a recorded Assertion detail\n\n${diagnostic}`);
  }
  return document.assertion.entry;
}

export async function inspectAssertion(
  niceeval: E2ECommand,
  projectRoot: string,
  locator: string,
  entryId: string,
  options: RunProcessOptions = {},
  checkpoint?: AssertionInspectionCheckpoint,
): Promise<{ readonly receipt: ProcessReceipt; readonly document: InspectionSuccessDocumentFor<"attempt.assertion.detail"> }> {
  if (checkpoint !== undefined) await checkpoint("prepare", entryId);

  if (checkpoint !== undefined) await checkpoint("invoke", entryId);
  const receipt = await niceeval.run(["show", locator, entryId, "--full", "--json"], options);
  if (checkpoint !== undefined) await checkpoint("observe", entryId);
  const document = receipt.attemptAssertionDetail();
  if (checkpoint !== undefined) await checkpoint("outcome", entryId);
  return { receipt, document };
}

// Each detail read starts the installed CLI while Vitest also runs files in
// parallel. Keep one reader per Record so the suite cannot multiply process
// and SQLite validation pressure inside a single case.
const ASSERTION_DETAIL_QUERY_CONCURRENCY = 1;

/** Read every Assertion detail in declaration order with an explicit process bound. */
export async function inspectAssertionEntries(
  niceeval: E2ECommand,
  projectRoot: string,
  locator: string,
  entries: readonly AssertionIndexEntry[],
  options: RunProcessOptions = {},
  checkpoint?: AssertionInspectionCheckpoint,
): Promise<readonly { readonly entry: AssertionIndexEntry; readonly receipt: ProcessReceipt; readonly document: InspectionSuccessDocumentFor<"attempt.assertion.detail"> }[]> {
  const details: { entry: AssertionIndexEntry; receipt: ProcessReceipt; document: InspectionSuccessDocumentFor<"attempt.assertion.detail"> }[] = [];
  for (let offset = 0; offset < entries.length; offset += ASSERTION_DETAIL_QUERY_CONCURRENCY) {
    const batch = entries.slice(offset, offset + ASSERTION_DETAIL_QUERY_CONCURRENCY);
    const batchDetails = await Promise.all(batch.map(async (entry) => {
      const detail = await inspectAssertion(niceeval, projectRoot, locator, entry.entryId, options, checkpoint);
      return { entry, ...detail };
    }));
    details.push(...batchDetails);
  }
  return details;
}

/** Write an explicit fixed-operation request; never read the operational Record directly. */
export async function inspectAttempt<Kind extends AttemptInspectionOperation>(
  niceeval: E2ECommand,
  projectRoot: string,
  locator: string,
  operation: Kind,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: InspectionSuccessDocumentFor<Kind> }> {

  const receipt = await niceeval.run(["show", locator, ...({ "attempt.get": [], "attempt.trace": ["execution"], "attempt.timing": ["timing"], "attempt.diff": ["diff"] }[operation]), "--json"], options);
  return { receipt, document: receipt.inspectionSuccess(operation) };
}

export async function inspectRunSummary(
  niceeval: E2ECommand,
  projectRoot: string,
  runId: string,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: InspectionSuccessDocumentFor<"run.get"> }> {

  const receipt = await niceeval.run(["show", `run:${runId}`, "--json"], options);
  return { receipt, document: receipt.run() };
}
