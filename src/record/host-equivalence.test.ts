// @ts-nocheck
// cases: docs/engineering/testing/unit/record.md
// show / view 两宿主的 Sample 选择等价契约(docs/feature/record/architecture.md「Selection 是计算入口」;
// docs/feature/record/library.md「选择快照」)。
//
// 守护的不变量:同一结果根、同一组范围参数下,两扇门(niceeval show 的 text 面、niceeval view 的
// web 面)传给 currentSample(results, scope) 同形的 scope({ experiment, patterns }),必须
// 算出同一份现刻水位 Selection —— 归一化后的 experiment 集 / 每 experiment 的 eval 集 / 每 eval 的
// attempt 原始身份(经 AttemptRef.run + attempt)/ issues 的 kind 与结构字段全部深等。
//
// 这是最直接的契约对象:两个宿主都调这一个函数、传同形状的 scope,它对了两扇门就对——不需要真的
// 起 show / view 两条渲染路径去比较文案。渲染出的终端文案与 HTML 不在本层断言,归
// docs/engineering/testing/e2e/report.md 的读面 CLI 行为(§4)与渲染面(§5)验收。
//
// fixture 直接写新布局(<expDir>/<snapDir>/run.json + <evalId>/a<n>/result.json),
// 依据 docs/feature/record/architecture.md 的稳定磁盘契约(与 show.test.ts / view/data.test.ts 同一写法)。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRecord } from "./index.ts";
import type { Sample, SampleIssue } from "./index.ts";
import { currentSample, latestRunSample, type SampleOptions } from "../sample/index.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";

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

type AttemptFixture = Pick<EvalResult, "id" | "verdict"> &
  Partial<Pick<EvalResult, "attempt" | "durationMs" | "assertions" | "estimatedCostUSD" | "usage" | "startedAt" | "artifactBase" | "artifacts">>;

function res(id: string, verdict: Verdict, extra: Partial<AttemptFixture> = {}): AttemptFixture {
  return { id, verdict, attempt: 0, durationMs: 1000, assertions: [], ...extra };
}

/** 实验目录名清洗:与 docs/feature/record/architecture.md 一致(/ 与非 [\w.@-] 换成 _)。 */
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
  /** 声明这份快照实际选中的 eval id 全集;省略 = 第三方 harness 未实现该字段。 */
  selectedEvalIds?: string[];
  /** 编排字段覆盖(runs / earlyExit / maxConcurrency / description…),叠在默认 { attempts: 1, earlyExit: true } 上。 */
  experiment?: globalThis.Record<string, unknown>;
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
    ...(opts.unfinished ? {} : { completedAt: opts.startedAt }),
    ...(opts.knownEvalIds ? { knownEvalIds: opts.knownEvalIds } : {}),
    ...(opts.selectedEvalIds !== undefined || opts.experiment !== undefined
      ? {
          experiment: {
            attempts: 1,
            earlyExit: true,
            ...(opts.selectedEvalIds !== undefined ? { selectedEvalIds: opts.selectedEvalIds } : {}),
            ...opts.experiment,
          },
        }
      : {}),
  };
  await writeFile(join(dir, "run.json"), JSON.stringify(meta, null, 2), "utf-8");
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
// 警告的 dir、快照 dir)不进归一化结果 —— attempt 身份一律走 AttemptRef.run + attempt(根相对)。

