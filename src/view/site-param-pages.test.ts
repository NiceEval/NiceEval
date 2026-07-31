// cases: docs/engineering/testing/unit/reports.md
// 覆盖登记行(「参数化页与下钻目标」类别):`planSite` 对每张参数化页(attempt、experiment……
// 核心不区分实体种类)按 `params.enumerate()` 给出的每个实例各生成一份 `<pageId>/<key>.html`
// ——fixture 用内建报告(attempt + experiment 两张参数化页齐全),证明「渲染两张参数化页」
// 不是「渲染 attempt 专属机制」的错误实现在这里会漏文件。
// 同时覆盖「view 数据装载(ViewScan)」类别里「单实例失败」的两种处置:本地模式(`pageFailure:
// "embed"`)只污染自己的槽位,其它实例照常可读;静态导出(`writeSite`)任一实例失败则整体
// 失败,不留半套目录(view.md「静态导出」)。

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { planSite, readSiteFile, writeSite } from "./site.ts";
import { encodeAttemptLocator } from "../record/locator.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION } from "../types.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-siteparam-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/** 写一份新布局快照:run.json + 一个 attempt 的 result.json(与 data.test.ts 同一姿势)。 */
async function writeSnapshot(root: string, expDirName: string, experimentId: string, startedAt: string, evalId: string): Promise<void> {
  const dir = join(root, expDirName, startedAt.replace(/:/g, "-"));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "run.json"),
    JSON.stringify({
      format: RECORD_FORMAT,
      schemaVersion: RECORD_SCHEMA_VERSION,
      producer: { name: "niceeval", version: "0.4.0" },
      experimentId,
      agent: "agent",
      startedAt,
      completedAt: startedAt,
    }),
    "utf-8",
  );
  const attemptDir = join(dir, evalId, "a0");
  await mkdir(attemptDir, { recursive: true });
  await writeFile(
    join(attemptDir, "result.json"),
    JSON.stringify({ id: evalId, verdict: "passed", attempt: 0, durationMs: 1000, assertions: [] }),
    "utf-8",
  );
}

describe("planSite · 参数化页按 enumerate() 逐实例物化(attempt + experiment 齐全)", () => {
  it("两个 experiment 各一个 attempt:两张参数化页各产出对应数量的静态文档", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "exp_a", "exp/a", "2026-07-01T08:00:00.000Z", "q1");
    await writeSnapshot(root, "exp_b", "exp/b", "2026-07-02T08:00:00.000Z", "q1");

    const plan = await planSite(root);
    const paths = [...plan.files.keys()];

    const q1LocatorA = encodeAttemptLocator({
      experimentId: "exp/a",
      snapshotStartedAt: "2026-07-01T08:00:00.000Z",
      evalId: "q1",
      attempt: 0,
    });
    const q1LocatorB = encodeAttemptLocator({
      experimentId: "exp/b",
      snapshotStartedAt: "2026-07-02T08:00:00.000Z",
      evalId: "q1",
      attempt: 0,
    });
    // attempt 页:每个可达 locator 各一份静态文档,不是只有一份 attempt 目录里混装内容。
    expect(paths).toContain(`attempt/${encodeURIComponent(q1LocatorA)}.html`);
    expect(paths).toContain(`attempt/${encodeURIComponent(q1LocatorB)}.html`);
    // experiment 页:两个 experiment id 各一份——证明它不是「attempt 专属渲染路径」的副产品,
    // 而是同一条通用 `params.enumerate()` 机制对另一张参数化页的独立产出。
    expect(paths).toContain(`experiment/${encodeURIComponent("exp/a")}.html`);
    expect(paths).toContain(`experiment/${encodeURIComponent("exp/b")}.html`);
  });
});

/**
 * 自定义 `attempt` 页覆盖:render 对指定 locator 抛错,其它 locator 正常——用来制造
 * 「一个参数化页实例失败,其它实例是否受影响」的区分力(与 defineReport() 校验路径无关,
 * 直接手工构造已规范化的报告定义,和 data.test.ts / site-head.test.ts 的 fixture 同一姿势)。
 */
