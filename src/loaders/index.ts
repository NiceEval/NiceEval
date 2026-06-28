// 数据集加载器:把 YAML / JSON 读进来,配 .map(row => defineEval(...)) 扇出。

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadJson<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(resolve(process.cwd(), path), "utf-8");
  return JSON.parse(raw) as T;
}

export async function loadYaml<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(resolve(process.cwd(), path), "utf-8");
  // 尽量用真正的 yaml 解析器(若项目装了);否则退回极简解析。
  // 用变量 specifier 避免 tsc 静态解析这个可选依赖。
  const yamlPkg = "yaml";
  try {
    const yaml = (await import(yamlPkg)) as { parse(s: string): unknown };
    return yaml.parse(raw) as T;
  } catch {
    return parseSimpleYaml(raw) as T;
  }
}

/** 极简 YAML(只够 cases 列表这类扁平结构;复杂结构请 `pnpm add yaml`)。 */
function parseSimpleYaml(text: string): unknown {
  const lines = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  const root: Record<string, unknown> = {};
  let currentKey: string | undefined;
  let list: Record<string, unknown>[] | undefined;
  let item: Record<string, unknown> | undefined;
  for (const line of lines) {
    const m = /^(\s*)(- )?([\w.-]+)?:?\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, indent, dash, key, value] = m;
    if (indent === "" && key && !dash) {
      currentKey = key;
      list = [];
      root[currentKey] = list;
    } else if (dash) {
      item = {};
      list?.push(item);
      if (key) item[key] = coerce(value);
    } else if (key && item) {
      item[key] = coerce(value);
    }
  }
  return root;
}

function coerce(v: string): unknown {
  const t = v.trim().replace(/^["']|["']$/g, "");
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return t;
}
