// cases: docs/engineering/testing/unit/reports.md
// niceeval view 的报告槽装载语义(docs/feature/reports/architecture.md「Selection 是计算入口」
// 与裁决记录 6;公开行为准绳 docs-site/zh/tutorials/viewing-results.mdx / custom-reports.mdx)。
// 覆盖(「view 数据装载(ViewScan)」类别,见 unit/reports.md 覆盖规范):
// - 输入语义:位置参数只表示 eval id 前缀(不随文件系统状态改变),结果根走 --results,
//   单开一份快照走 --snapshot(文件不可读时失败),--results/--snapshot 互斥;
// - 组合语义:位置前缀收窄证据室(attemptsByBase/artifactDirs/attemptPages.locators),
//   不收窄时的对照;前缀/实验匹配不到直说;
// - 报告槽恒在:裸跑填充内建报告(三页声明序),--report 整槽替换不影响证据室索引,
//   viewData 不携带统计产物(overview/table/overall),报告文件缺失或非法默认导出的完整反馈;
// - 外壳标题取值链(def.title → 内置文案兜底)与 ReportLink.icon 原样透传进 viewData;
// - viewData.report.pages 是外壳认识的全部 scope-input page,`navigation: false` 带标记出场
//   (导航列不列由外壳按标记决定,内容块与 `#/page/<id>` 深链的键仍是这份列表);
// - dev server 装载语义:报告文件变更 → 下次装载读取新内容(mtime cache-busting)。
//
// 渲染出的 HTML 结构、终端/web 双面逐字比对、--out 导出产物与本地 server 的进程级行为
// 归 docs/engineering/testing/e2e/report.md §4/§5 对真实产物验收,不在本层断言。
//
// fixture 直接写新布局(<expDir>/<snapDir>/snapshot.json + <evalId>/a<n>/result.json),
// 依据是 docs/feature/record/architecture.md 的稳定磁盘契约,不经 writer 运行时 API。

import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// dist-sourced: this must be the exact class loadViewScan()/data.ts's loadReportFile() throws
// (see src/view/data.ts's comment) — a raw-src import would be a structurally-identical but
// `instanceof`-incompatible class.
import { ReportLoadError } from "../../dist/report/runtime/load.js";
import { ViewInputError, loadViewScan } from "./data.ts";
import { resolveViewInput } from "./index.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";

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

type AttemptFixture = Pick<EvalResult, "id" | "verdict"> & Partial<Pick<EvalResult, "attempt" | "durationMs" | "assertions">>;

function res(id: string, verdict: Verdict, extra: Partial<AttemptFixture> = {}): AttemptFixture {
  return { id, verdict, attempt: 0, durationMs: 1000, assertions: [], ...extra };
}

interface SnapshotOpts {
  experimentId: string;
  agent?: string;
  startedAt: string;
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
    schemaVersion: RESULTS_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.4.6" },
    experimentId: opts.experimentId,
    agent: opts.agent ?? "bub",
    startedAt: opts.startedAt,
    completedAt: opts.startedAt,
  };
  await writeFile(join(dir, "snapshot.json"), JSON.stringify(meta, null, 2), "utf-8");
  for (const r of results) {
    const attemptDir = join(dir, r.id, `a${r.attempt ?? 0}`);
    await mkdir(attemptDir, { recursive: true });
    await writeFile(join(attemptDir, "result.json"), JSON.stringify(r, null, 2), "utf-8");
  }
  return dir;
}

/** 两个实验、weather 通过 + button 失败:报告槽/证据室/深链断言都要用到失败案例。 */
async function seedRoot(): Promise<string> {
  const root = await makeRoot();
  await writeSnapshot(root, "compare_bub", "2026-07-08T10-00-00-000Z", { experimentId: "compare/bub", agent: "bub", startedAt: "2026-07-08T10:00:00.000Z" }, [
    res("weather/brooklyn", "passed"),
    res("fixtures/button", "failed", {
      assertions: [{ name: 'fileChanged("Button.tsx")', severity: "gate", score: 0, outcome: "failed" as const }],
    }),
  ]);
  await writeSnapshot(root, "compare_codex", "2026-07-09T10-00-00-000Z", { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-09T10:00:00.000Z" }, [
    res("weather/brooklyn", "passed"),
  ]);
  return root;
}

