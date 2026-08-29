// rerun: pnpm e2e test --repo adapter/local-protocol -- --run test/live-progress.test.ts

import { withPty } from "@niceeval/testkit";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";
import { withLocalProtocolFixture } from "./support.ts";

const USER_SENTINEL = "local-live-user-sentinel";
const TOOL_SENTINEL = "lp-input-914";

test("UI Message Stream 的完整 tool input 在结束前投影到 Human TTY [necase_CFZC6BQ0V6RKV78R]", async () => {
  await localProtocolE2E.case(
    "live-progress",
    localProtocolRecordArtifacts,
    async ({ paths }) => {
      await withLocalProtocolFixture(paths.projectRoot, async ({ baseUrl, waitForRequest }) => {
        await withPty(
          [
            join(paths.projectRoot, "node_modules", ".bin", "niceeval"),
            "exp",
            "live-progress",
            "--rerun",
            "all",
          ],
          {
            cwd: paths.projectRoot,
            env: {
              ...process.env,
              NICEEVAL_HOME: join(paths.projectRoot, ".niceeval-user"),
              [FIXTURE_BASE_URL_ENV]: baseUrl,
            },
            columns: 120,
            rows: 40,
            timeoutMs: 30_000,
          },
          async (pty) => {
            await waitForRequest("live-progress");
            const user = await pty.waitForText(new RegExp(`user: .*${USER_SENTINEL}`), {
              timeoutMs: 15_000,
              whileRunning: true,
              label: "the local-protocol user sentinel in the active TTY frame",
            });
            expect(user).toContain(USER_SENTINEL);
            const tool = await pty.waitForText(new RegExp(`tool: .*${TOOL_SENTINEL}`), {
              timeoutMs: 15_000,
              whileRunning: true,
              label: "the flushed local-protocol tool input in the active TTY frame",
            });
            expect(tool).toContain(TOOL_SENTINEL);

            const receipt = await pty.wait();
            expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
            expect(receipt.signal, receipt.diagnostic()).toBeNull();
          },
        );
      });
    },
  );
});
