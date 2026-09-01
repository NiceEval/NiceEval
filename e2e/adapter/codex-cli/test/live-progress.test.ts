// rerun: pnpm e2e test --repo adapter/codex-cli -- --run test/live-progress.test.ts

import { command, createE2EContext, only, withInspectionRequest } from "@niceeval/testkit";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const COMMAND_SENTINEL = "niceeval-e2e-run-914";

const codexE2E = createE2EContext({
  repoId: "codex-cli",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-codex-cli-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "junit.xml", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {},
});

test("Codex CLI 的 coding-task 完成并可从公开 trace 读回 command tool [necase_11ZFMQPPHVM1BYZH]", async () => {
  await codexE2E.case(
    "live-progress",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths }) => {
      const niceeval = command([join(paths.projectRoot, "node_modules", ".bin", "niceeval")]);
      const env = { ...process.env, NICEEVAL_HOME: join(paths.projectRoot, ".niceeval-user") };
      const run = await niceeval.run(
        ["exp", "baseline", "coding-task", "--rerun", "all", "--json"],
        { cwd: paths.projectRoot, env, timeoutMs: 5 * 60_000 },
      );
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const codingTask = only(
        run.expEvalEvents(),
        (event) => event.experimentId === "baseline" && event.evalId === "coding-task",
        () => run.diagnostic(),
      );
      expect(codingTask).toMatchObject({ verdict: "passed", attempts: 1, passed: 1 });

      const queried = await withInspectionRequest(
        { kind: "attempt.trace", locator: codingTask.locator },
        async (requestPath) => await niceeval.run(
          ["query", "run", "--request", requestPath],
          { cwd: paths.projectRoot, env },
        ),
      );
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const trace = JSON.stringify(queried.attemptTrace().trace);
      expect(trace).toContain(COMMAND_SENTINEL);
      expect(
        trace.includes("shell") || trace.includes("command_execution"),
        "attempt trace missing shell/command_execution",
      ).toBe(true);
    },
  );
});
