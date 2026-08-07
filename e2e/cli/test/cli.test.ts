// feature: docs/engineering/testing/e2e/cli.md
//
// 单文件、单 it 的垂直 Journey:选择(前缀收窄与零命中用法错误)、退出码折叠
// (normal / deliberate-fail / deliberate-error)、缓存三步,全部在安装后的
// 公开 niceeval binary 上断言 exit / stdout / stderr / NDJSON / JUnit。
// 测试只启动安装后的 binary,不 import 候选源码/类型,不读 .niceeval 私有布局。
//
// 根 runner 每次运行都从签入仓库复制干净的隔离副本(排除 node_modules/.niceeval),
// 本 Journey 在副本根运行,开头只清理自己声明的结果/JUnit 路径,保证缓存基线从
// 零开始;JUnit 与结果根因此留在隔离 Repo 内可收集。

import { command, ProcessReceipt } from "@niceeval/testkit";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

// 事件流的最小公开形状只声明本测试断言的字段(契约见
// docs/feature/experiments/cli.md「机器怎么读:--json」),不从候选包导入。
interface ExpStartEvent {
  event: "start";
  format: string;
  schemaVersion: number;
  total: number;
  configs: number;
  concurrency: number;
  reused: number;
}

interface ExpFailureEvent {
  event: "failure";
  locator: string;
  evalId: string;
  experimentId: string;
  severity: string;
  assertion: string;
}

interface ExpErrorEvent {
  event: "error";
  locator: string;
  evalId: string;
  experimentId: string;
  phase: string;
  reason: string;
}

interface ExpResultEvent {
  event: "result";
  status: "passed" | "failed" | "incomplete" | "interrupted";
  passed: number;
  failed: number;
  errored: number;
  reused?: number;
  completion: "complete" | "incomplete" | "interrupted";
  snapshots: string[];
  junit?: string;
}

type ExpEvent = ExpStartEvent | ExpFailureEvent | ExpErrorEvent | ExpResultEvent | { event: string };

// --dry --json 的单个计划文档(docs/feature/experiments/cli.md「--dry」)。
interface ExpPlanRow {
  experimentId: string;
  evalId: string;
  reused: boolean;
}

interface ExpPlanDocument {
  format: string;
  schemaVersion: number;
  total: number;
  evals: number;
  configs: number;
  attempts: number;
  reused: number;
  matrix: ExpPlanRow[];
}

function expectSelectedEvalIds(plan: ExpPlanDocument, expected: string[]): void {
  expect(plan.matrix.map((row) => row.evalId)).toEqual(expected);
}

function expectFailureOutcome(events: ExpEvent[], junit: string): void {
  expect(events.at(-1)).toMatchObject({ event: "result", status: "failed", completion: "complete" });
  expect(
    events.some(
      (event) => event.event === "failure" && (event as ExpFailureEvent).evalId === "deliberate-fail/broken",
    ),
  ).toBe(true);
  expect(events.some((event) => event.event === "error")).toBe(false);
  expect(junit).toContain("<failure");
  expect(junit).not.toContain("<error");
}

function expectErrorOutcome(events: ExpEvent[], junit: string): void {
  expect(events.at(-1)).toMatchObject({
    event: "result",
    status: "failed",
    failed: 0,
    errored: 1,
    completion: "complete",
  });
  expect(
    events.some(
      (event) => event.event === "error" && (event as ExpErrorEvent).evalId === "deliberate-error/crash",
    ),
  ).toBe(true);
  expect(events.some((event) => event.event === "failure")).toBe(false);
  expect(junit).toContain("<error");
  expect(junit).not.toContain("<failure");
}

/** --json 运行流的公开不变量:stdout 是单一 NDJSON 流,首行 start、末行 result,零 ANSI,stderr 空。 */
function expectExpStream(receipt: ProcessReceipt, expectedExit: number | "nonzero"): ExpEvent[] {
  if (expectedExit === "nonzero") {
    expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
  } else {
    expect(receipt.exitCode, receipt.diagnostic()).toBe(expectedExit);
  }
  expect(receipt.stderr).toBe("");
  expect(receipt.stdout).not.toMatch(/[\x1b\x08]/);
  const events = receipt.ndjson<ExpEvent>();
  expect(events.length).toBeGreaterThan(0);
  expect(events[0]).toMatchObject({ event: "start", format: "niceeval.exp" });
  expect(events.at(-1)).toMatchObject({ event: "result" });
  return events;
}

