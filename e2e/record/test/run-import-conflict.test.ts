import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createE2EContext, runProcess } from "@niceeval/testkit";
import { expect, test } from "vitest";

const binary = join(process.cwd(), "node_modules", ".bin", "niceeval");
const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(), prefix: "niceeval-e2e-import-conflict-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [binary] },
});

// @feature docs/feature/run/README.md
test.concurrent("同 ID 的 Run 已删除时整批汇入拒绝，新的 Run 也不落库", async () => {
  await e2e.case("run-import-collision-rollback", async ({ paths, commands: { niceeval } }) => {
    const first = await niceeval.run(["exp", "migration-agent", "--rerun", "all", "--json"]);
    expect(first.exitCode, first.diagnostic()).toBe(0);
    const runId = first.expReceipt().createdRunIds[0]!;
    const single = join(paths.projectRoot, "single.sqlite");
    const exported = await niceeval.run(["run", "export", "--run", runId, "--out", single]);
    expect(exported.exitCode, exported.diagnostic()).toBe(0);
    const second = await niceeval.run(["exp", "migration-custom", "--rerun", "all", "--json"]);
    expect(second.exitCode, second.diagnostic()).toBe(0);
    const newRun = second.expReceipt().createdRunIds[0]!;
    const batch = join(paths.projectRoot, "batch.sqlite");
    const batchExport = await niceeval.run(["run", "export", "--run", runId, "--run", newRun, "--out", batch]);
    expect(batchExport.exitCode, batchExport.diagnostic()).toBe(0);
    const target = join(paths.projectRoot, "recipient");
    await mkdir(target);
    const options = { cwd: target, env: { NICEEVAL_HOME: join(target, ".user") } };
    const imported = await runProcess([binary, "run", "import", single], options);
    expect(imported.exitCode, imported.diagnostic()).toBe(0);
    const deleted = await runProcess([binary, "run", "delete", runId, "--yes"], options);
    expect(deleted.exitCode, deleted.diagnostic()).toBe(0);
    const before = await runProcess([binary, "run", "list", "--json"], options);
    expect(before.exitCode, before.diagnostic()).toBe(0);
    expect(before.runListDocument().runs).toEqual([]);
    const collision = await runProcess([binary, "run", "import", batch, "--json"], options);
    expect(collision.exitCode, collision.diagnostic()).not.toBe(0);
    expect(collision.stdout).toBe("");
    expect(collision.stderr).toContain("run-id-collision");
    const after = await runProcess([binary, "run", "list", "--json"], options);
    expect(after.exitCode, after.diagnostic()).toBe(0);
    expect(after.runListDocument()).toEqual(before.runListDocument());
  });
});
