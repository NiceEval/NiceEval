import { rmSync } from "node:fs";
import { beforeEach, expect, test } from "vitest";
import { parseJson, runProcess } from "./support/process.ts";

// NiceEval 根目录：pnpm e2e --repo cli -- --run test/show-json-pipe.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test --run test/show-json-pipe.test.ts

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: { sections: Array<{ evalId: string; attempts: Array<{ locator: string }> }> };
}

interface AttemptDocument {
  format: "niceeval.show";
  view: "attempt";
  data: {
    assertions: {
      attention: Array<{ expected?: string; received?: string }>;
      passedGroups: Array<{ items: Array<{ expected?: string; received?: string }> }>;
    } | null;
  };
}

beforeEach(() => rmSync(".niceeval", { recursive: true, force: true }));

// regression: d8d5a84b — process.exit() truncated piped JSON near 128 KiB.
test("show --json through a real pipe still contains the signed tail sentinel", async () => {
  // Prepare：真实 Experiment 生成一份超过旧截断阈值的失败 Attempt。
  const seeded = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "large-show", "--rerun", "all", "--json",
  ]);
  expect(seeded.exitCode, seeded.diagnostic()).toBe(1);

  // Observe identity：locator 只能从公开 history 取得，测试不读取结果目录。
  const history = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "large-output/payload", "--history", "--json",
  ]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  const historyDocument = parseJson<HistoryDocument>(history.stdout, history.diagnostic());
  const section = historyDocument.data.sections.find((item) => item.evalId === "large-output/payload");
  const locator = section?.attempts.at(-1)?.locator;
  expect(locator, history.diagnostic()).toMatch(/^@/);

  // Invoke：用用户得到的 locator 执行真实 installed CLI，并保留 producer 自身的流与退出状态。
  const shown = await runProcess([
    "pnpm", "--silent", "exec", "niceeval", "show", locator as string, "--json",
  ]);
  expect(shown.exitCode, shown.diagnostic()).toBe(0);
  expect(Buffer.byteLength(shown.stdout)).toBeGreaterThan(128 * 1024);

  // Outcome：严格 parse 后检查尾部 fixture 的独立 sentinel；不是只断言“输出看起来像 JSON”。
  const document = parseJson<AttemptDocument>(shown.stdout, shown.diagnostic());
  const assertions = document.data.assertions;
  expect(assertions, shown.diagnostic()).not.toBeNull();
  const rows = [
    ...(assertions?.attention ?? []),
    ...(assertions?.passedGroups.flatMap((group) => group.items) ?? []),
  ];
  expect(rows).toContainEqual({ expected: '"tail-sentinel"', received: '"actual-4999"' });
});
