

import type { ProcessReceipt, InspectionSuccessDocumentFor, RunProcessOptions } from "@niceeval/testkit";

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
): Promise<{ readonly receipt: ProcessReceipt; readonly document: InspectionSuccessDocumentFor<Kind> }> {

  const receipt = await niceeval.run(["show", locator, ...({ "attempt.get": [], "attempt.trace": ["execution"], "attempt.timing": ["timing"], "attempt.diff": ["diff"] }[operation]), "--json"], options);
  return { receipt, document: receipt.inspectionSuccess(operation) };
}

export async function inspectRuns(
  niceeval: NiceEvalCommand,
  projectRoot: string,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: InspectionSuccessDocumentFor<"run.list"> }> {

  const receipt = await niceeval.run(["show", "runs", "--json"], options);
  return { receipt, document: receipt.runsList() };
}
