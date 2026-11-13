import { join, resolve } from "node:path";
import { createE2EContext, only } from "@niceeval/testkit";
import { decodeRunDocument } from "niceeval/run";
import { expect, test } from "vitest";
import { createLoopbackBackend, whileRunning } from "./support.js";

const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(), prefix: "niceeval-e2e-orphaned-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")] },
});

// @use-case docs/feature/run/use-case/恢复中断运行.md
test.concurrent("集合恢复只收口已证明终止的 owner，并保留已发布结果", async () => {
  await e2e.case("run-recover-orphaned", async ({ commands: { niceeval } }) => {
    const backend = await createLoopbackBackend();
    const process = niceeval.start(["exp", "run-journey", "--rerun", "all", "--json"], {
      env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint }, timeoutMs: 90_000,
    });
    try {
      await whileRunning(backend.waitForAttempt(0), process, "the first Attempt reached its backend");
      const before = await niceeval.run(["run", "list", "--state", "active", "--json"]);
      expect(before.exitCode, before.diagnostic()).toBe(0);
      const run = only(before.runListDocument().runs, () => true, before.diagnostic());
      expect(run).toMatchObject({ owner: { state: "alive", observedAt: expect.any(String) } });
      const skipped = await niceeval.run(["run", "recover", "--orphaned", "--yes", "--json"]);
      expect(skipped.exitCode, skipped.diagnostic()).toBe(0);
      expect(decodeRunDocument(skipped.json())).toMatchObject({ success: true, value: { operation: "run.recover-orphaned", items: [{ runId: run.runId, outcome: "skipped", reason: "alive" }] } });
      backend.completeAttempt(0);
      await whileRunning(backend.waitForAttempt(1), process, "the second Attempt reached its backend");
      expect(process.signal("SIGKILL")).toBe(true);
      expect((await process.done).signal).toBe("SIGKILL");
      const gone = await niceeval.run(["run", "list", "--state", "active", "--json"]);
      expect(gone.exitCode, gone.diagnostic()).toBe(0);
      expect(gone.runListDocument().runs).toEqual([expect.objectContaining({ runId: run.runId, owner: expect.objectContaining({ state: "gone" }), coverage: { expected: 2, published: 1, missing: 1 } })]);
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
      expect(decodeRunDocument(recovered.json())).toMatchObject({ success: true, value: { operation: "run.recover-orphaned", items: [{ runId: run.runId, outcome: "recovered" }] } });
      const after = await niceeval.run(["run", "list", "--state", "interrupted", "--json"]);
      expect(after.exitCode, after.diagnostic()).toBe(0);
      expect(after.runListDocument().runs).toEqual([expect.objectContaining({ runId: run.runId, state: "interrupted", coverage: { expected: 2, published: 1, missing: 1 } })]);
      const empty = await niceeval.run(["run", "recover", "--orphaned", "--yes"]);
      expect(empty.exitCode, empty.diagnostic()).toBe(0);
      expect(empty.stdout).toContain("No orphaned runs");
    } finally {
      await process.dispose();
      await backend.close();
    }
  });
});
