// niceeval show 终端宿主的测试(行为规范:docs-site/zh/guides/viewing-results.mdx;
// 组合语义:docs/reports.md「宿主输入的组合语义」)。覆盖:
// - 榜单合成口径:每 experiment × eval 取最新判定,局部重跑从更早 run 补齐,头部标注合成自几个 run;
// - 前缀过滤收窄选集,覆盖警告分母 = 已知并集 ∩ 范围;
// - --history 时间轴只列真实执行,resume 携带的复印件不占行;
// - --report 装载(合法 / 非法默认导出 / 文件缺失)、位置前缀收窄注入选集、attemptCommand 下钻;
// - 互斥:--history 与 --report;
// - 单 eval 详情与 --transcript 证据切面的输出形态。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RESULTS_FORMAT,
  RESULTS_SCHEMA_VERSION,
  createRunWriter,
  openResults,
  type EvalResult,
  type RunSummary,
} from "../results/index.ts";
import { composeShowSelection, evalHistory } from "./compose.ts";
import { runShow, type ShowFlags } from "./index.ts";

// ───────────────────────── fixture 工具 ─────────────────────────

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-show-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function res(over: Partial<EvalResult> & Pick<EvalResult, "id">): EvalResult {
  return {
    agent: "bub",
    verdict: "passed",
    attempt: 0,
    durationMs: 1000,
    assertions: [],
    ...over,
  };
}

function summaryOf(results: EvalResult[], over: Partial<RunSummary> = {}): RunSummary {
  const count = (o: EvalResult["verdict"]) => results.filter((r) => r.verdict === o).length;
  return {
    format: RESULTS_FORMAT,
    schemaVersion: RESULTS_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.4.6" },
    agent: results[0]?.agent ?? "bub",
    startedAt: "2026-07-08T10:00:00.000Z",
    completedAt: "2026-07-08T10:10:00.000Z",
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    errored: count("errored"),
    durationMs: 60_000,
    results,
    ...over,
  };
}

