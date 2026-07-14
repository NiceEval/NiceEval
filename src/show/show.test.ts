// niceeval show 终端宿主的测试(行为规范:docs-site/zh/guides/viewing-results.mdx;
// 组合语义:docs/feature/reports/architecture.md「Selection 是计算入口」)。覆盖:
// - 榜单合成口径:每 experiment × eval 取最新判定,局部重跑从更早快照补齐,头部标注合成自几个快照;
// - 前缀过滤收窄 Selection,覆盖警告分母 = 已知并集 ∩ 范围;
// - --history 时间轴只列真实执行,resume 携带的复印件不占行;
// - --report 装载(合法 / 非法默认导出 / 文件缺失)、位置前缀收窄注入 Selection、attemptCommand 下钻;
// - 互斥:--history 与 --report;
// - 单 eval 详情、`@<locator>` 精确定位与 --eval / --execution / --diff 证据切面的输出形态。
//
// fixture 直接写新布局(<expDir>/<snapDir>/snapshot.json + <evalId>/a<n>/result.json),
// 依据是 docs/feature/results/architecture.md 的稳定磁盘契约,不经 writer 运行时 API(避免与并行重写的
// niceeval/results 写入面签名耦合)。

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openResults } from "../results/index.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";
import { selectCurrentResults } from "../results/select.ts";
import { evalHistory } from "./compose.ts";
import { runShow, type ShowFlags } from "./index.ts";
import { stringWidth } from "../report/text/layout.ts";

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

// show 的报告 chrome 跟随 CLI 界面语言(detectLocale);本文件的断言按英文写,
// 固定 en 让用例不随宿主机 LANG 漂移;zh-CN 传递单独一条用例覆盖。
let langBackup: string | undefined;
beforeAll(() => {
  langBackup = process.env.NICEEVAL_LANG;
  process.env.NICEEVAL_LANG = "en";
});
afterAll(() => {
  if (langBackup === undefined) delete process.env.NICEEVAL_LANG;
  else process.env.NICEEVAL_LANG = langBackup;
});

/** 一条 attempt 的最小 fixture;字段照 docs/feature/results/architecture.md 的 AttemptRecord。 */
type AttemptFixture = Pick<EvalResult, "id" | "verdict"> &
  Partial<
    Pick<
      EvalResult,
      "attempt" | "durationMs" | "assertions" | "estimatedCostUSD" | "usage" | "error" | "diagnostics" | "startedAt" | "artifactBase" | "hasEvents" | "hasTrace"
    >
  >;

function res(id: string, verdict: Verdict, extra: Partial<AttemptFixture> = {}): AttemptFixture {
  return { id, verdict, attempt: 0, durationMs: 1000, assertions: [], ...extra };
}

/** 实验目录名的清洗:与 docs/feature/results/architecture.md 一致(/ 与非 [\w.@-] 换成 _)。 */
function cleanDirName(id: string): string {
  return id.replace(/[^\w.@-]/g, "_");
}

interface SnapshotOpts {
  experimentId: string;
  agent?: string;
  model?: string;
  startedAt: string;
  completedAt?: string;
  knownEvalIds?: string[];
}

/** 写一份新布局快照:snapshot.json + 各 attempt 的 result.json。返回快照目录绝对路径。 */
async function writeSnapshot(
  root: string,
  snapDirName: string,
  opts: SnapshotOpts,
  results: AttemptFixture[],
): Promise<string> {
  const dir = join(root, cleanDirName(opts.experimentId), snapDirName);
  await mkdir(dir, { recursive: true });
  const meta = {
    format: RESULTS_FORMAT,
    schemaVersion: RESULTS_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.4.6" },
    experimentId: opts.experimentId,
    agent: opts.agent ?? "bub",
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    startedAt: opts.startedAt,
    completedAt: opts.completedAt ?? opts.startedAt,
    ...(opts.knownEvalIds ? { knownEvalIds: opts.knownEvalIds } : {}),
  };
  await writeFile(join(dir, "snapshot.json"), JSON.stringify(meta, null, 2), "utf-8");
  for (const r of results) {
    const attemptDir = join(dir, r.id, `a${r.attempt ?? 0}`);
    await mkdir(attemptDir, { recursive: true });
    await writeFile(join(attemptDir, "result.json"), JSON.stringify(r, null, 2), "utf-8");
  }
  return dir;
}

