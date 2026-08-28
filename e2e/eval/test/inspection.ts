import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProcessReceipt, QuerySuccessDocumentFor, RunProcessOptions } from "@niceeval/testkit";

type NiceEvalCommand = {
  run(args: readonly string[], options?: RunProcessOptions): Promise<ProcessReceipt>;
};

export type AttemptInspectionOperation =
  | "attempt.get"
  | "attempt.trace"
  | "attempt.timing"
  | "attempt.diff";

export interface AssertionIndexEntry {
  readonly entryId: string;
  readonly display: { readonly label?: string };
}

export async function inspectAssertion(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  locator: string,
  entryId: string,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: QuerySuccessDocumentFor<"attempt.assertion.detail"> }> {
  const requestPath = join(projectRoot, `.inspection-attempt-assertion-detail-${locator.slice(1)}-${entryId}.json`);
  await writeFile(
    requestPath,
    `${JSON.stringify({
      protocol: "niceeval.query/v1",
      operation: { kind: "attempt.assertion.detail", locator, entryId },
    })}\n`,
    "utf8",
  );
  const receipt = await niceeval.run(["query", "run", "--request", requestPath], options);
  return { receipt, document: receipt.attemptAssertionDetail() };
}

// Each detail read starts the installed CLI while Vitest also runs files in
// parallel. Keep one reader per Record so the suite cannot multiply process
// and SQLite validation pressure inside a single case.
const ASSERTION_DETAIL_QUERY_CONCURRENCY = 1;

/** Read every Assertion detail in declaration order with an explicit process bound. */
export async function inspectAssertionEntries(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  locator: string,
  entries: readonly AssertionIndexEntry[],
  options: RunProcessOptions = {},
): Promise<readonly { readonly entry: AssertionIndexEntry; readonly receipt: ProcessReceipt; readonly document: QuerySuccessDocumentFor<"attempt.assertion.detail"> }[]> {
  const details: { entry: AssertionIndexEntry; receipt: ProcessReceipt; document: QuerySuccessDocumentFor<"attempt.assertion.detail"> }[] = [];
  for (let offset = 0; offset < entries.length; offset += ASSERTION_DETAIL_QUERY_CONCURRENCY) {
    const batch = entries.slice(offset, offset + ASSERTION_DETAIL_QUERY_CONCURRENCY);
    const batchDetails = await Promise.all(batch.map(async (entry) => {
      const detail = await inspectAssertion(niceeval, projectRoot, locator, entry.entryId, options);
      return { entry, ...detail };
    }));
    details.push(...batchDetails);
  }
  return details;
}

/** Write an explicit fixed-operation request; never read the operational Record directly. */
export async function inspectAttempt<Kind extends AttemptInspectionOperation>(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  locator: string,
  operation: Kind,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: QuerySuccessDocumentFor<Kind> }> {
  const requestPath = join(projectRoot, `.inspection-${operation.replace(".", "-")}-${locator.slice(1)}.json`);
  await writeFile(
    requestPath,
    `${JSON.stringify({
      protocol: "niceeval.query/v1",
      operation: { kind: operation, locator },
    })}\n`,
    "utf8",
  );
  const receipt = await niceeval.run(["query", "run", "--request", requestPath], options);
  return { receipt, document: receipt.querySuccess(operation) };
}

export async function inspectRunSummary(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  runId: string,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: QuerySuccessDocumentFor<"run.summary"> }> {
  const requestPath = join(projectRoot, `.inspection-run-summary-${runId}.json`);
  await writeFile(
    requestPath,
    `${JSON.stringify({
      protocol: "niceeval.query/v1",
      operation: { kind: "run.summary", runId },
    })}\n`,
    "utf8",
  );
  const receipt = await niceeval.run(["query", "run", "--request", requestPath], options);
  return { receipt, document: receipt.runSummary() };
}
