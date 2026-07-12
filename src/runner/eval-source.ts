// Eval 源码捕获:discovery 时读一次 eval 定义文件、归一化、算 SHA-256(定稿见
// docs/concepts.md「标注 Eval 源码」、docs/feature/results/architecture.md「sources.json」)。
//
// 目标形态是"发现时捕获,同一快照内相同内容只存一份"——本函数只做捕获这一步(读 + 归一化 +
// 哈希),不碰去重存储、不写 result.json、不改 discoverEvals()。它的产物形状是为了让后续
// 集成把 `captureEvalSource(evalDef.sourcePath)` 直接插进 discoverEvals() 的每个文件循环里:
// path/content 交给 writer 落盘(按 sha256 去重),sha256 也是 buildAnnotatedEvalSource()
// 重建标注模型时用来核对"这就是同一份源码"的锚。
//
// 归一化 + 哈希算法住在 results/source-hash.ts,不在这里重新实现一遍——discovery 侧捕获的
// 哈希与证据重建侧(annotated-source.ts)重算的哈希必须逐字节一致,唯一的办法是共用同一个
// 函数。runner 已经单向依赖 results(reporters/artifacts.ts 用 createResultsWriter),这里
// 反向引用不新增循环。

import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { hashEvalSource, normalizeEvalSource } from "../results/source-hash.ts";

export interface CapturedEvalSource {
  /** 项目相对路径(正斜杠),与 SourceArtifact.path / SourceLoc.file 同一约定。 */
  path: string;
  /** 归一化后的源码文本(去 BOM、CRLF/CR 统一成 LF)。 */
  content: string;
  /** 归一化文本的 SHA-256 十六进制摘要;同一份内容(哪怕跨平台不同换行符)恒相同。 */
  sha256: string;
}

/**
 * 读一个 eval 定义文件、归一化文本、算哈希。`filePath` 是绝对路径(discoverEvals() 里
 * `DiscoveredEval.sourcePath` 的形状);`opts.root` 决定 `path` 字段相对谁计算,省略时
 * 用 `process.cwd()`(与 src/source-loc.ts 的 captureLoc()、runner/attempt.ts 的
 * collectSources() 同一约定——项目相对路径永远相对进程 cwd,不是相对 discoverEvals() 的
 * `root` 参数,两者通常相同但不保证,显式传参让调用方按需要覆盖,也让单测不依赖真实 cwd)。
 *
 * 读不到文件(已删除 / 权限问题)如实抛错——发现阶段的源码文件应当总是可读,
 * 与 collectSources() 运行后"读不到就跳过"的降级语义不同:那时源码可能已经在沙箱里、
 * 已被清理;这里读的是刚刚 import 成功的同一个文件,读不到是需要暴露的异常。
 */
export async function captureEvalSource(filePath: string, opts?: { root?: string }): Promise<CapturedEvalSource> {
  const root = opts?.root ?? process.cwd();
  const raw = await readFile(filePath, "utf-8");
  const content = normalizeEvalSource(raw);
  const path = relative(root, filePath).split(sep).join("/");
  return { path, content, sha256: hashEvalSource(content) };
}
