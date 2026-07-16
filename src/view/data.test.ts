// cases: docs/engineering/unit-tests/reports/cases.md
// view 数据层(data.ts)的单测:loader 收编到 openResults、统计整体住进报告槽之后,
// 守护三件事——skipped 三种原因如实进 viewData(producer 感知的 npx 提示)、报告槽是
// 现刻水位口径(裸跑经 selectCurrentResults 跨快照合成每 experiment × eval 的最新判定,
// 与 show 同一函数;en / zh-CN 双语渲染)、跨快照去重让 Runs/Traces 不被 --resume 复印件
// 灌票。viewData 只携带证据室数据(快照明细 + skipped + 壳元信息),不再有 overview /
// table / overall 统计产物。
// 另含 loadLatestResultsPerEval 的续跑携带语义(从旧 loader.test.ts 移植,口径不变)。
//
// fixture 直接写新布局(<expDir>/<snapDir>/snapshot.json + <evalId>/a<n>/result.json),
// 依据是 docs/feature/results/architecture.md 的稳定磁盘契约,不经 writer 运行时 API。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IncompatibleResultsError, ViewInputError, loadLatestResultsPerEval, loadViewScan } from "./data.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";
import { encodeAttemptLocator } from "../results/locator.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-viewdata-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

type AttemptFixture = Pick<EvalResult, "id" | "verdict"> &
  Partial<Pick<EvalResult, "attempt" | "durationMs" | "assertions" | "fingerprint" | "startedAt" | "artifactBase" | "hasEvents">>;

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
  schemaVersion?: number;
  producer?: { name: string; version?: string };
}

/** 写一份新布局快照:snapshot.json + 各 attempt 的 result.json。返回快照目录绝对路径。 */
async function writeSnapshot(
  root: string,
  expDirName: string,
  snapDirName: string,
  opts: SnapshotOpts,
  results: AttemptFixture[],
): Promise<string> {
  const dir = join(root, expDirName, snapDirName);
  await mkdir(dir, { recursive: true });
  const meta = {
    format: RESULTS_FORMAT,
    schemaVersion: opts.schemaVersion ?? RESULTS_SCHEMA_VERSION,
    producer: opts.producer ?? { name: "niceeval", version: "0.4.0" },
    experimentId: opts.experimentId,
    agent: opts.agent ?? "agent",
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    startedAt: opts.startedAt,
    ...(opts.completedAt !== undefined ? { completedAt: opts.completedAt } : {}),
  };
  await writeFile(join(dir, "snapshot.json"), JSON.stringify(meta, null, 2), "utf-8");
  for (const r of results) {
    const attemptDir = join(dir, r.id, `a${r.attempt ?? 0}`);
    await mkdir(attemptDir, { recursive: true });
    await writeFile(join(attemptDir, "result.json"), JSON.stringify(r, null, 2), "utf-8");
  }
  return dir;
}

