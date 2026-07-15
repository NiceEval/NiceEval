// 发现:扫 evals/ 找 *.eval.ts(默认导出 EvalDef、数组或 keyed record),扫 experiments/ 找实验。
// 路径即身份:id 从相对路径推导,排序保证稳定。

import { readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { pad4 } from "../util.ts";
import { captureEvalSource } from "./eval-source.ts";
import type { DiscoveredEval, DiscoveredExperiment, EvalDef, ExperimentDef } from "../types.ts";

const SKIP_DIRS = new Set(["node_modules", ".git", ".niceeval", "dist", ".next"]);

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
    const mod = (await import(pathToFileURL(file).href)) as {
      default?: EvalDef | EvalDef[] | Record<string, EvalDef>;
    };
    const def = mod.default;
    if (!def) continue;
    const baseId = relative(dir, file).replace(/\.eval\.tsx?$/, "").split(sep).join("/");
    const baseDir = dirname(file);
    // discovery 时读一次、归一化、算 SHA-256:同一文件(数组默认导出多个 eval)只读一次盘,
    // 全部共享同一份 CapturedEvalSource 引用——写入面按哈希去重靠的就是这份内容天然相同。
    const source = await captureEvalSource(file, { root });
    if (Array.isArray(def)) {
      def.forEach((d, i) => out.push({ ...d, id: `${baseId}/${pad4(i)}`, baseDir, sourcePath: file, source }));
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
        out.push({ ...d, id: `${baseId}/${key}`, baseDir, sourcePath: file, source });
      }
    } else {
      out.push({ ...def, id: baseId, baseDir, sourcePath: file, source });
    }
  }
  return out;
}

function isEvalDef(value: EvalDef | Record<string, EvalDef>): value is EvalDef {
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
    const mod = (await import(pathToFileURL(file).href)) as { default?: ExperimentDef };
    const def = mod.default;
    if (!def || !def.agent) continue;
    const id = relative(dir, file)
      .replace(/\.ts$/, "")
      .replace(/\.experiment$/, "")
      .split(sep)
      .join("/");
    const group = id.includes("/") ? id.split("/")[0]! : "";
    out.push({ ...def, id, group });
  }
  return out;
}

/** id 前缀过滤:精确匹配或目录前缀(weather 命中 weather 与 weather/*)。 */
export function makeFilter(patterns: string[]): (id: string) => boolean {
  if (patterns.length === 0) return () => true;
  return (id) => patterns.some((p) => id === p || id.startsWith(p + "/"));
}
