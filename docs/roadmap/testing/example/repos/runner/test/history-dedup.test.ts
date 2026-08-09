// feature: docs/feature/reports/show/history.md
import { resolve } from "node:path";
import { command, only, withProjectCopy, type ProcessReceipt } from "@niceeval/testkit";
import { expect, test } from "vitest";

// NiceEval 根目录：pnpm e2e --repo runner -- --run test/history-dedup.test.ts
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

interface InvocationReceiptRecord {
  type: "receipt";
  receipt: {
    completion: "complete" | "incomplete" | "interrupted";
    record: { state: "complete" | "partial" | "not-recorded" };
  };
}

type InvocationMachineRecord =
  | { type: "snapshot" | "observation" | "claim" | "heartbeat" }
  | InvocationReceiptRecord;

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-history-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

/** 只解析公开 history 文档；命令的完整 argv 留在调用点。 */
function historyAttempts(result: ProcessReceipt): HistorySection["attempts"] {
  expect(result.exitCode, result.diagnostic()).toBe(0);
  const document = result.json<HistoryDocument>();
  expect(document.format).toBe("niceeval.show");
  expect(document.view).toBe("history");
  const section = only(
    document.data.sections,
    (item) => item.evalId === "suite/stable",
    result.diagnostic(),
  );
  expect(section.experimentId).toBe("history");
  return section.attempts;
}

function locators(attempts: HistorySection["attempts"]): string[] {
  return attempts.map((attempt) => attempt.locator);
}

function invocationReceipt(result: ProcessReceipt): InvocationReceiptRecord {
  const receipts = result.ndjson<InvocationMachineRecord>()
    .filter((record): record is InvocationReceiptRecord => record.type === "receipt");
  return only(receipts, () => true, result.diagnostic());
}

// 相关风险：history 跨快照去重。身份就是 locator，断言用身份集合而不是行数猜测；
// 这不是 031ce196 的因果回归，因此不冒充 historical regression。
// RecordStore 属于本 case 的私有副本，不与 carry 的副本共享。
test("--rerun all 追加新 attempt，全携入 run 按身份键去重不重复行", async () => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    const first = await niceeval.run(["exp", "history", "--rerun", "all", "--json"], { cwd: root });
    expect(first.exitCode, first.diagnostic()).toBe(0);

    const baseline = await niceeval.run(["show", "suite/stable", "--history", "--json"], { cwd: root });
    const baselineAttempts = historyAttempts(baseline);
    expect(locators(baselineAttempts)).toHaveLength(1);
    const firstAttempt = only(baselineAttempts, () => true, baseline.diagnostic());
    expect(firstAttempt.verdict).toBe("passed");
    const firstLocator = firstAttempt.locator;

    const rerun = await niceeval.run(["exp", "history", "--rerun", "all", "--json"], { cwd: root });
    expect(rerun.exitCode, rerun.diagnostic()).toBe(0);

    const afterRerun = await niceeval.run(["show", "suite/stable", "--history", "--json"], { cwd: root });
    const afterRerunAttempts = historyAttempts(afterRerun);
    // 身份明确：全量重跑追加一条**新身份**的 attempt，旧身份原样保留，不是覆盖旧行。
    const newLocators = locators(afterRerunAttempts).filter((locator) => locator !== firstLocator);
    expect(newLocators).toHaveLength(1);
    const secondLocator = newLocators[0]!;
    expect(secondLocator).not.toBe(firstLocator);

    const carried = await niceeval.run(["exp", "history", "--json"], { cwd: root });
    expect(carried.exitCode, carried.diagnostic()).toBe(0);
    expect(invocationReceipt(carried)).toMatchObject({
      type: "receipt",
      receipt: { completion: "complete", record: { state: "complete" } },
    });

    const afterCarry = await niceeval.run(["show", "suite/stable", "--history", "--json"], { cwd: root });
    // 全携入 run 不派发任何新 attempt：历史按身份键去重后，身份集合与强制重跑后完全一致。
    const afterCarryAttempts = historyAttempts(afterCarry);
    expect(locators(afterCarryAttempts).sort()).toEqual([firstLocator, secondLocator].sort());
    expect(afterCarryAttempts.map((attempt) => attempt.verdict).sort()).toEqual(["passed", "passed"]);
  });
});
