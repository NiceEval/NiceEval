import { Schema } from "effect";
import { observeNativeTestResult } from "./native-observation.ts";
import { RepoReceiptSchema } from "./contracts.ts";
import { decode, RangeSchema, SelectionSchema, Text, type NativeResult, type Selection } from "./adapter-wire.ts";
export const CollectionSchema = Schema.Struct({ format: Schema.Literal("niceeval.adapter-collection/v1"), selections: Schema.Array(SelectionSchema), ranges: Schema.Record(Text, RangeSchema), groups: Schema.Record(Text, Text), gaps: Schema.Array(Text) });
export const ExecutionSchema = Schema.Struct({ format: Schema.Literal("niceeval.adapter-execution/v1"), selection: SelectionSchema, receipt: RepoReceiptSchema });
// A native reporter observation is required even when the wrapper exits zero.
export function observeExecutionDetails(value: unknown, selection: Selection) {
  const { selection: actual, receipt } = decode(ExecutionSchema, value);
  if (JSON.stringify(actual) !== JSON.stringify(selection) || receipt.repoId !== selection.repo) throw new Error("execution selection mismatch");
  if (!["pass", "regression"].includes(receipt.category)) throw new Error("execution did not reach an ordinary test result");
  const tests = receipt.stages.filter(stage => stage.stage === "test");
  if (tests.length !== 1 || receipt.testInvocations !== 1) throw new Error("expected exactly one native test invocation");
  const capture = tests[0]!.capture;
  if (!capture || capture.exitCode === null || capture.signal !== null || capture.timedOut || capture.cancelled || capture.error !== undefined) throw new Error("native test terminated abnormally");
  if (receipt.exitCode !== capture.exitCode || (receipt.category === "pass") !== (capture.exitCode === 0)) throw new Error("native receipt and test exit status disagree");
  if (capture.processGroupOwned && capture.groupCleanup.gone !== true) throw new Error("native test process cleanup is unconfirmed");
  if (receipt.stages.some(stage => stage.cancelled || stage.stage !== "test" && !stage.ok) || !receipt.stages.some(stage => stage.stage === "cleanup" && stage.ok)) throw new Error("preparation or cleanup failed");
  const observed = observeNativeTestResult(selection.executor, capture.stdout, { only: true, file: (selection.nativeFile ?? selection.file).slice(`e2e/${selection.repo}/`.length), titlePath: selection.titlePath, ...(selection.members === undefined ? {} : { members: selection.members }) });
  if (observed.caseCount < 1 || observed.retries !== 0 || observed.skipped !== 0 || observed.passed + observed.failed !== observed.caseCount || (observed.failed === 0) !== (capture.exitCode === 0)) throw new Error("native outcome and exit status disagree");
  return observed;
}
export function observeExecution(value: unknown, selection: Selection, nativeId: string): NativeResult {
  const observed = observeExecutionDetails(value, selection);
  return { nativeId, outcome: observed.failed === 0 ? "passed" : "failed", provenance: `NiceEval ${selection.executor} JSON reporter; ${JSON.stringify(observed.items)}` };
}
