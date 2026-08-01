// 发现:扫 evals/ 找 *.eval.ts / 目录入口 eval.ts(默认导出 EvalDef、数组或 keyed record),
// 扫 experiments/ 找实验。路径即身份:id 从相对路径推导,排序保证稳定。
// 同 id 双入口(foo.eval.ts 与 foo/eval.ts)启动期报重名;folder-local source 的默认
// profile id 与泄题门交叉检查见 docs/feature/eval/README.md、docs/feature/sandbox/case.md。

import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pad4 } from "../util.ts";
import {
  assertNoHiddenInputLeaks,
  captureEvalSource,
  defaultProfileIdForFolderEntry,
  getLeakGateHints,
  type HiddenInput,
  type LeakGateHints,
} from "./eval-source.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";
import { isDefinedScoreEval } from "../define.ts";
import { captureLoadedFiles } from "../loaders/index.ts";
import type {
  DiscoveredEval,
  DiscoveredExperiment,
  EvalAuthorFields,
  EvalScoring,
  ExperimentDef,
  TestContext,
} from "../types.ts";

const SKIP_DIRS = new Set(["node_modules", ".git", ".niceeval", "dist", ".next"]);

interface EvalEntry {
  readonly file: string;
  readonly baseId: string;
  readonly kind: "file" | "folder";
}

/** 动态 import 的运行时输入：factory 品牌只服务作者类型，discovery 需同时兼容旧的裸对象导出。 */
type ImportedEval = EvalAuthorFields & {
  scoring?: EvalScoring;
  test(t: TestContext): Promise<void> | void;
};

/**
 * 发现阶段的动态 import 会执行被加载文件的**顶层代码**(配置文件里现拉 registry、读 .env、
 * 连服务都很常见)。裸抛出去的话用户只看到一个不知从何而来的 `TypeError: fetch failed`——
 * 发现要遍历整棵 `evals/` / `experiments/` 树,一个文件炸了并不会告诉你是哪一个。
 * 这里把文件路径钉进 message,原错误挂 `cause`(`formatThrown` 会展开成 `caused by:` 链)。
 */
async function importDiscovered<T>(file: string, root: string, kind: "eval" | "experiment"): Promise<T> {
  try {
    return (await import(pathToFileURL(file).href)) as T;
  } catch (e) {
    throw new Error(
      `Failed to load ${kind} file ${relative(root, file)}: its top-level code threw while being imported. ` +
        `Fix the error below, or move the work into the ${kind} body so it only runs when this ${kind} is selected.`,
      { cause: e },
    );
  }
}