describe("loadViewScan · skipped 三种原因进 viewData", () => {
  it("incompatible-version / malformed / incomplete 都进 skippedRuns;niceeval 落盘拼 npx 命令,第三方如实报名字不拼", async () => {
    const root = await makeRoot();
    // 正常快照,页面照常渲染。
    await writeSnapshot(root, "exp_a", "2026-07-01T08-00-00-000Z", { experimentId: "exp/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    // 版本不同:niceeval 写的。
    await writeSnapshot(
      root,
      "exp_b",
      "2026-07-02T08-00-00-000Z",
      { experimentId: "exp/b", startedAt: "2026-07-02T08:00:00.000Z", schemaVersion: 999, producer: { name: "niceeval", version: "9.9.9" } },
      [],
    );
    // 版本不同:第三方 harness 写的。
    await writeSnapshot(
      root,
      "exp_c",
      "2026-07-03T08-00-00-000Z",
      { experimentId: "exp/c", startedAt: "2026-07-03T08:00:00.000Z", schemaVersion: 999, producer: { name: "otherharness", version: "1.2.3" } },
      [],
    );
    // 坏 JSON。
    const malformedDir = join(root, "exp_d", "2026-07-04T08-00-00-000Z");
    await mkdir(malformedDir, { recursive: true });
    await writeFile(join(malformedDir, "snapshot.json"), "{not json", "utf-8");
    // incomplete:有 attempt 落盘、没有 snapshot.json(快照目录建好、元数据没写完的极窄窗口)。
    const incompleteDir = join(root, "exp_e", "2026-07-05T08-00-00-000Z");
    await mkdir(join(incompleteDir, "q1", "a0"), { recursive: true });
    await writeFile(join(incompleteDir, "q1", "a0", "events.json"), "[]", "utf-8");

    const scan = await loadViewScan(root);
    const { viewData } = scan;
    const reportHtml = scan.reportPages[0]!.html;
    const byReason = new Map(viewData.skippedRuns!.map((s) => [s.dir, s]));
    expect(viewData.skippedRuns).toHaveLength(4);

    const niceevalSkip = [...byReason.values()].find((s) => s.producerName === "niceeval" && s.reason === "incompatible-version")!;
    expect(niceevalSkip.schemaVersion).toBe(999);
    expect(niceevalSkip.command).toContain("npx niceeval@9.9.9 view ");

    const foreignSkip = [...byReason.values()].find((s) => s.producerName === "otherharness")!;
    expect(foreignSkip.reason).toBe("incompatible-version");
    expect(foreignSkip.producerVersion).toBe("1.2.3");
    expect(foreignSkip.command).toBeUndefined(); // 第三方版本号拼 npx 是一句错误提示,不拼

    const malformed = [...byReason.values()].find((s) => s.reason === "malformed")!;
    expect(malformed.detail).toBe("invalid JSON");

    const incomplete = [...byReason.values()].find((s) => s.reason === "incomplete")!;
    expect(incomplete.dir).toContain("2026-07-05T08-00-00-000Z");

    // 正常快照照常进报告槽(默认报告的榜单),坏快照不拖垮整页。
    expect(reportHtml.en).toContain("exp/a");
    expect(viewData.snapshots.map((s) => s.experimentId)).toEqual(["exp/a"]);
  });

  it("单文件模式指向版本不同的报告:抛 IncompatibleResultsError(CLI 打印提示退出)", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(
      root,
      "exp_b",
      "2026-07-02T08-00-00-000Z",
      { experimentId: "exp/b", startedAt: "2026-07-02T08:00:00.000Z", schemaVersion: 999, producer: { name: "niceeval", version: "9.9.9" } },
      [],
    );
    await expect(loadViewScan(join(dir, "snapshot.json"))).rejects.toBeInstanceOf(IncompatibleResultsError);
  });
});

describe("loadViewScan · 报告槽是现刻水位口径,裸跑与局部收窄合成规则一致", () => {
  it("同一实验两次快照:报告槽跨快照补齐每 eval 的最新判定,不残缺;历史快照仍供证据室", async () => {
    const root = await makeRoot();
    // 周一全量:q1 失败、q2 通过。
    await writeSnapshot(root, "exp_a", "2026-07-01T08-00-00-000Z", { experimentId: "exp/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "failed"),
      res("q2", "passed"),
    ]);
    // 周二只补跑 q1(通过):latest 快照只盖 1/2 道题,但现刻水位从周一补齐 q2。
    await writeSnapshot(root, "exp_a", "2026-07-02T08-00-00-000Z", { experimentId: "exp/a", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
      res("q1", "passed"),
    ]);

    const scan = await loadViewScan(root);
    const { viewData } = scan;
    const reportHtml = scan.reportPages[0]!.html;
    // 现刻水位:q1 取周二(更新,通过),q2 取周一(仅此一次,通过)—— 两题全过(2/2 = 100%),
    // 不是「只看周二快照的 1/1」。深链分别指向各自的贡献快照(AttemptLocator 由身份元组——
    // 含快照 startedAt——确定性派生,两个不同快照的 q1/q2 编出两个不同的 locator)。
    expect(reportHtml.en).toContain("100%");
    const q1Locator = encodeAttemptLocator({
      experimentId: "exp/a",
      snapshotStartedAt: "2026-07-02T08:00:00.000Z",
      evalId: "q1",
      attempt: 0,
    });
    const q2Locator = encodeAttemptLocator({
      experimentId: "exp/a",
      snapshotStartedAt: "2026-07-01T08:00:00.000Z",
      evalId: "q2",
      attempt: 0,
    });
    expect(reportHtml.en).toContain(`#/attempt/${q1Locator}`); // q1 来自周二
    expect(reportHtml.en).toContain(`#/attempt/${q2Locator}`); // q2 来自周一

    // 两题都有真实判定,不是伪残缺:报告槽不再出 partial-coverage 警告。
    expect(reportHtml.en).not.toContain('data-kind="partial-coverage"');

    // 证据室的 latest 标记仍按 results.latest() 口径(周二快照),与报告槽 Selection 无关。
    const latest = viewData.snapshots.filter((s) => s.latest);
    expect(latest).toHaveLength(1);
    expect(latest[0]!.startedAt).toBe("2026-07-02T08:00:00.000Z");
    expect(viewData.lastRunAt).toBe("2026-07-02T08:00:00.000Z");
    // 合成 Selection 的 attempts 来自周一、周二两个物理 run。
    expect(viewData.composedRuns).toBe(2);

    // 历史快照仍在(Runs / Traces 吃全部),但不是 latest。
    const historical = viewData.snapshots.filter((s) => !s.latest);
    expect(historical).toHaveLength(1);
    expect(historical[0]!.results.map((r) => r.id).sort()).toEqual(["q1", "q2"]);
  });
});

describe("loadViewScan · 跨快照去重(--resume 携带的复印件只算一次)", () => {
  it("同一 attempt 存在于两份落盘:只保留最新快照里的那份,locator 落在最新落盘,artifactBase 沿用原快照 artifact", async () => {
    const root = await makeRoot();
    const oldDir = await writeSnapshot(
      root,
      "exp_a",
      "2026-07-01T08-00-00-000Z",
      { experimentId: "exp/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" },
      [res("q1", "passed", { hasEvents: true })],
    );
    await writeFile(join(oldDir, "q1", "a0", "events.json"), "[]", "utf-8");
    // 携带条目:startedAt 锚定原快照, artifactBase 指向原快照的 attempt 目录(root 相对)。
    await writeSnapshot(root, "exp_a", "2026-07-02T08-00-00-000Z", { experimentId: "exp/a", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
      res("q1", "passed", {
        hasEvents: true,
        startedAt: "2026-07-01T08:00:00.000Z",
        artifactBase: "exp_a/2026-07-01T08-00-00-000Z/q1/a0",
      }),
      res("q2", "passed"),
    ]);

    const { viewData, artifactDirs } = await loadViewScan(root);
    // 全部快照(Runs/Traces 的数据面)里 q1 只出现一次:复印件不灌票。
    const allResults = viewData.snapshots.flatMap((s) => s.results);
    expect(allResults.filter((r) => r.id === "q1")).toHaveLength(1);
    const q1 = allResults.find((r) => r.id === "q1")!;
    // 证据身份(locator)跟着最新落盘走:身份元组里的 snapshotStartedAt 是新快照的 startedAt。
    expect(q1.locator).toBe(
      encodeAttemptLocator({ experimentId: "exp/a", snapshotStartedAt: "2026-07-02T08:00:00.000Z", evalId: "q1", attempt: 0 }),
    );
    expect(q1.artifactBase).toBe("exp_a/2026-07-01T08-00-00-000Z/q1/a0"); // artifact 仍指原快照
    // 静态导出(--out)能把携带条目的 artifact 一并带走。
    expect(artifactDirs.get("exp_a/2026-07-01T08-00-00-000Z/q1/a0")).toBe(join(oldDir, "q1", "a0"));
    // 条目全被吸走的旧快照不再出现。
    expect(viewData.snapshots.filter((s) => !s.latest)).toHaveLength(0);
  });
});

describe("loadViewScan · 新布局落盘直接可读(写入面 / 读取面同一契约)", () => {
  it("快照与 locator 都从落盘产物算出", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "compare_bub",
      "2026-07-03T08-00-00-000Z",
      { experimentId: "compare/bub", agent: "bub", model: "gpt-5", startedAt: "2026-07-03T08:00:00.000Z" },
      [
        res("q1", "passed", { hasEvents: true }),
        res("q2", "failed"),
      ],
    );

    const scan = await loadViewScan(root);
    const { viewData } = scan;
    const reportHtml = scan.reportPages[0]!.html;
    // 报告槽(ExperimentComparison 的 web 面):Experiment 工作台行 + 官方通过率格子(1 过 1 败 = 50%)。
    expect(reportHtml.en).toContain("compare/bub");
    expect(reportHtml.en).toContain("50%");
    const snapshot = viewData.snapshots[0]!;
    expect(snapshot.latest).toBe(true);
    expect(snapshot.agent).toBe("bub");
    expect(snapshot.run).toBe("compare_bub/2026-07-03T08-00-00-000Z");
    // 每条结果的 locator 都能由身份元组(experimentId/快照 startedAt/evalId/attempt 下标)独立复算,
    // 证明它不是随手塞的占位值,而是真从落盘产物(snapshot.json + result.json)算出来的。
    expect(snapshot.results.every((r) => r.locator === encodeAttemptLocator({
      experimentId: snapshot.experimentId,
      snapshotStartedAt: snapshot.startedAt,
      evalId: r.id,
      attempt: r.attempt,
    }))).toBe(true);
    // 本快照跑出的条目落盘没有 artifactBase 字段:读取面按 `${ref.snapshot}/${ref.attempt}` 现算,
    // ref.snapshot 恒等于 snapshot.run,ref.attempt 恒是 `${evalId}/a${attempt}`。
    const q1 = snapshot.results.find((r) => r.id === "q1")!;
    expect(q1.hasEvents).toBe(true);
    expect(q1.artifactBase).toBe(`${snapshot.run}/q1/a0`);
  });
});

