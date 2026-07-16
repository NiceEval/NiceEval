// HTTP server 与静态资源:起本地 web、按需吐 artifact、把 viewData 烘焙进单个 HTML。
// 数据读取与统计在 data.ts(openResults + 官方计算函数);这里只管「怎么送到浏览器」。

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAttemptIndex, loadViewScan, viewRoot, type ViewScan, type ViewScanOptions } from "./data.ts";
import type { AttemptHandle } from "../results/index.ts";
import { formatThrown } from "../util.ts";

export interface ViewOptions {
  input?: string;
  out?: string;
  port?: number;
  /** `--out` 对非发布根(无 publish:applied 标记)导出时的显式确认;静态站原样携带证据文件。 */
  allowSensitiveArtifacts?: boolean;
  /** 报告槽的组合语义(位置前缀 / --experiment / --report),透传给 loadViewScan。 */
  scan?: ViewScanOptions;
}

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

const TEMPLATE_PLACEHOLDERS = {
  styles: "<!-- __NICEEVAL_STYLES__ -->",
  appCode: "__NICEEVAL_APP_CODE__",
  viewData: "__NICEEVAL_VIEW_DATA_JSON__",
  reportSlot: "<!-- __NICEEVAL_REPORT_SLOT__ -->",
} as const;

export async function startViewServer(opts: ViewOptions = {}): Promise<ViewServer> {
  const input = opts.input;
  const root = viewRoot(input);
  // 本地 server 的单页失败折成该页的错误块,其它页照常可读(静态导出仍整体失败)。
  const scanOptions = { ...opts.scan, pageFailure: "embed" as const };
  // 数据装载先跑一遍:--snapshot 指向读不了的快照、--report 装载失败、
  // 前缀匹配不到,都要在起 server 前就失败并给出提示。
  await loadViewScan(input, scanOptions);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
        return;
      }
      // 按需提供拆分 artifact(trace.json / events.json / …),前端展开时 fetch。
      // 路径式 /artifact/<rel> 与目录式静态导出的文件布局一致(见 view/index.ts 的 buildView),
      // 同一份前端产物在本地 server 和静态托管上用同一个相对 URL。
      if (url.pathname.startsWith("/artifact/")) {
        await serveArtifact(root, decodeURIComponent(url.pathname.slice("/artifact/".length)), res, () => loadAttemptIndex(input));
        return;
      }
      // 兼容旧的 query 形式(0.2.x 前端烘焙的 HTML 可能还开着)。
      if (url.pathname === "/artifact") {
        await serveArtifact(root, url.searchParams.get("p") ?? "", res, () => loadAttemptIndex(input));
        return;
      }
      if (url.pathname !== "/") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      // 每次请求现读现算,永远是盘上最新数据;--report 的报告文件变更同样在
      // 下次请求整页重算(装载走 mtime cache-busting,见 report/load.ts)。
      res.end(await renderHtml(await loadViewScan(input, scanOptions)));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(formatThrown(e));
    }
  });

  const port = await listen(server, opts.port ?? 0);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      }),
  };
}

/**
 * 把 viewData(只含原始值与相对路径,不含宿主机绝对路径)和前端产物烘焙进单个 HTML。
 * 报告槽恒在:每页报告 HTML 作为 <template id="niceeval-report-<pageId>-<locale>"> 静态块
 * 烘在 __NICEEVAL_VIEW_DATA__ 旁(不 hydrate,自定义组件的 <Style> 产物已内联其中),
 * 并恒内联官方组件样式(report/react/styles.css)与渐进增强 runtime(report/react/enhance.js,
 * 内联 <script>:排序 / 过滤 / tooltip,document 级事件委托,报告块被前端搬进槽位也无需重绑;
 * 无 JS 时报告内容依旧完整);外壳声明的 styles 注入在官方样式之后、scripts 注入在官方
 * 增强脚本之后 </body> 前,均按声明顺序(docs/feature/reports/library/shell.md)。
 * 前端只把当前页 / 当前界面语言对应的块摆进报告槽位置,不解析。
 */
