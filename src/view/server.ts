// HTTP server:把站点管线(site.ts 的 planSite)产出的同一份产物挂在 127.0.0.1 上按路径服务。
// 这里不携带任何取数或布局知识——查不到清单条目就是 404,与 `--out` 写盘的文件逐字节一致
// (docs/feature/reports/view.md 开篇;奇偶由 site-parity 测试守护)。宿主语义只有两条,全部
// 作用在管线之外:打开首页整份重建(数据永远是盘上最新)、单页渲染失败折成页内错误块
// (pageFailure: "embed")。位置参数 / --exp 收窄是管线输入,不是宿主语义——两宿主同义。

import { createServer, type Server } from "node:http";
import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { type ViewScanOptions } from "./data.ts";
import { planSite, readSiteFile, type SitePlan } from "./site.ts";
import { isHostModulePath } from "../report/runtime/host.ts";
import { formatThrown } from "../util.ts";

export interface ViewOptions {
  input?: string;
  out?: string;
  port?: number;
  /** 站点管线的组合语义(位置前缀 / --exp 收窄有效根,--report 换报告槽),透传给管线。 */
  scan?: ViewScanOptions;
  /** 本地模式观察的项目根；静态导出忽略。 */
  watchRoot?: string;
}

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

/** 去抖且单飞：构建期间的任意事件只请求结束后再跑一次。 */
export class ViewRebuildScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private pending = false;
  constructor(private readonly rebuild: () => Promise<void>, private readonly delayMs = 80) {}
  notify(): void {
    if (this.running) { this.pending = true; return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), this.delayMs);
  }
  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.rebuild(); } finally {
      this.running = false;
      if (this.pending) { this.pending = false; this.notify(); }
    }
  }
  close(): void { clearTimeout(this.timer); }
}

function isWatchedChange(root: string, filename: string | null): boolean {
  if (!filename) return true;
  const path = filename.toString();
  return !path.includes(`${sep}node_modules${sep}`) && !/(?:~$|\.swp$|\.tmp$|\.temp$|^\.#)/.test(path);
}

/**
 * 项目侧 watch 的入口(docs/feature/reports/view.md「持续重建」的闭集第 2–4 行):
 * 项目配置,加 --report / --theme 指到的**文件**。裸词(`standard` / `basalt`)是内建名,
 * 随包分发没有项目文件可盯,按装载同一条形态判别排除。配置文件此刻不存在也在列——
 * 它所在目录照样挂 watcher,建出来那一下就是一次重建理由。
 */
export async function projectWatchEntries(scan: ViewScanOptions, projectRoot: string): Promise<string[]> {
  const entries = [join(projectRoot, "niceeval.config.ts")];
  if (scan.report !== undefined && (await isHostModulePath(scan.report.path))) {
    entries.push(resolve(scan.report.cwd, scan.report.path));
  }
  if (scan.theme !== undefined && (await isHostModulePath(scan.theme.value))) {
    entries.push(resolve(scan.theme.cwd, scan.theme.value));
  }
  return entries;
}

/**
 * 入口文件加它们的**项目内静态 import 图**:改一个自定义组件、读数或工具模块与改报告文件
 * 本身没有区别(view.md「改组件代码同样重建」)。裸 specifier 与 node_modules 下的文件不进闭集
 * ——依赖目录里的包改了不是这条命令的事;动态 import 也不跟,与指纹的源码闭包同一条口径。
 */
export async function projectWatchTargets(entries: readonly string[]): Promise<Set<string>> {
  const targets = new Set(entries.map((entry) => resolve(entry)));
  const visited = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    const absolute = resolve(path);
    if (visited.has(absolute)) return;
    visited.add(absolute);
    let content: string;
    try {
      content = await readFile(absolute, "utf8");
    } catch {
      return; // 还没建出来的入口(如 niceeval.config.ts)照样在列,只是没有下游可走。
    }
    targets.add(absolute);
    const specs = [...content.matchAll(/\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const spec of specs) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const resolved = await resolveModuleFile(dirname(absolute), spec);
      if (resolved !== undefined && !resolved.split(sep).includes("node_modules")) await visit(resolved);
    }
  };
  for (const entry of entries) await visit(entry);
  return targets;
}

async function resolveModuleFile(from: string, specifier: string): Promise<string | undefined> {
  const raw = resolve(from, specifier);
  const candidates = extname(raw)
    ? // `./x.js` 形态的 specifier 在 TS 项目里指的是 `./x.ts`(NodeNext 的写法)。
      [raw, ...(/\.[cm]?jsx?$/i.test(raw) ? [".ts", ".tsx"].map((ext) => raw.replace(/\.[cm]?jsx?$/i, ext)) : [])]
    : [
        raw,
        ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"].map((ext) => `${raw}${ext}`),
        ...["index.ts", "index.tsx", "index.js"].map((name) => resolve(raw, name)),
      ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // 换下一个扩展名。
    }
  }
  return undefined;
}

/**
 * 项目侧监听:按闭集里文件**所在的目录**挂 watcher,再按绝对路径过滤事件——目录级监听会把
 * 记录落盘、依赖目录和临时文件都当成重建理由,而直接 watch 文件本体在编辑器"写临时文件再
 * rename"的保存方式下第一次保存后就哑了。闭集随每次重建重算,报告新 import 一个组件文件
 * 由此接上。
 */
