// 数据集加载器:把 YAML / JSON 读进来,配 .map(row => defineEval(...)) 扇出。

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { t } from "../i18n/index.ts";

let activeCapture: Set<string> | undefined;

/** 发现期包住一个 eval 模块的求值，记录它经公开 loader 读取的数据文件。 */
export async function captureLoadedFiles<T>(load: () => Promise<T>): Promise<{ value: T; paths: string[] }> {
  const previous = activeCapture;
  const paths = new Set<string>();
  activeCapture = paths;
  try {
    return { value: await load(), paths: [...paths].sort() };
  } finally {
    activeCapture = previous;
  }
}

function resolvedPath(path: string): string {
  const absolute = resolve(process.cwd(), path);
  activeCapture?.add(absolute);
  return absolute;
}

export async function loadJson<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(resolvedPath(path), "utf-8");
  return JSON.parse(raw) as T;
}

export async function loadYaml<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(resolvedPath(path), "utf-8");
  // yaml 是可选依赖:用变量 specifier 避免 tsc 静态解析。装了就用真解析器;
  // 没装直接报错并给出下一步 —— 不再退回手写的「极简 YAML」:它对嵌套 / 多行 /
  // 锚点会静默解析出错误数据,让 eval 拿着错的 case 跑起来比直接失败更糟。
  const yamlPkg = "yaml";
  let parse: (s: string) => unknown;
  try {
    ({ parse } = (await import(yamlPkg)) as { parse(s: string): unknown });
  } catch {
    throw new Error(t("loaders.yamlMissing", { path }));
  }
  return parse(raw) as T;
}
