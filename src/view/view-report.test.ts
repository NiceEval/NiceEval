// cases: docs/engineering/unit-tests/reports/cases.md
// niceeval view 的报告槽与宿主组合语义(docs/feature/reports/architecture.md「Selection 是计算入口」
// 与裁决记录 6;公开行为准绳 docs-site/zh/tutorials/viewing-results.mdx / custom-reports.mdx)。
// 覆盖:
// - 组合语义与 show 对齐:位置前缀收窄报告槽 Scope、--exp 过滤、匹配不到直说;
// - 输入语义:位置参数只表示 eval id 前缀(不随文件系统状态改变),结果根走 --results,
//   单开一份快照走 --snapshot(文件不可读时失败);
// - 报告槽恒在:裸跑填充内建报告,--report 整槽替换;en / zh-CN 双语各渲染一遍;
//   裸跑 ≡ --report <re-export ExperimentComparison 的文件>(等价性);
// - --out 静态导出:index.html 含两个语言的报告块、官方样式与增强 runtime,报告块零 <script>;
// - dev server 装载语义:报告文件变更 → 下次装载整页重算(mtime cache-busting)。
//
// fixture 直接写新布局(<expDir>/<snapDir>/snapshot.json + <evalId>/a<n>/result.json),
// 依据是 docs/feature/results/architecture.md 的稳定磁盘契约,不经 writer 运行时 API。

import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// dist-sourced: this must be the exact class loadViewScan()/data.ts's loadReportFile() throws
// (see src/view/data.ts's comment) — a raw-src import would be a structurally-identical but
// `instanceof`-incompatible class.
import { ReportLoadError } from "../../dist/report/load.js";
import { ViewInputError, loadViewScan, type ViewScan } from "./data.ts";
import { renderHtml } from "./site.ts";
import { buildView, resolveViewInput } from "./index.ts";
import { runShow } from "../show/index.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";

const EXAM_REPORT = resolve(__dirname, "../../test/fixtures/report/exam-report.tsx");
const DEFAULT_REPORT_REEXPORT = resolve(__dirname, "../../test/fixtures/report/default-report-reexport.tsx");

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


/** 单页报告(树形态 --report)的报告槽 HTML:规范化后唯一页 id 恒为 `report`。 */
function slotHtml(scan: ViewScan): { en: string; "zh-CN": string } {
  expect(scan.reportPages).toHaveLength(1);
  expect(scan.reportPages[0]!.id).toBe("report");
  return scan.reportPages[0]!.html as { en: string; "zh-CN": string };
}

/** 多页定义(裸跑装载的内建报告是三页)按页 id 取报告槽 HTML。 */
function pageHtml(scan: ViewScan, id: string): { en: string; "zh-CN": string } {
  const page = scan.reportPages.find((p) => p.id === id);
  expect(page, `page ${id}`).toBeTruthy();
  return page!.html as { en: string; "zh-CN": string };
}

/** 裸跑的首页(内建报告的 report 页):先断言内建三页齐全,再取首页 HTML。 */
function bareReportHtml(scan: ViewScan): { en: string; "zh-CN": string } {
  expect(scan.reportPages.map((p) => p.id)).toEqual(["report", "attempts", "traces"]);
  return pageHtml(scan, "report");
}

// ───────────────────────── 组合语义(与 show 对齐) ─────────────────────────