export class ProjectFileWatcher {
  private readonly dirs = new Map<string, FSWatcher>();
  private files = new Set<string>();
  constructor(private readonly onChange: () => void) {}

  /** 当前盯着的文件绝对路径全集。 */
  get watched(): ReadonlySet<string> {
    return this.files;
  }

  async sync(entries: readonly string[]): Promise<void> {
    this.files = await projectWatchTargets(entries);
    const dirs = new Set([...this.files].map((file) => dirname(file)));
    for (const [dir, watcher] of this.dirs) {
      if (dirs.has(dir)) continue;
      watcher.close();
      this.dirs.delete(dir);
    }
    for (const dir of dirs) {
      if (this.dirs.has(dir)) continue;
      try {
        this.dirs.set(dir, watch(dir, (_event, filename) => this.handle(dir, filename)));
      } catch {
        // 目录不存在(如报告文件指向还没建出来的目录):下一次 sync 再试。
      }
    }
  }

  /** 目录事件 → 是不是闭集内文件变了。filename 缺失时无从判断,按会变处理。 */
  handle(dir: string, filename: string | Buffer | null): void {
    if (filename === null) {
      this.onChange();
      return;
    }
    if (this.files.has(resolve(dir, filename.toString()))) this.onChange();
  }

  close(): void {
    for (const watcher of this.dirs.values()) watcher.close();
    this.dirs.clear();
  }
}

export async function startViewServer(opts: ViewOptions = {}): Promise<ViewServer> {
  const input = opts.input;
  // 本地 server 的单页失败折成该页的错误块,其它页照常可读(静态导出仍整体失败)。
  const scanOptions = { ...opts.scan, pageFailure: "embed" as const };

  // 产物重建的单飞通道:首页请求与 watch 调度器共享同一次构建,不并行跑两份
  // planSite(namespaced import 并发会卡住)。进行中的调用方都 await 同一份 Promise。
  let current: Promise<SitePlan>;
  let inFlight: Promise<SitePlan> | undefined;
  const reloadClients = new Set<import("node:http").ServerResponse>();
  let lastError: string | undefined;
  const rebuild = (): Promise<SitePlan> => {
    // 同步挂上 inFlight,避免「两个调用都看到 undefined」并行跑两份 namespaced import。
    if (!inFlight) {
      inFlight = (async () => {
        try {
          const next = await planSite(input, scanOptions);
          current = Promise.resolve(next);
          lastError = undefined;
          for (const client of reloadClients) client.write("event: reload\ndata: ok\n\n");
          return next;
        } catch (error) {
          lastError = formatThrown(error);
          process.stderr.write(`view rebuild failed: ${lastError}\n`);
          for (const client of reloadClients) client.write(`event: error\ndata: ${JSON.stringify(lastError)}\n\n`);
          throw error;
        } finally {
          inFlight = undefined;
        }
      })();
    }
    return inFlight;
  };

  // 启动前先构建一遍:--run 指向读不了的快照、--report 装载失败、前缀匹配不到,
  // 都要在起 server 前就失败并给出提示。
  try { await rebuild(); } catch (error) { throw error; }

  const scheduler = new ViewRebuildScheduler(async () => {
    try { await rebuild(); } catch { /* keep serving the preceding SitePlan */ }
    // 改动可能新增/删除 import:重算闭集,新引入的组件文件从下一次变更起就被盯着。
    await syncProjectWatch();
  });
  // 记录侧仍是整根递归监听:新 Run 目录、result.json 与证据文件都要接住。
  const recordRoot = resolve(input ?? ".niceeval");
  const onRecordEvent = (_event: string, filename: string | Buffer | null): void => {
    if (isWatchedChange(recordRoot, filename === null ? null : filename.toString())) scheduler.notify();
  };
  let recordWatcher: FSWatcher;
  try {
    recordWatcher = watch(recordRoot, { recursive: true }, onRecordEvent);
  } catch {
    recordWatcher = watch(recordRoot, onRecordEvent);
  }
  // 项目侧收窄到闭集,不再整根递归:项目根下的记录、依赖目录与无关文件都不是重建理由。
  const projectEntries = await projectWatchEntries(scanOptions, resolve(opts.watchRoot ?? process.cwd()));
  const projectWatcher = new ProjectFileWatcher(() => scheduler.notify());
  const syncProjectWatch = (): Promise<void> => projectWatcher.sync(projectEntries).catch(() => {});
  await syncProjectWatch();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
        return;
      }
      if (url.pathname === "/__niceeval_reload") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(lastError ? `event: error\ndata: ${JSON.stringify(lastError)}\n\n` : "event: ready\ndata: ok\n\n");
        reloadClients.add(res);
        req.on("close", () => reloadClients.delete(res));
        return;
      }

      // 站点相对路径:`/` 即 index.html;兼容旧的 /artifact?p= query 形式
      // (0.2.x 前端烘焙的 HTML 可能还开着)。
      let sitePath: string;
      if (url.pathname === "/") {
        // 每次打开首页整份重建,永远是盘上最新数据;报告 / 配置经 namespaced import
        // 失效整棵项目内 import 图(见 report/runtime/load.ts 与 load-config.ts)。
        await rebuild().catch(() => current);
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
        plan = await rebuild().catch(() => current);
        file = plan.files.get(sitePath);
      }
      if (!file) {
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
        scheduler.close();
        recordWatcher.close();
        projectWatcher.close();
        reloadClients.forEach((client) => client.end());
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
