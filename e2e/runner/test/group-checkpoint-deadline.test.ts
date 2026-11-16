import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// @feature docs/feature/eval-groups/README.md
test.concurrent("Group 成员耗尽执行时限后仍能在 cleanup 保存 checkpoint", async () => {
  await withProjectCopy(
    {
      from: process.cwd(),
      prefix: "niceeval-e2e-group-checkpoint-",
      omitTopLevel: [".niceeval", "node_modules", "test"],
      links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
    },
    async ({ root }) => {
      const result = await command([resolve("node_modules/.bin/niceeval")]).run(
        ["exp", "group-checkpoint", "--rerun", "all", "--json"],
        { cwd: root, timeoutMs: 180_000 },
      );
      expect(result.expReceipt().completion, result.diagnostic()).toBe("completed");
      expect(result.expEvalEvents()).toEqual([
        expect.objectContaining({ evalId: "group-checkpoint/first", verdict: "passed" }),
        expect.objectContaining({ evalId: "group-checkpoint/timeout", verdict: "errored" }),
      ]);
      expect(await readFile(join(root, "group-checkpoint-saved.txt"), "utf8"), result.diagnostic()).toBe("second");
      expect(
        await readFile(join(root, "group-checkpoint-explicit-timeout.txt"), "utf8"),
        result.diagnostic(),
      ).toContain("100ms");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("sandbox-teardown-failed");
    },
  );
});
