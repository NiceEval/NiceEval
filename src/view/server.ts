// HTTP server:把站点管线(site.ts 的 planSite)产出的同一份产物挂在指定地址上按路径服务。
// 这里不携带任何取数或布局知识——查不到清单条目就是 404,同一页同一语言的报告块与 `--out`
// 逐字节一致(docs/feature/reports/view.md 开篇)。宿主语义全部作用在管线之外:
//
// - 重建理由只有 watch 闭集。请求不触发重建——打开或刷新页面时盘上没变,产物就是上一次那份。
// - 变更按理由分流:记录变更沿用上一次装载出的定义,模块文件变更才重装整棵 import 图。
// - 产物按订阅渲染:清单是 prebake: "on-demand",重建本身一块都不渲染,块在被要到时才算。
// - 重建结果推给已打开的页面,外壳指纹变了整页重载,否则就地换报告块。
// - 单页渲染失败折成页内错误块(pageFailure: "embed")。
//
// 位置参数 / --exp 收窄是管线输入,不是宿主语义——两宿主同义。

import { createServer, type Server } from "node:http";
import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { type LoadedDefinitions, type ViewScanOptions } from "./data.ts";
import {
  planSite,
  readSiteFile,
  renderSiteReportBlock,
  reportBlockPath,
  SITE_LOCALES,
  type SitePlan,
} from "./site.ts";
import type { ReportLocale } from "../report/model/locale.ts";
import { isHostModulePath } from "../report/runtime/host.ts";
import { formatThrown } from "../util.ts";

export interface ViewOptions {
  input?: string;
  out?: string;
  port?: number;
  /** 监听地址；缺省与 CLI 裸写 --host 都监听全部 IPv4 网卡。 */
  host?: string;
  /** 站点管线的组合语义(位置前缀 / --exp 收窄有效根,--report 换报告槽),透传给管线。 */
  scan?: ViewScanOptions;
  /** 本地模式观察的项目根；静态导出忽略。 */
  watchRoot?: string;
  /** watch 触发的新产物已经构建并发布；初始构建与请求期补建不调用。 */
  onRebuild?: (completedAt: Date) => void;
}

export interface ViewServer {
  /** 首选的本机 URL，供 `--open` 直接打开。 */
  url: string;
  /** 可在浏览器打开的本机与局域网 URL。 */
  urls: string[];
  close(): Promise<void>;
}

/**
 * 重建理由(docs/feature/reports/view.md「变更分两类,失效到不同深度」)。合成一次重建时
 * `modules` 吸收 `records`：模块图重装本来就带着整条管线重跑,反过来不成立。
 */
export type RebuildReason = "records" | "modules";

/** 去抖且单飞：构建期间的任意事件只请求结束后再跑一次。 */
export class ViewRebuildScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private queued: RebuildReason | undefined;
  private pending: RebuildReason | undefined;
  constructor(private readonly rebuild: (reason: RebuildReason) => Promise<void>, private readonly delayMs = 80) {}
  notify(reason: RebuildReason = "records"): void {
    if (this.running) { this.pending = merge(this.pending, reason); return; }
    this.queued = merge(this.queued, reason);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), this.delayMs);
  }
  private async run(): Promise<void> {
    if (this.running) return;
    const reason = this.queued ?? "records";
    this.queued = undefined;
    this.running = true;
    try { await this.rebuild(reason); } finally {
      this.running = false;
      const next = this.pending;
      if (next !== undefined) { this.pending = undefined; this.notify(next); }
    }
  }
  close(): void { clearTimeout(this.timer); }
}