async function walkFiles(dir: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(current, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile() && match(e.name)) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

function isFolderEntryName(name: string): boolean {
  return name === "eval.ts" || name === "eval.tsx";
}

function isFileEntryName(name: string): boolean {
  return name.endsWith(".eval.ts") || name.endsWith(".eval.tsx");
}

/** 收集文件入口与目录入口,同 id 双入口在 import 之前报重名。 */
async function collectEvalEntries(evalsDir: string, root: string): Promise<EvalEntry[]> {
  const files = (
    await walkFiles(evalsDir, (n) => isFileEntryName(n) || isFolderEntryName(n))
  ).sort();
  const entries: EvalEntry[] = [];
  for (const file of files) {
    const name = basename(file);
    if (isFolderEntryName(name)) {
      const relDir = relative(evalsDir, dirname(file)).split(sep).join("/");
      const baseId = defaultProfileIdForFolderEntry(relDir === "" ? "." : relDir);
      entries.push({ file, baseId, kind: "folder" });
    } else {
      const baseId = relative(evalsDir, file).replace(/\.eval\.tsx?$/, "").split(sep).join("/");
      entries.push({ file, baseId, kind: "file" });
    }
  }
  const seen = new Map<string, EvalEntry>();
  for (const entry of entries) {
    const prev = seen.get(entry.baseId);
    if (prev) {
      const a = relative(root, prev.file).split(sep).join("/");
      const b = relative(root, entry.file).split(sep).join("/");
      throw new Error(
        `Duplicate eval id ${JSON.stringify(entry.baseId)}: both ${a} and ${b} map to the same id. ` +
          `Keep only one entry — either the file form (<id>.eval.ts) or the folder form (<id>/eval.ts).`,
      );
    }
    seen.set(entry.baseId, entry);
  }
  return entries;
}

export async function discoverEvals(root: string): Promise<DiscoveredEval[]> {
  const dir = join(root, "evals");
  const entries = await collectEvalEntries(dir, root);
  const out: DiscoveredEval[] = [];
  for (const entry of entries) {
    const file = entry.file;
    const { value: mod, paths: loaderDataPaths, criteriaPaths, privatePaths } = await captureLoadedFiles(() =>
      importDiscovered<{
        default?: ImportedEval | ImportedEval[] | globalThis.Record<string, ImportedEval>;
      }>(file, root, "eval"),
    );
    const def = mod.default;
    if (!def) continue;
    const baseId = entry.baseId;
    const baseDir = dirname(file);
    const defaultProfileId = entry.kind === "folder" ? baseId : undefined;
    // discovery 时读一次、归一化、算 SHA-256:同一文件(数组默认导出多个 eval)只读一次盘,
    // 全部共享同一份 CapturedEvalSource 引用——写入面按哈希去重靠的就是这份内容天然相同。
    const source = await captureEvalSource(file, { root });
    const pushOne = (d: ImportedEval, id: string): void => {
      assertScoreEvalOrigin(d, file);
      out.push({
        ...d,
        id,
        baseDir,
        sourcePath: file,
        source,
        loaderDataPaths,
        criteriaPaths,
        ...(privatePaths.length > 0 ? { privatePaths } : {}),
        ...(defaultProfileId !== undefined ? { defaultProfileId } : {}),
      });
    };
    if (Array.isArray(def)) {
      def.forEach((d, i) => pushOne(d, `${baseId}/${pad4(i)}`));
    } else if (!isEvalDef(def)) {
      const dataset = def;
      for (const key of Object.keys(dataset).sort()) {
        assertDatasetKey(key, file);
        const d = dataset[key];
        if (!d || typeof d.test !== "function") {
          throw new Error(
            `Invalid keyed eval dataset export in ${file}: key ${JSON.stringify(key)} must map to an EvalDef with test().`,
          );
        }
        pushOne(d, `${baseId}/${key}`);
      }
    } else {
      pushOne(def, baseId);
    }

    await runLeakGateIfNeeded({
      evalId: baseId,
      baseDir,
      environment: Array.isArray(def)
        ? def[0]?.environment
        : isEvalDef(def)
          ? def.environment
          : Object.values(def)[0]?.environment,
      criteriaPaths,
      privatePaths,
    });
  }
  return out;
}

/**
 * 优先用 `attachLeakGateHints` 挂上的提示;否则对 branded dockerfile / compose source
 * 自动构造 buildContexts(与相对 bind mounts)。Compose 结构抽取在 sandbox/compose.ts。
 */
async function leakGateHintsFor(environment: unknown, baseDir: string): Promise<LeakGateHints | undefined> {
  const attached = getLeakGateHints(environment);
  if (attached) return attached;
  if (environment === null || typeof environment !== "object") return undefined;
  const env = environment as {
    kind?: string;
    context?: string | URL;
    file?: string | URL;
    mainService?: string;
    __brand?: string;
  };
  if (env.kind === "dockerfile" && env.__brand === "niceeval.sandboxSource.dockerfile" && env.context !== undefined) {
    const contextDir =
      typeof env.context === "string" ? resolve(baseDir, env.context) : fileURLToPath(env.context);
    return { buildContexts: [{ contextDir, label: "dockerfile" }] };
  }
  if (
    env.kind === "compose" &&
    env.__brand === "niceeval.sandboxSource.compose" &&
    env.file !== undefined &&
    typeof env.mainService === "string"
  ) {
    const { leakGateHintsFromComposeFile } = await import("../sandbox/compose.ts");
    const { hints } = await leakGateHintsFromComposeFile(env.file, {
      mainService: env.mainService,
      baseDir,
    });
    return hints;
  }
  return undefined;
}

async function runLeakGateIfNeeded(input: {
  evalId: string;
  baseDir: string;
  environment: unknown;
  criteriaPaths: readonly string[];
  privatePaths: readonly string[];
}): Promise<void> {
  const hints = await leakGateHintsFor(input.environment, input.baseDir);
  if (!hints) return;
  const hidden: HiddenInput[] = [
    ...input.criteriaPaths.map((path) => ({ path, kind: "verifier" as const })),
    ...input.privatePaths.map((path) => ({ path, kind: "private" as const })),
  ];
  if (hidden.length === 0) return;
  await assertNoHiddenInputLeaks({
    hidden,
    buildContexts: hints.buildContexts,
    bindMounts: hints.bindMounts,
    evalId: input.evalId,
  });
}

function assertScoreEvalOrigin(def: ImportedEval, file: string): void {
  if (def.scoring === "points" && !isDefinedScoreEval(def)) {
    throw new Error(`Invalid points-scoring eval export in ${file}: use defineScoreEval() instead of writing scoring: "points".`);
  }
}

function isEvalDef(value: ImportedEval | globalThis.Record<string, ImportedEval>): value is ImportedEval {
  return typeof (value as ImportedEval).test === "function";
}

function assertDatasetKey(key: string, file: string): void {
  if (
    key.length === 0 ||
    key === "." ||
    key === ".." ||
    key.includes("/") ||
    key.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    throw new Error(
      `Invalid keyed eval dataset key ${JSON.stringify(key)} in ${file}: ` +
        "keys must be non-empty path segments; '.', '..', '/', '\\', and control characters are not allowed.",
    );
  }
}

export async function discoverExperiments(root: string): Promise<DiscoveredExperiment[]> {
  const dir = join(root, "experiments");
  const files = (await walkFiles(dir, (n) => n.endsWith(".ts") && !n.endsWith(".d.ts"))).sort();
  const out: DiscoveredExperiment[] = [];
  for (const file of files) {
    const mod = await importDiscovered<{ default?: ExperimentDef }>(file, root, "experiment");
    const def = mod.default;
    if (!def || !def.agent) continue;
    const id = relative(dir, file)
      .replace(/\.ts$/, "")
      .replace(/\.experiment$/, "")
      .split(sep)
      .join("/");
    out.push({ ...def, id });
  }
  return out;
}

/** eval id 的裸字面前缀过滤；exp / show / view 共用 shared helper，避免路径段语义漂移。 */
export function makeFilter(patterns: string[]): (id: string) => boolean {
  return evalPrefixPredicate(patterns.length > 0 ? patterns : undefined);
}
