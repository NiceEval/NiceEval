import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProcessReceipt, RunProcessOptions } from "@niceeval/testkit";

type NiceEvalCommand = {
  run(args: readonly string[], options?: RunProcessOptions): Promise<ProcessReceipt>;
};

export type AttemptInspectionOperation =
  | "attempt.get"
  | "attempt.trace"
  | "attempt.timing"
  | "attempt.diff";

export interface InspectionDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: AttemptInspectionOperation | "attempt.assertion.detail";
  readonly behaviorVersion: string;
  readonly sealedCutoff: unknown;
  readonly selection: unknown;
  readonly issues: readonly unknown[];
  readonly evidence: unknown;
}

export interface AssertionIndexEntry {
  readonly entryId: string;
  readonly display: { readonly label?: string };
}

export async function inspectAssertion<T extends InspectionDocument>(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  locator: string,
  entryId: string,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: T }> {
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
  return { receipt, document: receipt.json<T>() };
}

// Each detail read starts the installed CLI; keep the per-file bound low because Vitest also runs files in parallel.
const ASSERTION_DETAIL_QUERY_CONCURRENCY = 2;

/** Read every Assertion detail in declaration order with an explicit process bound. */
export async function inspectAssertionEntries<T extends InspectionDocument>(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  locator: string,
  entries: readonly AssertionIndexEntry[],
  options: RunProcessOptions = {},
): Promise<readonly { readonly entry: AssertionIndexEntry; readonly receipt: ProcessReceipt; readonly document: T }[]> {
  const details: { entry: AssertionIndexEntry; receipt: ProcessReceipt; document: T }[] = [];
  for (let offset = 0; offset < entries.length; offset += ASSERTION_DETAIL_QUERY_CONCURRENCY) {
    const batch = entries.slice(offset, offset + ASSERTION_DETAIL_QUERY_CONCURRENCY);
    const batchDetails = await Promise.all(batch.map(async (entry) => {
      const detail = await inspectAssertion<T>(niceeval, projectRoot, locator, entry.entryId, options);
      return { entry, ...detail };
    }));
    details.push(...batchDetails);
  }
  return details;
}

/** Write an explicit fixed-operation request; never read the operational Record directly. */
export async function inspectAttempt<T extends InspectionDocument>(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  locator: string,
  operation: AttemptInspectionOperation,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: T }> {
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
  return { receipt, document: receipt.json<T>() };
}

export async function inspectRunSummary<T extends Omit<InspectionDocument, "operation"> & { readonly operation: "run.summary" }>(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  runId: string,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: T }> {
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
  return { receipt, document: receipt.json<T>() };
}
