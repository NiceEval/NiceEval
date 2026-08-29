import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { command, defined, only, pollUntil, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface LifecycleEntry {
  readonly groupId: string;
  readonly evalId: string;
  readonly sandboxId: string;
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const docker = command(["docker"]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-eval-group-project-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

function lifecycleEntries(root: string): LifecycleEntry[] {
  return readFileSync(resolve(root, "eval-group-lifecycle.ndjson"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LifecycleEntry);
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

test("两个 Eval Group 并行、各自组内串行复用并重置同一台 Docker Sandbox [necase_ZSJ6A2P1FJ5AC603]", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const run = await niceeval.run(["exp", "eval-group", "--rerun", "all", "--json"], {
      cwd: root,
      timeoutMs: 120_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
    const evalEvents = run.expEvents().filter(
      (event): event is ExpEvalEvent => "event" in event && event.event === "eval",
    );
    expect(evalEvents, run.diagnostic()).toHaveLength(4);
    expect(evalEvents.map((event) => event.verdict), run.diagnostic()).toEqual([
      "passed",
      "passed",
      "passed",
      "passed",
    ]);

    const entries = lifecycleEntries(root);
    expect(entries).toHaveLength(4);
    const groupAFirst = only(entries, (entry) => entry.evalId === "group-a/01-first");
    const groupASecond = only(entries, (entry) => entry.evalId === "group-a/02-second");
    const groupBFirst = only(entries, (entry) => entry.evalId === "group-b/01-first");
    const groupBSecond = only(entries, (entry) => entry.evalId === "group-b/02-second");

    const groupASandbox = defined(groupAFirst.sandboxId);
    const groupBSandbox = defined(groupBFirst.sandboxId);
    expect(groupASecond.sandboxId).toBe(groupASandbox);
    expect(groupBSecond.sandboxId).toBe(groupBSandbox);
    expect(groupBSandbox).not.toBe(groupASandbox);
    expect(groupAFirst.groupId).toBe("group-a");
    expect(groupASecond.groupId).toBe("group-a");
    expect(groupBFirst.groupId).toBe("group-b");
    expect(groupBSecond.groupId).toBe("group-b");

    await Promise.all([
      waitForContainerGone(groupASandbox, root),
      waitForContainerGone(groupBSandbox, root),
    ]);
  });
});
