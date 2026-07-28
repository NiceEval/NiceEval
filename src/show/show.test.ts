// cases: docs/engineering/testing/unit/reports.md
// niceeval show 终端宿主的选择与错误反馈(「show 终端宿主的选择、时间轴与文案」与
// 「show 的范围 × 切片正交」两个类别)。渲染产物——默认报告/详情/证据切面的终端排版与结构——归
// docs/engineering/testing/e2e/report.md §4/§5 对真实运行产物验收,不在本文件重复。覆盖:
// - --history 时间轴计算(attemptHistory):按 experimentId + evalId 分节、跨快照按身份键去重
//   (resume 携带的复印件不占行)、startedAt 升序、单行摘要与成本派生;
// - eval id 前缀无匹配、--history/--report/--page 的互斥与用法冲突、@<locator> 语法错误与
//   索引未命中——全部以 CLI 抛出的错误对象/文案为断言面;
// - --report 装载校验(非法默认导出、文件缺失、页未命中、缺 attempt-input page)的错误反馈;
// - 证据切面(--source/--execution/--timing/--diff)接受任意范围:命中多个 eval 时逐 attempt
//   分节,不再是「撞多个 eval 就报错」;单元素范围(@<locator>)与范围通用实现
//   (renderEvidenceSections)是同一条代码路径,不是两份实现;
// - 多 `--exp` 的范围校验(每个必须恰好解析到一个 experiment、命中多个按用法错误列出候选)、
//   `@<locator>` 与重复 `--exp` 互斥、缺省切片对照矩阵的占位接线点(renderCompareSlice)错误
//   反馈;eval id 前缀命中单个 eval 时并入范围收窄后的默认报告,不再有独立的单 eval 详情分支。
//
// 跨快照合成 Selection 与去重的结构化语义(currentSample/现刻水位)已在
// src/record/host-equivalence.test.ts 直接对 Selection 对象断言,不在本文件重复覆盖。
//
// fixture 直接写新布局(<expDir>/<snapDir>/run.json + <evalId>/a<n>/result.json),
// 依据是 docs/feature/record/architecture.md 的稳定磁盘契约,不经 writer 运行时 API(避免与并行重写的
// niceeval/record 写入面签名耦合)。

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRecord } from "../record/index.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION, type EvalResult, type StreamEvent, type Verdict } from "../types.ts";
import { attemptHistory } from "./compose.ts";
import { runShow, type ShowFlags } from "./index.ts";
import { setConfiguredLocale } from "../i18n/index.ts";

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
// 固定 en 让用例不随宿主机 LANG 漂移。
beforeAll(() => {
  setConfiguredLocale("en");
});
afterAll(() => {
  setConfiguredLocale(undefined);
});

/** 一条 attempt 的最小 fixture;字段照 docs/feature/record/architecture.md 的 AttemptRecord。 */
type AttemptFixture = Pick<EvalResult, "id" | "verdict"> &
  Partial<
    Pick<
      EvalResult,
      "attempt" | "durationMs" | "assertions" | "estimatedCostUSD" | "startedAt" | "artifactBase" | "usage" | "facts"
    >
  >;

function res(id: string, verdict: Verdict, extra: Partial<AttemptFixture> = {}): AttemptFixture {
  return { id, verdict, attempt: 0, durationMs: 1000, assertions: [], ...extra };
}

/** 实验目录名的清洗:与 docs/feature/record/architecture.md 一致(/ 与非 [\w.@-] 换成 _)。 */
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
  configHash?: string;
}

