// cases: docs/engineering/testing/unit/reports.md
// view 本地模式的重建语义四格(见 unit/reports.md 覆盖规范同名类别):重建理由的闭集性、
// 失效分流、按订阅渲染、推送分档。
//
// 计数都靠 fixture 报告往一个日志文件追加行——报告经 namespaced import 装载,每次装载都是
// 新模块实例,进程内的计数器共享不到它;文件是两边都看得见的唯一通道。日志里有两种行:
// 模块顶层的 `load`(装载一次一行)与 web 面的 `render:<pageId>:<locale>`(渲染一块一行)。
// 断言的是这两个计数,不是响应体——只比响应体的写法在「每次请求都重建」「一律全渲」这两种
// 错误算法下照样全绿。

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startViewServer, type ViewServer } from "./server.ts";
import { buildView } from "./index.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION } from "../types.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";

const roots: string[] = [];
const servers: ViewServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/**
 * 两页报告(报告经 `--report` 装载)。`head` 参与外壳指纹:改它就是外壳变了,推送该走整页
 * 重载那一档;只改 marker 是报告内容变了,该走就地换块那一档。
 */
function reportSource(logPath: string, marker: string, head: { tag: string; children?: string }[] = []): string {
  return [
    'import { appendFileSync } from "node:fs";',
    `const LOG = ${JSON.stringify(logPath)};`,
    'appendFileSync(LOG, "load\\n");',
    'const FACES = Symbol.for("niceeval.report.faces");',
    'const DEFINITION = Symbol.for("niceeval.report.definition");',
    // 渲染时宿主把 WebContext 挂在这个全局键上;resolve 阶段没有它。只在有上下文时记一行,
    // 因此一行 = 一次「按某 locale 渲染这一页」,与 resolve 次数无关。
    'const CTX = Symbol.for("niceeval.report.activeWebContext");',
    "const make = (pageId) => {",
    "  const Block = (props) => Block[FACES].web(props);",
    "  Block[FACES] = {",
    "    web: () => {",
    "      const ctx = globalThis[CTX];",
    "      if (ctx) appendFileSync(LOG, `render:${pageId}:${ctx.locale}\\n`);",
    `      return ${JSON.stringify(marker)};`,
    "    },",
    `    text: () => ${JSON.stringify(marker)},`,
    "  };",
    '  return { $$typeof: Symbol.for("react.transitional.element"), type: Block, props: {}, key: null };',
    "};",
    "const definition = {",
    '  kind: "report",',
    `  head: ${JSON.stringify(head)},`,
    "  pages: [",
    '    { id: "first", title: "First", render: () => make("first") },',
    '    { id: "second", title: "Second", render: () => make("second") },',
    "  ],",
    "};",
    'Object.defineProperty(definition, DEFINITION, { value: true });',
    "export default definition;",
    "",
  ].join("\n");
}

interface Fixture {
  root: string;
  /** 记录根(`.niceeval`);server 的 input 与记录侧监听都指它。 */
  record: string;
  reportPath: string;
  logPath: string;
  /** 日志里各类行的计数;`render` 按 `<pageId>:<locale>` 分格。 */
  counts(): Promise<{ load: number; render: globalThis.Record<string, number> }>;
  reset(): Promise<void>;
}

