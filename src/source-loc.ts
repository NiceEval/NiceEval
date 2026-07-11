// 源码位置回溯:在 `t.send` / 断言落地时(collector.record / SessionManager.send)抓一次
// 调用栈,挑出**第一帧不属于 niceeval 自身**的位置——也就是用户 eval 里那一行。view 据此把
// 运行结果(回复 / 分数 / 判定)叠回真实源码行,渲染成 github-diff 式代码视图。
//
// 为什么靠栈而不是改 API:这样 `t` 的表面一个字不用动,作者照常写 `t.judge.autoevals...`,
// 位置在底层免费拿到。tsx 直接跑 .ts,栈里就是真实 .ts 路径+行号(ESM 下是 file:// URL)。

import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceLoc } from "./types.ts";

/** niceeval 自身的 src 目录(本文件所在目录);用于把内部帧排除掉。 */
const SRC_ROOT = dirname(fileURLToPath(import.meta.url));

/** 取 `at … (/abs/file.ts:line:col)` 或 `at file:///abs/file.ts:line:col` 末尾的 路径:行:列。 */
const FRAME_RE = /(?:\()?([^()]+):(\d+):(\d+)\)?$/;

/**
 * 回溯当前调用栈,返回第一帧用户代码的位置(相对项目根 cwd 的路径 + 行列)。
 * 抓不到(无栈 / 全是内部帧)返回 undefined——调用方据此优雅降级(loc 可选)。
 */
export function captureLoc(): SourceLoc | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  const cwd = process.cwd();
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
    const rel = relative(cwd, file);
    const display = rel && !rel.startsWith("..") ? rel : file;
    return { file: display.split("\\").join("/"), line: Number(m[2]), column: Number(m[3]) };
  }
  return undefined;
}

/** 内部帧:node 内建、依赖、niceeval 自身 src、loader 注入的过渡帧。 */
function isInternalFrame(file: string): boolean {
  if (!file || file.startsWith("node:")) return true;
  if (file.includes("node_modules")) return true;
  if (file === SRC_ROOT || file.startsWith(SRC_ROOT + "/") || file.startsWith(SRC_ROOT + "\\")) return true;
  return false;
}
