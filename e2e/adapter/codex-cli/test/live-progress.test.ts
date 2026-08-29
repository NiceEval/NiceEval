// rerun: pnpm e2e test --repo adapter/codex-cli -- --run test/live-progress.test.ts

import { createE2EContext, withPty } from "@niceeval/testkit";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const USER_SENTINEL = "codex-live-user-sentinel";
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

test("Codex CLI 在 coding-task 仍运行时投影 user 与 command tool [necase_10171BFF1HW90H90]", async () => {
  await codexE2E.case(
    "live-progress",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths }) => await withPty(
      [
        join(paths.projectRoot, "node_modules", ".bin", "niceeval"),
        "exp",
        "baseline",
        "coding-task",
        "--rerun",
        "all",
      ],
      {
        cwd: paths.projectRoot,
        env: { ...process.env, NICEEVAL_HOME: join(paths.projectRoot, ".niceeval-user") },
        columns: 120,
        rows: 40,
        timeoutMs: 5 * 60_000,
      },
      async (pty) => {
        const user = await pty.waitForText(new RegExp(`user: .*${USER_SENTINEL}`), {
          timeoutMs: 2 * 60_000,
          whileRunning: true,
          label: "the Codex user sentinel in the active TTY frame",
        });
        expect(user).toContain(USER_SENTINEL);
        const tool = await pty.waitForText(new RegExp(`tool: .*${COMMAND_SENTINEL}`), {
          timeoutMs: 2 * 60_000,
          whileRunning: true,
          label: "the Codex command input in the active TTY frame",
        });
        expect(tool).toContain(COMMAND_SENTINEL);

        const receipt = await pty.wait();
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        expect(receipt.signal, receipt.diagnostic()).toBeNull();
      },
    ),
  );
});