describe("loadLatestResultsPerEval(续跑携带基线,口径与旧 loader 一致)", () => {
  it("部分补跑快照只遮蔽它跑过的 eval,其它 eval 仍取自更早的全量快照", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "exp_a", "2026-01-01T00-00-00-000Z", { experimentId: "exp/a", agent: "a", startedAt: "2026-01-01T00:00:00.000Z" }, [
      res("e1", "passed"),
      res("e2", "errored"),
    ]);
    await writeSnapshot(root, "exp_b", "2026-01-01T00-00-00-000Z", { experimentId: "exp/b", agent: "a", startedAt: "2026-01-01T00:00:00.000Z" }, [
      res("e1", "passed"),
    ]);
    // 部分补跑:只重跑了 exp/a 的 e2
    await writeSnapshot(root, "exp_a", "2026-01-02T00-00-00-000Z", { experimentId: "exp/a", agent: "a", startedAt: "2026-01-02T00:00:00.000Z" }, [
      res("e2", "passed"),
    ]);

    const results = await loadLatestResultsPerEval(root);
    const byKey = new Map(results.map((r) => [`${r.experimentId}|${r.id}`, r.verdict]));
    expect(byKey.get("exp/a|e1")).toBe("passed"); // 来自旧全量快照,没被部分快照冲掉
    expect(byKey.get("exp/a|e2")).toBe("passed"); // 来自补跑快照(最新)
    expect(byKey.get("exp/b|e1")).toBe("passed");
    expect(results).toHaveLength(3);
  });

  it("同 (experiment, eval) 多 attempt 整批取自含它的最新快照,不跨快照混装;artifactBase 已拼好", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "exp_a", "2026-01-01T00-00-00-000Z", { experimentId: "exp/a", agent: "a", startedAt: "2026-01-01T00:00:00.000Z" }, [
      res("e1", "passed", { fingerprint: "old" }),
    ]);
    await writeSnapshot(root, "exp_a", "2026-01-02T00-00-00-000Z", { experimentId: "exp/a", agent: "a", startedAt: "2026-01-02T00:00:00.000Z" }, [
      res("e1", "failed", { fingerprint: "new" }),
      res("e1", "passed", { attempt: 1, fingerprint: "new" }),
    ]);

    const results = await loadLatestResultsPerEval(root);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.fingerprint === "new")).toBe(true);
    // runner 携带条目时依赖 artifactBase(相对结果根)可解析,view 才找得回 artifact。
    const withArtifact = results.find((r) => r.attempt === 0)!;
    expect(withArtifact.artifactBase).toBe("exp_a/2026-01-02T00-00-00-000Z/e1/a0");
  });
});

