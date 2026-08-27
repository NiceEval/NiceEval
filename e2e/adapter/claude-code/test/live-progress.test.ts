// owner: docs/engineering/testing/e2e/adapter/claude-code.md#adapter-claude-code-live-progress
// regression: memory/active-progress-hides-user-and-tool-detail.md
// rerun: pnpm e2e test --repo adapter/claude-code -- --run test/live-progress.test.ts

import { createE2EContext, withPty } from "@niceeval/testkit";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const FIRST_USER_SENTINEL = "claude-live-user-one-sentinel";
const FIRST_COMMAND_SENTINEL = "claude-live-command-one-sentinel";
const SECOND_USER_SENTINEL = "claude-live-user-two-sentinel";
const SECOND_COMMAND_SENTINEL = "claude-live-command-two-sentinel";

const claudeE2E = createE2EContext({
  repoId: "claude-code",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-claude-code-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "junit.xml", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {},
});

test("Claude Code 续轮期间按同一原生 session 投影两轮 user 与 command tool", async () => {
  await claudeE2E.case(
    "live-progress",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths }) => await withPty(
      [
        join(paths.projectRoot, "node_modules", ".bin", "niceeval"),
        "exp",
        "coding",
        "session-resume",
        "--rerun",
        "all",
      ],
      {
        cwd: paths.projectRoot,
        env: { ...process.env, NICEEVAL_HOME: join(paths.projectRoot, ".niceeval-user") },
        columns: 160,
        rows: 40,
        timeoutMs: 5 * 60_000,
      },
      async (pty) => {
        for (const [userSentinel, toolSentinel, turn] of [
          [FIRST_USER_SENTINEL, FIRST_COMMAND_SENTINEL, "first"],
          [SECOND_USER_SENTINEL, SECOND_COMMAND_SENTINEL, "second"],
        ] as const) {
          const user = await pty.waitForText(new RegExp(`user: .*${userSentinel}`), {
            timeoutMs: 2 * 60_000,
            whileRunning: true,
            label: `the ${turn} Claude user sentinel in the active TTY frame`,
          });
          expect(user).toContain(userSentinel);
          const tool = await pty.waitForText(new RegExp(`tool: .*${toolSentinel}`), {
            timeoutMs: 2 * 60_000,
            whileRunning: true,
            label: `the ${turn} Claude command input in the active TTY frame`,
          });
          expect(tool).toContain(toolSentinel);
        }

        const receipt = await pty.wait();
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        expect(receipt.signal, receipt.diagnostic()).toBeNull();
      },
    ),
  );
});
