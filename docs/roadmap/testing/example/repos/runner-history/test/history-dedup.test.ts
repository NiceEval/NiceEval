import { rmSync } from "node:fs";
import { expect, test } from "vitest";
import { parseJson, parseNdjson, runProcess, type ProcessResult } from "./support/process.ts";
import { only } from "./support/assert.ts";

// NiceEval 根目录：pnpm e2e --repo runner-history -- --run test/history-dedup.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test --run test/history-dedup.test.ts

interface HistorySection {
  experimentId: string;
  evalId: string;
  attempts: Array<{ locator: string; verdict: string }>;
}

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: { sections: HistorySection[] };
}

interface ResultEvent {
  event: "result";
  status: string;
  passed: number;
  failed: number;
  reused?: number;
  completion: string;
}

/** 只解析公开 history 文档；命令的完整 argv 留在调用点。 */
function historyAttempts(result: ProcessResult): HistorySection["attempts"] {
  expect(result.exitCode, result.diagnostic()).toBe(0);
  const document = parseJson<HistoryDocument>(result.stdout, result.diagnostic());
  expect(document.format).toBe("niceeval.show");
  expect(document.view).toBe("history");
  const section = only(
    document.data.sections,
    (item) => item.evalId === "suite/stable",
    result.diagnostic(),
  );
  expect(section.experimentId).toBe("smoke");
  return section.attempts;
}

function locators(attempts: HistorySection["attempts"]): string[] {
  return attempts.map((attempt) => attempt.locator);
}

// risk: history 跨快照去重。身份就是 locator，断言用身份集合而不是行数猜测；
// 这不是 031ce196 的因果回归，因此不冒充 historical regression。
test("--rerun all 追加新 attempt，全携入 run 按身份键去重不重复行", async () => {
  rmSync(".niceeval", { recursive: true, force: true });
  const first = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "smoke", "--rerun", "all", "--json",
  ]);
  expect(first.exitCode, first.diagnostic()).toBe(0);

  const baseline = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "suite/stable", "--history", "--json",
  ]);
  const baselineAttempts = historyAttempts(baseline);
  expect(locators(baselineAttempts)).toHaveLength(1);
  const firstAttempt = only(baselineAttempts, () => true, baseline.diagnostic());
  expect(firstAttempt.verdict).toBe("passed");
  const firstLocator = firstAttempt.locator;

  const forced = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "smoke", "--rerun", "all", "--json",
  ]);
  expect(forced.exitCode, forced.diagnostic()).toBe(0);

  const afterForce = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "suite/stable", "--history", "--json",
  ]);
  const afterForceAttempts = historyAttempts(afterForce);
  // 身份明确：强制重跑追加一条**新身份**的 attempt，旧身份原样保留，不是覆盖旧行。
  const newLocators = locators(afterForceAttempts).filter((locator) => locator !== firstLocator);
  expect(newLocators).toHaveLength(1);
  const secondLocator = newLocators[0]!;
  expect(secondLocator).not.toBe(firstLocator);

  const carried = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "smoke", "--json",
  ]);
  expect(carried.exitCode, carried.diagnostic()).toBe(0);
  const events = parseNdjson<ResultEvent>(carried.stdout, carried.diagnostic());
  const result = only(events, (item) => item.event === "result", carried.diagnostic());
  expect(result).toMatchObject({ event: "result", status: "passed", passed: 1, failed: 0, reused: 1, completion: "complete" });

  const afterCarry = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "suite/stable", "--history", "--json",
  ]);
  // 全携入 run 不派发任何新 attempt：历史按身份键去重后，身份集合与强制重跑后完全一致。
  const afterCarryAttempts = historyAttempts(afterCarry);
  expect(locators(afterCarryAttempts).sort()).toEqual([firstLocator, secondLocator].sort());
  expect(afterCarryAttempts.map((attempt) => attempt.verdict).sort()).toEqual(["passed", "passed"]);
});
