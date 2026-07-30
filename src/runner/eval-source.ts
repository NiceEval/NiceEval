// Eval 源码捕获 + folder-local 环境身份辅助。
// discovery 时读一次 eval 定义文件、归一化、算 SHA-256(定稿见
// docs/concepts.md「标注 Eval 源码」、docs/feature/record/architecture.md「sources.json」)。
//
// 目标形态是"发现时捕获,同一快照内相同内容只存一份"——本函数只做捕获这一步(读 + 归一化 +
// 哈希),不碰去重存储、不写 result.json。同一文件(数组默认导出多个 eval)共享同一份引用。
//
// 归一化 + 哈希算法住在 results/source-hash.ts,不在这里重新实现一遍——discovery 侧捕获的
// 哈希与证据重建侧(annotated-source.ts)重算的哈希必须逐字节一致,唯一的办法是共用同一个
// 函数。runner 已经单向依赖 results(reporters/artifacts.ts 用 createWriter),这里
// 反向引用不新增循环。
//
// folder-local sandbox source 的默认 profile id 与环境 profile 解析也落在本文件:
// BuildKey / CaseKey 的哈希仍归 sandbox identity 线;这里只提供「目录路径 → profile id」
// 与「string | source source → 查表用 profile id」的规则。

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
 * 目录入口 `evals/<dir>/eval.ts` 的默认 profile id:目录相对 `evals/` 的正斜杠路径。
 * 与 eval id 在非扇出时相同;扇出条目(数组 / keyed record)仍用入口目录的 profile id,
 * 不用 `…/0000` 之类的扇出后缀。
 */
export function defaultProfileIdForFolderEntry(evalsRelativeDir: string): string {
  const id = evalsRelativeDir.split(sep).join("/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!id || id === ".") {
    throw new Error(
      `Folder eval entry under evals/ itself is not allowed: put eval.ts inside a named directory ` +
        `(e.g. evals/foo/eval.ts → profile id "foo").`,
    );
  }
  return id;
}

/**
 * 解析这条 eval 用来查 `environments` 表的 profile id:
 * - `environment` 是非空字符串 → 用它(共享 profile);
 * - `environment` 是对象(folder-local sandbox source) → 用目录入口的 `defaultProfileId`;
 * - 都没有 → undefined。
 *
 * CaseKey / materializer 选择仍归 sandbox 线;本函数只给出查表键。
 */
export function resolvedEnvironmentProfileId(evalDef: {
  environment?: unknown;
  defaultProfileId?: string;
}): string | undefined {
  const env = evalDef.environment;
  if (typeof env === "string") {
    const trimmed = env.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (env !== null && typeof env === "object") {
    return evalDef.defaultProfileId;
  }
  return undefined;
}

/** 结构判定:`environment` 是否为 folder-local sandbox source(非字符串的对象声明)。 */
export function isFolderLocalSandboxSource(environment: unknown): environment is object {
  return environment !== null && typeof environment === "object";
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
