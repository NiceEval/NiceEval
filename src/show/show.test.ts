// cases: docs/engineering/testing/unit/reports.md
// niceeval show 终端宿主的选择与错误反馈(「show 终端宿主的选择、时间轴与文案」类别)。渲染产物——
// 榜单/详情/证据切面的终端排版与结构——归 docs/engineering/testing/e2e/report.md §4/§5 对真实
// 运行产物验收,不在本文件重复。覆盖:
// - --history 时间轴计算(attemptHistory):按 experimentId + evalId 分节、跨快照按身份键去重
//   (resume 携带的复印件不占行)、startedAt 升序、单行摘要与成本派生;
// - eval id 前缀无匹配、--history/--report/--page 的互斥与用法冲突、@<locator> 语法错误与
//   索引未命中、证据切面撞多个 eval 时的紧凑索引——全部以 CLI 抛出的错误对象/文案为断言面;
// - --report 装载校验(非法默认导出、文件缺失、页未命中、缺 attempt-input page)的错误反馈。
//
// 跨快照合成 Selection 与去重的结构化语义(selectCurrentResults/现刻水位)已在
// src/results/host-equivalence.test.ts 直接对 Selection 对象断言,不在本文件重复覆盖。
//
// fixture 直接写新布局(<expDir>/<snapDir>/snapshot.json + <evalId>/a<n>/result.json),
// 依据是 docs/feature/results/architecture.md 的稳定磁盘契约,不经 writer 运行时 API(避免与并行重写的
// niceeval/results 写入面签名耦合)。

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openResults } from "../results/index.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";
import { attemptHistory } from "./compose.ts";
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

// show 的报告 chrome 跟随 CLI 界面语言(detectLocale);本文件的断言按英文写,
// 固定 en 让用例不随宿主机 LANG 漂移。
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
  Partial<Pick<EvalResult, "attempt" | "durationMs" | "assertions" | "estimatedCostUSD" | "startedAt" | "artifactBase">>;

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
  /**
   * 不经 niceeval 包也能造出合法报告:判别锚在 Symbol.for 上
   * (docs/feature/reports/library/shell.md「defineReport 产物」)。只用来触发装载路径上的
   * 校验分支,不需要真正渲染出可读内容。
   */
  async function writeReportFile(dir: string): Promise<string> {
    const path = join(dir, "report.mjs");
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
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const { err, code } = await show(root, [locator], { report });
    expect(code).toBe(1);
    expect(err).toContain(report);
    expect(err).toContain("has no attempt-input page");
    expect(err).toContain("extends: standard");
    expect(err).toContain("standardAttemptPage");
    expect(err).toContain('input: "attempt"');
    // 不静默回退渲染内建 standard 的详情页(那会让用户以为自定义报告本来就有这页)
    expect(err).not.toContain("Eval Results");
  });
});

// ───────────────────────── 证据切面:撞多个 eval 时的紧凑索引 ─────────────────────────

describe("证据切面:多 eval 匹配", () => {
  it("多个 eval 匹配时证据切面报错:给紧凑索引(locator + 失败原因)而不是只报个数", async () => {
    const root = await seedComposedRoot();
    const { err, code } = await show(root, [], { execution: true });
    expect(code).toBe(1);
    expect(err).toContain("matched 2 evals");
    expect(err).toMatch(/✗ fixtures\/button\s+@1[0-9a-z]{7}/);
    expect(err).toContain('gate fileChanged("src/components/Button.tsx")');
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
    const results = await openResults(root);
    const locator = results.experiments[0]!.latest.evals[0]!.attempts[0]!.locator!;

    const { err, code } = await show(root, [locator, "weather/brooklyn"]);
    expect(code).toBe(1);
    expect(err).toContain("must be the only positional argument");
  });
});
