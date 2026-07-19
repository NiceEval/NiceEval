// HTTP server:把站点管线(site.ts 的 planSite)产出的同一份产物挂在 127.0.0.1 上按路径服务。
// 这里不携带任何取数或布局知识——查不到清单条目就是 404,与 `--out` 写盘的文件逐字节一致
// (docs/feature/reports/view.md 开篇;奇偶由 site-parity 测试守护)。宿主语义只有两条,全部
// 作用在管线之外:打开首页整份重建(数据永远是盘上最新)、单页渲染失败折成页内错误块
// (pageFailure: "embed")。位置参数 / --exp 收窄是管线输入,不是宿主语义——两宿主同义。

import { createServer, type Server } from "node:http";
import { loadViewScan, type ViewScanOptions } from "./data.ts";
import { planSite, readSiteFile, renderStandaloneAttemptDocument, type SitePlan } from "./site.ts";
import { formatThrown } from "../util.ts";
import type { AttemptLocator } from "../results/locator.ts";

const HTML_TYPE = "text/html; charset=utf-8";

/** `attempt/<locator>.html` 站点路径 → 磁盘/清单键用的原始 locator(未编码,含字面 `@`;
 *  见 site.ts「站点管线」对编码边界的说明)。不是这个形状返回 undefined。 */
function attemptLocatorFromSitePath(sitePath: string): AttemptLocator | undefined {
  if (!sitePath.startsWith("attempt/") || !sitePath.endsWith(".html")) return undefined;
  return sitePath.slice("attempt/".length, -".html".length) as AttemptLocator;
}

export interface ViewOptions {
  input?: string;
  out?: string;
  port?: number;
  /** 站点管线的组合语义(位置前缀 / --exp 收窄有效根,--report 换报告槽),透传给管线。 */
  scan?: ViewScanOptions;
}

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

export async function startViewServer(opts: ViewOptions = {}): Promise<ViewServer> {
  const input = opts.input;
  // 本地 server 的单页失败折成该页的错误块,其它页照常可读(静态导出仍整体失败)。
  const scanOptions = { ...opts.scan, pageFailure: "embed" as const };

  // 产物重建的单飞通道:首页请求整份重建;并发请求共享同一次构建,不重复扫描。
  let current: Promise<SitePlan>;
  const rebuild = (): Promise<SitePlan> => {
    current = planSite(input, scanOptions);
    return current;
  };

  // 启动前先构建一遍:--snapshot 指向读不了的快照、--report 装载失败、前缀匹配不到,
  // 都要在起 server 前就失败并给出提示。
  await rebuild();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
        return;
      }

      // 站点相对路径:`/` 即 index.html;兼容旧的 /artifact?p= query 形式
      // (0.2.x 前端烘焙的 HTML 可能还开着)。
      let sitePath: string;
      if (url.pathname === "/") {
        // 每次打开首页整份重建,永远是盘上最新数据;--report 的报告文件变更同样在
        // 下次请求整页重算(装载走 mtime cache-busting,见 report/load.ts)。
        await rebuild();
        sitePath = "index.html";
      } else if (url.pathname === "/artifact") {
        sitePath = `artifact/${url.searchParams.get("p") ?? ""}`;
      } else {
        sitePath = decodeURIComponent(url.pathname.slice(1));
      }

      let plan = await current;
      let file = plan.files.get(sitePath);
      if (!file && sitePath.startsWith("artifact/")) {
        // 未命中最近一次构建的产物清单:管线重建一次再查——server 运行期间
        // 新落盘的证据(新快照、补跑)不需要重启。
        plan = await rebuild();
        file = plan.files.get(sitePath);
      }
      if (!file) {
        // 本地宿主的 attempt 详情路由越过收窄,对完整结果根解析(docs/engineering/unit-tests/
        // reports/cases.md 第 198/220 行;与 `show @<locator>` 同一套「各自结果根语义寻址」,
        // 不是 SitePlan 清单之外的旁路取数——这条路由本来就不该受 --exp/eval 前缀收窄限制,
        // 与「server 不提供清单之外的路径」的奇偶保证不冲突,那条保证只约束收窄之内的路径)。
        const locator = attemptLocatorFromSitePath(sitePath);
        if (locator !== undefined) {
          const fullScan = await loadViewScan(input, { ...scanOptions, experiment: undefined, patterns: [] }).catch(() => undefined);
          const handle = fullScan?.attemptPages?.locators.get(locator);
          if (fullScan && handle) {
            const body = await renderStandaloneAttemptDocument(fullScan, locator, handle);
            res.writeHead(200, { "content-type": HTML_TYPE, "cache-control": "no-store" });
            res.end(body);
            return;
          }
        }
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      const body = await readSiteFile(file);
      if (body === undefined) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      // 同一路径同一 plan 生命周期内不重复求值(architecture.md「管线以 page 实例为单位执行」):
      // lazy 产出器求值一次后把结果写回清单,下一次同路径请求(未触发 rebuild 之前)直接命中。
      if (file.source.kind === "lazy") {
        plan.files.set(sitePath, { ...file, source: { kind: "content", body: body as string } });
      }
      res.writeHead(200, { "content-type": file.contentType, "cache-control": "no-store" });
      res.end(body);
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
