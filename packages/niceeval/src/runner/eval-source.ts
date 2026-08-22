// Eval 源码捕获 + folder-local 环境身份辅助。
// discovery 时读一次 eval 定义文件、归一化、算 SHA-256(定稿见
// docs/concepts.md「标注 Eval 源码」、docs/feature/record/architecture.md「sources.json」)。
//
// 目标形态是"发现时捕获,同一快照内相同内容只存一份"——本函数只做捕获这一步(读 + 归一化 +
// 哈希),不碰去重存储、不写 result.json。同一文件(数组默认导出多个 eval)共享同一份引用。
//
// 归一化 + 哈希算法住在 record/source-hash.ts,不在这里重新实现一遍——discovery 侧捕获的
// 哈希与证据重建侧重算的哈希必须逐字节一致,唯一的办法是共用同一个函数。这里不参与持久化：
// Record v1 writer 独自拥有 Run 的草稿、封口与发布。
//
// folder-local eval 的目录入口 id 也落在本文件；它只负责「目录路径 → eval base id」。
// Sandbox 起点由每条 Eval 的普通 TypeScript helper 直接声明，不存在 profile registry 或按名查表。

import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { hashEvalSource, normalizeEvalSource } from "../record/source-hash.ts";

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

/**
 * 目录入口 `evals/<dir>/eval.ts` 的 base id:目录相对 `evals/` 的正斜杠路径。
 * 非扇出时它就是 eval id；扇出条目（数组 / keyed record）在它后面追加扇出后缀。
 */
export function folderEntryBaseId(evalsRelativeDir: string): string {
  const id = evalsRelativeDir.split(sep).join("/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!id || id === ".") {
    throw new Error(
      `Folder eval entry under evals/ itself is not allowed: put eval.ts inside a named directory ` +
        `(e.g. evals/foo/eval.ts → profile id "foo").`,
    );
  }
  return id;
}

// 泄题门 API 从本模块再导出,方便 sandbox identity 线只依赖 runner/eval-source 边界,
// 而不用深挖 leak-gate 文件名。
export {
  attachLeakGateHints,
  assertNoHiddenInputLeaks,
  buildContextIdentityContribution,
  filterRulesForBuildKey,
  findHiddenInputLeaks,
  getLeakGateHints,
  isIgnoredByDockerignore,
  listFilteredBuildContextFiles,
  serializeContextFilterRules,
  type BindMountPhase,
  type BindMountSpec,
  type BuildContextSpec,
  type HiddenInput,
  type HiddenInputKind,
  type LeakFinding,
  type LeakGateHints,
} from "./leak-gate.ts";
