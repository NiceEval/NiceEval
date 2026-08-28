import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProcessReceipt, QuerySuccessDocumentFor, RunProcessOptions } from "@niceeval/testkit";

type NiceEvalCommand = {
  run(args: readonly string[], options?: RunProcessOptions): Promise<ProcessReceipt>;
};

export type AttemptInspectionOperation = "attempt.get" | "attempt.trace";

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

export async function inspectRuns(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: QuerySuccessDocumentFor<"runs.list"> }> {
  const requestPath = join(projectRoot, ".inspection-runs-list.json");
  await writeFile(requestPath, `${JSON.stringify({
    protocol: "niceeval.query/v1",
    operation: { kind: "runs.list" },
  })}\n`, "utf8");
  const receipt = await niceeval.run(["query", "run", "--request", requestPath], options);
  return { receipt, document: receipt.runsList() };
}