interface NormAttempt {
  run: string;
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
  | { kind: "unfinished-run"; experimentId: string; startedAt: string }
  | { kind: "unreadable-run"; reason: string };
interface NormCoverage {
  experimentId: string;
  knownEvalIds: string[];
  missingEvalIds: string[];
}
interface NormSelection {
  issues: NormWarning[];
  coverage: NormCoverage[];
  experiments: NormExperiment[];
}

function normalizeWarning(w: SampleIssue): NormWarning {
  switch (w.code) {
    case "unfinished-run":
      // dir 是宿主机绝对路径,归一化掉;身份靠 experimentId + startedAt。
      return { kind: w.code, experimentId: w.experimentId, startedAt: w.startedAt };
    case "unreadable-run":
      // dir 是宿主机绝对路径,归一化掉;这个 kind 本就非实验作用域,没有 experimentId 可比。
      return { kind: w.code, reason: w.reason };
    case "missing-startedAt":
      // 不透出到 Sample.issues(只由 dedupeAttempts 直调返回),两宿主的 Selection 不会带上它。
      throw new Error("unexpected missing-startedAt in Sample.issues");
  }
}

/**
 * Selection 的「按 experiment × eval」视图现在从 `selection.attempts` 分组重建,不再读
 * `run.evals`——真实 Run 各自持有完整(未按现刻水位收窄的)evals,只有物化的
 * `Sample.attempts` 才是这次选择的真正结果(docs/feature/record/library.md「官方现刻水位」)。
 */
function normalizeSelection(selection: Sample): NormSelection {
  const byExperiment = new Map<string, Map<string, NormAttempt[]>>();
  for (const experimentId of [...new Set(selection.attempts.map((a) => a.experimentId))]) {
    byExperiment.set(experimentId, new Map());
  }
  for (const a of selection.attempts) {
    const evals = byExperiment.get(a.experimentId)!;
    const list = evals.get(a.evalId) ?? [];
    list.push({ run: a.ref.run, attempt: a.ref.attempt, verdict: a.result.verdict });
    evals.set(a.evalId, list);
  }
  return {
    issues: selection.issues.map(normalizeWarning),
    coverage: selection.coverage
      .map((c) => ({ experimentId: c.experimentId, knownEvalIds: c.knownEvalIds, missingEvalIds: c.missingEvalIds }))
      .sort((a, b) => a.experimentId.localeCompare(b.experimentId)),
    experiments: [...byExperiment.entries()].map(([experimentId, evals]) => ({
      experimentId,
      evals: [...evals.entries()].map(([evalId, attempts]) => ({ evalId, attempts })),
    })),
  };
}

/** 两个宿主构造给选择器的 scope 完全同形:验证读源无误,避免"我以为它们一样"。 */
function hostScope(evals: string[], experiment?: string, fresh?: boolean): SampleOptions {
  return { experiments: experiment, ...(evals.length > 0 ? { evals } : {}), fresh };
}

/** 周一全量(q1 通过、q2 失败)+ 周二只补跑 q1(仍通过):现刻水位 = q1 周二 + q2 周一,50%。 */
async function seedPartialRerun(): Promise<string> {
  const root = await makeRoot();
  await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", configHash: "compare-bub-v1", startedAt: "2026-07-01T08:00:00.000Z" }, [
    res("q1", "passed"),
    res("q2", "failed", { assertions: [{ name: 'fileChanged("q2.tsx")', severity: "gate", score: 0, outcome: "failed" as const, detail: "file was not modified" }] }),
  ]);
  await writeSnapshot(root, "2026-07-02T08-00-00-000Z", { experimentId: "compare/bub", configHash: "compare-bub-v1", startedAt: "2026-07-02T08:00:00.000Z" }, [
    res("q1", "passed"),
  ]);
  return root;
}

// ══════════════════════════════════════════════════════════════════════════
// currentSample · 现刻水位结构化身份(11 必测场景中的选择器可判定部分)
// ══════════════════════════════════════════════════════════════════════════

