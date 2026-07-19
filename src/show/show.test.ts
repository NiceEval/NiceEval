// cases: docs/engineering/unit-tests/reports/cases.md
// niceeval show 终端宿主的测试(行为规范:docs-site/zh/tutorials/viewing-results.mdx;
// 组合语义:docs/feature/reports/architecture.md「Selection 是计算入口」)。覆盖:
// - 榜单合成口径:每 experiment × eval 取最新判定,局部重跑从更早快照补齐,头部标注合成自几个快照;
// - 前缀过滤收窄 Selection,覆盖警告分母 = 已知并集 ∩ 范围;
// - --history 时间轴只列真实执行,resume 携带的复印件不占行;
// - --report 装载(合法 / 非法默认导出 / 文件缺失)、位置前缀收窄注入 Selection、attemptCommand 下钻;
// - 互斥:--history 与 --report;
// - 单 eval 详情、`@<locator>` 精确定位与 --source / --execution / --diff 证据切面的输出形态。
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
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type TimingNode, type TraceSpan, type Verdict } from "../types.ts";
import { selectCurrentResults } from "../results/select.ts";
import { attemptHistory } from "./compose.ts";
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
      "attempt" | "durationMs" | "assertions" | "estimatedCostUSD" | "usage" | "error" | "diagnostics" | "startedAt" | "artifactBase" | "hasEvents" | "hasTrace" | "phases"
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
  const code = await runShow(root, patterns, { results: root, ...flags }, {
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
          outcome: "failed" as const,
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
    expect(out).toMatch(/\bbub\s+default\s+bub\s+1s\s+50%/);
    expect(out).toMatch(/1 passed[\s\S]*?· 1\s+failed/);
    expect(out).toMatch(/✗ failed\s+fixtures\/button[\s\S]*└─ @1[0-9a-z]{7}[\s\S]*fileChanged/);
    expect(out).toMatch(/✓ passed\s+weather\/brooklyn[\s\S]*└─ @1[0-9a-z]{7}/);
    expect(out).not.toMatch(/\[[EXD⏱,]+\]/);
  });

  it("裸 show 是内建报告首页:页首 Hero 标题行 + 最后运行 meta,尾部附 attempts / traces 页索引(命令带 --results 上下文)", async () => {
    // docs/feature/reports/show/default-report.md:Hero 两行在页首,「其余页」两行在尾部。
    const root = await seedComposedRoot();
    const { out, code } = await show(root, []);
    expect(code).toBe(0);
    const lines = out.split("\n");
    expect(lines[0]).toBe("Eval Results"); // 标题回退链终点(快照无 name、无 --report title)
    expect(lines[1]).toMatch(/^Last run \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/); // Hero meta 行
    // 尾部「其余页」索引:只列未渲染的两页,命令携带完整 --results 上下文,复制即可复现。
    const tailAt = out.indexOf("Other pages:");
    expect(tailAt).toBeGreaterThan(-1);
    const tail = out.slice(tailAt);
    expect(tail).toContain(`niceeval show --results ${root} --page attempts`);
    expect(tail).toContain(`niceeval show --results ${root} --page traces`);
    expect(tail).not.toContain("--page report"); // 已渲染的首页不进索引
  });

  it("裸 show 的 --page attempts / traces 渲染内建证据页(AttemptList / TraceWaterfall 的 text 面)", async () => {
    const root = await seedComposedRoot();
    const attempts = await show(root, [], { page: "attempts" }, 160);
    expect(attempts.code).toBe(0);
    // AttemptList text 面:范围内每个 attempt 一条,失败行带主失败摘要。
    expect(attempts.out).toContain("fixtures/button");
    expect(attempts.out).toContain("weather/brooklyn");
    expect(attempts.out).toMatch(/@1[0-9a-z]{7}/);
    const traces = await show(root, [], { page: "traces" }, 160);
    expect(traces.code).toBe(0);
    // TraceWaterfall text 面:每 attempt 一行,行尾是可复制的 --timing 下钻命令。
    expect(traces.out).toMatch(/niceeval show @1[0-9a-z]{7} --timing/);
    expect(traces.out).toContain("no trace"); // fixture 无 trace artifact:如实显示缺失
  });

  it("裸 show 的选择警告由页内 ScopeWarnings 组件显示(partial-coverage 按动作聚合成组头行)", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-08T10-00-00-000Z",
      {
        experimentId: "compare/bub",
        startedAt: "2026-07-08T10:00:00.000Z",
        knownEvalIds: ["weather/brooklyn", "weather/queens"], // 少跑一题 → partial-coverage
      },
      [res("weather/brooklyn", "passed")],
    );
    const { out, code } = await show(root, [], {}, 160);
    expect(code).toBe(0);
    // 警告块在 Hero 之后、组内容之前;组头一行含实验 id、徽标与可复制命令。
    expect(out).toMatch(/^! compare\/bub — coverage 1\/2 → niceeval exp compare\/bub$/m);
    expect(out.indexOf("Eval Results")).toBeLessThan(out.indexOf("! compare/bub"));
  });

  it("裸 show 的默认报告 chrome 跟随 locale", async () => {
    const root = await seedComposedRoot();
    process.env.NICEEVAL_LANG = "zh-CN";
    try {
      const { out, code } = await show(root, []);
      expect(code).toBe(0);
      expect(out).toContain("成本 × 通过率 没有可绘制的数据");
      expect(out).toContain("1 通过 · 1 失败");
      expect(out).toMatch(/\bbub\s+默认\s+bub\s+1s\s+50%/);
      // 页首 Hero 与尾部页索引同样跟随 locale(内置文案与页名)。
      expect(out.split("\n")[0]).toBe("Eval 运行结果");
      expect(out).toContain("其余页：");
      expect(out).toContain("追踪");
    } finally {
      process.env.NICEEVAL_LANG = "en";
    }
  });

  it("窄终端截断长 eval 与原因,报告正文每一行都不超过终端显示宽度", async () => {
    const root = await seedComposedRoot();
    const { out, code } = await show(root, [], {}, 60);
    expect(code).toBe(0);
    expect(out).toContain("fixtures/button");
    // 「其余页」索引里的命令是可复制的完整命令(携带 --results 绝对路径),复制即可执行,
    // 永不为宽度折行——宽度约束只作用于报告正文。
    const body = out.slice(0, out.indexOf("Other pages:"));
    for (const line of body.trimEnd().split("\n")) {
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
    // 成本轴(better: lower)反向,「更好」恒指向右上;两轴都声明 better → 提示在场
    expect(out).toContain("better → upper right");
    // 无 line 声明:按 agent 归类、不连线;图例一行一个 series(显示键字典序),标记按图例顺序分配
    expect(out).toContain("grouped by agent");
    expect(out).toContain("claude  A compare/b");
    expect(out).toContain("codex   B compare/a");
    expect(out).toMatch(/\bb\s+large\s+claude\s+1s\s+100%/);
    expect(out).toMatch(/\ba\s+mini\s+codex\s+1s\s+50%/);
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
              outcome: "failed" as const,
              detail: "tool was never called",
            },
            { name: "succeeded()", severity: "gate", score: 1, outcome: "passed" as const },
            {
              name: 'judge("回答基于实时数据")',
              severity: "soft",
              score: 0.2,
              outcome: "failed" as const,
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
    expect(out).toMatch(/next: niceeval show @1[0-9a-z]{7} \[--source\|--execution\|--diff\]/);
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
          assertions: [{ name: 'calledTool("get_weather")', severity: "gate", score: 0, outcome: "failed" as const }],
        }),
      ],
    );
    return root;
  }

  it("逐 attempt 分节:复印件按身份键去重不占行,startedAt 升序,行带摘要 / 成本 / locator", async () => {
    const root = await seedHistoryRoot();
    const results = await openResults(root);
    const exp = results.experiments.find((e) => e.id === "compare/bub")!;
    const rows = attemptHistory(exp, "weather/brooklyn");
    // 快照2 里复印件被识别(与快照1 的真实执行同身份键),历次 attempt = 快照1 的 passed +
    // 快照2 的 failed(新 attempt);startedAt 升序,旧的在前。
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ verdict: "passed", costUSD: 0.03 });
    expect(rows[0].summary).toBeUndefined();
    expect(rows[1]).toMatchObject({ verdict: "failed", costUSD: 0.04 });
    expect(rows[1].summary).toContain('calledTool("get_weather")');
    expect(rows[1].locator).toMatch(/^@/);

    const { out, code } = await show(root, ["weather/brooklyn"], { history: true });
    expect(code).toBe(0);
    // 分节头:experimentId + evalId 一起出现,计数按 attempt。
    expect(out).toContain("weather/brooklyn · compare/bub · 2 attempts · passed 1/2");
    // 复印件那份 passed 判定只出现一行,不在快照2 再占一行;升序:passed 行在 failed 行之前。
    expect(out.match(/✓ passed/g)).toHaveLength(1);
    expect(out.indexOf("✓ passed")).toBeLessThan(out.indexOf("✗ failed"));
    // 每行携带可复制的 locator。
    expect(out).toMatch(/@\w+/);
  });

  it("裸 --history:对 Scope 中每个 experimentId + evalId 分节,不再输出快照级序列", async () => {
    const root = await seedHistoryRoot();
    const { out, code } = await show(root, [], { history: true });
    expect(code).toBe(0);
    expect(out).toContain("weather/brooklyn · compare/bub · 2 attempts · passed 1/2");
    // 不是「每个快照一行」的通过率序列。
    expect(out).not.toContain("1/1 passed");
  });

  it("--history 与 --page 组合是用法矛盾:直说", async () => {
    const root = await seedHistoryRoot();
    const { err, code } = await show(root, [], { history: true, page: "report" });
    expect(code).toBe(1);
    expect(err).toContain("--page");
  });
});