describe("loadViewScan · 组合语义", () => {
  it("位置前缀收窄作用在有效根上:全部页与证据室一致缩小,被滤掉的 attempt 不烘进页面数据", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root, { patterns: ["weather"] });
    const { viewData } = scan;
    const reportHtml = bareReportHtml(scan);
    // 报告页:两实验都只剩 weather/brooklyn 一题,范围外的失败不再出现。
    expect(reportHtml.en).toContain("compare/bub");
    expect(reportHtml.en).toContain("compare/codex");
    expect(reportHtml.en).not.toContain("fixtures/button");
    // Attempts / Traces 是普通页,共享同一收窄后 Scope:行集同样缩小。
    expect(pageHtml(scan, "attempts").en).not.toContain("fixtures/button");
    expect(pageHtml(scan, "traces").en).not.toContain("fixtures/button");
    const bare = await loadViewScan(root);
    expect(pageHtml(bare, "attempts").en).toContain("fixtures/button"); // 不收窄时在场,对照
    // 有效根即证据室:被滤掉的 attempt 不在 viewData.snapshots 里,深链两宿主一致不可达。
    const filteredOut = viewData.snapshots
      .flatMap((s) => s.results)
      .find((r) => r.id === "fixtures/button");
    expect(filteredOut).toBeUndefined();
    expect(scan.artifactDirs.size).toBe(
      [...scan.artifactDirs.keys()].filter((base) => base.includes("weather/brooklyn")).length,
    );
    // 收窄之内、不在现刻水位的口径差异由 --exp 深链测试覆盖;不收窄时深链照常可达,对照:
    const inBare = bare.viewData.snapshots.flatMap((s) => s.results).find((r) => r.id === "fixtures/button");
    expect(inBare?.locator).toBeTruthy();
    const { resolveAttemptLocator } = await import("./app/lib/attempt-route.ts");
    expect(resolveAttemptLocator(bare.viewData.snapshots, inBare!.locator!)).toBe(inBare);
  });

  it("--exp 过滤:报告槽 Selection 只留该实验", async () => {
    const root = await seedRoot();
    const reportHtml = bareReportHtml(await loadViewScan(root, { experiment: "compare/codex" }));
    expect(reportHtml.en).toContain("compare/codex");
    expect(reportHtml.en).not.toContain("compare/bub");
  });

  it("前缀/实验匹配不到:直说,不渲染空页面", async () => {
    const root = await seedRoot();
    await expect(loadViewScan(root, { patterns: ["nosuch"] })).rejects.toBeInstanceOf(ViewInputError);
    await expect(loadViewScan(root, { patterns: ["nosuch"] })).rejects.toThrow(/weather\/brooklyn/);
    await expect(loadViewScan(root, { experiment: "nosuch" })).rejects.toBeInstanceOf(ViewInputError);
  });

  it("全部缺省:报告槽使用现刻水位口径(与 show 相同的合成规则);导航页即内建三页", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root);
    const reportHtml = bareReportHtml(scan);
    // 默认报告的榜单含两个实验;官方组件的稳定类名在场。
    expect(reportHtml.en).toContain("compare/bub");
    expect(reportHtml.en).toContain("compare/codex");
    expect(reportHtml.en).toContain("nre-");
    // 导航 = 报告定义声明的页(声明序),宿主不追加:裸 view 的三个 tab 就是内建三页。
    expect(scan.viewData.report?.pages.map((p) => p.id)).toEqual(["report", "attempts", "traces"]);
    expect(scan.viewData.report?.pages.map((p) => p.title)).toEqual([
      { en: "Report", "zh-CN": "报告" },
      "Attempts",
      { en: "Traces", "zh-CN": "追踪" },
    ]);
  });
});

// ─────────────────── 报告槽恒在:裸跑 ≡ --report <ExperimentComparison> ───────────────────

