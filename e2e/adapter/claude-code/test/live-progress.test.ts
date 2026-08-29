// rerun: pnpm e2e test --repo adapter/claude-code -- --run test/live-progress.test.ts

import { createE2EContext, withPty } from "@niceeval/testkit";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const FIRST_USER_SENTINEL = "claude-live-user-one-sentinel";
const SECOND_USER_SENTINEL = "claude-live-user-two-sentinel";
const FIRST_COMMAND_SENTINEL = "claude-live-command-one-sentinel";
const SECOND_COMMAND_SENTINEL = "claude-live-command-two-sentinel";

function liveToolAfterUser(
  userSentinel: string,
  commandSentinel: string,
  nextUserSentinel?: string,
): RegExp {
  const beforeNextTurn = nextUserSentinel === undefined
    ? "[\\s\\S]*?"
    : `(?:(?!user: [^\\n]*${nextUserSentinel})[\\s\\S])*?`;
  return new RegExp(`user: [^\\n]*${userSentinel}${beforeNextTurn}tool: [^\\n]*${commandSentinel}`);
}

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

test("Claude Code 续轮期间按同一原生 session 投影两轮 user 与原生 tool [necase_1V7SDBFKYSR5W6MK]", async () => {
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
        for (const [userSentinel, commandSentinel, nextUserSentinel, turn] of [
          [FIRST_USER_SENTINEL, FIRST_COMMAND_SENTINEL, SECOND_USER_SENTINEL, "first"],
          [SECOND_USER_SENTINEL, SECOND_COMMAND_SENTINEL, undefined, "second"],
        ] as const) {
          const progress = await pty.waitForText(liveToolAfterUser(userSentinel, commandSentinel, nextUserSentinel), {
            timeoutMs: 2 * 60_000,
            whileRunning: true,
            label: `the ${turn} Claude user followed by native tool input in the active TTY frame`,
          });
          expect(progress).toContain(userSentinel);
          expect(progress).toContain(commandSentinel);
        }

        const receipt = await pty.wait();
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        expect(receipt.signal, receipt.diagnostic()).toBeNull();
      },
    ),
  );
});
