// show / view 宿主等价契约(设计契约:plan/show-view-equivalence.md 完成定义;
// docs/feature/reports/architecture.md「Selection 是计算入口」;docs/feature/results/library.md「选择快照」)。
//
// 守护的不变量:同一结果根、同一组范围参数下,两扇门(niceeval show 的 text 面、
// niceeval view 的 web 面)的报告槽收到同一份现刻水位 Selection,并按同一公式算出同一批事实。
//
// 分三层验:
//  1. 结构化身份契约 —— 直接对两个宿主共同调用的选择入口 selectCurrentResults(results, scope)
//     断言归一化后的 Selection(experiment 集 / 每 experiment 的 eval 集 / 每 eval 的 attempt 原始身份
//     via AttemptRef.snapshot+attempt / warnings 的 kind + 结构字段)。这是最直接的契约对象:
//     两个宿主都调这一个函数、传同形状的 scope({ experiment, patterns }),它对了两扇门就对。
//  2. 宿主接线冒烟 —— 用真实 runShow(...) 与 loadViewScan(...) 跑同一 fixture + scope,断言两条
//     真实渲染路径反映同一批事实(同一 experiment / eval / 通过率 / 警告在/不在),证明两扇门确实
//     接在共享选择器上,而不是碰巧一致。轻断言渲染文案,不做整段 snapshot(排版差异是预期)。
//  3. 默认报告计算事实对照 —— 即使 Selection 相同,也要 text 面与 web 面算出同一通过率、同一警告
//     横幅在/不在,防止某一宿主在下游偷换公式或吞掉 warning。
//
// fixture 直接写新布局(<expDir>/<snapDir>/snapshot.json + <evalId>/a<n>/result.json),
// 依据 docs/feature/results/architecture.md 的稳定磁盘契约(与 show.test.ts / view/data.test.ts 同一写法)。

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openResults } from "./index.ts";
import type { Selection, SelectionWarning } from "./index.ts";
import { selectCurrentResults, type ResultScope } from "./select.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";
import { runShow, type ShowFlags } from "../show/index.ts";
import { loadViewScan, type ViewScanOptions } from "../view/data.ts";

// ───────────────────────── fixture 工具 ─────────────────────────

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-equiv-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

// 报告 chrome 跟随 CLI 界面语言(detectLocale);固定 en 让文案断言不随宿主机 LANG 漂移。
let langBackup: string | undefined;
beforeAll(() => {
  langBackup = process.env.NICEEVAL_LANG;
  process.env.NICEEVAL_LANG = "en";
});
afterAll(() => {
  if (langBackup === undefined) delete process.env.NICEEVAL_LANG;
  else process.env.NICEEVAL_LANG = langBackup;
});

type AttemptFixture = Pick<EvalResult, "id" | "verdict"> &
  Partial<Pick<EvalResult, "attempt" | "durationMs" | "assertions" | "estimatedCostUSD" | "usage" | "startedAt" | "artifactBase" | "hasEvents">>;

function res(id: string, verdict: Verdict, extra: Partial<AttemptFixture> = {}): AttemptFixture {
  return { id, verdict, attempt: 0, durationMs: 1000, assertions: [], ...extra };
}

/** 实验目录名清洗:与 docs/feature/results/architecture.md 一致(/ 与非 [\w.@-] 换成 _)。 */
function cleanDirName(id: string): string {
  return id.replace(/[^\w.@-]/g, "_");
}

