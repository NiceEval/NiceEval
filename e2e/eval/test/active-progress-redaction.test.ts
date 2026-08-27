// owner: docs/engineering/testing/e2e/eval.md#eval-active-progress-redaction
// regression: memory/active-progress-hides-user-and-tool-detail.md
// rerun: pnpm e2e test --repo eval -- --run test/active-progress-redaction.test.ts

import { withPty } from "@niceeval/testkit";
import { join } from "node:path";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

const C0_SECRET = "active-secret-c0";
const C1_SECRET = "active-secret-c1";
const MULTIBYTE_GRAPHEME = "🧑🏽‍💻";
const EXPECTED_DETAIL = `tool: <redacted> <redacted> ${MULTIBYTE_GRAPHEME.repeat(15)}…`;

test("ACTIVE detail 移除 C0/C1 后再次脱敏，且只在运行期显示", async () => {
  expect(Buffer.byteLength(EXPECTED_DETAIL, "utf8")).toBe(256);
  await evalE2E.case("active-progress-redaction", async ({ paths }) => {
    await withPty(
      [join(paths.projectRoot, "node_modules", ".bin", "niceeval"), "exp", "active-progress-redaction", "--rerun", "all"],
      { cwd: paths.projectRoot, columns: 512, rows: 40, timeoutMs: 30_000 },
      async (pty) => {
        const active = await pty.waitForText(EXPECTED_DETAIL, {
          timeoutMs: 15_000,
          whileRunning: true,
          label: "the twice-redacted ACTIVE detail",
        });
        expect(active).not.toContain(C0_SECRET);
        expect(active).not.toContain(C1_SECRET);
        expect(active).not.toContain(MULTIBYTE_GRAPHEME.repeat(16));
        expect(active).not.toContain("�");

        const receipt = await pty.wait();
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        expect(receipt.clean).not.toContain(C0_SECRET);
        expect(receipt.clean).not.toContain(C1_SECRET);
      },
    );
  });
});