interface Captured {
  out: string;
  err: string;
  code: number;
}

async function show(root: string, patterns: string[], flags: ShowFlags = {}, width = 100): Promise<Captured> {
  let out = "";
  let err = "";
  const code = await runShow(root, patterns, { run: root, ...flags }, {
    out: (s) => (out += s),
    err: (s) => (err += s),
    width,
    now: Date.parse("2026-07-09T10:01:00.000Z"),
  });
  return { out, err, code };
}

/** 两个快照:老快照全量(a ✓ b ✓),新快照只重跑 b(✗)—— 榜单该跨快照合成。 */
async function seedComposedRoot(): Promise<string> {
  const root = await makeRoot();
  await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
    res("weather/brooklyn", "passed"),
    res("fixtures/button", "passed"),
  ]);
  await writeSnapshot(root, "2026-07-09T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-09T10:00:00.000Z" }, [
    res("fixtures/button", "failed", {
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
  ]);
  return root;
}

// ───────────────────────── 榜单合成口径 ─────────────────────────

describe("默认报告:跨快照合成的现刻水位(ExperimentComparison text 面)", () => {
  it("局部重跑不撕报告:另一题从更早快照补齐,缺成本时散点明确空态", async () => {
    const root = await seedComposedRoot();
    const { out, code } = await show(root, []);
    expect(code).toBe(0);
    expect(out).toContain("No data to plot Cost × Pass rate");
    expect(out).toContain("1 point missing data");
    expect(out).not.toContain("needed to compare");
    expect(out).not.toContain("COMPARISON");
    expect(out).toMatch(/compare\/bub\s+default\s+bub\s+1s\s+50%/);
    expect(out).toContain("1 passed / 1 failed");
    expect(out).toMatch(/✗ failed\s+fixtures\/button[\s\S]*└─ @1[0-9a-z]{7}[\s\S]*fileChanged/);
    expect(out).toMatch(/✓ passed\s+weather\/brooklyn[\s\S]*└─ @1[0-9a-z]{7}/);
    expect(out).not.toMatch(/\[[EXD⏱,]+\]/);
  });

  it("裸 show 的默认报告 chrome 跟随 locale", async () => {
    const root = await seedComposedRoot();
    process.env.NICEEVAL_LANG = "zh-CN";
    try {
      const { out, code } = await show(root, []);
      expect(code).toBe(0);
      expect(out).toContain("预估成本 × 成功率 没有可绘制的数据");
      expect(out).toContain("1 通过 / 1 失败");
      expect(out).toContain("compare/bub");
    } finally {
      process.env.NICEEVAL_LANG = "en";
    }
  });

  it("窄终端截断长 eval 与原因,每一行都不超过终端显示宽度", async () => {
    const root = await seedComposedRoot();
    const { out, code } = await show(root, [], {}, 60);
    expect(code).toBe(0);
    expect(out).toContain("fixtures/button");
    for (const line of out.trimEnd().split("\n")) {
      expect(stringWidth(line), line).toBeLessThanOrEqual(60);
    }
  });

  it("多个 experiment 显示散点图,再逐 experiment → Eval → Attempt", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/a", agent: "codex", model: "mini", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("q1", "passed", { estimatedCostUSD: 0.1 }),
      res("q2", "failed", { estimatedCostUSD: 0.2 }),
    ]);
    await writeSnapshot(root, "2026-07-08T11-00-00-000Z", { experimentId: "compare/b", agent: "claude", model: "large", startedAt: "2026-07-08T11:00:00.000Z" }, [
      res("q1", "passed", { estimatedCostUSD: 0.3 }),
      res("q2", "passed", { estimatedCostUSD: 0.3 }),
    ]);
    const { out, code } = await show(root, []);
    expect(code).toBe(0);
    expect(out).toContain("better → upper right");
    expect(out).toContain("A compare/a   B compare/b");
    expect(out).toMatch(/compare\/b\s+large\s+claude\s+1s\s+100%/);
    expect(out).toMatch(/compare\/a\s+mini\s+codex\s+1s\s+50%/);
    expect(out).toMatch(/✓ passed\s+q1[\s\S]*└─ @1[0-9a-z]{7}/);
    expect(out).toMatch(/✗ failed\s+q2[\s\S]*└─ @1[0-9a-z]{7}/);
    expect(out).not.toContain("needed to compare");
  });

  it("合成 Selection:每 experiment × eval 取最新判定;compose 不产生残缺警告", async () => {
    const root = await seedComposedRoot();
    const results = await openResults(root);
    const selection = selectCurrentResults(results);
    expect(selection.snapshots).toHaveLength(1);
    const evals = selection.snapshots[0].evals.map((e) => e.id).sort();
    expect(evals).toEqual(["fixtures/button", "weather/brooklyn"]);
    const button = selection.snapshots[0].evals.find((e) => e.id === "fixtures/button")!;
    expect(button.attempts[0].result.verdict).toBe("failed"); // 新快照的判定赢
    expect(selection.warnings).toEqual([]);
    // 对照:results.latest() 的最新快照是残缺的(这正是宿主要合成的原因)
    expect(results.latest().warnings.some((w) => w.kind === "partial-coverage")).toBe(true);
  });
});