/** 写一份新布局快照:run.json + 各 attempt 的 result.json。返回快照目录绝对路径。 */
async function writeSnapshot(
  root: string,
  snapDirName: string,
  opts: SnapshotOpts,
  results: AttemptFixture[],
): Promise<string> {
  const dir = join(root, cleanDirName(opts.experimentId), snapDirName);
  await mkdir(dir, { recursive: true });
  const meta = {
    format: RECORD_FORMAT,
    schemaVersion: RECORD_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.4.6" },
    runId: `${snapDirName}-0000-4000-8000-000000000000`,
    experimentId: opts.experimentId,
    agent: opts.agent ?? "bub",
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    startedAt: opts.startedAt,
    configHash: opts.configHash ?? "fixture-config",
    completedAt: opts.completedAt ?? opts.startedAt,
    ...(opts.knownEvalIds ? { knownEvalIds: opts.knownEvalIds } : {}),
  };
  await writeFile(join(dir, "run.json"), JSON.stringify(meta, null, 2), "utf-8");
  for (const r of results) {
    const attemptDir = join(dir, r.id, `a${r.attempt ?? 0}`);
    await mkdir(attemptDir, { recursive: true });
    await writeFile(join(attemptDir, "result.json"), JSON.stringify(r, null, 2), "utf-8");
  }
  return dir;
}

/** 补写一个 attempt 的 events.json(--execution/--grep/--expand fixture 用);attempt 目录已由 writeSnapshot 建好。 */
async function writeEvents(
  root: string,
  experimentId: string,
  snapDirName: string,
  evalId: string,
  attempt: number,
  events: StreamEvent[],
): Promise<void> {
  const dir = join(root, cleanDirName(experimentId), snapDirName, evalId, `a${attempt}`);
  await writeFile(join(dir, "events.json"), JSON.stringify(events), "utf-8");
}

/** 两个事件的最小 turn:一句用户消息 + 一次工具调用,`tag` 进 query 里方便 --grep 区分。 */
function toolCallEvents(tag: string): StreamEvent[] {
  return [
    { type: "message", role: "user", text: `do the ${tag} thing` },
    { type: "message", role: "assistant", text: "on it" },
    { type: "action.called", callId: "c1", name: "memory_search", input: { query: tag } },
    { type: "action.result", callId: "c1", output: { total: 1 }, status: "completed" },
  ];
}

/**
 * 不经 niceeval 包也能造出合法报告:判别锚在 Symbol.for 上
 * (docs/feature/reports/library/shell.md「defineReport 产物」)。只用来触发装载路径上的
 * 校验分支、或在不依赖内建报告(dist/report/built-in,由并行节点在改的 report 组件树间接
 * 拉入,可能处于不可编译的中间状态)的前提下证明「确实走进了报告槽」,不需要真正渲染出
 * 可读内容。
 */
async function writeMinimalReport(dir: string, filename = "report.mjs"): Promise<string> {
  const path = join(dir, filename);
  await writeFile(
    path,
    [
      'const FACES = Symbol.for("niceeval.report.faces");',
      'const DEFINITION = Symbol.for("niceeval.report.definition");',
      "const Custom = () => null;",
      "Custom[FACES] = { web: () => null, text: () => \"CUSTOM\" };",
      "const definition = {",
      '  kind: "report",',
      "  links: [],",
      "  scripts: [],",
      "  styles: [],",
      '  pages: [{ id: "report", title: "Report", input: "scope", navigation: true, content: { type: Custom, props: {} } }],',
      "};",
      "Object.defineProperty(definition, DEFINITION, { value: true });",
      "export default definition;",
      "",
    ].join("\n"),
    "utf-8",
  );
  return path;
}

interface Captured {
  out: string;
  err: string;
  code: number;
}

async function show(root: string, patterns: string[], flags: ShowFlags = {}, width = 100): Promise<Captured> {
  let out = "";
  let err = "";
  const code = await runShow(root, patterns, { record: root, ...flags }, {
    out: (s) => (out += s),
    err: (s) => (err += s),
    width,
    now: Date.parse("2026-07-09T10:01:00.000Z"),
  });
  return { out, err, code };
}

/** 两个快照:老快照全量(a ✓ b ✓),新快照只重跑 b(✗)—— 用来触发错误反馈路径的通用底座。 */
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

// ───────────────────────── 位置前缀收窄:无匹配错误反馈 ─────────────────────────