interface SnapshotOpts {
  experimentId: string;
  agent?: string;
  model?: string;
  startedAt: string;
  /** 缺省 = 已收尾(completedAt = startedAt);置 true 则不写 completedAt,模拟中断快照。 */
  unfinished?: boolean;
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
    ...(opts.unfinished ? {} : { completedAt: opts.startedAt }),
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

// ───────────────────────── Selection 身份归一化 helper(测试专用) ─────────────────────────
//
// 生产逻辑保证的稳定顺序原样保留(evals 已按 id 排序、attempts 按 a<n> 读入顺序);helper 不再排序,
// 以免掩盖生产代码可能的不确定顺序。时间 / 成本 / verdict 保留真值;宿主机绝对路径(unfinished
// 警告的 dir、快照 dir)不进归一化结果 —— attempt 身份一律走 AttemptRef.snapshot + attempt(根相对)。

interface NormAttempt {
  snapshot: string;
  attempt: string;
  verdict: Verdict;
}
interface NormEval {
  evalId: string;
  attempts: NormAttempt[];
}
interface NormExperiment {
  experimentId: string;
  evals: NormEval[];
}
type NormWarning =
  | { kind: "partial-coverage"; experimentId: string; covered: number; total: number }
  | { kind: "stale-snapshot"; experimentId: string; startedAt: string; latestStartedAt: string }
  | { kind: "unfinished-snapshot"; experimentId: string; startedAt: string };
interface NormSelection {
  warnings: NormWarning[];
  experiments: NormExperiment[];
}

function normalizeWarning(w: SelectionWarning): NormWarning {
  switch (w.kind) {
    case "partial-coverage":
      return { kind: w.kind, experimentId: w.experimentId, covered: w.covered, total: w.total };
    case "stale-snapshot":
      return { kind: w.kind, experimentId: w.experimentId, startedAt: w.startedAt, latestStartedAt: w.latestStartedAt };
    case "unfinished-snapshot":
      // dir 是宿主机绝对路径,归一化掉;身份靠 experimentId + startedAt。
      return { kind: w.kind, experimentId: w.experimentId, startedAt: w.startedAt };
  }
}

function normalizeSelection(selection: Selection): NormSelection {
  return {
    warnings: selection.warnings.map(normalizeWarning),
    experiments: selection.snapshots.map((snapshot) => ({
      experimentId: snapshot.experimentId,
      evals: snapshot.evals.map((ev) => ({
        evalId: ev.id,
        attempts: ev.attempts.map((a) => ({
          snapshot: a.ref.snapshot,
          attempt: a.ref.attempt,
          verdict: a.result.verdict,
        })),
      })),
    })),
  };
}

// ───────────────────────── 宿主运行封装 ─────────────────────────

/** show 的 text 面:与 CLI 同一调用面(runShow),报告槽输出捕获成字符串。 */
async function showText(root: string, patterns: string[], flags: ShowFlags = {}): Promise<string> {
  let out = "";
  let err = "";
  const code = await runShow(root, patterns, { run: root, ...flags }, {
    out: (s) => (out += s),
    err: (s) => (err += s),
    width: 120,
    now: Date.parse("2026-07-09T10:01:00.000Z"),
  });
  if (code !== 0) throw new Error(`runShow exited ${code}: ${err}`);
  return out;
}

/** view 的 web 面:loadViewScan → 报告槽 HTML(en)。 */
async function viewHtml(root: string, opts: ViewScanOptions = {}): Promise<string> {
  const { reportHtml } = await loadViewScan(root, opts);
  return reportHtml.en;
}

/** 两个宿主构造给选择器的 scope 完全同形:验证读源无误,避免"我以为它们一样"。 */
function hostScope(patterns: string[], experiment?: string): ResultScope {
  return { experiment, patterns };
}

// ══════════════════════════════════════════════════════════════════════════
// 第 1 层:selectCurrentResults 结构化身份契约(11 必测场景中的选择器可判定部分)
// ══════════════════════════════════════════════════════════════════════════

describe("selectCurrentResults · 现刻水位结构化身份", () => {
  it("场景1 单 experiment / 单快照 / 单 attempt", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T00-00-00-000Z", { experimentId: "solo/bub", startedAt: "2026-07-01T00:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    const results = await openResults(root);
    expect(normalizeSelection(selectCurrentResults(results))).toEqual({
      warnings: [],
      experiments: [
        {
          experimentId: "solo/bub",
          evals: [{ evalId: "q1", attempts: [{ snapshot: "solo_bub/2026-07-01T00-00-00-000Z", attempt: "q1/a0", verdict: "passed" }] }],
        },
      ],
    } satisfies NormSelection);
  });

  it("场景2 全量快照后局部补跑一个 eval:q1 取周二、q2 从周一补齐,无伪残缺", async () => {
    const root = await seedPartialRerun();
    const results = await openResults(root);
    expect(normalizeSelection(selectCurrentResults(results))).toEqual({
      warnings: [],
      experiments: [
        {
          experimentId: "compare/bub",
          evals: [
            // q1 来自周二快照(局部补跑),q2 来自周一全量快照(补齐)—— 深链各指各的物理 run。
            { evalId: "q1", attempts: [{ snapshot: "compare_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "passed" }] },
            { evalId: "q2", attempts: [{ snapshot: "compare_bub/2026-07-01T08-00-00-000Z", attempt: "q2/a0", verdict: "failed" }] },
          ],
        },
      ],
    } satisfies NormSelection);
    // 对照:results.latest() 只挑周二快照,是残缺的(这正是宿主要合成现刻水位的原因)。
    expect(results.latest().warnings.some((w) => w.kind === "partial-coverage")).toBe(true);
  });

  it("场景3 同一 eval 多 attempts:最新快照整批替换旧 attempts,不跨快照混装", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "retry/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "passed", { attempt: 0 }),
    ]);
    await writeSnapshot(root, "2026-07-02T08-00-00-000Z", { experimentId: "retry/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
      res("q1", "failed", { attempt: 0 }),
      res("q1", "passed", { attempt: 1 }),
    ]);
    const results = await openResults(root);
    const norm = normalizeSelection(selectCurrentResults(results));
    // q1 整批取自周二(两个 attempt 都在周二快照),周一的那次 attempt 不掺进来。
    expect(norm.experiments[0].evals).toEqual([
      {
        evalId: "q1",
        attempts: [
          { snapshot: "retry_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "failed" },
          { snapshot: "retry_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a1", verdict: "passed" },
        ],
      },
    ] satisfies NormEval[]);
    expect(norm.warnings).toEqual([]);
  });

  it("场景4 多 experiment 更新时间不同:较早的实验触发 stale-snapshot", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    await writeSnapshot(root, "2026-07-03T08-00-00-000Z", { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-03T08:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    const results = await openResults(root);
    const norm = normalizeSelection(selectCurrentResults(results));
    expect(norm.warnings).toEqual([
      { kind: "stale-snapshot", experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z", latestStartedAt: "2026-07-03T08:00:00.000Z" },
    ] satisfies NormWarning[]);
    expect(norm.experiments.map((e) => e.experimentId)).toEqual(["compare/bub", "compare/codex"]);
  });

  it("场景5 未完成快照(无 completedAt):触发 unfinished-snapshot", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T00-00-00-000Z", { experimentId: "solo/bub", startedAt: "2026-07-01T00:00:00.000Z", unfinished: true }, [
      res("q1", "passed"),
    ]);
    const results = await openResults(root);
    expect(normalizeSelection(selectCurrentResults(results)).warnings).toEqual([
      { kind: "unfinished-snapshot", experimentId: "solo/bub", startedAt: "2026-07-01T00:00:00.000Z" },
    ] satisfies NormWarning[]);
  });

  it("场景6 历史已知 eval 从未有可读结果:触发真实 partial-coverage", async () => {
    const root = await makeRoot();
    // knownEvalIds 声明 q1 与 q2,但 q2 从未落盘 —— 跨快照补齐后仍缺,这是真残缺。
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z", knownEvalIds: ["q1", "q2"] },
      [res("q1", "passed")],
    );
    const results = await openResults(root);
    const norm = normalizeSelection(selectCurrentResults(results));
    expect(norm.experiments[0].evals.map((e) => e.evalId)).toEqual(["q1"]);
    expect(norm.warnings).toEqual([
      { kind: "partial-coverage", experimentId: "compare/bub", covered: 1, total: 2 },
    ] satisfies NormWarning[]);
  });

