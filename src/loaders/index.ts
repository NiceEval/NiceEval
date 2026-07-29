// 数据集与判据文件加载器:结构化数据读成 YAML / JSON,配 .map(row => defineEval(...)) 扇出;
// 非结构化的判据文件读成原文。经这里读入的文件都登记进读它那条 eval 的指纹。
// 路径两种写法等价:项目根相对的字符串,或 eval 文件相对的 `file:` URL(`new URL(p, import.meta.url)`)。
// 登记只在发现期的模块求值里成立,所以 capture 不在场时直接报错,不静默漏登记。

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

// 两种入参在这里归一成一个绝对路径,登记与指纹因此天然等价:字符串按项目根(进程 cwd)解析,
// URL 只认 `file:`。fileURLToPath 是 niceeval 内部实现,用户侧写 `new URL(p, import.meta.url)`
// 就够,不需要 import node:url。
function resolvedPath(path: string | URL): string {
  const absolute = typeof path === "string" ? resolve(process.cwd(), path) : fromFileUrl(path);
  if (!activeCapture) throw new Error(t("loaders.outsideDiscovery", { path: String(path) }));
  activeCapture.add(absolute);
  return absolute;
}

function fromFileUrl(url: URL): string {
  if (url.protocol !== "file:") throw new Error(t("loaders.nonFileUrl", { url: url.href, protocol: url.protocol }));
  return fileURLToPath(url);
}

/**
 * 读入一个 JSON 数据文件并解析。路径写项目根相对的字符串,或 eval 文件相对的
 * `new URL(p, import.meta.url)`。内容哈希进读它的那条 eval 的指纹。
 */
export async function loadJson<T = unknown>(path: string | URL): Promise<T> {
  const raw = await readFile(resolvedPath(path), "utf-8");
  return JSON.parse(raw) as T;
}

/**
 * 按 utf-8 读入一个文件的原文。判据不是结构化数据时用它:隐藏测试脚本、参考实现、
 * shell 模板都是判据文件。读入即宣告「它参与判定」——文件内容哈希进读它的那条 eval
 * 的指纹,改一字节就重跑那条 eval。用 `fs` 自行读入的文件不进指纹。
 * 路径写项目根相对的字符串,或 eval 文件相对的 `new URL(p, import.meta.url)`。
 */
export async function loadText(path: string | URL): Promise<string> {
  return readFile(resolvedPath(path), "utf-8");
}

/**
 * 读入一个 YAML 数据文件并解析,需要项目里装了 `yaml`。路径写项目根相对的字符串,
 * 或 eval 文件相对的 `new URL(p, import.meta.url)`。内容哈希进读它的那条 eval 的指纹。
 */
export async function loadYaml<T = unknown>(path: string | URL): Promise<T> {
  const raw = await readFile(resolvedPath(path), "utf-8");
  // yaml 是可选依赖:用变量 specifier 避免 tsc 静态解析。装了就用真解析器;
  // 没装直接报错并给出下一步 —— 不再退回手写的「极简 YAML」:它对嵌套 / 多行 /
  // 锚点会静默解析出错误数据,让 eval 拿着错的 case 跑起来比直接失败更糟。
  const yamlPkg = "yaml";
  let parse: (s: string) => unknown;
  try {
    ({ parse } = (await import(yamlPkg)) as { parse(s: string): unknown });
  } catch {
    throw new Error(t("loaders.yamlMissing", { path: String(path) }));
  }
  return parse(raw) as T;
}