describe("位置前缀收窄", () => {
  it("前缀匹配不到任何结果:直说 + 列出有结果的 eval", async () => {
    const root = await seedComposedRoot();
    const { err, code } = await show(root, ["nosuch"]);
    expect(code).toBe(1);
    expect(err).toContain("No results matched: nosuch");
    expect(err).toContain("weather/brooklyn");
  });
});

// ───────────────────────── --history:时间轴计算与用法冲突 ─────────────────────────

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

  it("attemptHistory:复印件按身份键去重不占行,startedAt 升序,行带摘要 / 成本 / locator", async () => {
    const root = await seedHistoryRoot();
    const results = await openRecord(root);
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
  });

  it("--history 与 --page 组合是用法矛盾:直说", async () => {
    const root = await seedHistoryRoot();
    const { err, code } = await show(root, [], { history: true, page: "report" });
    expect(code).toBe(1);
    expect(err).toContain("--page");
  });
});

// ───────────────────────── --report 装载:错误反馈与用法校验 ─────────────────────────

describe("--report 装载", () => {
  const writeReportFile = writeMinimalReport;

  /** 只有一张 scope-input page,没有声明 attempt-input page。 */
  async function writeReportFileNoAttemptPage(dir: string): Promise<string> {
    const path = join(dir, "no-attempt-page.mjs");
    await writeFile(
      path,
      [
        'const FACES = Symbol.for("niceeval.report.faces");',
        'const DEFINITION = Symbol.for("niceeval.report.definition");',
        "const Overview = () => null;",
        "Overview[FACES] = { web: () => null, text: () => \"OVERVIEW\" };",
        "const definition = {",
        '  kind: "report",',
        "  links: [],",
        "  scripts: [],",
        "  styles: [],",
        '  pages: [{ id: "report", title: "Report", input: "scope", navigation: true, content: { type: Overview, props: {} } }],',
        "};",
        "Object.defineProperty(definition, DEFINITION, { value: true });",
        "export default definition;",
        "",
      ].join("\n"),
      "utf-8",
    );
    return path;
  }

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

  it("自定义报告没有 attempt-input page 时,裸 show @<locator> --report <file> 报完整用户反馈,指引三种解决路径,不回退到内建详情", async () => {
    const root = await seedComposedRoot();
    const report = await writeReportFileNoAttemptPage(root);
    const results = await openRecord(root);
    const locator = results.experiments[0]!.latestRun.evals[0]!.attempts[0]!.locator!;

    const { err, code } = await show(root, [locator], { report });
    expect(code).toBe(1);
    expect(err).toContain(report);
    expect(err).toContain("has no attempt-input page");
    expect(err).toContain("extends: standard");
    expect(err).toContain("standardAttemptPage");
    expect(err).toContain('input: "attempt"');
    // 不静默回退渲染内建 standard 的详情页(那会让用户以为自定义报告本来就有这页)
    expect(err).not.toContain("Eval Record");
  });
});

// ───────────────────────── 证据切面:接受任意范围,逐 attempt 分节 ─────────────────────────
// cases: docs/engineering/testing/unit/reports.md「show 的范围 × 切片正交」——
// 切片(source/execution/timing/diff)接受任意范围;单 locator 是单元素范围的特例,不走
// 第二条代码路径。

