// cases: docs/engineering/testing/unit/reports.md
// view 数据层(data.ts)的单测(「view 数据装载(ViewScan)」类别,见 unit/reports.md
// 覆盖规范):守护三件事——unreadable 三种原因如实进 viewData(producer 感知的 npx 提示)、
// 报告槽是现刻水位口径(裸跑经 currentSample 跨快照合成每 experiment × eval 的
// 最新判定,与 show 同一函数,composedRuns 反映跨快照合成)、跨快照去重让证据室索引不被
// --resume 复印件灌票。viewData 不携带 overview / table / overall 统计产物。
// 另含 loadLatestResultsPerEval 的续跑携带语义(从旧 loader.test.ts 移植,口径不变),
// 与 dev server 装载语义——报告文件或其项目内依赖变更后下一次装载读取新内容
// (namespaced import 不复用陈旧模块,含经 config.cwd 装载的场景)。
//
// resolveViewInput 的进程级输入校验、收窄对证据室与导出的作用面、外壳导航与标题呈现,
// 归 docs/engineering/testing/e2e/report.md 对真实产物验收。
//
// 报告槽渲染出的 HTML 内容(通过率数字、locator 深链文本)归
// docs/engineering/testing/e2e/report.md 对真实产物验收,不在本层断言。
//
// fixture 直接写新布局(<expDir>/<snapDir>/run.json + <evalId>/a<n>/result.json),
// 依据是 docs/feature/record/architecture.md 的稳定磁盘契约,不经 writer 运行时 API。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IncompatibleResultsError, ViewInputError, incompatibleHistoryKey, loadCarryInputs, loadLatestResultsPerEval, loadViewScan, type ViewScan } from "./data.ts";
import type { AttemptHandle } from "../record/index.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";
import { encodeAttemptLocator } from "../record/locator.ts";

/** scan.attemptsByBase 按 base 建索引;测试按 eval id 找回单个 attempt(该 eval 在本 fixture 里唯一时用)。 */
function attemptByEvalId(scan: ViewScan, evalId: string): AttemptHandle {
  for (const handle of scan.attemptsByBase.values()) {
    if (handle.evalId === evalId) return handle;
  }
  throw new Error(`no attempt found for eval id "${evalId}"`);
}

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
  Partial<Pick<EvalResult, "attempt" | "durationMs" | "assertions" | "fingerprint" | "startedAt" | "artifactBase" | "artifacts">>;

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
  schemaVersion?: number;
  producer?: { name: string; version?: string };
}

/** 写一份新布局快照:run.json + 各 attempt 的 result.json。返回快照目录绝对路径。 */
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
    format: RECORD_FORMAT,
    schemaVersion: opts.schemaVersion ?? RECORD_SCHEMA_VERSION,
    producer: opts.producer ?? { name: "niceeval", version: "0.4.0" },
    runId: `${snapDirName}-0000-4000-8000-000000000000`,
    experimentId: opts.experimentId,
    agent: opts.agent ?? "agent",
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    startedAt: opts.startedAt,
    configHash: "fixture-config",
    ...(opts.completedAt !== undefined ? { completedAt: opts.completedAt } : {}),
  };
  await writeFile(join(dir, "run.json"), JSON.stringify(meta, null, 2), "utf-8");
  for (const r of results) {
    const attemptDir = join(dir, r.id, `a${r.attempt ?? 0}`);
    await mkdir(attemptDir, { recursive: true });
    await writeFile(join(attemptDir, "result.json"), JSON.stringify(r, null, 2), "utf-8");
  }
  return dir;
}

