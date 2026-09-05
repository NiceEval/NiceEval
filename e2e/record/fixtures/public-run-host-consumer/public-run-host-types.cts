import { Effect } from "effect";
import { runHost } from "niceeval/run/host";

export function compilePublicRunHostCalls(cwd: string, runId: string) {
  return Promise.all([
    Effect.runPromise(runHost.list({ cwd })),
    Effect.runPromise(runHost.get({ cwd, runId })),
    Effect.runPromise(runHost.delete({ cwd, runId })),
    Effect.runPromise(runHost.recover({ cwd, runId })),
  ]);
}