describe("证据切面:范围 × 分节", () => {
  it("命中多个 eval 时不再报错,按 experimentId、evalId 逐 attempt 分节,节头带 locator/evalId/experimentId/verdict", async () => {
    const root = await seedComposedRoot();
    const { out, code } = await show(root, [], { execution: true });
    expect(code).toBe(0);
    // evalId 字典序:fixtures/button < weather/brooklyn,分节顺序随之。
    const fixturesAt = out.indexOf("fixtures/button");
    const weatherAt = out.indexOf("weather/brooklyn");
    expect(fixturesAt).toBeGreaterThan(-1);
    expect(weatherAt).toBeGreaterThan(fixturesAt);
    expect(out).toMatch(/@\S+ · fixtures\/button · compare\/bub · failed/);
    expect(out).toMatch(/@\S+ · weather\/brooklyn · compare\/bub · passed/);
  });

  it("单元素范围(eval 前缀收窄到一个 eval)与多 attempt 范围里对应那一节字节相同——同一份 renderEvidenceSections,不是「locator 专属」再实现一遍", async () => {
    const root = await seedComposedRoot();
    const single = await show(root, ["weather/brooklyn"], { execution: true });
    expect(single.code).toBe(0);
    const multi = await show(root, [], { execution: true });
    expect(multi.code).toBe(0);
    // single 输出只有末尾一个换行(renderEvidenceSections 的返回值 + "\n"),去掉它应该整段
    // 原样出现在 multi 输出里(multi 只是把它和另一个 eval 的同款分节用 "\n\n" 接起来)。
    expect(multi.out).toContain(single.out.replace(/\n$/, ""));
  });

  it("@<locator> 单 attempt 范围只是省掉分节,内容与范围通用实现完全一致", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const results = await openRecord(root);
    const locator = results.experiments[0]!.latestRun.evals[0]!.attempts[0]!.locator!;
    const byLocator = await show(root, [locator], { execution: true });
    const byPrefix = await show(root, ["weather/brooklyn"], { execution: true });
    expect(byLocator.code).toBe(0);
    expect(byLocator.out).toBe(byPrefix.out);
  });
});

// ───────────────────────── show @<locator>:语法与索引错误 ─────────────────────────

describe("show @<locator>", () => {
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
    const results = await openRecord(root);
    const locator = results.experiments[0]!.latestRun.evals[0]!.attempts[0]!.locator!;

    const { err, code } = await show(root, [locator, "weather/brooklyn"]);
    expect(code).toBe(1);
    expect(err).toContain("must be the only positional argument");
  });
});

// ───────────────────────── 多 --exp:范围校验、互斥与对照矩阵 ─────────────────────────
// cases: docs/engineering/testing/unit/reports.md「show 的范围 × 切片正交」——
// docs/feature/reports/show.md「选择结果范围」:0/1 个 --exp 沿用前缀收窄;2 个以上进入对照
// 语义,每个必须恰好解析到一个 experiment,命中多个按用法错误列出候选;`@<locator>` 与重复
// `--exp` 互斥。合法范围最终怎样呈现由 Report E2E 从公开 CLI 验收。

