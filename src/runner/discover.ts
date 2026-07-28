// 发现:扫 evals/ 找 *.eval.ts(默认导出 EvalDef、数组或 keyed record),扫 experiments/ 找实验。
// 路径即身份:id 从相对路径推导,排序保证稳定。

import { readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { pad4 } from "../util.ts";
import { captureEvalSource } from "./eval-source.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";
import { isDefinedScoreEval } from "../define.ts";
import { captureLoadedFiles } from "../loaders/index.ts";
import type { DiscoveredEval, DiscoveredExperiment, EvalDef, ExperimentDef } from "../types.ts";

const SKIP_DIRS = new Set(["node_modules", ".git", ".niceeval", "dist", ".next"]);

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

export async function discoverEvals(root: string): Promise<DiscoveredEval[]> {
  const dir = join(root, "evals");
  const files = (await walkFiles(dir, (n) => n.endsWith(".eval.ts") || n.endsWith(".eval.tsx"))).sort();
  const out: DiscoveredEval[] = [];
  for (const file of files) {
    const { value: mod, paths: loaderDataPaths } = await captureLoadedFiles(() => importDiscovered<{
      default?: EvalDef | EvalDef[] | globalThis.Record<string, EvalDef>;
    }>(file, root, "eval"));
    const def = mod.default;
    if (!def) continue;
    const baseId = relative(dir, file).replace(/\.eval\.tsx?$/, "").split(sep).join("/");
    const baseDir = dirname(file);
    // discovery 时读一次、归一化、算 SHA-256:同一文件(数组默认导出多个 eval)只读一次盘,
    // 全部共享同一份 CapturedEvalSource 引用——写入面按哈希去重靠的就是这份内容天然相同。
    const source = await captureEvalSource(file, { root });
    if (Array.isArray(def)) {
      def.forEach((d, i) => {
        assertScoreEvalOrigin(d, file);
        out.push({ ...d, id: `${baseId}/${pad4(i)}`, baseDir, sourcePath: file, source, loaderDataPaths });
      });
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
        assertScoreEvalOrigin(d, file);
        out.push({ ...d, id: `${baseId}/${key}`, baseDir, sourcePath: file, source, loaderDataPaths });
      }
    } else {
      assertScoreEvalOrigin(def, file);
      out.push({ ...def, id: baseId, baseDir, sourcePath: file, source, loaderDataPaths });
    }
  }
  return out;
}

function assertScoreEvalOrigin(def: EvalDef, file: string): void {
  if (def.scoring === "points" && !isDefinedScoreEval(def)) {
    throw new Error(`Invalid points-scoring eval export in ${file}: use defineScoreEval() instead of writing scoring: "points".`);
  }
}

function isEvalDef(value: EvalDef | globalThis.Record<string, EvalDef>): value is EvalDef {
  return typeof (value as EvalDef).test === "function";
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