async function writeRun(root: string, dirName: string, summary: RunSummary): Promise<void> {
  const dir = join(root, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
}

interface Captured {
  out: string;
  err: string;
  code: number;
}

async function show(root: string, patterns: string[], flags: ShowFlags = {}): Promise<Captured> {
  let out = "";
  let err = "";
  const code = await runShow(root, patterns, { run: root, ...flags }, {
    out: (s) => (out += s),
    err: (s) => (err += s),
    width: 100,
    now: Date.parse("2026-07-09T10:01:00.000Z"),
  });
  return { out, err, code };
}

/** 两个 run:老 run 全量(a ✓ b ✓),新 run 只重跑 b(✗)—— 榜单该跨 run 合成。 */
async function seedComposedRoot(): Promise<string> {
  const root = await makeRoot();
  await writeRun(
    root,
    "2026-07-08T10-00-00-000Z",
    summaryOf(
      [
        res({ id: "weather/brooklyn", experimentId: "compare/bub", startedAt: "2026-07-08T10:00:01.000Z" }),
        res({ id: "fixtures/button", experimentId: "compare/bub", startedAt: "2026-07-08T10:00:02.000Z" }),
      ],
      { startedAt: "2026-07-08T10:00:00.000Z" },
    ),
  );
  await writeRun(
    root,
    "2026-07-09T10-00-00-000Z",
    summaryOf(
      [
        res({
          id: "fixtures/button",
          experimentId: "compare/bub",
          verdict: "failed",
          startedAt: "2026-07-09T10:00:01.000Z",
          assertions: [
            {
              name: 'fileChanged("src/components/Button.tsx")',
              severity: "gate",
              score: 0,
              passed: false,
              detail: "file was not modified",
            },
          ],
        }),
      ],
      { startedAt: "2026-07-09T10:00:00.000Z" },
    ),
  );
  return root;
}

// ───────────────────────── 榜单合成口径 ─────────────────────────

describe("榜单:跨 run 合成的现刻水位", () => {
  it("局部重跑不撕榜单:另一题从更早 run 补齐,头部如实标注合成自 2 个 run", async () => {
    const root = await seedComposedRoot();
    const { out, code } = await show(root, []);
    expect(code).toBe(0);
    expect(out).toContain("Current verdicts · 1 experiment · composed from 2 runs");
    expect(out).toContain("latest 2026-07-09T10-00-00-000Z");
    // eval 级折叠计票:2 题里 1 题通过;两题都在(没有 partial-coverage 撕榜)
    expect(out).toContain("1/2");
    expect(out).toContain("50%");
    expect(out).not.toContain("verdicts cover");
    // Failing 清单:新判定的 fixtures/button,带失败断言与下钻命令
    expect(out).toContain("Failing:");
    expect(out).toContain("✗ fixtures/button");
    expect(out).toContain('gate fileChanged("src/components/Button.tsx")');
    expect(out).toContain("→ niceeval show fixtures/button");
    expect(out).not.toContain("✗ weather/brooklyn");
  });

  it("合成选集:每 experiment × eval 取最新判定;compose 不产生残缺警告", async () => {
    const root = await seedComposedRoot();
    const results = await openResults(root);
    const selection = composeShowSelection(results);
    expect(selection.snapshots).toHaveLength(1);
    const evals = selection.snapshots[0].evals.map((e) => e.id).sort();
    expect(evals).toEqual(["fixtures/button", "weather/brooklyn"]);
    const button = selection.snapshots[0].evals.find((e) => e.id === "fixtures/button")!;
    expect(button.attempts[0].result.verdict).toBe("failed"); // 新 run 的判定赢
    expect(selection.warnings).toEqual([]);
    // 对照:results.latest() 的最新快照是残缺的(这正是宿主要合成的原因)
    expect(results.latest().warnings.some((w) => w.kind === "partial-coverage")).toBe(true);
  });
});

// ───────────────────────── 前缀过滤 ─────────────────────────

describe("位置前缀收窄", () => {
  it("前缀收窄选集覆盖的 eval;覆盖警告分母 = 已知并集 ∩ 范围", async () => {
    const root = await makeRoot();
    await writeRun(
      root,
      "2026-07-08T10-00-00-000Z",
      summaryOf(
        [
          res({ id: "weather/brooklyn", experimentId: "compare/bub", startedAt: "2026-07-08T10:00:01.000Z" }),
          res({ id: "algebra/quadratic", experimentId: "compare/bub", startedAt: "2026-07-08T10:00:02.000Z" }),
        ],
        {
          startedAt: "2026-07-08T10:00:00.000Z",
          // 已知并集包含一道从未落盘的题:algebra 范围外,不该刷 weather 范围的屏
          snapshots: { "compare/bub": { knownEvalIds: ["weather/brooklyn", "weather/queens", "algebra/quadratic"] } },
        },
      ),
    );
    const results = await openResults(root);

    const weather = composeShowSelection(results, { patterns: ["weather"] });
    expect(weather.snapshots[0].evals.map((e) => e.id)).toEqual(["weather/brooklyn"]);
    // 分母 = {weather/brooklyn, weather/queens}:缺 queens → 1/2;algebra 的缺口不进来
    const coverage = weather.warnings.find((w) => w.kind === "partial-coverage");
    expect(coverage).toMatchObject({ covered: 1, total: 2 });

    const algebra = composeShowSelection(results, { patterns: ["algebra"] });
    expect(algebra.warnings.filter((w) => w.kind === "partial-coverage")).toEqual([]);
  });

  it("前缀匹配不到任何结果:直说 + 列出有结果的 eval", async () => {
    const root = await seedComposedRoot();
    const { err, code } = await show(root, ["nosuch"]);
    expect(code).toBe(1);
    expect(err).toContain("No results matched: nosuch");
    expect(err).toContain("weather/brooklyn");
  });
});

// ───────────────────────── 单 eval 详情 ─────────────────────────

describe("单 eval 详情", () => {
  it("attempt 行 + 断言明细 + artifacts 路径 + 下钻提示", async () => {
    const root = await makeRoot();
    await writeRun(
      root,
      "2026-07-09T10-00-00-000Z",
      summaryOf(
        [
          res({
            id: "weather/brooklyn",
            experimentId: "compare/codex",
            agent: "codex",
            verdict: "failed",
            attempt: 0,
            startedAt: "2026-07-09T10:00:01.000Z",
            durationMs: 40_000,
          }),
          res({
            id: "weather/brooklyn",
            experimentId: "compare/codex",
            agent: "codex",
            verdict: "failed",
            attempt: 1,
            startedAt: "2026-07-09T10:00:42.000Z",
            durationMs: 41_000,
            usage: { inputTokens: 12_000, outputTokens: 300 },
            estimatedCostUSD: 0.04,
            artifactsDir: "artifacts/compare__codex__weather__brooklyn__1",
            assertions: [
              {
                name: 'calledTool("get_weather")',
                severity: "gate",
                score: 0,
                passed: false,
                detail: "tool was never called",
              },
              { name: "succeeded()", severity: "gate", score: 1, passed: true },
              {
                name: 'judge("回答基于实时数据")',
                severity: "soft",
                score: 0.2,
                passed: false,
                detail: "reply invents a temperature without any tool call",
              },
            ],
          }),
        ],
        { agent: "codex", startedAt: "2026-07-09T10:00:00.000Z" },
      ),
    );
    const { out, code } = await show(root, ["weather/brooklyn"]);
    expect(code).toBe(0);
    expect(out).toContain("weather/brooklyn");
    expect(out).toContain("compare/codex");
    expect(out).toContain("✗ failed");
    expect(out).toContain("2 attempts");
    // 详情块默认挑最新一次失败的 attempt(人看 1 计:attempt 2)
    expect(out).toContain("attempt 2 · compare/codex · failed · 41.0s · 12.3k tokens · $0.04");
    expect(out).toContain('✗ gate calledTool("get_weather") — tool was never called');
    expect(out).toContain("✓ gate succeeded()");
    expect(out).toContain('✗ soft judge("回答基于实时数据") — 0.2/1: reply invents a temperature');
    expect(out).toContain("artifacts/compare__codex__weather__brooklyn__1/");
    expect(out).toContain("next: niceeval show weather/brooklyn --transcript | --trace | --diff");
  });

  it("--attempt 指定不存在的 attempt:直说可用序号", async () => {
    const root = await seedComposedRoot();
    const { err, code } = await show(root, ["fixtures/button"], { attempt: 5 });
    expect(code).toBe(1);
    expect(err).toContain("Attempt 5 not found for fixtures/button");
  });
});

// ───────────────────────── --history:复印件不占行 ─────────────────────────

describe("--history 时间轴", () => {
  /** run1 真实执行;run2 resume 携带同一判定(身份键相同的复印件)+ 新题真实执行。 */
  async function seedHistoryRoot(): Promise<string> {
    const root = await makeRoot();
    const original = res({
      id: "weather/brooklyn",
      experimentId: "compare/bub",
      verdict: "passed",
      startedAt: "2026-07-07T09:00:01.000Z",
      estimatedCostUSD: 0.03,
      artifactsDir: "artifacts/compare__bub__weather__brooklyn__0",
    });
    await writeRun(
      root,
      "2026-07-07T09-00-00-000Z",
      summaryOf([original], { startedAt: "2026-07-07T09:00:00.000Z" }),
    );
    // 复印件:同 id / attempt / startedAt,artifactBase 指回原 run(resume 合入的形状)
    const { artifactsDir: _dropped, ...carriedBase } = original;
    const carried: EvalResult = {
      ...carriedBase,
      artifactBase: "2026-07-07T09-00-00-000Z/artifacts/compare__bub__weather__brooklyn__0",
    };
    await writeRun(
      root,
      "2026-07-09T10-00-00-000Z",
      summaryOf(
        [
          carried,
          res({
            id: "weather/brooklyn",
            experimentId: "compare/bub",
            verdict: "failed",
            attempt: 1,
            startedAt: "2026-07-09T10:00:05.000Z",
            estimatedCostUSD: 0.04,
            assertions: [
              { name: 'calledTool("get_weather")', severity: "gate", score: 0, passed: false },
            ],
          }),
        ],
        { startedAt: "2026-07-09T10:00:00.000Z" },
      ),
    );
    return root;
  }

  it("时间轴只列真实执行:复印件不占行,新失败带断言", async () => {
    const root = await seedHistoryRoot();
    const results = await openResults(root);
    const exp = results.experiments.find((e) => e.id === "compare/bub")!;
    const rows = evalHistory(exp, "weather/brooklyn");
    // run2 里复印件被识别,真实执行只有:run1 的 passed + run2 的 failed(新 attempt)
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ verdict: "failed", attempts: 1, costUSD: 0.04 });
    expect(rows[0].failedAssertion).toBe('gate calledTool("get_weather")');
    expect(rows[1]).toMatchObject({ verdict: "passed", attempts: 1, costUSD: 0.03 });

    const { out, code } = await show(root, ["weather/brooklyn"], { history: true });
    expect(code).toBe(0);
    expect(out).toContain("compare/bub · 2 runs · passed 1/2");
    expect(out).toContain("2026-07-09T10-00");
    expect(out).toContain("2026-07-07T09-00");
    // 复印件那份 passed 判定只出现一行(run1),不在 run2 再占一行
    expect(out.match(/✓ passed/g)).toHaveLength(1);
  });

  it("裸 --history:每个 experiment 的 per-run 通过率序列", async () => {
    const root = await seedHistoryRoot();
    const { out, code } = await show(root, [], { history: true });
    expect(code).toBe(0);
    expect(out).toContain("compare/bub · 2 runs");
    // 每个快照一行(run2 折叠含携带的 passed 复印件,任一轮通过 → passed)
    expect(out.match(/1\/1 passed/g)).toHaveLength(2);
  });
});

