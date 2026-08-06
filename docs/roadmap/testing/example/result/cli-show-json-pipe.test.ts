import { beforeAll, expect, test } from "vitest";
import { parseJson, runProcess } from "../support/process.ts";

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: {
    sections: Array<{
      evalId: string;
      attempts: Array<{ locator: string; verdict: string }>;
    }>;
  };
}

interface AttemptDocument {
  format: "niceeval.show";
  view: "attempt";
  data: unknown;
}

beforeAll(async () => {
  const seed = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "large-show", "--rerun", "all", "--json",
  ]);
  // fixture 故意产生大量 failed assertions，因此整个实验应非零。
  expect(seed.exitCode, seed.diagnostic()).not.toBe(0);
});

// regression: d8d5a84b（直接 process.exit 会把 pipe 截在约 128 KiB）
test("show --json 经 pipe 仍交付完整文档和尾部断言", async () => {
  const history = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "large-output/payload", "--history", "--json",
  ]);
  expect(history.exitCode, history.diagnostic()).toBe(0);

  const historyDocument = parseJson<HistoryDocument>(history.stdout, history.diagnostic());
  const attempts = historyDocument.data.sections.flatMap((section) => section.attempts);
  expect(attempts).toHaveLength(1);
  const locator = attempts[0]!.locator;

  // runProcess 的 stdout 本来就是 pipe；这里没有调用进程内 show() 绕过真实 flush 行为。
  const shown = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", locator, "--json",
  ]);
  expect(shown.exitCode, shown.diagnostic()).toBe(0);
  expect(Buffer.byteLength(shown.stdout)).toBeGreaterThan(128 * 1024);

  const document = parseJson<AttemptDocument>(shown.stdout, shown.diagnostic());
  expect(document.format).toBe("niceeval.show");
  expect(document.view).toBe("attempt");
  expect(JSON.stringify(document.data)).toContain("tail-sentinel");
});