// ───────────────────────── 位置参数语义(单文件模式共存) ─────────────────────────

describe("resolveViewInput · 输入语义", () => {
  it("位置参数只表示 eval id 前缀:文件与目录路径不改变含义", async () => {
    const root = await seedRoot();
    const file = join(root, "compare_bub", "2026-07-08T10-00-00-000Z", "snapshot.json");
    // 恰好是存在文件/目录的位置参数也照常当前缀(后续按「无匹配」报错,不做模糊猜测)。
    expect(resolveViewInput(root, [file])).toEqual({ patterns: [file] });
    expect(resolveViewInput(root, ["compare_bub"])).toEqual({ patterns: ["compare_bub"] });
    expect(resolveViewInput(root, ["weather", "fixtures/button"])).toEqual({
      patterns: ["weather", "fixtures/button"],
    });
    expect(resolveViewInput(root, [])).toEqual({ patterns: [] });
  });

  it("--snapshot 单开一份快照文件;文件不可读时失败(与扫描模式的跳过相反)", async () => {
    const root = await seedRoot();
    const file = join(root, "compare_bub", "2026-07-08T10-00-00-000Z", "snapshot.json");
    expect(resolveViewInput(root, [], { snapshot: file })).toEqual({ input: file, patterns: [] });
    expect(() => resolveViewInput(root, [], { snapshot: join(root, "nope.json") })).toThrow(ViewInputError);
    expect(() => resolveViewInput(root, [], { snapshot: join(root, "nope.json") })).toThrow(/--snapshot/);
    // 目录不是快照文件。
    expect(() => resolveViewInput(root, [], { snapshot: join(root, "compare_bub") })).toThrow(/--snapshot/);
  });

  it("--results 指向不存在的目录:直说", async () => {
    const root = await seedRoot();
    expect(() => resolveViewInput(root, [], { results: join(root, "nope") })).toThrow(/Results directory not found/);
  });

  it("--results 换结果根,位置参数仍是前缀", async () => {
    const root = await seedRoot();
    expect(resolveViewInput("/elsewhere", ["weather"], { results: root })).toEqual({ input: root, patterns: ["weather"] });
  });

  it("--results 与 --snapshot 互斥:报错直说", async () => {
    const root = await seedRoot();
    const file = join(root, "compare_bub", "2026-07-08T10-00-00-000Z", "snapshot.json");
    expect(() => resolveViewInput(root, [], { results: root, snapshot: file })).toThrow(/mutually exclusive/);
  });
});

// ───────────────────────── 组合语义(与 show 对齐) ─────────────────────────

describe("loadViewScan · 组合语义", () => {
  it("位置前缀收窄作用在有效根上:证据室(attemptsByBase/artifactDirs)一致缩小,被滤掉的 attempt 不在场", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root, { patterns: ["weather"] });
    // 有效根即证据室:被滤掉的 attempt 不在 attemptsByBase 里,站点管线(site.ts)不会为它
    // 生成 attempt/<locator>.html。
    const filteredOut = [...scan.attemptsByBase.values()].find((a) => a.evalId === "fixtures/button");
    expect(filteredOut).toBeUndefined();
    expect(scan.artifactDirs.size).toBe(
      [...scan.artifactDirs.keys()].filter((base) => base.includes("weather/brooklyn")).length,
    );
    // 不收窄时深链照常可达,对照:
    const bare = await loadViewScan(root);
    const inBare = [...bare.attemptsByBase.values()].find((a) => a.evalId === "fixtures/button");
    expect(inBare?.locator).toBeTruthy();
    expect(bare.attemptPages!.locators.get(inBare!.locator!)).toBe(inBare);
  });

  it("前缀/实验匹配不到:直说,不渲染空页面", async () => {
    const root = await seedRoot();
    await expect(loadViewScan(root, { patterns: ["nosuch"] })).rejects.toBeInstanceOf(ViewInputError);
    await expect(loadViewScan(root, { patterns: ["nosuch"] })).rejects.toThrow(/weather\/brooklyn/);
    await expect(loadViewScan(root, { experiment: "nosuch" })).rejects.toBeInstanceOf(ViewInputError);
  });

  it("全部缺省:导航页即内建三页(声明序),viewData.report.pages 与 reportPages 一致", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root);
    // 报告页与 viewData 的页元数据是两份独立结构(渲染出的 HTML vs 序列化声明),
    // 两者的页 id 集合与顺序必须一致——导航页就是报告定义声明的页,声明序,宿主不追加。
    expect(scan.reportPages.map((p) => p.id)).toEqual(["report", "attempts", "traces"]);
    expect(scan.viewData.report?.pages.map((p) => p.id)).toEqual(["report", "attempts", "traces"]);
    expect(scan.viewData.report?.pages.map((p) => p.title)).toEqual([
      { en: "Report", "zh-CN": "报告" },
      "Attempts",
      { en: "Traces", "zh-CN": "追踪" },
    ]);
  });
});

