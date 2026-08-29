import type { GenerationLease } from "../data/index.ts";
import { runOperations } from "../data/operations.ts";
import { closeRun, type RunPageModel } from "./model.ts";

export async function loadRun(lease: GenerationLease, runId: string): Promise<RunPageModel> {
  const [runOperation, summaryOperation] = runOperations(runId);
  const [run, summary] = await Promise.all([
    lease.inspect(runOperation),
    lease.inspect(summaryOperation),
  ]);
  return closeRun(run, summary);
}