async function makeFixture(marker = "FIRST", head: { tag: string; children?: string }[] = []): Promise<Fixture> {
  // 布局照真实项目:记录根是项目下的 .niceeval,报告文件与渲染日志在项目根。日志一定要在
  // 记录根之外——它住在记录根里就会被记录侧的递归监听当成新证据,报告一渲染就再触发一次重建。
  const root = await mkdtemp(join(tmpdir(), "niceeval-viewrebuild-"));
  roots.push(root);
  const record = join(root, ".niceeval");
  const dir = join(record, "exp_a", "2026-07-08T10-00-00-000Z");
  await mkdir(join(dir, "e1", "a0"), { recursive: true });
  await writeFile(
    join(dir, "run.json"),
    JSON.stringify({
      format: RECORD_FORMAT,
      schemaVersion: RECORD_SCHEMA_VERSION,
      producer: { name: "niceeval", version: "0.4.0" },
      runId: "2026-07-08T10-00-00-000Z-0000-4000-8000-000000000000",
      experimentId: "exp/a",
      agent: "agent",
      startedAt: "2026-07-08T10:00:00.000Z",
      completedAt: "2026-07-08T10:00:00.000Z",
      configHash: "fixture-config",
      experiment: {
        attempts: 1,
        earlyExit: true,
        sandboxLayer: {},
        sandboxPlansByEval: {},
        agentInstalls: [],
      },
    }),
    "utf-8",
  );
  await writeFile(
    join(dir, "e1", "a0", "result.json"),
    JSON.stringify({ id: "e1", verdict: "passed", attempt: 0, durationMs: 1000, assertions: [], evidenceCoverage: completeEvidenceCoverage }),
    "utf-8",
  );
  // 日志放进一个提前建好的子目录:它既不在记录根里,也不是闭集文件的所在目录,
  // 两侧监听都不会把它算成输入。
  const logDir = join(root, "logs");
  await mkdir(logDir, { recursive: true });
  const logPath = join(logDir, "render.log");
  await writeFile(logPath, "", "utf-8");
  const reportPath = join(root, "report.mjs");
  await writeFile(reportPath, reportSource(logPath, marker, head), "utf-8");
  return {
    root,
    record,
    reportPath,
    logPath,
    async counts() {
      const lines = (await readFile(logPath, "utf-8")).split("\n").filter(Boolean);
      const render: globalThis.Record<string, number> = {};
      let load = 0;
      for (const line of lines) {
        if (line === "load") load++;
        else render[line.slice("render:".length)] = (render[line.slice("render:".length)] ?? 0) + 1;
      }
      return { load, render };
    },
    async reset() {
      await writeFile(logPath, "", "utf-8");
    },
  };
}

async function serve(fx: Fixture): Promise<ViewServer> {
  const server = await startViewServer({
    input: fx.record,
    scan: { report: { path: fx.reportPath, cwd: fx.root } },
    watchRoot: fx.root,
  });
  servers.push(server);
  return server;
}

/** 等到 `probe()` 为真或超时;超时不抛,由调用方的断言给出可读失败。 */
async function until(probe: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** 一条 SSE 订阅:按声明的页与语言连上去,把事件按到达顺序收进数组。 */
function subscribe(url: string, page: string, locale: string): { events: { event: string; data: string }[]; close: () => void } {
  const events: { event: string; data: string }[] = [];
  const controller = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`${url}__niceeval_reload?page=${page}&locale=${encodeURIComponent(locale)}`, {
        signal: controller.signal,
      });
      let buffer = "";
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += new TextDecoder().decode(chunk);
        let cut = buffer.indexOf("\n\n");
        while (cut !== -1) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (event) events.push({ event, data: data ?? "" });
          cut = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // 关闭订阅即中断读取,不是错误。
    }
  })();
  return { events, close: () => controller.abort() };
}

describe("本地监听地址", () => {
  it("默认监听全部网卡，并给浏览器本机可访问的地址", async () => {
    const fx = await makeFixture();
    const server = await serve(fx);

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(server.urls).toContain(server.url);
    expect((await fetch(server.url)).status).toBe(200);
  });

  it("显式 host 时只公布该地址", async () => {
    const fx = await makeFixture();
    const server = await startViewServer({
      input: fx.record,
      host: "127.0.0.1",
      scan: { report: { path: fx.reportPath, cwd: fx.root } },
      watchRoot: fx.root,
    });
    servers.push(server);

    expect(server.urls).toEqual([server.url]);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });
});

describe("重建理由的闭集性", () => {
  it("请求 / 不是重建理由:连续请求命中同一份产物,报告只在启动时装载过一次", async () => {
    const fx = await makeFixture();
    const server = await serve(fx);
    // 启动只做扫描与装载,一块都不渲染(渲染发生在真的有人要看的时候)。
    expect((await fx.counts()).load).toBe(1);

    await fetch(server.url);
    await fetch(server.url);
    await fetch(server.url);

    const counts = await fx.counts();
    // 区分力在这一行:每次请求都重建的写法会数到 4。
    expect(counts.load).toBe(1);
    // 初始页两种语言随 index.html 一起下发,且只渲染一次(第二、三次请求命中缓存)。
    expect(counts.render).toEqual({ "first:en": 1, "first:zh-CN": 1 });
  });
});