// ───────────────────────── 前缀过滤 ─────────────────────────

describe("位置前缀收窄", () => {
  it("前缀收窄 Selection 覆盖的 eval;覆盖警告分母 = 已知并集 ∩ 范围", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-08T10-00-00-000Z",
      {
        experimentId: "compare/bub",
        startedAt: "2026-07-08T10:00:00.000Z",
        // 已知并集包含一道从未落盘的题:algebra 范围外,不该刷 weather 范围的屏
        knownEvalIds: ["weather/brooklyn", "weather/queens", "algebra/quadratic"],
      },
      [res("weather/brooklyn", "passed"), res("algebra/quadratic", "passed")],
    );
    const results = await openResults(root);

    const weather = selectCurrentResults(results, { patterns: ["weather"] });
    expect(weather.snapshots[0].evals.map((e) => e.id)).toEqual(["weather/brooklyn"]);
    // 分母 = {weather/brooklyn, weather/queens}:缺 queens → 1/2;algebra 的缺口不进来
    const coverage = weather.warnings.find((w) => w.kind === "partial-coverage");
    expect(coverage).toMatchObject({ covered: 1, total: 2 });

    const algebra = selectCurrentResults(results, { patterns: ["algebra"] });
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
    await writeSnapshot(
      root,
      "2026-07-09T10-00-00-000Z",
      { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-09T10:00:00.000Z" },
      [
        res("weather/brooklyn", "failed", { attempt: 0, durationMs: 40_000 }),
        res("weather/brooklyn", "failed", {
          attempt: 1,
          durationMs: 41_000,
          usage: { inputTokens: 12_000, outputTokens: 300 },
          estimatedCostUSD: 0.04,
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
    // artifacts 路径 = <experiment-dir>/<snapshot-dir>/<evalId>/a<n>(root 相对)
    expect(out).toContain("compare_codex/2026-07-09T10-00-00-000Z/weather/brooklyn/a1");
    // 每 experiment 一行都带紧凑索引(locator + 失败原因),详情块再补一条精确的 attempt locator
    expect(out).toMatch(/✗ failed\s+2 attempts.*@1[0-9a-z]{7}.*gate calledTool/);
    expect(out).toMatch(/attempt locator: @1[0-9a-z]{7}/);
    expect(out).toMatch(/next: niceeval show @1[0-9a-z]{7} \[--eval\|--execution\|--diff\]/);
  });
});

// ───────────────────────── --history:复印件不占行 ─────────────────────────

describe("--history 时间轴", () => {
  /** 快照1 真实执行;快照2 resume 携带同一判定(身份键相同的复印件)+ 新题真实执行。 */
  async function seedHistoryRoot(): Promise<string> {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-07T09-00-00-000Z",
      { experimentId: "compare/bub", startedAt: "2026-07-07T09:00:00.000Z" },
      [res("weather/brooklyn", "passed", { estimatedCostUSD: 0.03 })],
    );
    // 复印件:同 id / attempt / startedAt(锚定原快照的 startedAt),artifactBase 指回原快照。
    await writeSnapshot(
      root,
      "2026-07-09T10-00-00-000Z",
      { experimentId: "compare/bub", startedAt: "2026-07-09T10:00:00.000Z" },
      [
        res("weather/brooklyn", "passed", {
          estimatedCostUSD: 0.03,
          startedAt: "2026-07-07T09:00:00.000Z",
          artifactBase: "compare_bub/2026-07-07T09-00-00-000Z/weather/brooklyn/a0",
        }),
        res("weather/brooklyn", "failed", {
          attempt: 1,
          estimatedCostUSD: 0.04,
          assertions: [{ name: 'calledTool("get_weather")', severity: "gate", score: 0, passed: false }],
        }),
      ],
    );
    return root;
  }

  it("时间轴只列真实执行:复印件不占行,新失败带断言", async () => {
    const root = await seedHistoryRoot();
    const results = await openResults(root);
    const exp = results.experiments.find((e) => e.id === "compare/bub")!;
    const rows = evalHistory(exp, "weather/brooklyn");
    // 快照2 里复印件被识别,真实执行只有:快照1 的 passed + 快照2 的 failed(新 attempt)
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ verdict: "failed", attempts: 1, costUSD: 0.04 });
    expect(rows[0].failedAssertion).toBe('gate calledTool("get_weather")');
    expect(rows[1]).toMatchObject({ verdict: "passed", attempts: 1, costUSD: 0.03 });

    const { out, code } = await show(root, ["weather/brooklyn"], { history: true });
    expect(code).toBe(0);
    expect(out).toContain("compare/bub · 2 runs · passed 1/2");
    expect(out).toContain("2026-07-09T10-00");
    expect(out).toContain("2026-07-07T09-00");
    // 复印件那份 passed 判定只出现一行(快照1),不在快照2 再占一行
    expect(out.match(/✓ passed/g)).toHaveLength(1);
  });

  it("裸 --history:每个 experiment 的 per-run 通过率序列", async () => {
    const root = await seedHistoryRoot();
    const { out, code } = await show(root, [], { history: true });
    expect(code).toBe(0);
    expect(out).toContain("compare/bub · 2 runs");
    // 每个快照一行(快照2 折叠含携带的 passed 复印件,任一轮通过 → passed)
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
        "  text: (props, ctx) => `CUSTOM ${props.evals} · drill ${ctx.attemptCommand(props.locator)}`,",
        "};",
        "export default {",
        '  [Symbol.for("niceeval.report.definition")]: true,',
        "  build: (ctx) => ({",
        "    type: Custom,",
        "    props: {",
        "      evals: ctx.selection.snapshots.flatMap((s) => s.evals.map((e) => e.id)).sort().join(\",\"),",
        "      locator: ctx.selection.snapshots[0].evals[0].attempts[0].locator,",
        "    },",
        "  }),",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );
    return path;
  }

  it("装载 + 注入 Selection + attemptCommand 下钻命令", async () => {
    const root = await seedComposedRoot();
    const report = await writeReportFile(root);
    const { out, code } = await show(root, [], { report });
    expect(code).toBe(0);
    expect(out).toContain("CUSTOM fixtures/button,weather/brooklyn");
    expect(out).toContain("drill niceeval show");
  });

  it("位置前缀对 --report 生效:收窄注入 Selection 覆盖的 eval", async () => {
    const root = await seedComposedRoot();
    const report = await writeReportFile(root);
    const { out, code } = await show(root, ["weather"], { report });
    expect(code).toBe(0);
    expect(out).toContain("CUSTOM weather/brooklyn ·");
  });

  it("--experiment 让 Selection 只留该实验", async () => {
    const root = await seedComposedRoot();
    await writeSnapshot(
      root,
      "2026-07-09T11-00-00-000Z",
      { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-09T11:00:00.000Z" },
      [res("weather/brooklyn", "passed")],
    );
    const results = await openResults(root);
    const selection = selectCurrentResults(results, { experiment: "compare/codex" });
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
    expect(out).toContain("no diff recorded"); // fixture 没有 diff artifact:如实说缺
  });
});

// ───────────────────────── 证据切面:--execution ─────────────────────────

describe("--execution", () => {
  it("标准事件流(消息);没有 OTel 时如实标 timing unavailable", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(
      root,
      "2026-07-09T10-00-00-000Z",
      { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-09T10:00:00.000Z" },
      [res("weather/brooklyn", "failed", { attempt: 2, durationMs: 41_000, hasEvents: true })],
    );
    await writeFile(
      join(dir, "weather/brooklyn/a2/events.json"),
      JSON.stringify([
        { type: "message", role: "user", text: "布鲁克林今天天气怎么样?" },
        { type: "message", role: "assistant", text: "布鲁克林今天大约 24°C,晴。" },
      ]),
      "utf-8",
    );

    const { out, code } = await show(root, ["weather/brooklyn"], { execution: true });
    expect(code).toBe(0);
    expect(out).toMatch(/^@1[0-9a-z]{7} · weather\/brooklyn · compare\/codex · failed/m);
    expect(out).toMatch(/USER\s+布鲁克林今天天气怎么样?/);
    expect(out).toMatch(/ASSISTANT\s+布鲁克林今天大约 24°C,晴。/);
    expect(out).toContain("timing unavailable · OTel trace was not collected");
    expect(out).toContain("full events: ");
    expect(out).toContain("events.json");
  });

  it("execution === null 时如实说没有事件记录", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-08T10-00-00-000Z",
      { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" },
      [res("weather/brooklyn", "passed")],
    );
    const { out, code } = await show(root, ["weather/brooklyn"], { execution: true });
    expect(code).toBe(0);
    expect(out).toContain("no events recorded for this attempt");
  });

  it("不把未关联的 telemetry spans 混进 Agent 执行记录", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(root, "2026-07-09T10-00-00-000Z", { experimentId: "compare/codex", startedAt: "2026-07-09T10:00:00.000Z" }, [
      res("weather/brooklyn", "failed", { hasEvents: true, hasTrace: true }),
    ]);
    await writeFile(join(dir, "weather/brooklyn/a0/events.json"), JSON.stringify([{ type: "message", role: "user", text: "hello" }]), "utf-8");
    await writeFile(join(dir, "weather/brooklyn/a0/trace.json"), JSON.stringify([{ traceId: "t", spanId: "s", name: "sdk.internal", startMs: 1, endMs: 2 }]), "utf-8");
    const { out } = await show(root, ["weather/brooklyn"], { execution: true });
    expect(out).toContain("USER");
    expect(out).not.toMatch(/telemetry\s+sdk\.internal/);
    expect(out).toContain("unlinked telemetry spans omitted");
  });

  it("多个 eval 匹配时证据切面报错:给紧凑索引(locator + 失败原因)而不是只报个数", async () => {
    const root = await seedComposedRoot();
    const { err, code } = await show(root, [], { execution: true });
    expect(code).toBe(1);
    expect(err).toContain("matched 2 evals");
    expect(err).toMatch(/✗ fixtures\/button\s+@1[0-9a-z]{7}/);
    expect(err).toContain('gate fileChanged("src/components/Button.tsx")');
  });
});