describe("loadViewScan · unreadable 三种原因进 viewData", () => {
  it("incompatible / malformed / incomplete 都进 skippedRuns;niceeval 落盘拼 npx 命令,第三方如实报名字不拼", async () => {
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
    await writeFile(join(malformedDir, "run.json"), "{not json", "utf-8");
    // incomplete:有 attempt 落盘、没有 run.json(快照目录建好、元数据没写完的极窄窗口)。
    const incompleteDir = join(root, "exp_e", "2026-07-05T08-00-00-000Z");
    await mkdir(join(incompleteDir, "q1", "a0"), { recursive: true });
    await writeFile(join(incompleteDir, "q1", "a0", "events.json"), "[]", "utf-8");

    const scan = await loadViewScan(root);
    const { viewData } = scan;
    const byReason = new Map(viewData.skippedRuns!.map((s) => [s.dir, s]));
    expect(viewData.skippedRuns).toHaveLength(4);

    const niceevalSkip = [...byReason.values()].find((s) => s.producerName === "niceeval" && s.reason === "incompatible")!;
    expect(niceevalSkip.schemaVersion).toBe(999);
    expect(niceevalSkip.command).toContain("npx niceeval@9.9.9 view ");

    const foreignSkip = [...byReason.values()].find((s) => s.producerName === "otherharness")!;
    expect(foreignSkip.reason).toBe("incompatible");
    expect(foreignSkip.producerVersion).toBe("1.2.3");
    expect(foreignSkip.command).toBeUndefined(); // 第三方版本号拼 npx 是一句错误提示,不拼

    const malformed = [...byReason.values()].find((s) => s.reason === "malformed")!;
    expect(malformed.detail).toBe("invalid JSON");

    const incomplete = [...byReason.values()].find((s) => s.reason === "incomplete")!;
    expect(incomplete.dir).toContain("2026-07-05T08-00-00-000Z");

    // 坏快照不拖垮证据室索引:只有 exp/a 一条(正常快照照常进报告槽——现刻水位口径见下方 describe)。
    expect([...scan.attemptsByBase.values()].map((a) => a.experimentId)).toEqual(["exp/a"]);
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
    await expect(loadViewScan(join(dir, "run.json"))).rejects.toBeInstanceOf(IncompatibleResultsError);
  });
});