function attemptOverrideReportSource(failingLocator: string): string {
  return [
    'const FACES = Symbol.for("niceeval.report.faces");',
    'const DEFINITION = Symbol.for("niceeval.report.definition");',
    "const Block = (props) => Block[FACES].web(props);",
    'Block[FACES] = { web: () => "OK_BODY", text: () => "OK_BODY" };',
    "const el = () => ({ $$typeof: Symbol.for(\"react.transitional.element\"), type: Block, props: {}, key: null });",
    "const attemptPage = {",
    '  id: "attempt",',
    '  title: "Attempt",',
    "  navigation: false,",
    "  params: {",
    "    encode: (p) => p.locator,",
    "    decode: (k) => ({ locator: k }),",
    "    enumerate: (base) => base.attempts.filter((a) => a.locator !== undefined).map((a) => ({ locator: a.locator })),",
    "  },",
    "  load: (_base, p) => p,",
    `  render: (p) => { if (p.locator === ${JSON.stringify(failingLocator)}) { throw new Error("boom"); } return el(); },`,
    "};",
    "const definition = {",
    '  kind: "report",',
    "  head: [],",
    "  pages: [",
    '    { id: "report", title: "Report", render: () => el() },',
    "    attemptPage,",
    "  ],",
    "};",
    "Object.defineProperty(definition, DEFINITION, { value: true });",
    "export default definition;",
    "",
  ].join("\n");
}

describe("planSite / writeSite · 单实例失败的两种处置", () => {
  it("本地模式(pageFailure: embed)只污染失败的那个实例;其它实例照常可读", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "exp_a", "exp/a", "2026-07-01T08:00:00.000Z", "q1");
    await writeSnapshot(root, "exp_b", "exp/b", "2026-07-02T08:00:00.000Z", "q1");
    const failingLocator = encodeAttemptLocator({
      experimentId: "exp/a",
      snapshotStartedAt: "2026-07-01T08:00:00.000Z",
      evalId: "q1",
      attempt: 0,
    });
    const okLocator = encodeAttemptLocator({
      experimentId: "exp/b",
      snapshotStartedAt: "2026-07-02T08:00:00.000Z",
      evalId: "q1",
      attempt: 0,
    });
    const path = join(root, "report.mjs");
    await writeFile(path, attemptOverrideReportSource(failingLocator), "utf-8");

    const plan = await planSite(root, { report: { path, cwd: root }, pageFailure: "embed" });
    const failingFile = plan.files.get(`attempt/${encodeURIComponent(failingLocator)}.html`)!;
    const okFile = plan.files.get(`attempt/${encodeURIComponent(okLocator)}.html`)!;

    const failingBody = (await readSiteFile(failingFile)) as string;
    expect(failingBody).toContain("niceeval-page-error");
    expect(failingBody).toContain("boom");

    const okBody = (await readSiteFile(okFile)) as string;
    expect(okBody).not.toContain("niceeval-page-error");
    expect(okBody).toContain("OK_BODY");
  });

  it("静态导出(writeSite)任一实例失败则整体失败,不留半套目录", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "exp_a", "exp/a", "2026-07-01T08:00:00.000Z", "q1");
    await writeSnapshot(root, "exp_b", "exp/b", "2026-07-02T08:00:00.000Z", "q1");
    const failingLocator = encodeAttemptLocator({
      experimentId: "exp/a",
      snapshotStartedAt: "2026-07-01T08:00:00.000Z",
      evalId: "q1",
      attempt: 0,
    });
    const path = join(root, "report.mjs");
    await writeFile(path, attemptOverrideReportSource(failingLocator), "utf-8");

    // 静态导出的缺省处置是 "throw"(与 --out 同义,architecture.md「管线以 page 实例为单位执行」)。
    const plan = await planSite(root, { report: { path, cwd: root } });
    const outDir = join(root, "out");
    await expect(writeSite(plan, outDir)).rejects.toThrow(/boom/);
    // 全有或全无:失败实例之外的文件(包括本该成功的 attempt/experiment 实例)也没有落盘。
    expect(existsSync(outDir) && (await readdir(outDir)).length > 0).toBe(false);
  });
});