// ───────────────────────── --report 装载与组合语义 ─────────────────────────

describe("--report 装载", () => {
  /** 不经 niceeval 包也能造出合法报告:判别与双面组件都锚在 Symbol.for 上。 */
  async function writeReportFile(dir: string): Promise<string> {
    const path = join(dir, "report.mjs");
    await writeFile(
      path,
      [
        'const FACES = Symbol.for("niceeval.report.faces");',
        "const Custom = () => null;",
        "Custom[FACES] = {",
        "  web: () => null,",
        "  text: (props, ctx) => `CUSTOM ${props.evals} · drill ${ctx.attemptCommand(props.ref)}`,",
        "};",
        "export default {",
        '  [Symbol.for("niceeval.report.definition")]: true,',
        "  build: (ctx) => ({",
        "    type: Custom,",
        "    props: {",
        "      evals: ctx.selection.snapshots.flatMap((s) => s.evals.map((e) => e.id)).sort().join(\",\"),",
        "      ref: ctx.selection.snapshots[0].evals[0].attempts[0].ref,",
        "    },",
        "  }),",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );
    return path;
  }

  it("装载 + 注入选集 + attemptCommand 下钻命令", async () => {
    const root = await seedComposedRoot();
    const report = await writeReportFile(root);
    const { out, code } = await show(root, [], { report });
    expect(code).toBe(0);
    expect(out).toContain("CUSTOM fixtures/button,weather/brooklyn");
    expect(out).toContain("drill niceeval show");
  });

  it("位置前缀对 --report 生效:收窄注入选集覆盖的 eval", async () => {
    const root = await seedComposedRoot();
    const report = await writeReportFile(root);
    const { out, code } = await show(root, ["weather"], { report });
    expect(code).toBe(0);
    expect(out).toContain("CUSTOM weather/brooklyn ·");
  });

  it("--experiment 让选集只留该实验", async () => {
    const root = await seedComposedRoot();
    await writeRun(
      root,
      "2026-07-09T11-00-00-000Z",
      summaryOf(
        [res({ id: "weather/brooklyn", experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-09T11:00:01.000Z" })],
        { agent: "codex", startedAt: "2026-07-09T11:00:00.000Z" },
      ),
    );
    const results = await openResults(root);
    const selection = composeShowSelection(results, { experiment: "compare/codex" });
    expect(selection.snapshots.map((s) => s.experimentId)).toEqual(["compare/codex"]);
  });

  it("--history 与 --report 互斥:报错直说", async () => {
    const root = await seedComposedRoot();
    const { err, code } = await show(root, [], { history: true, report: "reports/x.tsx" });
    expect(code).toBe(1);
    expect(err).toContain("mutually exclusive");
  });

  it("非法报告文件:默认导出不是 defineReport 产物", async () => {
    const root = await seedComposedRoot();
    const bad = join(root, "bad.mjs");
    await writeFile(bad, "export default {};\n", "utf-8");
    const { err, code } = await show(root, [], { report: bad });
    expect(code).toBe(1);
    expect(err).toContain("does not default-export a report");
    expect(err).toContain("defineReport");
  });

  it("报告文件不存在:直说路径与下一步", async () => {
    const root = await seedComposedRoot();
    const { err, code } = await show(root, [], { report: join(root, "missing.tsx") });
    expect(code).toBe(1);
    expect(err).toContain("Report file not found");
  });

  it("证据切面 flag 出现时走证据室,不渲染报告槽", async () => {
    const root = await seedComposedRoot();
    const report = await writeReportFile(root);
    const { out, code } = await show(root, ["fixtures/button"], { report, diff: true });
    expect(code).toBe(0);
    expect(out).not.toContain("CUSTOM");
    expect(out).toContain("no diff recorded"); // fixture 没有 diff 工件:如实说缺
  });
});

// ───────────────────────── 证据切面:--transcript ─────────────────────────

describe("--transcript", () => {
  it("逐轮对话 + 截断标注(事件数 · 工具调用数 · 原始工件路径)", async () => {
    const root = await makeRoot();
    const writer = await createRunWriter(root, { producer: { name: "niceeval", version: "0.0.0" } });
    const snap = writer.snapshot({
      experiment: "compare/codex",
      agent: "codex",
      startedAt: "2026-07-09T10:00:00.000Z",
    });
    await snap.writeAttempt(
      {
        id: "weather/brooklyn",
        verdict: "failed",
        attempt: 2,
        durationMs: 41_000,
        assertions: [],
      },
      {
        events: [
          { type: "message", role: "user", text: "布鲁克林今天天气怎么样?" },
          { type: "message", role: "assistant", text: "布鲁克林今天大约 24°C,晴。" },
        ],
      },
    );
    await writer.finish();

    const { out, code } = await show(root, ["weather/brooklyn"], { transcript: true });
    expect(code).toBe(0);
    expect(out).toContain("attempt 3 · compare/codex · failed");
    expect(out).toContain("[user]");
    expect(out).toContain("布鲁克林今天天气怎么样?");
    expect(out).toContain("[assistant]");
    expect(out).toContain("(2 events · no tool calls · full stream: ");
    expect(out).toContain("events.json)");
  });

  it("多个 eval 匹配时证据切面报错:先收窄到单个 eval", async () => {
    const root = await seedComposedRoot();
    const { err, code } = await show(root, [], { transcript: true });
    expect(code).toBe(1);
    expect(err).toContain("Narrow to a single eval id");
  });
});