describe("currentSample · 现刻水位结构化身份", () => {
  it("场景1 单 experiment / 单快照 / 单 attempt", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T00-00-00-000Z", { experimentId: "solo/bub", startedAt: "2026-07-01T00:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    const results = await openRecord(root);
    expect(normalizeSelection(currentSample(results))).toEqual({
      issues: [],
      coverage: [{ experimentId: "solo/bub", knownEvalIds: ["q1"], missingEvalIds: [] }],
      experiments: [
        {
          experimentId: "solo/bub",
          evals: [{ evalId: "q1", attempts: [{ run: "solo_bub/2026-07-01T00-00-00-000Z", attempt: "q1/a0", verdict: "passed" }] }],
        },
      ],
    } satisfies NormSelection);
  });

  it("场景2 全量快照后局部补跑一个 eval:q1 取周二、q2 从周一补齐,无伪残缺", async () => {
    const root = await seedPartialRerun();
    const results = await openRecord(root);
    expect(normalizeSelection(currentSample(results))).toEqual({
      issues: [],
      coverage: [{ experimentId: "compare/bub", knownEvalIds: ["q1", "q2"], missingEvalIds: [] }],
      experiments: [
        {
          experimentId: "compare/bub",
          evals: [
            // q1 来自周二快照(局部补跑),q2 来自周一全量快照(补齐)—— 深链各指各的物理 run。
            { evalId: "q1", attempts: [{ run: "compare_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "passed" }] },
            { evalId: "q2", attempts: [{ run: "compare_bub/2026-07-01T08-00-00-000Z", attempt: "q2/a0", verdict: "failed" }] },
          ],
        },
      ],
    } satisfies NormSelection);
    // 对照:latestRunSample(results) 只挑周二快照,是残缺的(这正是宿主要合成现刻水位的原因)——
    // coverage 承载这份残缺事实,不再是 warning。
    expect(latestRunSample(results).coverage.some((c) => c.missingEvalIds.length > 0)).toBe(true);
  });

  it("show / view 两宿主注入同一个 fresh 口径(hostScope({ fresh: true })):跨快照拼入的 q2 被排除,分母缺口进 coverage", async () => {
    const root = await seedPartialRerun();
    const results = await openRecord(root);
    // 两宿主都用同一个 hostScope(...) 构造 SampleOptions 传给 currentSample——这里直接验证
    // 该共享函数收到 fresh: true 后的行为,即两宿主实际得到的是同一份口径(show/index.ts 与
    // view/data.ts 都把各自的 --fresh flag 原样透传成这个字段,不做任何宿主特有的加工)。
    const fresh = currentSample(results, hostScope([], undefined, true));
    // q1 来自周二(新执行),q2 只在周一跑过、被周二"补齐"进来——是跨快照拼入的历史执行,fresh 排除它。
    expect(fresh.attempts.map((a) => a.evalId)).toEqual(["q1"]);
    expect(fresh.coverage.find((c) => c.experimentId === "compare/bub")!.missingEvalIds).toEqual(["q2"]);
    // q2 唯一的来源(周一快照)不再贡献任何 attempts,不该继续出现在 runs 里。
    expect(fresh.runs.map((s) => s.startedAt)).toEqual(["2026-07-02T08:00:00.000Z"]);
  });

  it("两个真实贡献 Run 各自保留对象身份,不合并成一个带重建 selectedEvalIds 的对象(q1 新快照 + q2 旧快照补齐)", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "compare/carry", startedAt: "2026-07-01T08:00:00.000Z", selectedEvalIds: ["q1", "q2"] },
      [res("q1", "passed"), res("q2", "failed")],
    );
    await writeSnapshot(
      root,
      "2026-07-02T08-00-00-000Z",
      { experimentId: "compare/carry", startedAt: "2026-07-02T08:00:00.000Z", selectedEvalIds: ["q1"] },
      [res("q1", "passed")],
    );
    const results = await openRecord(root);
    const scope = currentSample(results);
    // 两个来源各自原样保留:各自的 selectedEvalIds 是它自己落盘的那份,不是合并/重建的产物。
    expect(scope.runs).toHaveLength(2);
    const byStartedAt = new Map(scope.runs.map((s) => [s.startedAt, s]));
    expect(byStartedAt.get("2026-07-01T08:00:00.000Z")!.experiment!.selectedEvalIds).toEqual(["q1", "q2"]);
    expect(byStartedAt.get("2026-07-02T08:00:00.000Z")!.experiment!.selectedEvalIds).toEqual(["q1"]);
    // 但物化的 attempts 只取现刻水位实际选中的那份:q1 来自周二,q2 来自周一补齐。
    expect(scope.attempts.map((a) => `${a.evalId}@${a.run.startedAt}`).sort()).toEqual([
      "q1@2026-07-02T08:00:00.000Z",
      "q2@2026-07-01T08:00:00.000Z",
    ]);
  });

  it("来源快照声明 selectedEvalIds:[q1] 却夹带 q2 的历史 attempt,现刻水位不含该 q2(真实 Run 的 evals 原样保留 q2,只是不物化进 attempts)", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "compare/leaky", startedAt: "2026-07-01T08:00:00.000Z", selectedEvalIds: ["q1"] },
      [res("q1", "passed"), res("q2", "passed")], // q2 落盘了,但没被这次实验选中
    );
    const results = await openRecord(root);
    const scope = currentSample(results);
    expect(scope.attempts.map((a) => a.evalId)).toEqual(["q1"]);
    // 真实 Run 原样保留:q2 仍在它自己的 evals 里,select.ts 没有克隆/裁剪来源对象。
    expect(scope.runs[0]!.evals.map((ev) => ev.id).sort()).toEqual(["q1", "q2"]);
  });

  it("第三方快照缺 experiment.selectedEvalIds 时按其实际 evals 退化,不整份排除;与本方快照混合时各自按自己口径收窄", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "third-party/harness", startedAt: "2026-07-01T08:00:00.000Z" }, // 无 selectedEvalIds
      [res("q1", "passed"), res("q2", "passed")],
    );
    const results = await openRecord(root);
    const scope = currentSample(results);
    expect(scope.attempts.map((a) => a.evalId).sort()).toEqual(["q1", "q2"]);
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
    const results = await openRecord(root);
    const norm = normalizeSelection(currentSample(results));
    // q1 整批取自周二(两个 attempt 都在周二快照),周一的那次 attempt 不掺进来。
    expect(norm.experiments[0].evals).toEqual([
      {
        evalId: "q1",
        attempts: [
          { run: "retry_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "failed" },
          { run: "retry_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a1", verdict: "passed" },
        ],
      },
    ] satisfies NormEval[]);
    expect(norm.issues).toEqual([]);
  });

  it("场景4 多 experiment 更新时间不同:staleness 已删除,时效是逐 attempt 的行级属性,不产生跨实验的页面警告", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    await writeSnapshot(root, "2026-07-03T08-00-00-000Z", { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-03T08:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    const results = await openRecord(root);
    const norm = normalizeSelection(currentSample(results));
    // compare/bub 比 compare/codex 更新时间早,但这是两个不同的 experiment ——
    // 每个 experiment 只跟自己的历史比,不跟 Sample 里其它 experiment 比,两者都无警告、无缺口。
    expect(norm.issues).toEqual([]);
    expect(norm.coverage).toEqual([
      { experimentId: "compare/bub", knownEvalIds: ["q1"], missingEvalIds: [] },
      { experimentId: "compare/codex", knownEvalIds: ["q1"], missingEvalIds: [] },
    ] satisfies NormCoverage[]);
    expect(norm.experiments.map((e) => e.experimentId)).toEqual(["compare/bub", "compare/codex"]);
  });

  it("场景5 未完成快照(无 completedAt):触发 unfinished-run", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T00-00-00-000Z", { experimentId: "solo/bub", startedAt: "2026-07-01T00:00:00.000Z", unfinished: true }, [
      res("q1", "passed"),
    ]);
    const results = await openRecord(root);
    expect(normalizeSelection(currentSample(results)).issues).toEqual([
      { kind: "unfinished-run", experimentId: "solo/bub", startedAt: "2026-07-01T00:00:00.000Z" },
    ] satisfies NormWarning[]);
  });

  it("场景6 历史已知 eval 从未有可读结果:coverage.missingEvalIds 列出真残缺", async () => {
    const root = await makeRoot();
    // knownEvalIds 声明 q1 与 q2,但 q2 从未落盘 —— 跨快照补齐后仍缺,这是真残缺。
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z", knownEvalIds: ["q1", "q2"] },
      [res("q1", "passed")],
    );
    const results = await openRecord(root);
    const norm = normalizeSelection(currentSample(results));
    expect(norm.experiments[0].evals.map((e) => e.evalId)).toEqual(["q1"]);
    expect(norm.issues).toEqual([]);
    expect(norm.coverage).toEqual([
      { experimentId: "compare/bub", knownEvalIds: ["q1", "q2"], missingEvalIds: ["q2"] },
    ] satisfies NormCoverage[]);
  });

  it("可比性前提:配置(model)不一致的旧快照不贡献 attempt,缺口进 coverage.missingEvalIds", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "compare/cfg", model: "gpt-old", configHash: "old-config", startedAt: "2026-07-01T08:00:00.000Z" },
      [res("q1", "passed"), res("q2", "passed")],
    );
    await writeSnapshot(
      root,
      "2026-07-02T08-00-00-000Z",
      { experimentId: "compare/cfg", model: "gpt-new", configHash: "new-config", startedAt: "2026-07-02T08:00:00.000Z" },
      [res("q1", "failed")],
    );
    const results = await openRecord(root);
    const norm = normalizeSelection(currentSample(results));
    // 旧 model 的 q2 不冒充新配置的水位:只有周二的 q1 物化进 attempts,缺口如实进 coverage,不发警告。
    expect(norm.experiments).toEqual([
      {
        experimentId: "compare/cfg",
        evals: [{ evalId: "q1", attempts: [{ run: "compare_cfg/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "failed" }] }],
      },
    ] satisfies NormExperiment[]);
    expect(norm.issues).toEqual([]);
    expect(norm.coverage).toEqual([
      { experimentId: "compare/cfg", knownEvalIds: ["q1", "q2"], missingEvalIds: ["q2"] },
    ] satisfies NormCoverage[]);
  });

  it("编排字段(runs / maxConcurrency / description…)不参与可比性比较:旧快照照常补齐,无缺口", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      {
        experimentId: "compare/orch",
        startedAt: "2026-07-01T08:00:00.000Z",
        selectedEvalIds: ["q1", "q2"],
        experiments: { attempts: 3, earlyExit: true, maxConcurrency: 2, description: "old" },
      },
      [res("q1", "passed"), res("q2", "passed")],
    );
    await writeSnapshot(
      root,
      "2026-07-02T08-00-00-000Z",
      {
        experimentId: "compare/orch",
        startedAt: "2026-07-02T08:00:00.000Z",
        selectedEvalIds: ["q1"],
        experiments: { attempts: 1, earlyExit: false, description: "new" },
      },
      [res("q1", "failed")],
    );
    const results = await openRecord(root);
    const norm = normalizeSelection(currentSample(results));
    // agent/model 一致、只有编排字段不同:q2 从周一补齐,不被误判为不可比而制造伪残缺。
    expect(norm.experiments).toEqual([
      {
        experimentId: "compare/orch",
        evals: [
          { evalId: "q1", attempts: [{ run: "compare_orch/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "failed" }] },
          { evalId: "q2", attempts: [{ run: "compare_orch/2026-07-01T08-00-00-000Z", attempt: "q2/a0", verdict: "passed" }] },
        ],
      },
    ] satisfies NormExperiment[]);
    expect(norm.coverage).toEqual([
      { experimentId: "compare/orch", knownEvalIds: ["q1", "q2"], missingEvalIds: [] },
    ] satisfies NormCoverage[]);
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
    const results = await openRecord(root);

    const weather = normalizeSelection(currentSample(results, hostScope(["weather"])));
    expect(weather.experiments[0].evals.map((e) => e.evalId)).toEqual(["weather/brooklyn"]);
    // 分母 = {weather/brooklyn, weather/queens} ∩ 范围 = 2,缺 queens → 1/2;algebra 的缺口不进来。
    expect(weather.issues).toEqual([]);
    expect(weather.coverage).toEqual([
      { experimentId: "compare/bub", knownEvalIds: ["weather/brooklyn", "weather/queens"], missingEvalIds: ["weather/queens"] },
    ] satisfies NormCoverage[]);

    // algebra 范围:该题有结果,范围内无缺口 → 不刷 weather 的残缺屏。
    const algebra = normalizeSelection(currentSample(results, hostScope(["algebra"])));
    expect(algebra.issues).toEqual([]);
  });

  it("场景8 --exp 分段前缀过滤:只留匹配段,不误配同前缀实验", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [res("q1", "passed")]);
    await writeSnapshot(root, "2026-07-01T09-00-00-000Z", { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-01T09:00:00.000Z" }, [res("q1", "passed")]);
    await writeSnapshot(root, "2026-07-01T10-00-00-000Z", { experimentId: "solo/bub", startedAt: "2026-07-01T10:00:00.000Z" }, [res("q1", "passed")]);
    const results = await openRecord(root);
    const norm = normalizeSelection(currentSample(results, hostScope([], "compare")));
    // "compare" 分段前缀匹配 compare/bub、compare/codex,不含 solo/bub。
    expect(norm.experiments.map((e) => e.experimentId)).toEqual(["compare/bub", "compare/codex"]);
  });

  it("场景9 --run 指向单个结果根:选择器只看该根的实验,不串到另一个根", async () => {
    const rootA = await makeRoot();
    const rootB = await makeRoot();
    await writeSnapshot(rootA, "2026-07-01T08-00-00-000Z", { experimentId: "onlyA/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [res("qa", "passed")]);
    await writeSnapshot(rootB, "2026-07-02T08-00-00-000Z", { experimentId: "onlyB/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [res("qb", "passed")]);
    const normA = normalizeSelection(currentSample(await openRecord(rootA)));
    const normB = normalizeSelection(currentSample(await openRecord(rootB)));
    // 各根只看见自己的实验;show --run rootB / view rootB 传的都是同一个 root 参数,
    // 不会把另一个根的 experiment 混进来 —— 隔离性在选择入口这一层就成立。
    expect(normA.experiments.map((e) => e.experimentId)).toEqual(["onlyA/bub"]);
    expect(normB.experiments.map((e) => e.experimentId)).toEqual(["onlyB/bub"]);
  });

  it("场景11 resume 携带的复印件不重复计票,证据 ref 仍指向可读 artifact", async () => {
    const root = await makeRoot();
    // 周一原始:q1 通过,带 events artifact。
    const oldDir = await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "passed", { artifacts: ["events"] }),
    ]);
    await writeFile(join(oldDir, "q1", "a0", "events.json"), "[]", "utf-8");
    // 周二 resume:q1 是复印件(startedAt 锚原快照,artifactBase 指原快照 artifact),q2 是新题。
    await writeSnapshot(root, "2026-07-02T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
      res("q1", "passed", { artifacts: ["events"], startedAt: "2026-07-01T08:00:00.000Z", artifactBase: "compare_bub/2026-07-01T08-00-00-000Z/q1/a0" }),
      res("q2", "passed"),
    ]);
    const results = await openRecord(root);
    const selection = currentSample(results);
    const norm = normalizeSelection(selection);
    // q1 整批取自周二(含它的最新快照 = 复印件那份),只出现一次;不因为它也活在周一而计两票。
    expect(norm.experiments[0].evals).toEqual([
      { evalId: "q1", attempts: [{ run: "compare_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "passed" }] },
      { evalId: "q2", attempts: [{ run: "compare_bub/2026-07-02T08-00-00-000Z", attempt: "q2/a0", verdict: "passed" }] },
    ] satisfies NormEval[]);
    expect(norm.issues).toEqual([]);
    // 证据 ref 可达:复印件的 artifactBase 回退到原快照,events.json 仍读得到(非 null)。
    const q1 = selection.runs[0].evals.find((e) => e.id === "q1")!;
    expect(await q1.attempts[0].events()).not.toBeNull();
  });
});
