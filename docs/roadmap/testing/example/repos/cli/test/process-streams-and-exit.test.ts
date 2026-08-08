// feature: docs/feature/experiments/cli.md
import { resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// NiceEval 根目录：pnpm e2e --repo cli -- --run test/process-streams-and-exit.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test --run test/process-streams-and-exit.test.ts

interface ExpEvent {
  event: string;
  status?: string;
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-streams-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("JSON 模式保持 stdout、stderr 与 exit code 的公开分工", async () => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    const passed = await niceeval.run(["exp", "passing", "--rerun", "all", "--json"], { cwd: root });
    expect(passed.exitCode, passed.diagnostic()).toBe(0);
    expect(passed.stderr).toBe("");
    expect(passed.ndjson<ExpEvent>().at(-1))
      .toMatchObject({ event: "result", status: "passed" });

    const failed = await niceeval.run(["exp", "failing", "--rerun", "all", "--json"], { cwd: root });
    expect(failed.exitCode, failed.diagnostic()).toBe(1);
    expect(failed.stderr).toBe("");
    expect(failed.ndjson<ExpEvent>().at(-1))
      .toMatchObject({ event: "result", status: "failed" });

    const usageError = await niceeval.run(["show", "missing-eval", "--json"], { cwd: root });
    expect(usageError.exitCode, usageError.diagnostic()).not.toBe(0);
    expect(usageError.stdout).toBe("");
    expect(usageError.stderr).toContain("No results matched");
  });
});