describe("多 --exp:范围校验与用法冲突", () => {
  async function seedTwoExperimentsRoot(): Promise<string> {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub-baseline", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub-mempal", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    return root;
  }

  it("单个 --exp 沿用前缀收窄,目录前缀命中多个 experiment 不是错误(与对照语义的「必须恰好一个」不同规则)", async () => {
    const root = await seedTwoExperimentsRoot();
    // 用最小自定义报告渲染,不依赖内建报告(dist/report/built-in 由并行节点在改,可能处于不可
    // 编译的中间状态);这里只关心「单个 --exp 目录前缀不触发范围校验错误」,不关心报告内容。
    const report = await writeMinimalReport(root);
    const { err, code } = await show(root, [], { experiment: ["compare"], report });
    expect(code).toBe(0);
    expect(err).toBe("");
  });

  it("对照语义(--exp 出现两次以上)下,某个 --exp 前缀命中多个 experiment 时按用法错误退出,列出全部候选 id", async () => {
    const root = await seedTwoExperimentsRoot();
    const { err, code } = await show(root, [], { experiment: ["compare", "compare/bub-mempal"] });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("fix:");
    expect(err).toContain("--exp compare matched 2 experiments");
    expect(err).toContain("compare/bub-baseline");
    expect(err).toContain("compare/bub-mempal");
  });

  it("对照语义下,某个 --exp 一个都命不中时按现有 noExperimentMatch 报错", async () => {
    const root = await seedTwoExperimentsRoot();
    const { err, code } = await show(root, [], { experiment: ["compare/bub-baseline", "nosuch"] });
    expect(code).toBe(1);
    expect(err).toContain("No experiment matched --exp nosuch");
  });

  it("--exp >= 2 与 --report 组合时不进对照占位,照常渲染自定义报告(对照与 --report 互斥,--report 接管缺省切片)", async () => {
    const root = await seedTwoExperimentsRoot();
    const report = await writeMinimalReport(root);
    const { err, code } = await show(root, [], { experiment: ["compare/bub-baseline", "compare/bub-mempal"], report });
    expect(code).toBe(0);
    expect(err).toBe("");
  });

  it("@<locator> 与重复 --exp 互斥:先于任何 IO 报错,不去读结果根", async () => {
    const root = await seedTwoExperimentsRoot();
    const results = await openRecord(root);
    const locator = results.experiments[0]!.latestRun.evals[0]!.attempts[0]!.locator!;
    const { err, code } = await show(root, [locator], { experiment: ["compare/bub-baseline", "compare/bub-mempal"] });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("fix:");
    expect(err).toContain(locator);
    expect(err).toContain("cannot combine with repeated --exp");
  });

  it("locator 与单个 --exp 不互斥(只有重复 --exp 才冲突)", async () => {
    const root = await seedTwoExperimentsRoot();
    const results = await openRecord(root);
    const locator = results.experiments[0]!.latestRun.evals[0]!.attempts[0]!.locator!;
    // 无证据 flag 的 @<locator> 走 attempt-input page(内建 standard),同样间接依赖
    // dist/report/built-in;带一个证据 flag 绕开报告槽,只验证 mutex 没有误伤单个 --exp。
    const { code } = await show(root, [locator], { experiment: ["compare/bub-baseline"], execution: true });
    expect(code).toBe(0);
  });
});

// ───────────────────────── --stats:稳定性矩阵 ─────────────────────────
// cases: docs/engineering/testing/unit/reports.md「show 的范围 × 切片正交」——`--stats` 与
// `@<locator>`/`--report` 的用法冲突;深层聚合判据(failed/errored 分列、unreadable 不计、
// neverPassed……)的断言面是 stabilityMatrixData 本身(见
// src/report/components/metric-views/stability-matrix.test.ts)；可见头行与矩阵由 Report E2E
// 验收，这里只保留公开 flag 的组合校验。

describe("--stats", () => {
  /** 同一 (experiment, eval) 两次历史执行,先 failed 后 errored——分列不合并的最小判据。 */
  async function seedStatsRoot(): Promise<string> {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T00-00-00-000Z", { experimentId: "compare/base", startedAt: "2026-07-01T00:00:00.000Z" }, [
      res("weather/brooklyn", "failed"),
    ]);
    await writeSnapshot(root, "2026-07-08T00-00-00-000Z", { experimentId: "compare/base", startedAt: "2026-07-08T00:00:00.000Z" }, [
      res("weather/brooklyn", "errored"),
    ]);
    return root;
  }

  it("与 @<locator> 互斥:单 attempt 没有稳定性可言", async () => {
    const root = await seedStatsRoot();
    const results = await openRecord(root);
    const locator = results.experiments[0]!.latestRun.evals[0]!.attempts[0]!.locator!;
    const { err, code } = await show(root, [locator], { stats: true });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("fix:");
    expect(err).toContain("--stats cannot combine with a locator");
  });

  it("与 --report 互斥:零配置装配不经用户显式报告树", async () => {
    const root = await seedStatsRoot();
    const report = await writeMinimalReport(root);
    const { err, code } = await show(root, [], { stats: true, report });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("fix:");
    expect(err).toContain("--stats cannot combine with --report");
  });

  it("与 --stats/--usage/--history 同一档:与 --page 组合是用法矛盾", async () => {
    const root = await seedStatsRoot();
    const { err, code } = await show(root, [], { stats: true, page: "report" });
    expect(code).toBe(1);
    expect(err).toContain("--stats");
  });
});