export async function renderHtml(scan: ViewScan): Promise<string> {
  const template = await readViewAsset("template.html");
  const styles = await readViewAsset("client-dist/app.css");
  const app = await readViewAsset("client-dist/app.js");
  const [reportStyles, reportEnhance] = await Promise.all([
    readFile(new URL("../report/react/styles.css", import.meta.url), "utf-8"),
    readFile(new URL("../report/react/enhance.js", import.meta.url), "utf-8"),
  ]);

  const shellStyles = scan.shellAssets.styles.map((css) => `\n<style>\n${css}\n</style>`).join("");
  const shellScripts = scan.shellAssets.scripts.map((js) => `<script>\n${js}\n</script>\n`).join("");

  const pageTemplates = scan.reportPages
    .flatMap((page) => [
      `<template id="niceeval-report-${page.id}-en">${page.html.en}</template>`,
      `<template id="niceeval-report-${page.id}-zh-CN">${page.html["zh-CN"]}</template>`,
    ])
    .join("\n");

  return template
    .replace(
      TEMPLATE_PLACEHOLDERS.styles,
      () =>
        `<style>\n${styles}\n</style>\n<style>\n${reportStyles}\n</style>\n<script>\n${reportEnhance}\n</script>` +
        shellStyles,
    )
    .replace(TEMPLATE_PLACEHOLDERS.reportSlot, () => pageTemplates)
    .replace(TEMPLATE_PLACEHOLDERS.viewData, () => JSON.stringify(scan.viewData).replace(/</g, "\\u003c"))
    .replace(TEMPLATE_PLACEHOLDERS.appCode, () => JSON.stringify(app).replace(/</g, "\\u003c"))
    .replace("</body>", () => `${shellScripts}</body>`);
}

/** rel 的末段文件名;base = 去掉末段后剩下的部分(与 artifactUrl 的按段编码/拼接对称)。 */
function splitArtifactRel(rel: string): { base: string; file: string } {
  const segments = rel.split("/");
  const file = segments.pop() ?? "";
  return { base: segments.join("/"), file };
}

/**
 * 安全地把 root 下的 artifact 文件吐回去(限定 .json,且解析后必须仍在 root 内)。
 * sources.json 是唯一例外:落盘是去重后的引用(`{path, sha256}[]`),不能直接 piping 原字节——
 * 按 base 反查 AttemptHandle,经它的 `.sources()` 解引用出完整内容(`{path, content}[]`)再回给
 * 浏览器。attemptIndex 懒建(只在真的碰到 sources.json 请求时才付 openResults() 扫描的代价),
 * events.json / trace.json 等其它 artifact 完全不受影响,原样走原文件读取。
 */
async function serveArtifact(
  root: string,
  rel: string,
  res: import("node:http").ServerResponse,
  attemptIndex: () => Promise<Map<string, AttemptHandle>>,
): Promise<void> {
  const abs = resolve(root, rel);
  const within = abs === root || abs.startsWith(root + "/");
  if (!within || !rel.endsWith(".json")) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("bad artifact path");
    return;
  }

  const { base, file } = splitArtifactRel(rel);
  if (file === "sources.json") {
    const attempt = (await attemptIndex()).get(base);
    if (!attempt) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("artifact not found");
      return;
    }
    const sources = await attempt.sources();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(sources ?? []));
    return;
  }

  try {
    const body = await readFile(abs, "utf-8");
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("artifact not found");
  }
}

async function readViewAsset(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf-8");
}

async function listen(server: Server, preferredPort: number): Promise<number> {
  const tryListen = (port: number): Promise<number> =>
    new Promise((resolveListen, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolveListen(typeof address === "object" && address ? address.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });

  if (preferredPort === 0) return tryListen(0);
  for (let port = preferredPort; port < preferredPort + 20; port++) {
    try {
      return await tryListen(port);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    }
  }
  throw new Error(`No available port near ${preferredPort}`);
}