// ───────────────────────── 证据切面:--eval ─────────────────────────

describe("--eval", () => {
  it("evalSource === null 时如实说源码未捕获", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-08T10-00-00-000Z",
      { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" },
      [res("weather/brooklyn", "failed", { assertions: [{ name: "succeeded()", severity: "gate", score: 0, passed: false }] })],
    );
    const { out, code } = await show(root, ["weather/brooklyn"], { eval: true });
    expect(code).toBe(0);
    expect(out).toContain("eval source unavailable for this attempt");
  });

  it("有捕获的源码时:源码行标回断言,unmapped 断言单独成段,断言计票摘要", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(
      root,
      "2026-07-08T10-00-00-000Z",
      { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" },
      [
        res("weather/brooklyn", "failed", {
          assertions: [
            {
              name: 'calledTool("get_weather")',
              severity: "gate",
              score: 0,
              passed: false,
              detail: "tool was never called",
              loc: { file: "evals/weather/brooklyn.eval.ts", line: 2 },
            },
            { name: "unlocated()", severity: "soft", score: 0.5, passed: false, detail: "no loc on this one" },
          ],
        }),
      ],
    );
    const attemptDir = join(dir, "weather/brooklyn/a0");
    const content = 'defineEval({\n  turn.calledTool("get_weather");\n});\n';
    const sha = createHash("sha256").update(content).digest("hex");
    await writeFile(join(attemptDir, "sources.json"), JSON.stringify([{ path: "evals/weather/brooklyn.eval.ts", sha256: sha }]), "utf-8");
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources", `${sha}.json`), JSON.stringify({ content }), "utf-8");

    const { out, code } = await show(root, ["weather/brooklyn"], { eval: true });
    expect(code).toBe(0);
    expect(out).toContain(`eval source: evals/weather/brooklyn.eval.ts · sha256:${sha.slice(0, 8)}`);
    // 源码行的缩进是语义的一部分,渲染必须原样保留(不按词重排折叠掉这两个空格)。
    expect(out).toMatch(/2✗ {3}turn\.calledTool\("get_weather"\);/);
    expect(out).toContain('gate · calledTool("get_weather") · tool was never called');
    expect(out).toContain("unmapped assertions (1, no source location):");
    expect(out).toContain("unlocated()");
    expect(out).toContain("assertions: 1 gate failed · 1 soft below target");
  });

  it("源码行标注保留 group 与值断言的 expected/received", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("manager", "failed", { assertions: [{ name: "equals(4)", severity: "gate", score: 0, passed: false, evidence: "1", group: "Issue 15193", loc: { file: "evals/manager.eval.ts", line: 1 } }] }),
    ]);
    const attemptDir = join(dir, "manager/a0");
    const content = "t.check(actual, equals(expected));\n";
    const sha = createHash("sha256").update(content).digest("hex");
    await writeFile(join(attemptDir, "sources.json"), JSON.stringify([{ path: "evals/manager.eval.ts", sha256: sha }]), "utf-8");
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources", `${sha}.json`), JSON.stringify({ content }), "utf-8");
    const { out } = await show(root, ["manager"], { eval: true });
    expect(out).toContain("gate · Issue 15193 · equals(4) · expected 4 · received 1");
  });
});

