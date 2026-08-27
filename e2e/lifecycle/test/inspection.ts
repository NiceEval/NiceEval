import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProcessReceipt, RunProcessOptions } from "@niceeval/testkit";

type NiceEvalCommand = {
  run(args: readonly string[], options?: RunProcessOptions): Promise<ProcessReceipt>;
};

export type AttemptInspectionOperation = "attempt.get" | "attempt.trace";

export interface InspectionDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: AttemptInspectionOperation;
  readonly behaviorVersion: string;
  readonly sealedCutoff: unknown;
  readonly selection: unknown;
  readonly issues: readonly unknown[];
  readonly evidence: unknown;
}

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

export async function inspectRuns<T extends Omit<InspectionDocument, "operation"> & { readonly operation: "runs.list" }>(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: T }> {
  const requestPath = join(projectRoot, ".inspection-runs-list.json");
  await writeFile(requestPath, `${JSON.stringify({
    protocol: "niceeval.query/v1",
    operation: { kind: "runs.list" },
  })}\n`, "utf8");
  const receipt = await niceeval.run(["query", "run", "--request", requestPath], options);
  return { receipt, document: receipt.json<T>() };
}
