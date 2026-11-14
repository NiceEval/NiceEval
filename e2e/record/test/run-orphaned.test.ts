import { join, resolve } from "node:path";
import { createE2EContext, only } from "@niceeval/testkit";
import { decodeRunDocument } from "niceeval/run";
import { expect, test } from "vitest";
import { createLoopbackBackend, whileRunning } from "./support.js";

const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-orphaned-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")] },
});

// @use-case docs/feature/run/use-case/恢复中断运行.md
test.concurrent("集合恢复只收口已证明终止的 owner，并保留已发布结果", async () => {
  await e2e.case("run-recover-orphaned", async ({ paths, commands: { niceeval } }) => {
    const backend = await createLoopbackBackend();
    const process = niceeval.start(["exp", "run-journey", "--rerun", "all", "--json"], {
      env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint },
      timeoutMs: 90_000,
    });
    try {
      await whileRunning(backend.waitForAttempt(0), process, "the first Attempt reached its backend");
      const before = await niceeval.run(["run", "list", "--state", "active", "--json"]);
      expect(before.exitCode, before.diagnostic()).toBe(0);
      const run = only(before.runListDocument().runs, () => true, before.diagnostic());
      expect(run).toMatchObject({ owner: { state: "alive", observedAt: expect.any(String) } });
      const skipped = await niceeval.run(["run", "recover", "--orphaned", "--yes", "--json"]);
      expect(skipped.exitCode, skipped.diagnostic()).toBe(0);
      expect(decodeRunDocument(skipped.json())).toMatchObject({
        success: true,
        value: {
          operation: "run.recover-orphaned",
          items: [{ runId: run.runId, outcome: "skipped", reason: "alive" }],
        },
      });
      backend.completeAttempt(0);
      await whileRunning(backend.waitForAttempt(1), process, "the second Attempt reached its backend");
      expect(process.signal("SIGKILL")).toBe(true);
      expect((await process.done).signal).toBe("SIGKILL");
      const gone = await niceeval.run(["run", "list", "--state", "active", "--json"]);
      expect(gone.exitCode, gone.diagnostic()).toBe(0);
      expect(gone.runListDocument().runs).toEqual([
        expect.objectContaining({
          runId: run.runId,
          owner: expect.objectContaining({ state: "gone" }),
          coverage: { expected: 2, published: 1, missing: 1 },
        }),
      ]);
      const human = await niceeval.run(["run", "list", "--state", "active"]);
      expect(human.stdout).toContain("owner gone");
      expect(human.stdout).toContain("Next: niceeval run recover --orphaned");
      const unconfirmed = await niceeval.run(["run", "recover", "--orphaned", "--json"]);
      expect(unconfirmed.exitCode, unconfirmed.diagnostic()).not.toBe(0);
      const unchanged = await niceeval.run(["run", "list", "--state", "active", "--json"]);
      expect(unchanged.runListDocument().runs.map((item) => item.runId)).toEqual([run.runId]);
      const exclusive = await niceeval.run(["run", "recover", run.runId, "--orphaned", "--yes", "--json"]);
      expect(exclusive.exitCode, exclusive.diagnostic()).not.toBe(0);
      const recovered = await niceeval.run(["run", "recover", "--orphaned", "--yes", "--json"]);
      expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
      expect(decodeRunDocument(recovered.json())).toMatchObject({
        success: true,
        value: { operation: "run.recover-orphaned", items: [{ runId: run.runId, outcome: "recovered" }] },
      });
      const after = await niceeval.run(["run", "list", "--state", "interrupted", "--json"]);
      expect(after.exitCode, after.diagnostic()).toBe(0);
      expect(after.runListDocument().runs).toEqual([
        expect.objectContaining({
          runId: run.runId,
          state: "interrupted",
          coverage: { expected: 2, published: 1, missing: 1 },
        }),
      ]);
      const empty = await niceeval.run(["run", "recover", "--orphaned", "--yes"]);
      expect(empty.exitCode, empty.diagnostic()).toBe(0);
      expect(empty.stdout).toContain("No orphaned runs");

      const faults = join(paths.projectRoot, "fixtures", "run-os-fault.cjs");
      const unknownBackend = await createLoopbackBackend();
      const unknownProcess = niceeval.start(["exp", "run-journey", "--rerun", "all", "--json"], {
        env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: unknownBackend.endpoint },
        timeoutMs: 90_000,
      });
      try {
        await whileRunning(unknownBackend.waitForAttempt(0), unknownProcess, "the unknown owner's first Attempt");
        const unknown = await niceeval.run(["run", "list", "--state", "active", "--json"], {
          env: { NODE_OPTIONS: `--require=${faults}`, NICEEVAL_RUN_OS_FAULT: "identity-unavailable" },
        });
        expect(unknown.exitCode, unknown.diagnostic()).toBe(0);
        const unknownRun = only(unknown.runListDocument().runs, () => true, unknown.diagnostic());
        expect(unknownRun.owner).toMatchObject({ state: "unknown", reason: "probe-failed" });
        const skippedUnknown = await niceeval.run(["run", "recover", "--orphaned", "--yes", "--json"], {
          env: { NODE_OPTIONS: `--require=${faults}`, NICEEVAL_RUN_OS_FAULT: "identity-unavailable" },
        });
        expect(skippedUnknown.exitCode, skippedUnknown.diagnostic()).toBe(0);
        expect(decodeRunDocument(skippedUnknown.json())).toMatchObject({
          success: true,
          value: { items: [{ runId: unknownRun.runId, outcome: "skipped", reason: "unknown:probe-failed" }] },
        });
        unknownBackend.completeAttempt(0);
        await whileRunning(unknownBackend.waitForAttempt(1), unknownProcess, "the unknown owner's second Attempt");
        unknownBackend.completeAttempt(1);
        expect((await unknownProcess.done).exitCode).toBe(0);
      } finally {
        await unknownProcess.dispose();
        await unknownBackend.close();
      }

      // Two independently killed owners make partial failure distinguishable
      // from stopping the whole collection after its first error.
      const orphanIds: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const orphanBackend = await createLoopbackBackend();
        const orphan = niceeval.start(["exp", "run-journey", "--rerun", "all", "--json"], {
          env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: orphanBackend.endpoint },
          timeoutMs: 90_000,
        });
        try {
          await whileRunning(orphanBackend.waitForAttempt(0), orphan, "an independent owner's first Attempt");
          expect(orphan.signal("SIGKILL")).toBe(true);
          expect((await orphan.done).signal).toBe("SIGKILL");
          const active = await niceeval.run(["run", "list", "--state", "active", "--json"]);
          expect(active.exitCode, active.diagnostic()).toBe(0);
          const newest = active.runListDocument().runs[0]!;
          orphanIds.unshift(newest.runId);
        } finally {
          await orphan.dispose();
          await orphanBackend.close();
        }
      }
      const partial = await niceeval.run(["run", "recover", "--orphaned", "--yes", "--json"], {
        env: { NODE_OPTIONS: `--require=${faults}`, NICEEVAL_RUN_OS_FAULT: "commit-once" },
      });
      expect(partial.exitCode, partial.diagnostic()).not.toBe(0);
      expect(decodeRunDocument(partial.json())).toMatchObject({
        success: true,
        value: {
          items: [
            { runId: orphanIds[0], outcome: "failed", reason: "run-recover-failed" },
            { runId: orphanIds[1], outcome: "recovered" },
          ],
        },
      });
      const recovering = await niceeval.run(["run", "list", "--state", "recovering", "--json"]);
      expect(recovering.exitCode, recovering.diagnostic()).toBe(0);
      expect(recovering.runListDocument().runs).toEqual([
        expect.objectContaining({
          runId: orphanIds[0],
          state: "recovering",
          owner: expect.objectContaining({ state: "gone" }),
        }),
      ]);
      const retried = await niceeval.run(["run", "recover", "--orphaned", "--yes", "--json"]);
      expect(retried.exitCode, retried.diagnostic()).toBe(0);
      expect(decodeRunDocument(retried.json())).toMatchObject({
        success: true,
        value: { items: [{ runId: orphanIds[0], outcome: "recovered" }] },
      });
    } finally {
      await process.dispose();
      await backend.close();
    }
  });
});