describe("loadViewScan · 默认报告槽(裸跑)", () => {
  it("裸跑产出的报告槽 HTML 与 --report <re-export 内建报告的文件> 逐页完全一致(双语)", async () => {
    const root = await seedRoot();
    const bare = await loadViewScan(root);
    const viaReport = await loadViewScan(root, {
      report: { path: DEFAULT_REPORT_REEXPORT, cwd: root },
    });
    expect(viaReport.reportPages.map((p) => p.id)).toEqual(bare.reportPages.map((p) => p.id));
    for (const pageId of ["report", "attempts", "traces"]) {
      expect(pageHtml(viaReport, pageId).en).toBe(pageHtml(bare, pageId).en);
      expect(pageHtml(viaReport, pageId)["zh-CN"]).toBe(pageHtml(bare, pageId)["zh-CN"]);
    }
  });

  it("报告槽双语渲染:同一棵树按 locale 渲染两遍,chrome 文案分语言、数据不分语言", async () => {
    const root = await seedRoot();
    const reportHtml = bareReportHtml(await loadViewScan(root));
    expect(reportHtml.en).toContain("Pass rate"); // ExperimentList 主行(en)
    expect(reportHtml["zh-CN"]).toContain("通过率"); // ExperimentList 主行(zh-CN)
    for (const html of [reportHtml.en, reportHtml["zh-CN"]]) {
      expect(html).toContain("compare/bub");
      // 失败案例深链进证据室:不透明 AttemptLocator 单段路由 `#/attempt/@<locator>`,
      // 不再是旧的两段式 `#/attempt/<snapshot>/<attempt>`。
      expect(html).toMatch(/href="#\/attempt\/@[0-9a-z]+"/);
      expect(html).not.toContain("<script"); // 报告槽产物零客户端 JS,不 hydrate
    }
  });

  it("失败清单与警告住在报告页里:ExperimentList 列出失败,壳的 viewData 不携带统计产物", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root);
    const { viewData } = scan;
    expect(bareReportHtml(scan).en).toContain("fixtures/button");
    // 品牌行是页内组件(Hero 恒含),不是宿主 chrome:每页 web 面都带官网品牌行。
    for (const pageId of ["report", "attempts", "traces"]) {
      const html = pageHtml(scan, pageId).en;
      expect(html).toContain("nre-powered-by");
      expect(html).toContain("https://niceeval.com/?utm_source=report&amp;utm_medium=powered-by");
    }
    // viewData 只有证据室数据:快照 + skipped + 壳元信息。
    expect(viewData).not.toHaveProperty("overview");
    expect(viewData).not.toHaveProperty("table");
    expect(viewData).not.toHaveProperty("overall");
  });
});

// ───────────────────────── 报告槽整槽替换 ─────────────────────────