describe("loadViewScan · 报告槽是现刻水位口径,裸跑与局部收窄合成规则一致", () => {
  it("同一实验两次快照:composedRuns 反映跨快照合成,历史快照仍各自供证据室(locator 可达)", async () => {
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
    expect(viewData.lastRunAt).toBe("2026-07-02T08:00:00.000Z");
    // 合成 Selection 的 attempts 来自周一、周二两个物理 run,不是「只看最新快照」。
    expect(viewData.composedRuns).toBe(2);

    // 历史 attempt 仍各自可达(attempt/<locator>.html 的证据室索引,不随报告槽 Selection 收窄):
    // AttemptLocator 由身份元组(含快照 startedAt)确定性派生,两个不同快照的 q1 编出两个不同
    // locator。周二的 q1(现刻水位选中的那份)、周一的 q2(唯一一次,现刻水位也选它)都在;
    // 周一自己的 q1(被周二顶替,不再是现刻水位选中的那份)locator 不同,dedup 也不吞它——
    // 它是独立的历史事实,不是 --resume 字面携带的复印件。
    const q1TuesdayLocator = encodeAttemptLocator({
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
    const q1MondayLocator = encodeAttemptLocator({
      experimentId: "exp/a",
      snapshotStartedAt: "2026-07-01T08:00:00.000Z",
      evalId: "q1",
      attempt: 0,
    });
    const attemptInstances = scan.paramPages.get("attempt")!.instances;
    expect(attemptInstances.has(q1TuesdayLocator)).toBe(true);
    expect(attemptInstances.has(q2Locator)).toBe(true);
    expect(attemptInstances.has(q1MondayLocator)).toBe(true);
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
      [res("q1", "passed", { artifacts: ["events"] })],
    );
    await writeFile(join(oldDir, "q1", "a0", "events.json"), "[]", "utf-8");
    // 携带条目:startedAt 锚定原快照, artifactBase 指向原快照的 attempt 目录(root 相对)。
    await writeSnapshot(root, "exp_a", "2026-07-02T08-00-00-000Z", { experimentId: "exp/a", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
      res("q1", "passed", {
        artifacts: ["events"],
        startedAt: "2026-07-01T08:00:00.000Z",
        artifactBase: "exp_a/2026-07-01T08-00-00-000Z/q1/a0",
      }),
      res("q2", "passed"),
    ]);

    const scan = await loadViewScan(root);
    const { artifactDirs, attemptsByBase } = scan;
    // 全部落盘(证据室索引的数据面)里 q1 只出现一次:复印件不灌票。
    const allAttempts = [...attemptsByBase.values()];
    expect(allAttempts.filter((a) => a.evalId === "q1")).toHaveLength(1);
    const q1 = allAttempts.find((a) => a.evalId === "q1")!;
    // 证据身份(locator)跟着最新落盘走:身份元组里的 snapshotStartedAt 是新快照的 startedAt。
    expect(q1.locator).toBe(
      encodeAttemptLocator({ experimentId: "exp/a", snapshotStartedAt: "2026-07-02T08:00:00.000Z", evalId: "q1", attempt: 0 }),
    );
    expect(q1.result.artifactBase).toBe("exp_a/2026-07-01T08-00-00-000Z/q1/a0"); // artifact 仍指原快照
    // 静态导出(--out)能把携带条目的 artifact 一并带走。
    expect(artifactDirs.get("exp_a/2026-07-01T08-00-00-000Z/q1/a0")).toBe(join(oldDir, "q1", "a0"));
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
        res("q1", "passed", { artifacts: ["events"] }),
        res("q2", "failed"),
      ],
    );

    const scan = await loadViewScan(root);
    const attempts = [...scan.attemptsByBase.values()];
    expect(attempts.every((a) => a.run.agent === "bub")).toBe(true);
    expect(attempts.every((a) => a.run.startedAt === "2026-07-03T08:00:00.000Z")).toBe(true);
    // 每条结果的 locator 都能由身份元组(experimentId/快照 startedAt/evalId/attempt 下标)独立复算,
    // 证明它不是随手塞的占位值,而是真从落盘产物(run.json + result.json)算出来的。
    expect(attempts.every((a) => a.locator === encodeAttemptLocator({
      experimentId: a.experimentId,
      snapshotStartedAt: a.run.startedAt,
      evalId: a.evalId,
      attempt: a.result.attempt,
    }))).toBe(true);
    // 本快照跑出的条目落盘没有 artifactBase 字段:读取面按 `${ref.run}/${ref.attempt}` 现算——
    // scan.attemptsByBase 正是按这份现算出的 base 建的索引,q1 应恰好落在这个 key 上。
    const q1Base = "compare_bub/2026-07-03T08-00-00-000Z/q1/a0";
    const q1 = scan.attemptsByBase.get(q1Base)!;
    expect(q1).toBeTruthy();
    expect(q1.result.artifacts).toEqual(["events"]);
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

describe("loadCarryInputs · 版本不兼容的历史认得出坐标", () => {
  it("v11 快照不进 results,但它跑过的 (实验, eval) 进 incompatibleHistory;可读快照不进", async () => {
    const root = await makeRoot();
    // 当前版本:正常读进来,不算「不兼容历史」。
    await writeSnapshot(root, "exp_a", "2026-01-02T00-00-00-000Z", { experimentId: "exp/a", agent: "a", startedAt: "2026-01-02T00:00:00.000Z" }, [
      res("e1", "passed"),
    ]);
    // 上一版写的:整份不解析,但盘上确实有 e2 与 nested/e3 跑过的痕迹。
    await writeSnapshot(
      root,
      "exp_a",
      "2026-01-01T00-00-00-000Z",
      { experimentId: "exp/a", agent: "a", startedAt: "2026-01-01T00:00:00.000Z", schemaVersion: 11 },
      [res("e2", "passed"), res("nested/e3", "failed")],
    );

    const inputs = await loadCarryInputs(root);
    expect(inputs.results.map((r) => r.id)).toEqual(["e1"]); // v11 的条目一条都读不进来
    expect([...inputs.incompatibleHistory].sort()).toEqual(["exp_a|e2", "exp_a|nested/e3"]);
    expect(inputs.incompatibleHistory.has(incompatibleHistoryKey("exp/a", "e2"))).toBe(true);
    expect(inputs.incompatibleHistory.has(incompatibleHistoryKey("exp/a", "e1"))).toBe(false);
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
    await writeFile(join(malformedDir, "run.json"), "{not json", "utf-8");

    const err = await loadViewScan(root).then(
      () => { throw new Error("expected ViewInputError"); },
      (e) => e as Error,
    );
    expect(err).toBeInstanceOf(ViewInputError);
    expect(err.message).toContain("2 run directories were unreadable");
    expect(err.message).toContain("incompatible, schemaVersion 999");
    expect(err.message).toContain("npx niceeval@9.9.9 view ");
    expect(err.message).toContain("malformed");
  });
});

describe("loadViewScan · viewData 只含证据室元信息", () => {
  it("壳的 viewData 不携带 overview / table / overall 统计产物:统计口径整体住在报告页里", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "exp_a", "2026-07-08T10-00-00-000Z", { experimentId: "exp/a", startedAt: "2026-07-08T10:00:00.000Z", completedAt: "2026-07-08T10:00:00.000Z" }, [
      res("e1", "passed"),
    ]);
    const scan = await loadViewScan(root);
    expect(scan.viewData).not.toHaveProperty("overview");
    expect(scan.viewData).not.toHaveProperty("table");
    expect(scan.viewData).not.toHaveProperty("overall");
  });
});

// ───────────────────────── dev server 装载语义:整页重算 ─────────────────────────

describe("loadViewScan · 报告文件变更整页重算", () => {
  /** 不经包入口也合法的最小报告(判别锚在 Symbol.for 上):写 tmp .mjs 才能改内容重载。 */
  function reportSource(marker: string): string {
    return [
      'const FACES = Symbol.for("niceeval.report.faces");',
      'const DEFINITION = Symbol.for("niceeval.report.definition");',
      "const Block = (props) => Block[FACES].web(props);",
      "Block[FACES] = {",
      `  web: () => "${marker}",`,
      `  text: () => "${marker}",`,
      "};",
      "const definition = {",
      '  kind: "report",',
      "  head: [],",
      '  pages: [{ id: "report", title: "Report", input: "sample", render: () => ({ $$typeof: Symbol.for("react.transitional.element"), type: Block, props: {}, key: null }) }],',
      "};",
      "Object.defineProperty(definition, DEFINITION, { value: true });",
      "export default definition;",
      "",
    ].join("\n");
  }

  async function seedReloadRoot(): Promise<string> {
    const root = await makeRoot();
    await writeSnapshot(root, "exp_a", "2026-07-08T10-00-00-000Z", { experimentId: "exp/a", startedAt: "2026-07-08T10:00:00.000Z", completedAt: "2026-07-08T10:00:00.000Z" }, [
      res("e1", "passed"),
    ]);
    return root;
  }

  it("重写报告文件后,下一次装载读取新内容(namespaced import,不复用陈旧模块)", async () => {
    const root = await seedReloadRoot();
    const path = join(root, "report.mjs");
    await writeFile(path, reportSource("FIRST_RENDER"), "utf-8");
    const first = await loadViewScan(root, { report: { path, cwd: root } });
    expect(await first.reportPages.render(first.reportPages.ids[0]!, "en")).toContain("FIRST_RENDER");
    // 自定义报告没有声明 attempt-input page，也不能让 locator 下钻退化成纯文本；
    // view 补官方详情页，但不把它列进自定义报告的导航 pages。
    expect(first.reportPages.ids).toEqual(["report"]);
    expect(first.paramPages.get("attempt")?.page.id).toBe("attempt");
    expect(first.paramPages.get("attempt")?.instances.size).toBe(1);

    await writeFile(path, reportSource("SECOND_RENDER"), "utf-8");
    const second = await loadViewScan(root, { report: { path, cwd: root } });
    expect(await second.reportPages.render(second.reportPages.ids[0]!, "en")).toContain("SECOND_RENDER");
    expect(await second.reportPages.render(second.reportPages.ids[0]!, "en")).not.toContain("FIRST_RENDER");
  });

  it("改报告 import 的组件文件后,下一次装载读取新内容(子图失效)", async () => {
    const root = await seedReloadRoot();
    await writeFile(join(root, "marker.mjs"), 'export const marker = "DEP_FIRST";\n', "utf-8");
    await writeFile(
      join(root, "report.mjs"),
      [
        'import { marker } from "./marker.mjs";',
        'const FACES = Symbol.for("niceeval.report.faces");',
        'const DEFINITION = Symbol.for("niceeval.report.definition");',
        "const Block = (props) => Block[FACES].web(props);",
        "Block[FACES] = {",
        "  web: () => marker,",
        "  text: () => marker,",
        "};",
        "const definition = {",
        '  kind: "report",',
        "  links: [],",
        "  head: [],",
        "  scripts: [],",
        "  styles: [],",
        '  pages: [{ id: "report", title: "Report", input: "sample", render: () => ({ $$typeof: Symbol.for("react.transitional.element"), type: Block, props: {}, key: null }) }],',
        "};",
        "Object.defineProperty(definition, DEFINITION, { value: true });",
        "export default definition;",
        "",
      ].join("\n"),
      "utf-8",
    );
    const first = await loadViewScan(root, { report: { path: join(root, "report.mjs"), cwd: root } });
    expect(await first.reportPages.render(first.reportPages.ids[0]!, "en")).toContain("DEP_FIRST");

    await writeFile(join(root, "marker.mjs"), 'export const marker = "DEP_SECOND";\n', "utf-8");
    const second = await loadViewScan(root, { report: { path: join(root, "report.mjs"), cwd: root } });
    expect(await second.reportPages.render(second.reportPages.ids[0]!, "en")).toContain("DEP_SECOND");
    expect(await second.reportPages.render(second.reportPages.ids[0]!, "en")).not.toContain("DEP_FIRST");
  });

  it("经 config.cwd 装载时,改配置所 import 的报告文件后读到新内容", async () => {
    // vitest/vite-node 下对 .ts 做 namespaced register 会挂起;这条断言走与 CLI 相同的
    // `node --import tsx/esm` 子进程(bin 注册的同一套 hook)。
    const root = await seedReloadRoot();
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }), "utf-8");
    await writeFile(join(root, "report.mjs"), reportSource("CFG_FIRST"), "utf-8");
    await writeFile(
      join(root, "niceeval.config.ts"),
      ['import report from "./report.mjs";', "export default { report };", ""].join("\n"),
      "utf-8",
    );
    const script = join(root, "probe.mjs");
    await writeFile(
      script,
      [
        'import { writeFile } from "node:fs/promises";',
        'import { join } from "node:path";',
        `const root = ${JSON.stringify(root)};`,
        `const { loadViewScan } = await import(${JSON.stringify(resolve(__dirname, "./data.ts"))});`,
        "const block = (scan) => scan.reportPages.render(scan.reportPages.ids[0], 'en');",
        "const first = await block(await loadViewScan(root, { config: { cwd: root } }));",
        "if (!first.includes('CFG_FIRST')) throw new Error('first miss');",
        "await writeFile(join(root, 'report.mjs'), " + JSON.stringify(reportSource("CFG_SECOND")) + ");",
        "const second = await block(await loadViewScan(root, { config: { cwd: root } }));",
        "if (!second.includes('CFG_SECOND')) throw new Error('second miss: ' + second);",
        "if (second.includes('CFG_FIRST')) throw new Error('stale');",
        "console.log('ok');",
        "",
      ].join("\n"),
      "utf-8",
    );
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", script], {
      encoding: "utf-8",
      cwd: resolve(__dirname, "../.."),
      timeout: 30_000,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("ok");
  }, 30_000);
});