// ───────────────────────── 报告槽恒在:统计产物只住在报告槽里 ─────────────────────────

describe("loadViewScan · 报告槽 viewData 不携带统计产物", () => {
  it("壳的 viewData 不携带统计产物:统计口径整体住在报告页里(官方组件的计算函数)", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root);
    expect(scan.viewData).not.toHaveProperty("overview");
    expect(scan.viewData).not.toHaveProperty("table");
    expect(scan.viewData).not.toHaveProperty("overall");
  });
});

// ───────────────────────── 报告槽整槽替换 ─────────────────────────

describe("loadViewScan · --report 报告槽", () => {
  it("--report 整槽替换不影响证据室索引:attemptsByBase 原样保留、每条都有 locator;报告块本体不进 viewData", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root, { report: { path: EXAM_REPORT, cwd: root } });
    expect(scan.attemptsByBase.size).toBeGreaterThan(0);
    expect([...scan.attemptsByBase.values()].every((a) => a.locator)).toBe(true);
    expect(JSON.stringify(scan.viewData)).not.toContain("考试成绩单"); // 报告块不进 viewData
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

// ───────────────────── 外壳:title 落点(hero / <title>)与 ReportLink.icon ─────────────────────

describe("loadViewScan · 外壳标题与 ReportLink.icon", () => {
  /** 不经包入口也合法的最小外壳报告(与下方 reportSource 同一姿势):声明 title 与带 icon 的 link。 */
  function shellReportSource(): string {
    return [
      'const FACES = Symbol.for("niceeval.report.faces");',
      'const DEFINITION = Symbol.for("niceeval.report.definition");',
      "const Block = (props) => Block[FACES].web(props);",
      "Block[FACES] = {",
      '  web: () => "SHELL_BODY",',
      '  text: () => "SHELL_BODY",',
      "};",
      "const definition = {",
      '  kind: "report",',
      '  title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },',
      '  links: [{ label: "GitHub", href: "https://example.com", icon: { svg: "<svg data-mark></svg>" } }],',
      "  head: [],",
      "  scripts: [],",
      "  styles: [],",
      '  pages: [{ id: "report", title: "Report", content: { $$typeof: Symbol.for("react.transitional.element"), type: Block, props: {}, key: null } }],',
      "};",
      "Object.defineProperty(definition, DEFINITION, { value: true });",
      "export default definition;",
      "",
    ].join("\n");
  }

  it("def.title 进 viewData.report.title;link 的 icon svg 原样透传进 viewData", async () => {
    const root = await seedRoot();
    const path = join(root, "shell-report.mjs");
    await writeFile(path, shellReportSource(), "utf-8");
    const scan = await loadViewScan(root, { report: { path, cwd: root } });
    // 标题回退链第一级:def.title 原样(hero 与浏览器标题都吃它)。
    expect(scan.viewData.report?.title).toEqual({ en: "Memory Evals", "zh-CN": "记忆能力评测" });
    // ReportLink.icon 经 viewData 序列化边界原样透传(web 面在 label 前渲染,静态导出原样内联)。
    expect(scan.viewData.report?.links).toEqual([
      { label: "GitHub", href: "https://example.com", icon: { svg: "<svg data-mark></svg>" } },
    ]);
  });

  it("无 def.title 且快照无 name:标题落内置文案「Eval 运行结果 / Eval Results」,不再是产品名", async () => {
    const root = await seedRoot(); // seedRoot 的快照都没有 name
    const scan = await loadViewScan(root);
    expect(scan.viewData.report?.title).toEqual({ en: "Eval Results", "zh-CN": "Eval 运行结果" });
  });
});

// ───────────────────── 外壳:页列表与 navigation 标记 ─────────────────────

describe("loadViewScan · scope-input page 的 navigation 标记", () => {
  /** 两张 scope-input page,第二张显式退出导航(不经包入口的最小报告,同上面两处姿势)。 */
  function twoPageReportSource(): string {
    const page = (id: string, extra: string) =>
      `{ id: "${id}", title: "${id}", input: "scope"${extra}, content: { $$typeof: Symbol.for("react.transitional.element"), type: Block, props: {}, key: null } }`;
    return [
      'const FACES = Symbol.for("niceeval.report.faces");',
      'const DEFINITION = Symbol.for("niceeval.report.definition");',
      "const Block = (props) => Block[FACES].web(props);",
      "Block[FACES] = {",
      '  web: () => "PAGE_BODY",',
      '  text: () => "PAGE_BODY",',
      "};",
      "const definition = {",
      '  kind: "report",',
      "  links: [],",
      "  head: [],",
      "  scripts: [],",
      "  styles: [],",
      `  pages: [${page("report", ", navigation: true")}, ${page("hidden", ", navigation: false")}],`,
      "};",
      "Object.defineProperty(definition, DEFINITION, { value: true });",
      "export default definition;",
      "",
    ].join("\n");
  }

  it("navigation: false 的 scope-input page 带标记进 viewData.report.pages:退出导航但内容与深链仍在场", async () => {
    const root = await seedRoot();
    const path = join(root, "two-page-report.mjs");
    await writeFile(path, twoPageReportSource(), "utf-8");
    const scan = await loadViewScan(root, { report: { path, cwd: root } });
    // 这份列表是外壳认识的全部 scope-input page(<template> 静态块与 `#/page/<id>` 路由的键),
    // 退出导航的页照样在列——外壳按标记决定列不列,不靠从列表里删页实现。
    expect(scan.viewData.report?.pages).toEqual([
      { id: "report", title: "report" },
      { id: "hidden", title: "hidden", navigation: false },
    ]);
    // 内容也照常渲染:退出导航不等于退出站点。
    expect(scan.reportPages.map((p) => p.id)).toEqual(["report", "hidden"]);
  });

  it("未声明 navigation 的页不带标记出场(缺省即在导航里)", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root);
    // 内建报告的三张 scope-input page 都在导航里;attempt-input 的第四张更早一步就不进这份列表。
    expect(scan.viewData.report?.pages.every((p) => !("navigation" in p))).toBe(true);
  });
});

