import type { GenerationLease } from "../../data/index.ts";
import { attemptOperations } from "../../data/operations.ts";
import { closeAttemptPage, type AttemptPageModel } from "../model/page.ts";

export async function loadAttempt(lease: GenerationLease, locator: string): Promise<AttemptPageModel> {
  const [attemptOperation, traceOperation] = attemptOperations(locator);
  const [attempt, trace] = await Promise.all([
    lease.inspect(attemptOperation),
    lease.inspect(traceOperation),
  ]);
  return closeAttemptPage(attempt, trace);
}
