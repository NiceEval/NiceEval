// niceeval view 的 --report 报告槽与宿主组合语义(docs/reports.md「宿主输入的组合语义」
// 与裁决记录 6;公开行为准绳 docs-site/zh/guides/viewing-results.mdx / custom-reports.mdx)。
// 覆盖:
// - 组合语义与 show 对齐:位置前缀收窄报告槽 Selection、--experiment 过滤、匹配不到直说;
// - 单文件模式共存:存在的文件路径 → 单文件模式,目录报错直说走 --run,其余按 eval 前缀;
// - 报告槽整槽替换:报告 HTML(含 <Style> 产物与证据室深链)烘进静态块,证据室数据原样保留;
// - --out 静态导出:index.html 含报告块与官方样式,报告 HTML 零 <script>;
// - dev server 装载语义:报告文件变更 → 下次装载整页重算(mtime cache-busting)。

import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReportLoadError } from "../report/load.ts";
import { ViewInputError, loadViewScan } from "./data.ts";
import { buildView, resolveViewInput } from "./index.ts";
import { runShow } from "../show/index.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type RunSummary } from "../types.ts";

const EXAM_REPORT = resolve(__dirname, "../../test/fixtures/report/exam-report.tsx");

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-viewreport-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function res(over: Partial<EvalResult> & Pick<EvalResult, "id">): EvalResult {
  return { agent: "bub", verdict: "passed", attempt: 0, durationMs: 1000, assertions: [], ...over };
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

async function writeRun(root: string, dirName: string, summary: RunSummary): Promise<string> {
  const dir = join(root, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  return dir;
}

/** 两个实验、weather 通过 + button 失败:报告槽/证据室/深链断言都要用到失败案例。 */
async function seedRoot(): Promise<string> {
  const root = await makeRoot();
  await writeRun(
    root,
    "2026-07-08T10-00-00-000Z",
    summaryOf(
      [
        res({ id: "weather/brooklyn", experimentId: "compare/bub", startedAt: "2026-07-08T10:00:01.000Z" }),
        res({
          id: "fixtures/button",
          experimentId: "compare/bub",
          verdict: "failed",
          startedAt: "2026-07-08T10:00:02.000Z",
          assertions: [
            { name: 'fileChanged("Button.tsx")', severity: "gate", score: 0, passed: false },
          ],
        }),
      ],
      { startedAt: "2026-07-08T10:00:00.000Z" },
    ),
  );
  await writeRun(
    root,
    "2026-07-09T10-00-00-000Z",
    summaryOf(
      [res({ id: "weather/brooklyn", experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-09T10:00:01.000Z" })],
      { agent: "codex", startedAt: "2026-07-09T10:00:00.000Z" },
    ),
  );
  return root;
}

// ───────────────────────── 位置参数语义(单文件模式共存) ─────────────────────────

describe("resolveViewInput · 位置参数语义", () => {
  it("存在的文件路径 → 单文件模式;其余位置参数按 eval id 前缀", async () => {
    const root = await seedRoot();
    const file = join(root, "2026-07-08T10-00-00-000Z", "summary.json");
    expect(resolveViewInput(root, [file])).toEqual({ input: file, patterns: [] });
    expect(resolveViewInput(root, ["weather", "fixtures/button"])).toEqual({
      patterns: ["weather", "fixtures/button"],
    });
    expect(resolveViewInput(root, [])).toEqual({ patterns: [] });
  });

  it("目录位置参数:报错直说走 --run(位置参数留给 eval id 前缀)", async () => {
    const root = await seedRoot();
    expect(() => resolveViewInput(root, ["2026-07-08T10-00-00-000Z"])).toThrow(ViewInputError);
    expect(() => resolveViewInput(root, ["2026-07-08T10-00-00-000Z"])).toThrow(/--run/);
  });

  it("单文件模式不与其它位置参数或 --run 混用,歧义报错直说", async () => {
    const root = await seedRoot();
    const file = join(root, "2026-07-08T10-00-00-000Z", "summary.json");
    expect(() => resolveViewInput(root, [file, "weather"])).toThrow(/exactly one path/);
    expect(() => resolveViewInput(root, [file], root)).toThrow(/--run/);
  });

  it("--run 指向不存在的目录:直说", async () => {
    const root = await seedRoot();
    expect(() => resolveViewInput(root, [], join(root, "nope"))).toThrow(/Results directory not found/);
  });

  it("--run 换结果根,位置参数仍是前缀", async () => {
    const root = await seedRoot();
    expect(resolveViewInput("/elsewhere", ["weather"], root)).toEqual({ input: root, patterns: ["weather"] });
  });
});

// ───────────────────────── 组合语义(与 show 对齐) ─────────────────────────

describe("loadViewScan · 组合语义", () => {
  it("位置前缀收窄报告槽 Selection(榜单/overview);证据室快照不收窄,深链恒可达", async () => {
    const root = await seedRoot();
    const { viewData } = await loadViewScan(root, { patterns: ["weather"] });
    // 报告槽:两实验都只剩 weather/brooklyn 一题,全过。
    expect(viewData.overview.totals.evals).toBe(1);
    expect(viewData.overview.totals.attempts).toBe(2); // 2 个实验各 1 attempt
    for (const row of viewData.table.rows) {
      expect(row.cells["pass-rate"]!.value).toBe(1);
    }
    // 证据室:快照明细仍含 fixtures/button(attempt 深链在收窄下也能解析)。
    const allIds = viewData.snapshots.flatMap((s) => s.results.map((r) => r.id));
    expect(allIds).toContain("fixtures/button");
  });

  it("--experiment 过滤:Selection 只留该实验", async () => {
    const root = await seedRoot();
    const { viewData } = await loadViewScan(root, { experiment: "compare/codex" });
    expect(viewData.table.rows.map((r) => r.key)).toEqual(["compare/codex"]);
  });

  it("前缀/实验匹配不到:直说,不渲染空页面", async () => {
    const root = await seedRoot();
    await expect(loadViewScan(root, { patterns: ["nosuch"] })).rejects.toBeInstanceOf(ViewInputError);
    await expect(loadViewScan(root, { patterns: ["nosuch"] })).rejects.toThrow(/weather\/brooklyn/);
    await expect(loadViewScan(root, { experiment: "nosuch" })).rejects.toBeInstanceOf(ViewInputError);
  });

  it("全部缺省:默认行为不变(results.latest() 口径,不走合成)", async () => {
    const root = await seedRoot();
    const { viewData, reportHtml } = await loadViewScan(root);
    expect(reportHtml).toBeUndefined();
    expect(viewData.table.rows.map((r) => r.key).sort()).toEqual(["compare/bub", "compare/codex"]);
  });
});

// ───────────────────────── 报告槽整槽替换 ─────────────────────────

describe("loadViewScan · --report 报告槽", () => {
  it("报告树渲染为静态 HTML:官方水位 + 自定义摆法 + <Style> 产物 + 证据室深链,零 <script>", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root, { report: { path: EXAM_REPORT, cwd: root } });
    const html = scan.reportHtml!;
    expect(html).toContain("考试成绩单"); // 自定义 Section
    expect(html).toContain("nre-"); // 官方组件的稳定类名
    expect(html).toContain("<style>.exam-note { color: #4a7; }</style>"); // <Style> 随树带走
    expect(html).toContain("#/attempt/2026-07-08T10-00-00-000Z/"); // 失败案例深链进证据室
    expect(html).not.toContain("<script"); // 报告槽产物零客户端 JS,不 hydrate
    // 证据室数据契约(__NICEEVAL_VIEW_DATA__)原样保留:快照、attemptRef、skipped 不动。
    expect(scan.viewData.snapshots.length).toBeGreaterThan(0);
    expect(scan.viewData.snapshots.flatMap((s) => s.results).every((r) => r.attemptRef)).toBe(true);
    expect(JSON.stringify(scan.viewData)).not.toContain("考试成绩单"); // 报告块不进 viewData
  });

  it("位置前缀对 --report 生效:收窄注入 Selection,报告只见范围内的 eval", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root, {
      patterns: ["weather"],
      report: { path: EXAM_REPORT, cwd: root },
    });
    // 范围外的失败(fixtures/button)不再出现在报告里;范围内的实验行都在。
    expect(scan.reportHtml).not.toContain("fixtures/button");
    expect(scan.reportHtml).toContain("compare/bub");
    expect(scan.reportHtml).toContain("compare/codex");
  });

  it("show --report 与 view --report 吃同一个报告文件,判定口径一致", async () => {
    const root = await seedRoot();
    let text = "";
    const code = await runShow(root, [], { run: root, report: EXAM_REPORT }, {
      out: (s) => (text += s),
      err: () => {},
      width: 120,
    });
    expect(code).toBe(0);
    const scan = await loadViewScan(root, { report: { path: EXAM_REPORT, cwd: root } });
    // 同一棵树的两个面:同一份失败清单与同一个自定义 Section。
    for (const needle of ["考试成绩单", "compare/bub", "compare/codex", "fixtures/button"]) {
      expect(text).toContain(needle);
      expect(scan.reportHtml).toContain(needle);
    }
  });

  it("报告文件缺失 / 默认导出不是 defineReport 产物:ReportLoadError 直说", async () => {
    const root = await seedRoot();
    await expect(
      loadViewScan(root, { report: { path: join(root, "missing.tsx"), cwd: root } }),
    ).rejects.toBeInstanceOf(ReportLoadError);
    const bad = join(root, "bad.mjs");
    await writeFile(bad, "export default {};\n", "utf-8");
    await expect(loadViewScan(root, { report: { path: bad, cwd: root } })).rejects.toThrow(
      /does not default-export a report/,
    );
  });
});

// ───────────────────────── dev server 装载语义:整页重算 ─────────────────────────

describe("loadViewScan · 报告文件变更整页重算", () => {
  /** 不经包入口也合法的最小报告(与 show.test.ts 同一姿势):写 tmp .mjs 才能改内容重载。 */
  function reportSource(marker: string): string {
    return [
      'const FACES = Symbol.for("niceeval.report.faces");',
      "const Block = (props) => Block[FACES].web(props);",
      "Block[FACES] = {",
      `  web: () => "${marker}",`,
      `  text: () => "${marker}",`,
      "};",
      "export default {",
      '  [Symbol.for("niceeval.report.definition")]: true,',
      "  build: () => ({",
      '    $$typeof: Symbol.for("react.transitional.element"),',
      "    type: Block,",
      "    props: {},",
      "    key: null,",
      "  }),",
      "};",
      "",
    ].join("\n");
  }

  it("重写报告文件后,下一次装载渲染新内容(mtime cache-busting)", async () => {
    const root = await seedRoot();
    const path = join(root, "report.mjs");
    await writeFile(path, reportSource("FIRST_RENDER"), "utf-8");
    const first = await loadViewScan(root, { report: { path, cwd: root } });
    expect(first.reportHtml).toContain("FIRST_RENDER");

    await writeFile(path, reportSource("SECOND_RENDER"), "utf-8");
    // mtime 精度兜底:显式把 mtime 拨到未来,确保与首次装载可区分。
    const future = new Date(Date.now() + 5000);
    await utimes(path, future, future);
    const second = await loadViewScan(root, { report: { path, cwd: root } });
    expect(second.reportHtml).toContain("SECOND_RENDER");
    expect(second.reportHtml).not.toContain("FIRST_RENDER");
  });
});

// ───────────────────────── --out 静态导出 ─────────────────────────

describe("buildView · --out 与 --report", () => {
  it("报告页为首页报告槽,证据室同站:index.html 含报告块与官方样式, artifact 照常复制", async () => {
    const root = await seedRoot();
    // 给 weather attempt 一份 events artifact,验证证据室 artifact 照常进导出。
    const artifactDir = join(root, "2026-07-09T10-00-00-000Z", "artifacts", "weather");
    await mkdir( artifactDir, { recursive: true });
    await writeFile(join( artifactDir, "events.json"), "[]", "utf-8");
    const summaryPath = join(root, "2026-07-09T10-00-00-000Z", "summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf-8")) as RunSummary;
    summary.results[0]!.artifactsDir = "artifacts/weather";
    await writeFile(summaryPath, JSON.stringify(summary), "utf-8");

    const out = join(root, "site");
    await buildView({ input: root, out, scan: { report: { path: EXAM_REPORT, cwd: root } } });

    const html = await readFile(join(out, "index.html"), "utf-8");
    expect(html).toContain('<template id="niceeval-report">');
    expect(html).toContain("考试成绩单");
    expect(html).toContain("nre-"); // 官方组件样式(report/react/styles.css)随页注入
    // 报告块本体零 <script>:静态块起于 <template>,内部只有标记与 <style>。
    const block = html.split('<template id="niceeval-report">')[1]!.split("</template>")[0]!;
    expect(block).not.toContain("<script");
    // 证据室同站: artifact 按 /artifact/<base>/ 布局复制。
    expect(existsSync(join(out, "artifact", "2026-07-09T10-00-00-000Z/artifacts/weather", "events.json"))).toBe(true);
  });

  it("默认导出(无 --report)不含报告块,行为不变", async () => {
    const root = await seedRoot();
    const out = join(root, "site");
    await buildView({ input: root, out });
    const html = await readFile(join(out, "index.html"), "utf-8");
    expect(html).not.toContain('<template id="niceeval-report">');
  });
});