// ───────────────────────── dev server 装载语义:整页重算 ─────────────────────────

describe("loadViewScan · 报告文件变更整页重算", () => {
  /** 不经包入口也合法的最小报告(与 show.test.ts 同一姿势):写 tmp .mjs 才能改内容重载。 */
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
      "  links: [],",
      "  head: [],",
      "  scripts: [],",
      "  styles: [],",
      '  pages: [{ id: "report", title: "Report", content: { $$typeof: Symbol.for("react.transitional.element"), type: Block, props: {}, key: null } }],',
      "};",
      "Object.defineProperty(definition, DEFINITION, { value: true });",
      "export default definition;",
      "",
    ].join("\n");
  }

  it("重写报告文件后,下一次装载读取新内容(mtime cache-busting,不复用陈旧模块)", async () => {
    const root = await seedRoot();
    const path = join(root, "report.mjs");
    await writeFile(path, reportSource("FIRST_RENDER"), "utf-8");
    const first = await loadViewScan(root, { report: { path, cwd: root } });
    expect(first.reportPages[0]!.html.en).toContain("FIRST_RENDER");

    await writeFile(path, reportSource("SECOND_RENDER"), "utf-8");
    // mtime 精度兜底:显式把 mtime 拨到未来,确保与首次装载可区分。
    const future = new Date(Date.now() + 5000);
    await utimes(path, future, future);
    const second = await loadViewScan(root, { report: { path, cwd: root } });
    expect(second.reportPages[0]!.html.en).toContain("SECOND_RENDER");
    expect(second.reportPages[0]!.html.en).not.toContain("FIRST_RENDER");
  });
});
