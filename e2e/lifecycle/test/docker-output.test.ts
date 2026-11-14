import { resolve } from "node:path";
import { command, defined, pollUntil, withProcess, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// @feature docs/feature/sandbox/README.md
test.concurrent("Docker 命令增量输出保留跨块 UTF-8 字符与大输出完整性", async () => {
  await withProjectCopy(
    {
      from: process.cwd(),
      prefix: "niceeval-e2e-docker-output-",
      omitTopLevel: [".niceeval", "node_modules", "test"],
      links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
    },
    async ({ root }) => {
      await withProcess(
        [resolve("node_modules/.bin/niceeval"), "exp", "docker-output", "--rerun", "all", "--json"],
        { cwd: root, processGroup: true, timeoutMs: 180_000 },
        async (controlled) => {
          const result = await controlled.done;
          expect(result.exitCode, result.diagnostic()).toBe(0);
          expect(result.expReceipt().completion).toBe("completed");
          expect(result.expEvalEvents()).toEqual([
            expect.objectContaining({ evalId: "docker-output", verdict: "passed" }),
          ]);
          await pollUntil(
            async () => {
              const listed = await command(["docker"]).run(
                ["ps", "-aq", "--filter", `label=niceeval.pid=${defined(controlled.pid)}`],
                { cwd: root },
              );
              expect(listed.exitCode, listed.diagnostic()).toBe(0);
              return listed.stdout.trim() === "" ? true : undefined;
            },
            { timeoutMs: 15_000, intervalMs: 100, label: "owned Docker sandbox removed" },
          );
        },
      );
    },
  );
});