// ───────────────────────── --usage 对照矩阵(--exp 出现两次以上) ─────────────────────────
// cases: docs/engineering/testing/unit/reports.md「show 的范围 × 切片正交」——对照范围下
// text 面的矩阵呈现归 Report E2E；这里只证明 `--json` 在对照范围下仍返回同一份
// usageTableData 行数组，不泄漏 text-only 的矩阵形状。

describe("--usage 对照矩阵(重复 --exp)", () => {
  async function seedUsageCompareRoot(): Promise<string> {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/usage-a", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", { estimatedCostUSD: 0.05, usage: { inputTokens: 100, outputTokens: 20, requests: 3 } }),
      res("weather/queens", "passed", { estimatedCostUSD: 0.02, usage: { inputTokens: 40, outputTokens: 8, requests: 1 } }),
    ]);
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "compare/usage-b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", { estimatedCostUSD: 0.09, usage: { inputTokens: 300, outputTokens: 60, requests: 7 } }),
    ]);
    return root;
  }

  it("--json 不受对照范围影响:恒为 usageTableData 行数组,不输出矩阵形状", async () => {
    const root = await seedUsageCompareRoot();
    const { out, code } = await show(root, [], { experiment: ["compare/usage-a", "compare/usage-b"], usage: true, json: true });
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.view).toBe("usage");
    expect(Array.isArray(doc.data)).toBe(true);
    expect(doc.data).toHaveLength(3);
    expect(doc.data.map((r: { evalId: string }) => r.evalId).sort()).toEqual(["weather/brooklyn", "weather/brooklyn", "weather/queens"]);
  });
});

// ───────────────────────── --grep / --expand:show 层接线 ─────────────────────────
// cases: docs/engineering/testing/unit/reports.md「execution 的预算、句柄与 grep」——卡片
// 预算 / 句柄派生 / 匹配面本身的判据断言面是 executionText(见 src/show/render.test.ts,并行
// render 节点已覆盖)；可见卡片与命中汇总由 Report E2E 验收，这里只证明 show 层的组合
// 校验(互斥、只与 --execution 组合、--expand 要求单 attempt)和错误反馈。

describe("--grep / --expand", () => {
  async function seedTwoAttemptEventsRoot(): Promise<string> {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "memory/claude", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("memory/alpha", "passed"),
      res("memory/beta", "passed"),
    ]);
    await writeEvents(root, "memory/claude", "2026-07-08T10-00-00-000Z", "memory/alpha", 0, toolCallEvents("alpha"));
    await writeEvents(root, "memory/claude", "2026-07-08T10-00-00-000Z", "memory/beta", 0, toolCallEvents("beta"));
    return root;
  }

  it("--grep pattern 不是合法 JS 正则:直说语法问题", async () => {
    const root = await seedTwoAttemptEventsRoot();
    const { err, code } = await show(root, [], { execution: true, grep: "(unclosed" });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("fix:");
    expect(err).toContain("not a valid JS regular expression");
  });

  it("--grep 只与 --execution 组合:出现在其它切片上按用法错误退出", async () => {
    const root = await seedTwoAttemptEventsRoot();
    const { err, code } = await show(root, [], { grep: "x" });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("--grep only combines with --execution");
  });

  it("--grep 与 --expand 互斥", async () => {
    const root = await seedTwoAttemptEventsRoot();
    const { err, code } = await show(root, [], { execution: true, grep: "x", expand: "t1.c1" });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("cannot combine");
  });

  it("--expand 要求范围恰好一个 attempt", async () => {
    const root = await seedTwoAttemptEventsRoot();
    const { err, code } = await show(root, [], { execution: true, expand: "t1.c1" });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("fix:");
    expect(err).toContain("resolve to exactly one attempt, got 2");
  });

  it("--expand 句柄未命中:裸 Error 被套成 error:/fix: 三段式,带真实 turn 数", async () => {
    const root = await seedTwoAttemptEventsRoot();
    const { err, code } = await show(root, ["memory/alpha"], { execution: true, expand: "t9.c1" });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("fix:");
    expect(err).toContain("this attempt has 1 turn");
  });
});