  it("场景7 eval id 前缀过滤:覆盖分母同步收窄到范围内", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      {
        experimentId: "compare/bub",
        startedAt: "2026-07-01T08:00:00.000Z",
        // 已知并集:weather 两题 + 一道范围外的 algebra。
        knownEvalIds: ["weather/brooklyn", "weather/queens", "algebra/quadratic"],
      },
      [res("weather/brooklyn", "passed"), res("algebra/quadratic", "passed")],
    );
    const results = await openResults(root);

    const weather = normalizeSelection(selectCurrentResults(results, hostScope(["weather"])));
    expect(weather.experiments[0].evals.map((e) => e.evalId)).toEqual(["weather/brooklyn"]);
    // 分母 = {weather/brooklyn, weather/queens} ∩ 范围 = 2,缺 queens → 1/2;algebra 的缺口不进来。
    expect(weather.warnings).toEqual([
      { kind: "partial-coverage", experimentId: "compare/bub", covered: 1, total: 2 },
    ] satisfies NormWarning[]);

    // algebra 范围:该题有结果,范围内无缺口 → 不刷 weather 的残缺屏。
    const algebra = normalizeSelection(selectCurrentResults(results, hostScope(["algebra"])));
    expect(algebra.warnings).toEqual([]);
  });

  it("场景8 --experiment 分段前缀过滤:只留匹配段,不误配同前缀实验", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [res("q1", "passed")]);
    await writeSnapshot(root, "2026-07-01T09-00-00-000Z", { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-01T09:00:00.000Z" }, [res("q1", "passed")]);
    await writeSnapshot(root, "2026-07-01T10-00-00-000Z", { experimentId: "solo/bub", startedAt: "2026-07-01T10:00:00.000Z" }, [res("q1", "passed")]);
    const results = await openResults(root);
    const norm = normalizeSelection(selectCurrentResults(results, hostScope([], "compare")));
    // "compare" 分段前缀匹配 compare/bub、compare/codex,不含 solo/bub。
    expect(norm.experiments.map((e) => e.experimentId)).toEqual(["compare/bub", "compare/codex"]);
  });

  it("场景9 --run 指向单个结果根:选择器只看该根的实验,不串到另一个根", async () => {
    const rootA = await makeRoot();
    const rootB = await makeRoot();
    // 失败 eval 让 id 现于两面(通过 eval 只进折叠子行,不便断言);qa / qb 各根独有。
    const boom = { assertions: [{ name: "succeeded()", severity: "gate" as const, score: 0, passed: false, detail: "boom" }] };
    await writeSnapshot(rootA, "2026-07-01T08-00-00-000Z", { experimentId: "onlyA/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [res("qa", "failed", boom)]);
    await writeSnapshot(rootB, "2026-07-02T08-00-00-000Z", { experimentId: "onlyB/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [res("qb", "failed", boom)]);
    const normB = normalizeSelection(selectCurrentResults(await openResults(rootB)));
    expect(normB.experiments.map((e) => e.experimentId)).toEqual(["onlyB/bub"]);
    // 宿主接线:show --run rootB / view rootB 只反映 rootB(qb 在、qa 不在)。
    const text = await showText(rootB, []);
    expect(text).toContain("qb");
    expect(text).not.toContain("qa");
    const html = await viewHtml(rootB);
    expect(html).toContain("qb");
    expect(html).not.toContain("qa");
  });

  it("场景11 resume 携带的复印件不重复计票,证据 ref 仍指向可读 artifact", async () => {
    const root = await makeRoot();
    // 周一原始:q1 通过,带 events artifact。
    const oldDir = await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "passed", { hasEvents: true }),
    ]);
    await writeFile(join(oldDir, "q1", "a0", "events.json"), "[]", "utf-8");
    // 周二 resume:q1 是复印件(startedAt 锚原快照,artifactBase 指原快照 artifact),q2 是新题。
    await writeSnapshot(root, "2026-07-02T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
      res("q1", "passed", { hasEvents: true, startedAt: "2026-07-01T08:00:00.000Z", artifactBase: "compare_bub/2026-07-01T08-00-00-000Z/q1/a0" }),
      res("q2", "passed"),
    ]);
    const results = await openResults(root);
    const selection = selectCurrentResults(results);
    const norm = normalizeSelection(selection);
    // q1 整批取自周二(含它的最新快照 = 复印件那份),只出现一次;不因为它也活在周一而计两票。
    expect(norm.experiments[0].evals).toEqual([
      { evalId: "q1", attempts: [{ snapshot: "compare_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "passed" }] },
      { evalId: "q2", attempts: [{ snapshot: "compare_bub/2026-07-02T08-00-00-000Z", attempt: "q2/a0", verdict: "passed" }] },
    ] satisfies NormEval[]);
    expect(norm.warnings).toEqual([]);
    // 证据 ref 可达:复印件的 artifactBase 回退到原快照,events.json 仍读得到(非 null)。
    const q1 = selection.snapshots[0].evals.find((e) => e.id === "q1")!;
    expect(await q1.attempts[0].events()).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 第 2 层:两个宿主接线同一选择器(真实 runShow / loadViewScan 反映同一批事实)
// ══════════════════════════════════════════════════════════════════════════

/** 周一全量(q1 通过、q2 失败)+ 周二只补跑 q1(仍通过):现刻水位 = q1 周二 + q2 周一,50%。 */
async function seedPartialRerun(): Promise<string> {
  const root = await makeRoot();
  await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
    res("q1", "passed"),
    res("q2", "failed", { assertions: [{ name: 'fileChanged("q2.tsx")', severity: "gate", score: 0, passed: false, detail: "file was not modified" }] }),
  ]);
  await writeSnapshot(root, "2026-07-02T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
    res("q1", "passed"),
  ]);
  return root;
}

/** partial-coverage:knownEvalIds 声明 q2 但从未落盘;q1 失败让失败 eval id 现于两面。 */
async function seedPartialCoverage(): Promise<string> {
  const root = await makeRoot();
  await writeSnapshot(
    root,
    "2026-07-01T08-00-00-000Z",
    { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z", knownEvalIds: ["q1", "q2"] },
    [res("q1", "failed", { assertions: [{ name: "succeeded()", severity: "gate", score: 0, passed: false, detail: "boom" }] })],
  );
  return root;
}

describe("宿主接线 · show text 面与 view web 面反映同一批事实", () => {
  it("局部补跑:两扇门都从周一补齐 q2,通过率 50%,不出伪残缺警告", async () => {
    const root = await seedPartialRerun();
    const text = await showText(root, []);
    const html = await viewHtml(root);
    for (const face of [text, html]) {
      expect(face).toContain("compare/bub");
      expect(face).toContain("q2"); // 周一补齐的失败 eval,若宿主回退 results.latest() 就会消失
      expect(face).toContain("50%"); // 1 过 1 败;回退到 latest 只剩周二 q1 → 会变 100%
    }
    // 现刻水位覆盖齐全 → 两面都不出 partial-coverage(text: "verdicts cover"; html: data-kind)。
    expect(hasPartialCoverageText(text)).toBe(false);
    expect(hasPartialCoverageHtml(html)).toBe(false);
    // 直接对照选择器口径:两个宿主传的 scope 同形,选择器给出的正是这份现刻水位。
    const norm = normalizeSelection(selectCurrentResults(await openResults(root), hostScope([])));
    expect(norm.experiments[0].evals.map((e) => e.evalId)).toEqual(["q1", "q2"]);
  });

  it("位置前缀收窄:两扇门都只见范围内的 eval,范围外一致排除", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("weather/brooklyn", "failed", { assertions: [{ name: "succeeded()", severity: "gate", score: 0, passed: false, detail: "boom" }] }),
      res("weather/queens", "passed"),
      res("algebra/quadratic", "passed"),
    ]);
    // "weather" 前缀匹配 2 题 → show 仍走报告槽(非单 eval 详情)。
    const text = await showText(root, ["weather"]);
    const html = await viewHtml(root, { patterns: ["weather"] });
    for (const face of [text, html]) {
      expect(face).toContain("weather/brooklyn"); // 范围内失败 eval 现身两面
      expect(face).not.toContain("algebra"); // 范围外一致排除
    }
  });

  it("--report 收到与裸默认报告相同的 Selection(eval 集一致)", async () => {
    const root = await seedPartialRerun();
    // 回显报告:把注入 Selection 的 eval id 集打印出来 —— 与裸默认报告用同一份 Selection 才对得上。
    const reportPath = join(root, "echo-report.mjs");
    await writeFile(
      reportPath,
      [
        'const FACES = Symbol.for("niceeval.report.faces");',
        "const Echo = (props) => Echo[FACES].web(props);",
        "Echo[FACES] = {",
        '  web: (props) => "EVALS[" + props.ids + "]",',
        '  text: (props) => "EVALS[" + props.ids + "]",',
        "};",
        "export default {",
        '  [Symbol.for("niceeval.report.definition")]: true,',
        "  build: (ctx) => ({",
        '    $$typeof: Symbol.for("react.transitional.element"),',
        "    type: Echo,",
        '    props: { ids: ctx.selection.snapshots.flatMap((s) => s.evals.map((e) => e.id)).sort().join(",") },',
        "    key: null,",
        "  }),",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );
    const bareNorm = normalizeSelection(selectCurrentResults(await openResults(root)));
    const expectedIds = bareNorm.experiments.flatMap((e) => e.evals.map((ev) => ev.evalId)).sort().join(",");

    const text = await showText(root, [], { report: reportPath });
    const html = await viewHtml(root, { report: { path: reportPath, cwd: root } });
    expect(text).toContain(`EVALS[${expectedIds}]`);
    expect(html).toContain(`EVALS[${expectedIds}]`);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 第 3 层:默认报告计算事实对照(通过率 / 警告横幅 在 text 面与 web 面口径一致)
// ══════════════════════════════════════════════════════════════════════════

/** partial-coverage 的 text 形态(report.ts 的 "! <message>" 前置块,message 含 "verdicts cover N of M")。 */
function hasPartialCoverageText(text: string): boolean {
  return /verdicts cover \d+ of \d+ evals/.test(text);
}
/** partial-coverage 的 web 形态(web.ts 的 li.nre-warning[data-kind="partial-coverage"])。 */
function hasPartialCoverageHtml(html: string): boolean {
  return html.includes('data-kind="partial-coverage"');
}

describe("默认报告计算事实对照 · text 面与 web 面同口径", () => {
  it("通过率一致:同一 fixture 两面算出同一个 experiment 通过率", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "failed", { durationMs: 40_000, estimatedCostUSD: 0.04, assertions: [{ name: "succeeded()", severity: "gate", score: 0, passed: false, detail: "boom" }] }),
      res("q2", "passed", { durationMs: 2_000, estimatedCostUSD: 0.02 }),
      res("q3", "passed", { durationMs: 2_000, estimatedCostUSD: 0.02 }),
      res("q4", "passed", { durationMs: 2_000, estimatedCostUSD: 0.02 }),
    ]);
    const text = await showText(root, []);
    const html = await viewHtml(root);
    // 1 败 3 过 = 75%;通过率 display 是单串,两面渲染同一份 MetricCell.display。
    for (const face of [text, html]) {
      expect(face).toContain("75%");
      expect(face).toContain("compare/bub");
    }
    // 无残缺:两面都不出 partial-coverage,布尔一致(某面偷偷补/漏警告即失配)。
    expect(hasPartialCoverageText(text)).toBe(hasPartialCoverageHtml(html));
    expect(hasPartialCoverageText(text)).toBe(false);
  });

  it("警告横幅一致:真实 partial-coverage 在两面同时在场(布尔对照)", async () => {
    const root = await seedPartialCoverage();
    const text = await showText(root, []);
    const html = await viewHtml(root);
    // 两面都必须报出真残缺;某一宿主吞掉 warning → 下面这条布尔对照失配。
    expect(hasPartialCoverageText(text)).toBe(true);
    expect(hasPartialCoverageHtml(html)).toBe(true);
    expect(hasPartialCoverageText(text)).toBe(hasPartialCoverageHtml(html));
    // 且 message 里的分子/分母(1 of 2)两面一致 —— 同一 SelectionWarning.message。
    expect(text).toContain("verdicts cover 1 of 2 evals");
    expect(html).toContain("verdicts cover 1 of 2 evals");
  });
});