function merge(a: RebuildReason | undefined, b: RebuildReason): RebuildReason {
  return a === "modules" || b === "modules" ? "modules" : "records";
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
  /** 闭集里每个文件上一次看到的 mtime + 大小;文件不存在记 null。 */
  private stamps = new Map<string, string | null>();
  private checking: Promise<void> | undefined;
  constructor(private readonly onChange: () => void) {}

  /** 当前盯着的文件绝对路径全集。 */
  get watched(): ReadonlySet<string> {
    return this.files;
  }

  async sync(entries: readonly string[]): Promise<void> {
    this.files = await projectWatchTargets(entries);
    await this.stamp();
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

  /**
   * 目录事件 → 闭集里真有文件变了才通知。
   *
   * 事件名不足以判定:macOS 的 `fs.watch` 会为同一目录下**没被碰过**的兄弟文件也报一次事件
   * (`.niceeval/` 落一份 result.json,同目录的 report 文件跟着报 rename),`filename` 还可能
   * 是被监听目录自己的名字或 null。只按名字判定的话,记录一落盘就被当成模块变更,
   * 「记录变更不重装模块图」这条分流在默认的 `.niceeval` 布局下等于没有。所以事件只当作
   * 「去核对一下」的信号,变没变由 mtime + 大小说了算。
   */
  handle(_dir: string, _filename: string | Buffer | null): void {
    if (this.checking) return; // 核对本身是异步的,同一批事件合成一次。
    this.checking = this.stamp()
      .then((changed) => {
        if (changed) this.onChange();
      })
      .catch(() => {})
      .finally(() => {
        this.checking = undefined;
      });
  }

  /** 重新采样闭集的 mtime + 大小;返回是否与上一次不同。首次采样(sync)不算变更。 */
  private async stamp(): Promise<boolean> {
    const previous = this.stamps;
    const next = new Map<string, string | null>();
    await Promise.all(
      [...this.files].map(async (file) => {
        try {
          const info = await stat(file);
          next.set(file, `${info.mtimeMs}:${info.size}`);
        } catch {
          next.set(file, null);
        }
      }),
    );
    this.stamps = next;
    if (previous.size === 0) return false;
    for (const [file, stamp] of next) {
      if (!previous.has(file) || previous.get(file) !== stamp) return true;
    }
    return [...previous.keys()].some((file) => !next.has(file));
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

  // 产物重建的单飞通道:同时到达的重建请求共享同一次构建,不并行跑两份 planSite
  // (namespaced import 并发会卡住)。进行中的调用方都 await 同一份 Promise。
  let current: Promise<SitePlan>;
  let inFlight: Promise<SitePlan> | undefined;
  /**
   * 一个订阅中的浏览器:它在看哪一页、哪种语言(docs/feature/reports/view.md
   * 「只渲染看得见的那一块」)。重建后只为这些订阅渲染块,没人看的页不渲染。
   */
  const reloadClients = new Set<{ res: import("node:http").ServerResponse; page?: string; locale: ReportLocale }>();
  let lastError: string | undefined;
  // 上一次装载出的报告 / 主题定义:记录变更的重建沿用它,不重走 namespaced import。
  let definitions: LoadedDefinitions | undefined;
  let shellFingerprint: string | undefined;

  const push = (client: { res: import("node:http").ServerResponse }, event: string, data: unknown): void => {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  /**
   * 重建完成后把结果送到已经打开的页面。外壳指纹变了整页重载(样式表 / 脚本 / head 标签住在
   * `<head>` 里,就地替换要重放整套加载顺序);否则给每个订阅渲染它那一块就地换掉。
   */
  const publish = async (plan: SitePlan): Promise<void> => {
    const shellChanged = shellFingerprint !== undefined && shellFingerprint !== plan.shellFingerprint;
    shellFingerprint = plan.shellFingerprint;
    if (shellChanged) {
      for (const client of reloadClients) push(client, "reload", "shell");
      return;
    }
    for (const client of reloadClients) {
      const page = client.page ?? plan.scan.viewData.report?.initialPageId;
      if (page === undefined || !plan.scan.reportPages.ids.includes(page)) {
        push(client, "reload", "page-gone");
        continue;
      }
      try {
        const html = await renderSiteReportBlock(plan, page, client.locale);
        push(client, "patch", { viewData: plan.scan.viewData, page, locale: client.locale, html });
      } catch (e) {
        push(client, "error", formatThrown(e));
      }
    }
  };

  const rebuild = (reason: RebuildReason = "modules"): Promise<SitePlan> => {
    // 同步挂上 inFlight,避免「两个调用都看到 undefined」并行跑两份 namespaced import。
    if (!inFlight) {
      inFlight = (async () => {
        try {
          const next = await planSite(
            input,
            // 记录变更沿用上一次的定义;模块文件变了就不传,让整棵 import 图重新装载。
            reason === "records" && definitions !== undefined ? { ...scanOptions, definitions } : scanOptions,
            { prebake: "on-demand" },
          );
          current = Promise.resolve(next);
          definitions = next.scan.definitions;
          lastError = undefined;
          await publish(next);
          return next;
        } catch (error) {
          lastError = formatThrown(error);
          process.stderr.write(`view rebuild failed: ${lastError}\n`);
          for (const client of reloadClients) push(client, "error", lastError);
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

  const scheduler = new ViewRebuildScheduler(async (reason) => {
    let succeeded = false;
    try {
      await rebuild(reason);
      succeeded = true;
    } catch { /* keep serving the preceding SitePlan */ }
    // 改动可能新增/删除 import:重算闭集,新引入的组件文件从下一次变更起就被盯着。
    await syncProjectWatch();
    if (succeeded) opts.onRebuild?.(new Date());
  });
  // 记录侧仍是整根递归监听:新 Run 目录、result.json 与证据文件都要接住。
  const recordRoot = resolve(input ?? ".niceeval");
  const onRecordEvent = (_event: string, filename: string | Buffer | null): void => {
    if (isWatchedChange(recordRoot, filename === null ? null : filename.toString())) scheduler.notify("records");
  };
  let recordWatcher: FSWatcher;
  try {
    recordWatcher = watch(recordRoot, { recursive: true }, onRecordEvent);
  } catch {
    recordWatcher = watch(recordRoot, onRecordEvent);
  }
  // 项目侧收窄到闭集,不再整根递归:项目根下的记录、依赖目录与无关文件都不是重建理由。
  const projectEntries = await projectWatchEntries(scanOptions, resolve(opts.watchRoot ?? process.cwd()));
  const projectWatcher = new ProjectFileWatcher(() => scheduler.notify("modules"));
  const syncProjectWatch = async (): Promise<void> => {
    const plan = await current;
    await projectWatcher.sync([...projectEntries, ...plan.scan.projectWatchInputs]).catch(() => {});
  };
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
        // 订阅带上「在看哪一页、哪种语言」:重建只为这些订阅渲染块。切页 / 切语言时前端
        // 重连一次,不需要另一条上行通道。
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        const rawLocale = url.searchParams.get("locale");
        const client = {
          res,
          ...(url.searchParams.get("page") ? { page: url.searchParams.get("page")! } : {}),
          locale: SITE_LOCALES.includes(rawLocale ?? "") ? (rawLocale as ReportLocale) : "en",
        };
        res.write(lastError ? `event: error\ndata: ${JSON.stringify(lastError)}\n\n` : "event: ready\ndata: \"ok\"\n\n");
        reloadClients.add(client);
        req.on("close", () => reloadClients.delete(client));
        return;
      }

      // 站点相对路径:`/` 即 index.html；artifact 使用静态站点同形的 `/artifact/<path>`。
      // 打开或刷新页面不是重建理由(view.md「重建理由是一个闭集」)：盘上没变时直接命中
      // 上一次产物。数据是否最新由 watch 保证，不靠每次请求重跑管线。
      // plan 的参数化页键本身就是 URL 路径（`<pageId>/<encodeURIComponent(key)>.html`），
      // 因此先按浏览器请求里的编码路径精确查表。artifact 等历史清单键仍可能保存未编码的
      // 文件名；只有精确未命中时才回退到解码路径，不能在查表前无条件把 `%40` 变回 `@`。
      const requestPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      // 顶层刷新是远程/不可监听 planning 输入的显式 replan 边界。本地权威输入仍由 watcher
      // 主动触发；刷新失败后绝不把 last-good 继续冒充 current。
      if (requestPath === "index.html" && scanOptions.projectCurrent !== undefined) {
        await rebuild("modules").catch(() => undefined);
        await syncProjectWatch();
      }
      if (lastError !== undefined) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end(`current target unavailable: ${lastError}`);
        return;
      }
      const lookup = (candidate: SitePlan) => {
        let path = requestPath;
        let result = candidate.files.get(path);
        if (!result) {
          try {
            path = decodeURIComponent(requestPath);
            result = candidate.files.get(path);
          } catch {
            // 非法 percent encoding 按原路径查不到处理，由下面统一返回 404。
          }
        }
        return { path, result };
      };
      let plan = await current;
      let { path: sitePath, result: file } = lookup(plan);
      if (!file && sitePath.startsWith("artifact/")) {
        // 未命中最近一次构建的产物清单:管线重建一次再查——server 运行期间
        // 新落盘的证据(新快照、补跑)不需要重启。
        plan = await rebuild("records").catch(() => current);
        ({ path: sitePath, result: file } = lookup(plan));
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

  const host = opts.host ?? "0.0.0.0";
  const port = await listen(server, opts.port ?? 0, host);
  const urls = viewUrls(host, port);
  return {
    url: urls[0]!,
    urls,
    close: () =>
      new Promise((resolveClose, reject) => {
        scheduler.close();
        recordWatcher.close();
        projectWatcher.close();
        reloadClients.forEach((client) => client.res.end());
        server.close((err) => (err ? reject(err) : resolveClose()));
      }),
  };
}

async function listen(server: Server, preferredPort: number, host: string): Promise<number> {
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
      server.listen(port, host);
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

/** `0.0.0.0` 不是浏览器实际访问的地址；把本机和每个 IPv4 局域网地址都明确列出来。 */
function viewUrls(host: string, port: number): string[] {
  const urlFor = (address: string) => `http://${address.includes(":") ? `[${address}]` : address}:${port}/`;
  if (host !== "0.0.0.0") return [urlFor(host)];
  const addresses = ["127.0.0.1"];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)].map(urlFor);
}
