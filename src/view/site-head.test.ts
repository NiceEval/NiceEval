// cases: docs/engineering/testing/unit/reports.md
// 覆盖登记行(「view 数据装载(ViewScan)」类别):外壳 head 通道的装载解析——按声明序产出
// ResolvedHeadTag[]、外链原样透传不解析为本地资产、children 原样保留、本地 src/href 解析出
// 绝对路径与扩展名、head 不进 viewData.report、本地资产缺失时的完整错误反馈。
// 头标签渲染进最终 HTML 的结构、属性值转义与 assets/<sha256><ext> 物化落盘属于站点管线的
// 渲染/导出产物,归 docs/engineering/testing/e2e/report.md 对真实产物验收,不在本层断言。

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadViewScan } from "./data.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION } from "../types.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-sitehead-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/** 最小结果根:单实验单快照单 attempt(与 view/data.test.ts 的 writeSnapshot 同一姿势)。 */
async function seedRoot(): Promise<string> {
  const root = await makeRoot();
  const dir = join(root, "compare_bub", "2026-07-08T10-00-00-000Z");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "run.json"),
    JSON.stringify({
      format: RECORD_FORMAT,
      schemaVersion: RECORD_SCHEMA_VERSION,
      producer: { name: "niceeval", version: "0.4.6" },
      experimentId: "compare/bub",
      agent: "bub",
      startedAt: "2026-07-08T10:00:00.000Z",
      completedAt: "2026-07-08T10:00:00.000Z",
    }),
    "utf-8",
  );
  const attemptDir = join(dir, "weather/brooklyn", "a0");
  await mkdir(attemptDir, { recursive: true });
  await writeFile(
    join(attemptDir, "result.json"),
    JSON.stringify({ id: "weather/brooklyn", verdict: "passed", attempt: 0, durationMs: 1000, assertions: [] }),
    "utf-8",
  );
  return root;
}

const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>';

const GA_SRC = "https://www.googletagmanager.com/gtag/js?id=G-TEST";
const OG_IMAGE = 'https://x.example/a"b.png';

/** 不经包入口也合法的最小外壳报告(判别锚在 Symbol.for 上,与 view/data.test.ts 的 reportSource 同一姿势)。 */
function headReportSource(head: string): string {
  return [
    'const FACES = Symbol.for("niceeval.report.faces");',
    'const DEFINITION = Symbol.for("niceeval.report.definition");',
    "const Block = (props) => Block[FACES].web(props);",
    "Block[FACES] = {",
    '  web: () => "HEAD_TEST_BODY",',
    '  text: () => "HEAD_TEST_BODY",',
    "};",
    "const definition = {",
    '  kind: "report",',
    '  title: "Head Test",',
    `  head: ${head},`,
    '  pages: [{ id: "report", title: "Report", input: "sample", render: () => ({ $$typeof: Symbol.for("react.transitional.element"), type: Block, props: {}, key: null }) }],',
    "};",
    "Object.defineProperty(definition, DEFINITION, { value: true });",
    "export default definition;",
    "",
  ].join("\n");
}

const HEAD_DECL = JSON.stringify([
  { tag: "script", attrs: { async: true, src: GA_SRC } },
  { tag: "script", children: "window.dataLayer = window.dataLayer || [];" },
  { tag: "meta", attrs: { property: "og:image", content: OG_IMAGE } },
  { tag: "link", attrs: { rel: "icon", href: "./favicon.svg" } },
]);

async function seedReport(root: string, head: string): Promise<string> {
  const path = join(root, "head-report.mjs");
  await writeFile(path, headReportSource(head), "utf-8");
  await writeFile(join(root, "favicon.svg"), FAVICON_SVG, "utf-8");
  return path;
}

describe("loadViewScan · head 通道装载解析(shellAssets.head)", () => {
  it("按声明序产出 ResolvedHeadTag[]:外链原样、不解析为本地资产;children 原样保留", async () => {
    const root = await seedRoot();
    const path = await seedReport(root, HEAD_DECL);
    const scan = await loadViewScan(root, { report: { path, cwd: root } });
    const head = scan.shellAssets.head;

    expect(head.map((h) => h.tag)).toEqual(["script", "script", "meta", "link"]);
    // 外链(gtag):attrs 原样保留,不解析出 localAsset。
    expect(head[0]!.attrs).toEqual({ async: true, src: GA_SRC });
    expect(head[0]!.localAsset).toBeUndefined();
    // children 原样保留(inline script)。
    expect(head[1]!.children).toBe("window.dataLayer = window.dataLayer || [];");
    expect(head[1]!.attrs).toEqual({});
    // 非 src/href 属性(og:image 的 content)不触发本地资产解析。
    expect(head[2]!.attrs).toEqual({ property: "og:image", content: OG_IMAGE });
    expect(head[2]!.localAsset).toBeUndefined();
  });

  it("本地 href 解析为绝对路径与扩展名(localAsset);服务/物化是渲染期的事,不在这层做", async () => {
    const root = await seedRoot();
    const path = await seedReport(root, HEAD_DECL);
    const scan = await loadViewScan(root, { report: { path, cwd: root } });
    const link = scan.shellAssets.head[3]!;

    expect(link.tag).toBe("link");
    expect(link.localAsset).toEqual({ attr: "href", abs: join(root, "favicon.svg"), ext: ".svg" });
  });

  it("head 是注入资产,不进报告序列化声明(viewData.report)", async () => {
    const root = await seedRoot();
    const withHead = await seedReport(root, HEAD_DECL);
    const scan = await loadViewScan(root, { report: { path: withHead, cwd: root } });
    expect(scan.viewData.report).not.toHaveProperty("head");
    expect(scan.shellAssets.head).toHaveLength(4);
  });

  it("本地 href 缺失文件:装载报错并给出解析后的绝对路径", async () => {
    const root = await seedRoot();
    const path = join(root, "missing-asset.mjs");
    await writeFile(
      path,
      headReportSource(JSON.stringify([{ tag: "link", attrs: { rel: "icon", href: "./nope.svg" } }])),
      "utf-8",
    );
    await expect(loadViewScan(root, { report: { path, cwd: root } })).rejects.toThrow(/asset not found: .*nope\.svg/);
  });
});
