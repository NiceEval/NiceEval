// 跨进程保证：进程终止与信号——Run recovery 清锁与另一个 Invocation 接管交错。
import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { execa } from "execa";
import { coordinationHost } from "niceeval/coordination/host";
import { runHost } from "niceeval/run/host";
import { expect, test } from "vitest";
import {
  ProjectStateDatabase,
  ProjectStateDatabaseLive,
} from "../../packages/niceeval/src/record/sqlite/project-state-database.ts";
import type { CaseCoordinationCommand, StorageWorkerResult } from "../../packages/niceeval/src/record/sqlite/worker-protocol.ts";
import { createRecordProject, waitForGate } from "../integration/fixtures/record-harness/project.ts";

// @feature docs/feature/experiments/README.md#concurrency-and-queues
test("the same claim call continues when Run recovery clears the dead owner before takeover", async () => {
  const cwd = await createRecordProject("niceeval-claim-recovery-", { held: true });
  const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
  const start = (experimentId: string) =>
    execa(process.execPath, [...process.execArgv, cli, "exp", experimentId, "--json"], { cwd, reject: false });
  const owner = start("runs");
  let unrelated: ReturnType<typeof start> | undefined;
  try {
    await Promise.race([waitForGate(cwd, "entered"), owner.then((run) => { throw new Error(run.stderr); })]);
    const { runs } = await Effect.runPromise(runHost.list({ cwd }));
    const [run] = runs;
    if (run === undefined) throw new Error("Expected the active Run");
    // Keep another real Invocation active so Run recovery does not make the
    // database portable while this Host is testing the case command boundary.
    await copyFile(join(cwd, "experiments", "runs.ts"), join(cwd, "experiments", "unrelated.ts"));
    await rm(join(cwd, "gates", "entered"));
    unrelated = start("unrelated");
    await Promise.race([
      waitForGate(cwd, "entered"),
      unrelated.then((run) => { throw new Error(run.stderr); }),
    ]);
    owner.kill("SIGKILL");
    await owner;

    let recovered = false;
    await Effect.runPromise(
      Effect.gen(function* () {
        const claim = yield* coordinationHost.claimExecution({
          projectDatabaseRoot: join(cwd, ".niceeval"),
          experimentId: "runs",
          evalId: "held",
        });
        yield* claim.release;
        expect(claim.caseTakenOver).toBe(false);
        expect((yield* runHost.get({ cwd, runId: run.runId })).run.state).toBe("interrupted");
      }).pipe(
        Effect.updateService(ProjectStateDatabase, (database) => ({
          ...database,
          bind: (path) => database.bind(path).pipe(Effect.map((facets) => ({
            ...facets,
            caseCoordination: {
              async execute<A extends StorageWorkerResult>(command: CaseCoordinationCommand) {
                if (command._tag === "case-takeover" && !recovered) {
                  recovered = true;
                  await Effect.runPromise(runHost.recover({ cwd, runId: run.runId }));
                }
                return facets.caseCoordination.execute<A>(command);
              },
            },
          }))),
        })),
        Effect.provide(ProjectStateDatabaseLive),
      ),
    );
  } finally {
    unrelated?.kill("SIGKILL");
    await unrelated;
    owner.kill("SIGKILL");
    await owner;
    await rm(cwd, { recursive: true, force: true });
  }
}, 15_000);
