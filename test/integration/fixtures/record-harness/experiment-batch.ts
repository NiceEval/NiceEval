import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import { createRecordProject } from "./project.ts";

export async function planBatch(cwd: string, experimentIds: string[], evalSelectors?: string[]) {
  const result = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd, config: { maxConcurrency: 1 }, experimentIds, evalSelectors }),
  );
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  return result.plan;
}

export async function createExperimentBatch(evalIds = ["first", "second"]) {
  const cwd = await createRecordProject("niceeval-inspection-experiment-batch-", { held: false });
  const locators = new Map<string, string>();
  try {
    const experiment = join(cwd, "experiments", "runs.ts");
    await writeFile(experiment, (await readFile(experiment, "utf8")).replace('["first"]', JSON.stringify(evalIds)));
    await copyFile(experiment, join(cwd, "experiments", "more.ts"));
    await copyFile(join(cwd, "evals", "first.eval.ts"), join(cwd, "evals", "second.eval.ts"));
    for (const experimentId of ["runs", "more"]) {
      for (const evalId of evalIds) {
        const plan = await planBatch(cwd, [experimentId], [evalId]);
        const result = await Effect.runPromise(experimentHost.invocation.run({ plan }));
        const detail = await Effect.runPromise(runHost.get({ cwd, runId: result.receipt.createdRunIds[0]! }));
        const publication = detail.run.slots[0]!.publication;
        if (publication.state !== "published") throw new Error(`No published result for ${experimentId}/${evalId}`);
        locators.set(`${experimentId}/${evalId}`, publication.attemptLocator);
      }
    }
    return { cwd, locators };
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

export async function withSlowAttachmentReads<A>(read: () => Promise<A>, millisPerCheck = 1_000): Promise<A> {
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    // Model individually short Record reads whose cumulative cost outlives one deadline.
    const stack = new Error().stack ?? "";
    if (stack.includes("assertUsable") && /hydrateAttachment|decodeCurrentAssertions/.test(stack)) now += millisPerCheck;
    return now;
  });
  try {
    return await read();
  } finally {
    clock.mockRestore();
  }
}
