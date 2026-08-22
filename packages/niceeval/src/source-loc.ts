// 源码位置回溯:在 `t.send` / 断言落地时(collector.record / SessionManager.send)抓一次
// 调用栈,挑出**第一帧不属于 niceeval 自身**的位置——也就是用户 eval 里那一行。view 据此把
// 运行结果(回复 / 分数 / 判定)叠回真实源码行,渲染成 github-diff 式代码视图。
//
// 为什么靠栈而不是改 API:这样 `t` 的表面一个字不用动,作者照常写 `t.judge.autoevals...`,
// 位置在底层免费拿到。tsx 直接跑 .ts,栈里就是真实 .ts 路径+行号(ESM 下是 file:// URL)。

import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SourceArtifact, SourceLoc, SourcePathFrame } from "./types.ts";

/** niceeval 自身的 src 目录(本文件所在目录);用于把内部帧排除掉。 */
const SRC_ROOT = dirname(fileURLToPath(import.meta.url));
const activeRegistry = new AsyncLocalStorage<SourceRegistry>();

/** 取 `at … (/abs/file.ts:line:col)` 或 `at file:///abs/file.ts:line:col` 末尾的 路径:行:列。 */
const FRAME_RE = /(?:\()?([^()]+):(\d+):(\d+)\)?$/;

/**
 * 回溯当前调用栈,返回第一帧用户代码的位置(相对项目根 cwd 的路径 + 行列)。
 * 抓不到(无栈 / 全是内部帧)返回 undefined——调用方据此优雅降级(loc 可选)。
 */
export interface SourceRegistry {
  readonly root: string;
  capture(file: string): void;
  artifacts(entry: SourceArtifact): SourceArtifact[];
}

/** 每个 attempt 单独持有；调用发生时同步冻结首次见到的项目源码。 */
export function createSourceRegistry(root: string): SourceRegistry {
  const normalizedRoot = canonical(root);
  const captured = new Map<string, string | undefined>();
  return {
    root: normalizedRoot,
    capture(file) {
      const absolute = canonical(resolve(normalizedRoot, file));
      if (!inside(normalizedRoot, absolute) || captured.has(file)) return;
      try {
        captured.set(file, readFileSync(absolute, "utf-8"));
      } catch {
        captured.set(file, undefined);
      }
    },
    artifacts(entry) {
      const out: SourceArtifact[] = [{ ...entry, role: "entry" }];
      for (const [path, content] of captured) {
        if (path !== entry.path && content !== undefined) out.push({ path, content, role: "referenced" });
      }
      return out;
    },
  };
}

/** 让一个 attempt 的异步调用链共享自己的同步源码快照注册表。 */
export function withSourceRegistry<T>(registry: SourceRegistry, run: () => T): T {
  return activeRegistry.run(registry, run);
}

/**
 * 将 root/registry 显式由 attempt 注入；调用方不再以 cwd 猜测项目边界。
 * registry 在同步栈采集期间立即冻结源码，读取失败只留下路径，供投影输出 unavailable。
 */
export function captureLoc(options: { root?: string; registry?: SourceRegistry } = {}): SourceLoc | undefined {
  const oldLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 64;
  const stack = new Error().stack;
  Error.stackTraceLimit = oldLimit;
  if (!stack) return undefined;
  const registry = options.registry ?? activeRegistry.getStore();
  const root = canonical(options.root ?? registry?.root ?? process.cwd());
  const frames: SourcePathFrame[] = [];
  let declaration: { file: string; line: number; column?: number } | undefined;
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    const m = FRAME_RE.exec(line);
    if (!m) continue;
    let file = m[1]!.trim();
    if (file.startsWith("file://")) {
      try {
        file = fileURLToPath(file);
      } catch {
        continue;
      }
    }
    if (isInternalFrame(file)) continue;
    const absolute = canonical(file);
    const lineNo = Number(m[2]);
    const column = Number(m[3]);
    if (inside(root, absolute)) {
      const project = { kind: "project" as const, file: relative(root, absolute).split(sep).join("/"), line: lineNo, column };
      registry?.capture(project.file);
      if (!declaration) declaration = project;
      else frames.push(project);
      continue;
    }
    const pkg = packageFrame(absolute);
    if (pkg && frames.at(-1)?.kind !== "package") frames.push(pkg);
  }
  if (!declaration) return undefined;
  // V8 栈由内而外；声明位置是第一个项目帧，其余翻转成入口→声明的 callers。
  return { ...declaration, callers: frames.reverse() };
}

/** 内部帧:node 内建、依赖、niceeval 自身 src、loader 注入的过渡帧。 */
function isInternalFrame(file: string): boolean {
  if (!file || file.startsWith("node:")) return true;
  if (file === SRC_ROOT || file.startsWith(SRC_ROOT + "/") || file.startsWith(SRC_ROOT + "\\")) return true;
  return false;
}

function packageFrame(file: string): SourcePathFrame | undefined {
  const marker = `${sep}node_modules${sep}`;
  const at = file.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = file.slice(at + marker.length).split(sep);
  const packageName = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1] ?? ""}` : rest[0];
  return packageName ? { kind: "package", package: packageName } : undefined;
}

function canonical(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    return resolve(file);
  }
}

function inside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
