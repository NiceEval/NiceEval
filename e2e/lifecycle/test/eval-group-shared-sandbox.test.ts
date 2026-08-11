// owner: docs/engineering/testing/e2e/README.md#eval-group-shared-sandbox
import { resolve } from "node:path";
import { command, defined, only, pollUntil, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface HistoryAttempt {
  attempt: number;
  verdict: string;
  sandbox?: {
    provider: string;
    sandboxId: string;
    reused?: true;
    reuseSandbox?: number;
    reuseOrdinal?: number;
  };
}

interface ShowHistoryDocument {
  format: "niceeval.show";
  schemaVersion: number;
  view: "history";
  data: {
    sections: Array<{
      experimentId: string;
      evalId: string;
      attempts: HistoryAttempt[];
    }>;
  };
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const docker = command(["docker"]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-eval-group-project-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

async function historyAttempt(root: string, evalId: string): Promise<HistoryAttempt> {
  const shown = await niceeval.run(["show", evalId, "--history", "--json"], { cwd: root });
  expect(shown.exitCode, shown.diagnostic()).toBe(0);
  const document = shown.json<ShowHistoryDocument>();
  expect(document).toMatchObject({ format: "niceeval.show", schemaVersion: 1, view: "history" });
  const section = only(
    document.data.sections,
    (candidate) => candidate.experimentId === "eval-group" && candidate.evalId === evalId,
    shown.diagnostic(),
  );
  return only(section.attempts, () => true, shown.diagnostic());
}

async function waitForContainerGone(container: string, cwd: string): Promise<void> {
  await pollUntil(
    async () => {
      const inspected = await docker.run(["inspect", container], { cwd });
      return inspected.exitCode !== 0 ? true : undefined;
    },
    { timeoutMs: 15_000, intervalMs: 100, label: `Docker sandbox ${container} to be removed` },
  );
}

test("两个 Eval Group 并行、各自组内串行复用并重置同一台 Docker Sandbox", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const run = await niceeval.run(["exp", "eval-group", "--rerun", "all", "--json"], {
      cwd: root,
      timeoutMs: 120_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expResult()).toMatchObject({
      event: "result",
      status: "passed",
      completion: "complete",
      passed: 4,
      failed: 0,
      errored: 0,
    });

    const [groupAFirst, groupASecond, groupBFirst, groupBSecond] = await Promise.all([
      historyAttempt(root, "group-a/01-first"),
      historyAttempt(root, "group-a/02-second"),
      historyAttempt(root, "group-b/01-first"),
      historyAttempt(root, "group-b/02-second"),
    ]);
    for (const attempt of [groupAFirst, groupASecond, groupBFirst, groupBSecond]) {
      expect(attempt).toMatchObject({
        attempt: 0,
        verdict: "passed",
        sandbox: { provider: "docker", reused: true },
      });
    }

    const groupASandbox = defined(groupAFirst.sandbox?.sandboxId);
    const groupBSandbox = defined(groupBFirst.sandbox?.sandboxId);
    expect(groupASecond.sandbox?.sandboxId).toBe(groupASandbox);
    expect(groupBSecond.sandbox?.sandboxId).toBe(groupBSandbox);
    expect(groupBSandbox).not.toBe(groupASandbox);
    expect(groupAFirst.sandbox?.reuseOrdinal).toBe(1);
    expect(groupASecond.sandbox?.reuseOrdinal).toBe(2);
    expect(groupBFirst.sandbox?.reuseOrdinal).toBe(1);
    expect(groupBSecond.sandbox?.reuseOrdinal).toBe(2);

    await Promise.all([
      waitForContainerGone(groupASandbox, root),
      waitForContainerGone(groupBSandbox, root),
    ]);
  });
});