// ───────────────────────── @<locator> ─────────────────────────

describe("show @<locator>", () => {
  it("默认页直接解释失败断言的 group、期望值、实际值和源码位置", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("manager", "failed", { assertions: [{ name: "equals(4)", severity: "gate", score: 0, passed: false, evidence: "1", group: "Issue 15193", loc: { file: "evals/manager.eval.ts", line: 40, column: 11 } }] }),
    ]);
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;
    const { out } = await show(root, [locator]);
    expect(out).toContain("gate · Issue 15193");
    expect(out).toContain("assertion: equals(4)");
    expect(out).toContain("expected: 4");
    expect(out).toContain("received: 1");
    expect(out).toContain("source: evals/manager.eval.ts:40:11");
  });
  it("解析到对应 attempt,渲染紧凑全景(不当成 eval id 前缀匹配)", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const results = await openResults(root);
    const attempt = results.experiments[0]!.latest.evals[0]!.attempts[0]!;
    const locator = attempt.locator!;
    expect(locator).toMatch(/^@1[0-9a-z]{7}$/);

    const { out, code } = await show(root, [locator]);
    expect(code).toBe(0);
    expect(out).toContain(`${locator} · weather/brooklyn · compare/bub · passed`);
    expect(out).toContain("attempt 1 · ");
    expect(out).toContain("execution: unavailable (no events recorded for this attempt)");
    expect(out).toContain("changes: diff unavailable");
    expect(out).not.toContain("evidence:");
    expect(out).not.toContain("available:");
  });

  it("errored attempt 首页展开结构化 error(phase/code/message/cause)与 diagnostics", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/claude-e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("agent-029", "errored", {
        error: {
          code: "sandbox-rate-limit",
          message: "E2B sandbox allocation failed after 5 attempts",
          operation: "sandbox.provision",
          cause: { name: "RateLimitError", message: "too many concurrent sandboxes" },
        },
        diagnostics: [
          { code: "teardown-failed", level: "warning", message: "container stop timed out", operation: "sandbox.teardown" },
        ],
      }),
    ]);
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const { out, code } = await show(root, [locator]);
    expect(code).toBe(0);
    expect(out).toContain(`${locator} · agent-029 · compare/claude-e2b · errored`);
    // 结构化 error 块:operation 点换空格作 phase 标签,code/message/cause 各一行(见 docs/feature/reports/show.md)
    expect(out).toContain("error:");
    expect(out).toContain("phase: sandbox provision");
    expect(out).toContain("code: sandbox-rate-limit");
    expect(out).toContain("message: E2B sandbox allocation failed after 5 attempts");
    expect(out).toContain("cause: RateLimitError · too many concurrent sandboxes");
    // attempt 级 diagnostics 块(与 verdict 独立)
    expect(out).toContain("diagnostics:");
    expect(out).toContain("warning · sandbox.teardown · teardown-failed");
    expect(out).toContain("container stop timed out");
    // errored 且无断言:不打印空的 assertions 汇总行
    expect(out).not.toContain("assertions:");
  });

  it("available 只逐行列出实际存在的证据命令,不打印能力字母或合并式 next", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "failed", { hasEvents: true }),
    ]);
    const attemptDir = join(dir, "weather/brooklyn/a0");
    const content = "t.check(false, equals(true));\n";
    const sha = createHash("sha256").update(content).digest("hex");
    await writeFile(join(attemptDir, "sources.json"), JSON.stringify([{ path: "evals/weather.eval.ts", sha256: sha }]), "utf-8");
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources", `${sha}.json`), JSON.stringify({ content }), "utf-8");
    await writeFile(join(attemptDir, "events.json"), JSON.stringify([{ type: "message", role: "user", text: "hello" }]), "utf-8");
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const { out, code } = await show(root, [locator]);
    expect(code).toBe(0);
    expect(out).toContain(`available:\n  niceeval show ${locator} --eval\n  niceeval show ${locator} --execution`);
    expect(out).not.toContain(`niceeval show ${locator} --diff`);
    expect(out).not.toContain("evidence:");
    expect(out).not.toContain("next:");
  });

  it("配 --execution 走证据切面,不是紧凑全景", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const { out, code } = await show(root, [locator], { execution: true });
    expect(code).toBe(0);
    expect(out).toContain(`${locator} · weather/brooklyn · compare/bub · passed`);
    expect(out).toContain("no events recorded for this attempt");
    // 紧凑全景独有的行不应该出现在证据切面输出里
    expect(out).not.toContain("available:");
  });

  it("语法不对的 locator 报「not a valid attempt locator」,退出码 1,不崩", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const { err, code } = await show(root, ["@not-valid"]);
    expect(code).toBe(1);
    expect(err).toContain("not a valid attempt locator");
  });

  it("语法合法但索引里没有的 locator 报「No attempt found」,退出码 1,不崩", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const { err, code } = await show(root, ["@1nosuch1"]);
    expect(code).toBe(1);
    expect(err).toContain("No attempt found");
  });

  it("locator 与其它位置参数混用时报错,不静默只取第一个", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const { err, code } = await show(root, [locator, "weather/brooklyn"]);
    expect(code).toBe(1);
    expect(err).toContain("must be the only positional argument");
  });
});