describe("loadViewScan · 零可读结果直说,不渲染空页面", () => {
  it("目录真空:抛 ViewInputError,给「先跑一轮」提示(与 show 同文案)", async () => {
    const root = await makeRoot();
    await expect(loadViewScan(root)).rejects.toBeInstanceOf(ViewInputError);
    await expect(loadViewScan(root)).rejects.toThrow(/niceeval exp/);
  });

  it("全被跳过:错误逐条列目录与原因,niceeval 落盘的 schemaVersion 场景给出可跑的 npx 命令", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "exp_b",
      "2026-07-02T08-00-00-000Z",
      { experimentId: "exp/b", startedAt: "2026-07-02T08:00:00.000Z", schemaVersion: 999, producer: { name: "niceeval", version: "9.9.9" } },
      [],
    );
    const malformedDir = join(root, "exp_d", "2026-07-04T08-00-00-000Z");
    await mkdir(malformedDir, { recursive: true });
    await writeFile(join(malformedDir, "snapshot.json"), "{not json", "utf-8");

    const err = await loadViewScan(root).then(
      () => { throw new Error("expected ViewInputError"); },
      (e) => e as Error,
    );
    expect(err).toBeInstanceOf(ViewInputError);
    expect(err.message).toContain("2 snapshot directories were skipped");
    expect(err.message).toContain("incompatible-version, schemaVersion 999");
    expect(err.message).toContain("npx niceeval@9.9.9 view ");
    expect(err.message).toContain("malformed");
  });
});
