// 发现:扫 evals/ 找 *.eval.ts(默认导出 EvalDef 或数组),扫 experiments/ 找实验。
// 路径即身份:id 从相对路径推导,排序保证稳定。

import { readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { pad4 } from "../util.ts";
import type { DiscoveredEval, DiscoveredExperiment, EvalDef, ExperimentDef } from "../types.ts";

const SKIP_DIRS = new Set(["node_modules", ".git", ".fastevals", "dist", ".next"]);

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
    const mod = (await import(pathToFileURL(file).href)) as { default?: EvalDef | EvalDef[] };
    const def = mod.default;
    if (!def) continue;
    const baseId = relative(dir, file).replace(/\.eval\.tsx?$/, "").split(sep).join("/");
    const baseDir = dirname(file);
    if (Array.isArray(def)) {
      def.forEach((d, i) => out.push({ ...d, id: `${baseId}/${pad4(i)}`, baseDir }));
    } else {
      out.push({ ...def, id: baseId, baseDir });
    }
  }
  return out;
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