describe("loadViewScan · --report 报告槽", () => {
  it("报告树渲染为静态 HTML:官方水位 + 自定义摆法 + <Style> 产物,零 <script>", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root, { report: { path: EXAM_REPORT, cwd: root } });
    const html = slotHtml(scan).en;
    expect(html).toContain("考试成绩单"); // 自定义 Section
    expect(html).toContain("nre-"); // 官方组件的稳定类名
    expect(html).toContain("<style>.exam-note { color: #4a7; }</style>"); // <Style> 随树带走
    // exam-report.tsx 是树形态 defineReport,没有声明 attempt-input page:locator 因此只是
    // 纯文本,不生成假 href(architecture.md「Attempt 详情是一张参数化 page」)。
    expect(html).toMatch(/<span class="nre-locator[^"]*">@[0-9a-z]+/);
    expect(html).not.toMatch(/href="#\/attempt\//);
    expect(html).not.toContain("<script"); // 报告槽产物零客户端 JS,不 hydrate
    // 用户报告同样双语渲染两遍(壳按界面语言摆放)。
    expect(slotHtml(scan)["zh-CN"]).toContain("考试成绩单");
    // 证据室数据契约(__NICEEVAL_VIEW_DATA__)原样保留:快照、locator、skipped 不动。
    expect(scan.viewData.snapshots.length).toBeGreaterThan(0);
    expect(scan.viewData.snapshots.flatMap((s) => s.results).every((r) => r.locator)).toBe(true);
    expect(JSON.stringify(scan.viewData)).not.toContain("考试成绩单"); // 报告块不进 viewData
  });

  it("位置前缀对 --report 生效:收窄注入 Selection,报告只见范围内的 eval", async () => {
    const root = await seedRoot();
    const scan = await loadViewScan(root, {
      patterns: ["weather"],
      report: { path: EXAM_REPORT, cwd: root },
    });
    // 范围外的失败(fixtures/button)不再出现在报告里;范围内的实验行都在。
    const html = slotHtml(scan);
    expect(html.en).not.toContain("fixtures/button");
    expect(html.en).toContain("compare/bub");
    expect(html.en).toContain("compare/codex");
  });

  it("show --report 与 view --report 吃同一个报告文件,判定口径一致", async () => {
    const root = await seedRoot();
    let text = "";
    const code = await runShow(root, [], { results: root, report: EXAM_REPORT }, {
      out: (s) => (text += s),
      err: () => {},
      width: 120,
    });
    expect(code).toBe(0);
    const scan = await loadViewScan(root, { report: { path: EXAM_REPORT, cwd: root } });
    // 同一棵树的两个面:同一份失败清单与同一个自定义 Section。
    const html = slotHtml(scan);
    for (const needle of ["考试成绩单", "compare/bub", "compare/codex", "fixtures/button"]) {
      expect(text).toContain(needle);
      expect(html.en).toContain(needle);
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

  it("def.title 进 viewData.report.title,初始 <title> 同源烘进 HTML;link 的 icon svg 原样透传", async () => {
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
    const html = await renderHtml(scan);
    expect(html).toContain("<title>Memory Evals</title>");
  });

  it("无 def.title 且快照无 name:标题落内置文案「Eval 运行结果 / Eval Results」,不再是产品名", async () => {
    const root = await seedRoot(); // seedRoot 的快照都没有 name
    const scan = await loadViewScan(root);
    expect(scan.viewData.report?.title).toEqual({ en: "Eval Results", "zh-CN": "Eval 运行结果" });
    const html = await renderHtml(scan);
    expect(html).toContain("<title>Eval Results</title>");
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

  it("重写报告文件后,下一次装载渲染新内容(mtime cache-busting)", async () => {
    const root = await seedRoot();
    const path = join(root, "report.mjs");
    await writeFile(path, reportSource("FIRST_RENDER"), "utf-8");
    const first = slotHtml(await loadViewScan(root, { report: { path, cwd: root } }));
    expect(first.en).toContain("FIRST_RENDER");

    await writeFile(path, reportSource("SECOND_RENDER"), "utf-8");
    // mtime 精度兜底:显式把 mtime 拨到未来,确保与首次装载可区分。
    const future = new Date(Date.now() + 5000);
    await utimes(path, future, future);
    const second = slotHtml(await loadViewScan(root, { report: { path, cwd: root } }));
    expect(second.en).toContain("SECOND_RENDER");
    expect(second.en).not.toContain("FIRST_RENDER");
  });
});

// ───────────────────────── --out 静态导出 ─────────────────────────

describe("buildView · --out 与 --report", () => {
  it("报告页为首页报告槽,证据室同站:index.html 含报告块与官方样式,artifact 照常复制", async () => {
    const root = await seedRoot();
    // 给 weather attempt 一份 events artifact,验证证据室 artifact 照常进导出。
    // 本快照跑出的条目:artifact 目录 = <snapshot.dir>/<evalId>/a<n>,不需要声明字段。
    const artifactDir = join(root, "compare_codex", "2026-07-09T10-00-00-000Z", "weather", "brooklyn", "a0");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "events.json"), "[]", "utf-8");

    const out = join(root, "site");
    await buildView({ input: root, out, scan: { report: { path: EXAM_REPORT, cwd: root } } });

    const html = await readFile(join(out, "index.html"), "utf-8");
    // 双语两个 <template> 静态块都在,壳按界面语言摆放。
    expect(html).toContain('<template id="niceeval-report-report-en">');
    expect(html).toContain('<template id="niceeval-report-report-zh-CN">');
    expect(html).toContain("考试成绩单");
    expect(html).toContain("nre-"); // 官方组件样式(report/react/styles.css)随页注入
    // 报告块本体零 <script>:静态块起于 <template>,内部只有标记与 <style>。
    const block = html.split('<template id="niceeval-report-report-en">')[1]!.split("</template>")[0]!;
    expect(block).not.toContain("<script");
    // 证据室同站: artifact 按 /artifact/<base>/ 布局复制。
    expect(
      existsSync(join(out, "artifact", "compare_codex/2026-07-09T10-00-00-000Z/weather/brooklyn/a0", "events.json")),
    ).toBe(true);
  });

  it("--out 无档位:diff.json 有就带,o11y.json 永不复制", async () => {
    const root = await seedRoot();
    const artifactDir = join(root, "compare_codex", "2026-07-09T10-00-00-000Z", "weather", "brooklyn", "a0");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "events.json"), "[]", "utf-8");
    await writeFile(join(artifactDir, "diff.json"), '{"windows":[]}', "utf-8");
    await writeFile(join(artifactDir, "o11y.json"), "{}", "utf-8");

    const out = join(root, "site");
    await buildView({ input: root, out });
    const exported = join(out, "artifact", "compare_codex/2026-07-09T10-00-00-000Z/weather/brooklyn/a0");
    expect(existsSync(join(exported, "diff.json"))).toBe(true);
    expect(existsSync(join(exported, "events.json"))).toBe(true);
    expect(existsSync(join(exported, "o11y.json"))).toBe(false);
  });

  it("--out 接受收窄,出站的就是收窄到的:被滤掉实验的证据文件与页面数据都不出站", async () => {
    const root = await seedRoot();
    // 两个实验各写一份 events.json:导出后只有收窄内的那份在站里。
    const bubDir = join(root, "compare_bub", "2026-07-08T10-00-00-000Z", "weather", "brooklyn", "a0");
    const codexDir = join(root, "compare_codex", "2026-07-09T10-00-00-000Z", "weather", "brooklyn", "a0");
    for (const dir of [bubDir, codexDir]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "events.json"), "[]", "utf-8");
    }

    const out = join(root, "site");
    await buildView({ input: root, out, scan: { patterns: [], experiment: "compare/codex" } });
    expect(existsSync(join(out, "artifact", "compare_codex/2026-07-09T10-00-00-000Z/weather/brooklyn/a0", "events.json"))).toBe(true);
    // 被滤掉的实验:证据树整目录不出站,页面数据(烘进 HTML 的 viewData 与报告块)也不含它。
    expect(existsSync(join(out, "artifact", "compare_bub"))).toBe(false);
    const html = await readFile(join(out, "index.html"), "utf-8");
    expect(html).not.toContain("compare/bub");
    expect(html).toContain("compare/codex");
  });

  it("eval 前缀收窄导出:不匹配 attempt 的证据不出站", async () => {
    const root = await seedRoot();
    const weatherDir = join(root, "compare_bub", "2026-07-08T10-00-00-000Z", "weather", "brooklyn", "a0");
    const buttonDir = join(root, "compare_bub", "2026-07-08T10-00-00-000Z", "fixtures", "button", "a0");
    for (const dir of [weatherDir, buttonDir]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "events.json"), "[]", "utf-8");
    }

    const out = join(root, "site");
    await buildView({ input: root, out, scan: { patterns: ["weather"] } });
    expect(existsSync(join(out, "artifact", "compare_bub/2026-07-08T10-00-00-000Z/weather/brooklyn/a0", "events.json"))).toBe(true);
    expect(existsSync(join(out, "artifact", "compare_bub/2026-07-08T10-00-00-000Z/fixtures"))).toBe(false);
    const html = await readFile(join(out, "index.html"), "utf-8");
    expect(html).not.toContain("fixtures/button");
  });

  it("默认导出(无 --report):报告槽填充 ExperimentComparison,双语块与增强 runtime 恒内联", async () => {
    const root = await seedRoot();
    const out = join(root, "site");
    await buildView({ input: root, out });
    const html = await readFile(join(out, "index.html"), "utf-8");
    expect(html).toContain('<template id="niceeval-report-report-en">');
    expect(html).toContain('<template id="niceeval-report-report-zh-CN">');
    expect(html).toContain("nre-"); // 官方组件的稳定类名(KPI / 榜单 / 散点来自 nre 组件)
    // 渐进增强 runtime(排序 / 过滤 / tooltip)恒内联;报告块本体仍零 <script>。
    expect(html).toContain("__nreEnhanced");
    const block = html.split('<template id="niceeval-report-report-en">')[1]!.split("</template>")[0]!;
    expect(block).not.toContain("<script");
  });
});