/** 公开 show --history 时间轴里带 locator 的行数,即该 eval 的历史 attempt 数。 */
async function attemptCount(evalId: string): Promise<number> {
  const shown = await niceeval.run(["show", evalId, "--history"]);
  expect(shown.exitCode, shown.diagnostic()).toBe(0);
  return shown.stdout.split("\n").filter((line) => line.includes("@")).length;
}

it("安装后的 niceeval 在选择、退出码折叠与缓存复用上符合 CLI 契约", async () => {
  // prepare:本 Journey 声明的结果/JUnit 路径从空白开始,缓存基线不继承历史。
  rmSync(".niceeval", { recursive: true, force: true });
  rmSync("junit", { recursive: true, force: true });
  mkdirSync("junit", { recursive: true });

  // ── 1. selection:eval id 位置参数按前缀收窄实际计划(--dry 零网络成本、零写入) ──
  const greetPlanReceipt = await niceeval.run(["exp", "normal", "greet", "--dry", "--json"]);
  expect(greetPlanReceipt.exitCode, greetPlanReceipt.diagnostic()).toBe(0);
  const greetPlan = greetPlanReceipt.json<ExpPlanDocument>();
  expect(greetPlan.format).toBe("niceeval.exp-plan");
  expectSelectedEvalIds(greetPlan, ["greet/hello"]);
  expect(greetPlan.matrix.some((row) => row.evalId === "tool/weather")).toBe(false);

  const toolPlanReceipt = await niceeval.run(["exp", "normal", "tool", "--dry", "--json"]);
  expect(toolPlanReceipt.exitCode, toolPlanReceipt.diagnostic()).toBe(0);
  const toolPlan = toolPlanReceipt.json<ExpPlanDocument>();
  expectSelectedEvalIds(toolPlan, ["tool/weather"]);

  const allPlanReceipt = await niceeval.run(["exp", "normal", "--dry", "--json"]);
  expect(allPlanReceipt.exitCode, allPlanReceipt.diagnostic()).toBe(0);
  const allPlan = allPlanReceipt.json<ExpPlanDocument>();
  expectSelectedEvalIds(
    { ...allPlan, matrix: [...allPlan.matrix].sort((a, b) => a.evalId.localeCompare(b.evalId)) },
    ["greet/hello", "tool/weather"],
  );

  // 未命中任何 Experiment 的选择器按用法错误退出,错误信息给出下一步(cli.md「用法错误」)。
  const noExperiment = await niceeval.run(["exp", "totally-bogus-selector-zzz", "--dry"]);
  expect(noExperiment.exitCode, noExperiment.diagnostic()).not.toBe(0);
  expect(noExperiment.stdout).toBe("");
  expect(noExperiment.stderr).toMatch(/No experiment matched/);
  expect(noExperiment.stderr).toMatch(/Run `niceeval exp/);

  // experiment 命中但尾随 eval id 前缀零命中,是判然有别的另一条用法错误路径。
  const noEval = await niceeval.run(["exp", "normal", "totally-bogus-eval-prefix-zzz", "--dry"]);
  expect(noEval.exitCode, noEval.diagnostic()).not.toBe(0);
  expect(noEval.stdout).toBe("");
  expect(noEval.stderr).toMatch(/No eval matched prefix/);
  expect(noEval.stderr).toMatch(/niceeval exp/);

  // ── 2. 退出码折叠:deliberate-fail → failed,非零退出,公开面与 errored 判然有别 ──
  const fail = await niceeval.run([
    "exp", "deliberate-fail", "--rerun", "all", "--json", "--junit", "junit/fail.xml",
  ]);
  const failEvents = expectExpStream(fail, "nonzero");
  expect(fail.exitCode).not.toBe(0);
  expect(failEvents[0]).toMatchObject({ event: "start", format: "niceeval.exp" });
  const failJunit = readFileSync("junit/fail.xml", "utf8");
  expectFailureOutcome(failEvents, failJunit);

  // ── 3. 退出码折叠:deliberate-error → errored,非零退出,与 failed 判然有别 ──
  const error = await niceeval.run([
    "exp", "deliberate-error", "--rerun", "all", "--json", "--junit", "junit/error.xml",
  ]);
  const errorEvents = expectExpStream(error, "nonzero");
  expect(error.exitCode).not.toBe(0);
  expect(errorEvents[0]).toMatchObject({ event: "start", format: "niceeval.exp" });
  const errorJunit = readFileSync("junit/error.xml", "utf8");
  expectErrorOutcome(errorEvents, errorJunit);

  // ── 4. normal:断言全部通过,人读文本零 ANSI、单一 stdout 追加流,按 Eval 级折叠退出 0 ──
  // 这一步同时是缓存三步的基线(--rerun all 建干净基线)。
  const normal = await niceeval.run(["exp", "normal", "--rerun", "all", "--junit", "junit/normal.xml"]);
  expect(normal.exitCode, normal.diagnostic()).toBe(0);
  expect(normal.stderr).toBe("");
  expect(normal.stdout).not.toMatch(/[\x1b\x08]/);
  expect(normal.stdout).toMatch(/PASSED/);
  const normalJunit = readFileSync("junit/normal.xml", "utf8");
  expect(normalJunit).not.toContain("<failure");
  expect(normalJunit).not.toContain("<error");
  const baseline = {
    greet: await attemptCount("greet/hello"),
    tool: await attemptCount("tool/weather"),
  };
  expect(baseline.greet).toBe(1);
  expect(baseline.tool).toBe(1);

  // ── 5. 缓存三步:不带 --rerun all 复用,再 --rerun all 真实新 attempt ──
  const reused = await niceeval.run(["exp", "normal", "--json"]);
  const reusedEvents = expectExpStream(reused, 0);
  expect(reusedEvents[0]).toMatchObject({ event: "start", total: 2, reused: 2 });
  expect(reusedEvents.at(-1)).toMatchObject({
    event: "result",
    status: "passed",
    passed: 2,
    failed: 0,
    errored: 0,
    reused: 2,
    completion: "complete",
  });
  expect(await attemptCount("greet/hello")).toBe(baseline.greet);
  expect(await attemptCount("tool/weather")).toBe(baseline.tool);

  const rerun = await niceeval.run(["exp", "normal", "--rerun", "all", "--json"]);
  const rerunEvents = expectExpStream(rerun, 0);
  expect(rerunEvents[0]).toMatchObject({ event: "start", reused: 0 });
  expect(rerunEvents.at(-1)).toMatchObject({
    event: "result",
    status: "passed",
    passed: 2,
    failed: 0,
    errored: 0,
    completion: "complete",
  });
  expect(await attemptCount("greet/hello")).toBe(baseline.greet + 1);
  expect(await attemptCount("tool/weather")).toBe(baseline.tool + 1);
}, 240_000);

it.each([
  {
    mutation: "selector 被忽略",
    kill: () =>
      expectSelectedEvalIds(
        {
          format: "niceeval.exp-plan",
          schemaVersion: 1,
          total: 2,
          evals: 2,
          configs: 1,
          attempts: 2,
          reused: 0,
          matrix: [
            { experimentId: "normal", evalId: "greet/hello", reused: false },
            { experimentId: "normal", evalId: "tool/weather", reused: false },
          ],
        },
        ["greet/hello"],
      ),
  },
  {
    mutation: "failed 与 errored 被交换",
    kill: () =>
      expectFailureOutcome(
        [
          {
            event: "error",
            locator: "@mutant",
            evalId: "deliberate-error/crash",
            experimentId: "deliberate-fail",
            phase: "eval.run",
            reason: "mutant swapped failure into error",
          },
          {
            event: "result",
            status: "failed",
            passed: 0,
            failed: 0,
            errored: 1,
            completion: "complete",
            snapshots: [],
          },
        ],
        "<testsuite><testcase><error/></testcase></testsuite>",
      ),
  },
  {
    mutation: "NDJSON 在 result 前截断",
    kill: () =>
      expectExpStream(
        new ProcessReceipt({
          argv: ["niceeval", "exp", "--json"],
          cwd: process.cwd(),
          exitCode: 0,
          signal: null,
          stdout: '{"event":"start","format":"niceeval.exp","schemaVersion":1}\n{"event":',
          stderr: "",
          durationMs: 1,
          timedOut: false,
        }),
        0,
      ),
  },
])("公开 Journey oracle 会杀死 $mutation", ({ kill }) => {
  expect(kill).toThrow();
});