// ───────────────────────── --report 装载与组合语义 ─────────────────────────

describe("--report 装载", () => {
  /**
   * 不经 niceeval 包也能造出合法报告:判别、组合组件与双面组件都锚在 Symbol.for 上
   * (docs/feature/reports/library/shell.md「defineReport 产物」、layout.md「自定义组件」)。
   * Custom 是双面组件,读 props 直接渲染;Wrapper 是组合组件,用 ComposeContext 的 scope
   * 算出 evals / locator 再装配进 Custom —— 对应 defineReport(<Wrapper />) 的展开形态。
   */
  async function writeReportFile(dir: string): Promise<string> {
    const path = join(dir, "report.mjs");
    await writeFile(
      path,
      [
        'const FACES = Symbol.for("niceeval.report.faces");',
        'const COMPOSE = Symbol.for("niceeval.report.compose");',
        'const DEFINITION = Symbol.for("niceeval.report.definition");',
        "const Custom = () => null;",
        "Custom[FACES] = {",
        "  web: () => null,",
        "  text: (props, ctx) => `CUSTOM ${props.evals} · drill ${ctx.attemptCommand(props.locator)}`,",
        "};",
        "const Wrapper = () => null;",
        "Wrapper[COMPOSE] = (props, ctx) => ({",
        "  type: Custom,",
        "  props: {",
        "    evals: ctx.scope.snapshots.flatMap((s) => s.evals.map((e) => e.id)).sort().join(\",\"),",
        "    locator: ctx.scope.snapshots[0].evals[0].attempts[0].locator,",
        "  },",
        "});",
        "const AttemptPage = () => null;",
        "AttemptPage[FACES] = { web: () => null, text: () => \"\" };",
        "const definition = {",
        '  kind: "report",',
        "  links: [],",
        "  scripts: [],",
        "  styles: [],",
        "  pages: [",
        '    { id: "report", title: "Report", input: "scope", navigation: true, content: { type: Wrapper, props: {} } },',
        // 报告需要声明一张 attempt-input page,attemptCommand 生成器才存在(architecture.md
        // 「Attempt 详情是一张参数化 page」);navigation:false 不进「其余页」索引,单页断言不受影响。
        '    { id: "attempt", title: "Attempt", input: "attempt", navigation: false, content: { type: AttemptPage, props: {} } },',
        "  ],",
        "};",
        "Object.defineProperty(definition, DEFINITION, { value: true });",
        "export default definition;",
        "",
      ].join("\n"),
      "utf-8",
    );
    return path;
  }

  /**
   * 两页文件:overview / exam,各自的 text 面输出一个可断言的标记字符串——够验证
   * 「渲染初始页 + 尾部附其余页索引,不倾倒其余页内容」而不需要引入更多组合语义
   * (docs/feature/reports/show/reports.md Case 2)。
   */
  async function writeMultiPageReportFile(dir: string): Promise<string> {
    const path = join(dir, "site.mjs");
    await writeFile(
      path,
      [
        'const FACES = Symbol.for("niceeval.report.faces");',
        'const DEFINITION = Symbol.for("niceeval.report.definition");',
        "const Overview = () => null;",
        "Overview[FACES] = { web: () => null, text: () => \"OVERVIEW PAGE CONTENT\" };",
        "const Exam = () => null;",
        "Exam[FACES] = { web: () => null, text: () => \"EXAM PAGE CONTENT\" };",
        "const definition = {",
        '  kind: "report",',
        "  links: [],",
        "  scripts: [],",
        "  styles: [],",
        "  pages: [",
        '    { id: "overview", title: { en: "Overview", "zh-CN": "总览" }, content: { type: Overview, props: {} } },',
        '    { id: "exam", title: { en: "Exam", "zh-CN": "成绩单" }, content: { type: Exam, props: {} } },',
        "  ],",
        "};",
        "Object.defineProperty(definition, DEFINITION, { value: true });",
        "export default definition;",
        "",
      ].join("\n"),
      "utf-8",
    );
    return path;
  }

  it("多页文件:渲染初始页(缺省第一页)+ 尾部附其余页索引,不倾倒其余页内容", async () => {
    // show() 测试助手缺省把 root 当 --results 传下去(见上方 show() 定义),
    // 因此索引命令恒含 --results;这里的默认 locale 是 en(beforeAll 固定)。
    const root = await seedComposedRoot();
    const report = await writeMultiPageReportFile(root);
    const { out, code } = await show(root, [], { report });
    expect(code).toBe(0);
    expect(out).toContain("OVERVIEW PAGE CONTENT");
    expect(out).not.toContain("EXAM PAGE CONTENT");
    expect(out).toContain("Other pages:");
    expect(out).toContain(`niceeval show --results ${root} --report ${report} --page exam`);
    expect(out).toContain("Exam");
    expect(out).not.toContain("--page overview"); // 已渲染的页不进「其余页」索引
  });

  it("多页文件:--page 选中的页渲染,尾部索引只列剩下的页", async () => {
    const root = await seedComposedRoot();
    const report = await writeMultiPageReportFile(root);
    const { out, code } = await show(root, [], { report, page: "exam" });
    expect(code).toBe(0);
    expect(out).toContain("EXAM PAGE CONTENT");
    expect(out).not.toContain("OVERVIEW PAGE CONTENT");
    expect(out).toContain("Other pages:");
    expect(out).toContain(`niceeval show --results ${root} --report ${report} --page overview`);
    expect(out).not.toContain("--page exam");
  });

  it("单页定义直接渲染,无「其余页」段", async () => {
    const root = await seedComposedRoot();
    const report = await writeReportFile(root);
    const { out, code } = await show(root, [], { report });
    expect(code).toBe(0);
    expect(out).not.toContain("其余页");
    expect(out).not.toContain("Other pages");
  });

  it("其余页索引命令保留当前 --results / --report 与位置参数上下文,复制即可复现下一层视图", async () => {
    const root = await seedComposedRoot();
    const report = await writeMultiPageReportFile(root);
    const { out, code } = await show(root, ["weather"], { report, results: root });
    expect(code).toBe(0);
    expect(out).toContain(`niceeval show weather --results ${root} --report ${report} --page exam`);
  });

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

  it("--exp 让 Selection 只留该实验", async () => {
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

  it("--page 命中单页定义的唯一页 id `report`:与直接渲染等价", async () => {
    const root = await seedComposedRoot();
    const report = await writeReportFile(root);
    const bare = await show(root, [], { report });
    const paged = await show(root, [], { report, page: "report" });
    expect(paged.code).toBe(0);
    expect(paged.out).toBe(bare.out);
  });

  it("--page 未命中:按用法错误非零退出并列出可用页 id(内建报告同样成立)", async () => {
    const root = await seedComposedRoot();
    const report = await writeReportFile(root);
    const miss = await show(root, [], { report, page: "typo" });
    expect(miss.code).toBe(1);
    expect(miss.err).toContain(`page "typo" not found in ${report}`);
    expect(miss.err).toContain("Available pages: report");

    const builtin = await show(root, [], { page: "typo" });
    expect(builtin.code).toBe(1);
    expect(builtin.err).toContain('page "typo" not found in the built-in report');
    expect(builtin.err).toContain("Available pages: report, attempts, traces");
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

// ───────────────────────── 证据切面:--source ─────────────────────────

describe("--source", () => {
  it("evalSource === null 时如实说源码未捕获", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-08T10-00-00-000Z",
      { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" },
      [res("weather/brooklyn", "failed", { assertions: [{ name: "succeeded()", severity: "gate", score: 0, outcome: "failed" as const }] })],
    );
    const { out, code } = await show(root, ["weather/brooklyn"], { source: true });
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
              outcome: "failed" as const,
              detail: "tool was never called",
              loc: { file: "evals/weather/brooklyn.eval.ts", line: 2 },
            },
            { name: "unlocated()", severity: "soft", score: 0.5, outcome: "failed" as const, detail: "no loc on this one" },
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

    const { out, code } = await show(root, ["weather/brooklyn"], { source: true });
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
      res("manager", "failed", { assertions: [{ name: "equals(4)", severity: "gate", score: 0, outcome: "failed" as const, expected: "4", received: "1", groupPath: ["Issue 15193"], loc: { file: "evals/manager.eval.ts", line: 1 } }] }),
    ]);
    const attemptDir = join(dir, "manager/a0");
    const content = "t.check(actual, equals(expected));\n";
    const sha = createHash("sha256").update(content).digest("hex");
    await writeFile(join(attemptDir, "sources.json"), JSON.stringify([{ path: "evals/manager.eval.ts", sha256: sha }]), "utf-8");
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources", `${sha}.json`), JSON.stringify({ content }), "utf-8");
    const { out } = await show(root, ["manager"], { source: true });
    expect(out).toContain("gate · Issue 15193 · equals(4) · expected 4 · received 1");
  });
});

// ───────────────────────── @<locator> ─────────────────────────

describe("show @<locator>", () => {
  it("默认页直接解释失败断言的 group、期望值、实际值和源码位置", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("manager", "failed", { assertions: [{ name: "equals(4)", severity: "gate", score: 0, outcome: "failed" as const, expected: "4", received: "1", groupPath: ["Issue 15193"], loc: { file: "evals/manager.eval.ts", line: 40, column: 11 } }] }),
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
          phase: "sandbox.create",
          cause: { name: "RateLimitError", message: "too many concurrent sandboxes" },
        },
        diagnostics: [
          { code: "teardown-failed", level: "warning", message: "container stop timed out", phase: "sandbox.teardown" },
        ],
      }),
    ]);
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const { out, code } = await show(root, [locator]);
    expect(code).toBe(0);
    expect(out).toContain(`${locator} · agent-029 · compare/claude-e2b · errored`);
    // 结构化 error 块:phase 直接展示闭集点分名,code/message/cause 各一行(见 docs/feature/reports/show.md)
    expect(out).toContain("error:");
    expect(out).toContain("phase: sandbox.create");
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
    expect(out).toContain(`available:\n  niceeval show ${locator} --source\n  niceeval show ${locator} --execution`);
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

  it("单独 --timing 进入完整时间树,不回落到 attempt 首页", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", {
        durationMs: 50_000,
        phases: [
          { name: "eval.run", durationMs: 42_000 },
          { name: "sandbox.stop", durationMs: 800 },
        ],
      }),
    ]);
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const { out, code } = await show(root, [locator], { timing: true });
    expect(code).toBe(0);
    expect(out).toContain("total 50.0s");
    expect(out).toContain("eval.run              42.0s");
    expect(out).toContain("teardown (not counted in total):");
    expect(out).toContain("sandbox.stop          800ms");
    expect(out).not.toContain("assertions:");
    expect(out).not.toContain("available:");
  });

  it("--timing 在 80 个 detail node 内与 full 等价，81 个开始原位省略", async () => {
    const root = await makeRoot();
    const children: TimingNode[] = Array.from({ length: 81 }, (_, index) => ({
      id: `command-${String(index).padStart(3, "0")}`,
      kind: "command",
      label: "tool",
      startOffsetMs: index * 10,
      durationMs: 81 - index,
      command: { display: `tool --item=${index}` },
    }));
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", {
        durationMs: 50_000,
        phases: [
          { name: "sandbox.create", durationMs: 1_000 },
          { name: "eval.run", durationMs: 42_000, children },
          { name: "sandbox.stop", durationMs: 800 },
        ],
      }),
    ]);
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const bounded = await show(root, [locator], { timing: "summary" });
    const full = await show(root, [locator], { timing: "full" });
    expect(bounded.out).toContain("sandbox.create");
    expect(bounded.out).toContain("eval.run");
    expect(bounded.out).toContain("sandbox.stop");
    expect(bounded.out).toMatch(/… 1 nodes omitted/);
    expect(bounded.out).toContain(`niceeval show ${locator} --timing=full`);
    expect(full.out).not.toContain("nodes omitted");
    expect(full.out).toContain("tool --item=0");
    expect(full.out).toContain("tool --item=80");

    // 去掉第 81 个后，默认投影不再省略，detail 行与 full 完全一致。
    children.pop();
    const root80 = await makeRoot();
    await writeSnapshot(root80, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", {
        durationMs: 50_000,
        phases: [{ name: "eval.run", durationMs: 42_000, children }],
      }),
    ]);
    const results80 = await openResults(root80);
    const locator80 = results80.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;
    const bounded80 = await show(root80, [locator80], { timing: "summary" });
    const full80 = await show(root80, [locator80], { timing: "full" });
    expect(bounded80.out).toBe(full80.out);
  });

  it("默认投影保留失败路径/慢点/首尾，omission 报失败数且不虚构 children 合计", async () => {
    const root = await makeRoot();
    const children: TimingNode[] = Array.from({ length: 120 }, (_, index) => ({
      id: `node-${String(index).padStart(3, "0")}`,
      kind: "provider",
      label: `provider-step-${index}`,
      startOffsetMs: index * 100,
      durationMs: index === 60 ? 99_000 : index + 1,
      ...(index === 55 ? { failed: true as const } : {}),
    }));
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "errored", {
        durationMs: 120_000,
        error: { code: "provider-failed", message: "boom", phase: "sandbox.create" },
        phases: [{ name: "sandbox.create", durationMs: 120_000, failed: true, children }],
      }),
    ]);
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;
    const { out } = await show(root, [locator], { timing: "summary" });

    expect(out).toContain("provider-step-0");
    expect(out).toContain("provider-step-55");
    expect(out).toContain("provider-step-60");
    expect(out).toContain("provider-step-119");
    expect(out).not.toContain("combined");
  });

  it("operation 使用 producer label；full 按 parentSpanId 展开唯一关联 OTel 树", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", {
        durationMs: 50_000,
        hasTrace: true,
        phases: [{
          name: "workspace.diff",
          durationMs: 5_000,
          children: [{
            id: "operation-1",
            kind: "operation",
            label: "export workspace diff · 1 window · 3,302 files",
            startOffsetMs: 100,
            durationMs: 4_000,
            children: [{
              id: "turn-1",
              kind: "turn",
              label: "s1/t1",
              startOffsetMs: 200,
              durationMs: 3_000,
              traceId: "trace-1",
            }],
          }],
        }],
      }),
    ]);
    const trace: TraceSpan[] = [
      { traceId: "trace-1", spanId: "child", parentSpanId: "root", name: "chat", kind: "model", startMs: 1_100, endMs: 2_000 },
      { traceId: "trace-1", spanId: "root", name: "codex.exec", kind: "agent", startMs: 1_000, endMs: 3_000 },
    ];
    await writeFile(join(dir, "weather/brooklyn/a0/trace.json"), JSON.stringify(trace), "utf-8");
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;
    const { out } = await show(root, [locator], { timing: "full" });

    expect(out).toContain("operation · export workspace diff · 1 window · 3,302 files");
    expect(out).toMatch(/agent · codex\.exec[\s\S]*model · chat/);
    expect(out).not.toContain("git show ×");
  });

  it("attempt 首页 timing 只列大头,但保留变慢的 telemetry 阶段", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", {
        durationMs: 100_000,
        hasEvents: true,
        phases: [
          { name: "sandbox.queue", durationMs: 0 },
          { name: "sandbox.create", durationMs: 3_000 },
          { name: "workspace.baseline", durationMs: 310 },
          { name: "telemetry.configure", durationMs: 358 },
          { name: "eval.run", durationMs: 45_000 },
          { name: "telemetry.collect", durationMs: 35_300 },
          { name: "sandbox.stop", durationMs: 8_500 },
        ],
      }),
    ]);
    await writeFile(
      join(dir, "weather/brooklyn/a0/events.json"),
      JSON.stringify([{ type: "message", role: "assistant", text: "done" }]),
      "utf-8",
    );
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const { out } = await show(root, [locator]);
    const timingLine = out.split("\n").find((line) => line.startsWith("timing:"));
    expect(out).toContain("1 AI message");
    expect(timingLine).toContain("sandbox.queue 0ms");
    expect(timingLine).toContain("sandbox.create 3.0s");
    expect(timingLine).toContain("eval.run 45.0s");
    expect(timingLine).toContain("telemetry.collect 35.3s");
    expect(timingLine).toContain("teardown +8.5s");
    expect(timingLine).not.toContain("workspace.baseline");
    expect(timingLine).not.toContain("telemetry.configure");
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