describe("失效分流", () => {
  it("记录变更沿用上一次装载出的定义,报告文件变更才重新装载", async () => {
    const fx = await makeFixture();
    const server = await serve(fx);
    await fetch(server.url);
    expect((await fx.counts()).load).toBe(1);

    // 记录变更:重跑管线,不重新装载模块图。
    await fx.reset();
    await writeFile(join(fx.record, "exp_a", "2026-07-08T10-00-00-000Z", "e1", "a0", "result.json"),
      JSON.stringify({ id: "e1", verdict: "failed", attempt: 0, durationMs: 2000, assertions: [], evidenceCoverage: completeEvidenceCoverage }), "utf-8");
    const sub = subscribe(server.url, "first", "en");
    await until(async () => sub.events.some((e) => e.event === "patch"));
    sub.close();
    expect(sub.events.filter((e) => e.event === "patch").length).toBeGreaterThan(0);
    // 区分力在这一行:每次重建都 fresh import 的写法会数到 1。macOS 的 fs.watch 会为同目录
    // 里没被碰过的兄弟文件也报事件,只按事件名判定的写法在这里同样会数到 1。
    expect((await fx.counts()).load).toBe(0);

    // 报告文件变更:整棵 import 图重新装载。
    await fx.reset();
    await writeFile(fx.reportPath, reportSource(fx.logPath, "SECOND"), "utf-8");
    await until(async () => (await fx.counts()).load > 0);
    expect((await fx.counts()).load).toBe(1);
  }, 20_000);
});

describe("按订阅渲染", () => {
  it("一次重建只渲染订阅中的那一块,没人看的页不渲染", async () => {
    const fx = await makeFixture();
    const server = await serve(fx);
    await fetch(server.url);

    const sub = subscribe(server.url, "second", "zh-CN");
    await until(async () => sub.events.some((e) => e.event === "ready"));
    await fx.reset();
    await writeFile(join(fx.record, "exp_a", "2026-07-08T10-00-00-000Z", "e1", "a0", "result.json"),
      JSON.stringify({ id: "e1", verdict: "failed", attempt: 0, durationMs: 3000, assertions: [], evidenceCoverage: completeEvidenceCoverage }), "utf-8");
    await until(async () => sub.events.some((e) => e.event === "patch"));
    sub.close();

    // 区分力在这一行:全渲的写法会数到四块。initial page 与另一种语言都没人看,不渲染。
    expect((await fx.counts()).render).toEqual({ "second:zh-CN": 1 });
  }, 20_000);

  it("非订阅的块经 report/<pageId>.<locale>.html 按需取,内容与 --out 预烘的同一块逐字节一致", async () => {
    const fx = await makeFixture();
    const server = await serve(fx);
    const onDemand = await (await fetch(`${server.url}report/second.zh-CN.html`)).text();

    const out = join(fx.root, "out");
    await buildView({ input: fx.record, out, scan: { report: { path: fx.reportPath, cwd: fx.root } } });
    const exported = await readFile(join(out, "index.html"), "utf-8");
    const baked = /<template id="niceeval-report-second-zh-CN">([\s\S]*?)<\/template>/.exec(exported)?.[1];

    expect(onDemand.length).toBeGreaterThan(0);
    expect(baked).toBe(onDemand);
    // --out 没有「当前订阅」可言:四块全渲并预烘进 index.html,不写 report/ 目录。
    expect(exported).toContain('id="niceeval-report-first-en"');
    await expect(readFile(join(out, "report", "second.zh-CN.html"), "utf-8")).rejects.toThrow();
  }, 20_000);
});

describe("推送分档", () => {
  it("只改报告内容推新块就地换,外壳变了推整页重载", async () => {
    const fx = await makeFixture();
    const server = await serve(fx);
    await fetch(server.url);

    const sub = subscribe(server.url, "first", "en");
    await until(async () => sub.events.some((e) => e.event === "ready"));

    await writeFile(fx.reportPath, reportSource(fx.logPath, "SECOND"), "utf-8");
    await until(async () => sub.events.some((e) => e.event === "patch"));
    const patch = JSON.parse(sub.events.find((e) => e.event === "patch")!.data) as {
      page: string;
      locale: string;
      html: string;
    };
    expect(patch).toMatchObject({ page: "first", locale: "en" });
    expect(patch.html).toContain("SECOND");

    // 外壳(head)变了:整页重载。缺这一格时「一律 patch」的写法会漏掉样式表没换的场景。
    await writeFile(fx.reportPath, reportSource(fx.logPath, "SECOND", [{ tag: "style", children: "/* shell */" }]), "utf-8");
    await until(async () => sub.events.some((e) => e.event === "reload"));
    sub.close();
    expect(sub.events.map((e) => e.event)).toEqual(["ready", "patch", "reload"]);
  }, 20_000);
});
