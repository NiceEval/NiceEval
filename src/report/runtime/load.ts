// --report 的装载:两个宿主(show / view)共用的中性入口。复用跑用户 .ts 配置的
// 同一 tsx 加载机制(bin 里已 register)。show 一进程一次装载;view 的 dev server
// 每次请求现读现渲染 —— ESM 模块缓存永不失效,所以按文件 mtime 做 cache-busting
// (freshImport):报告文件变更 → 下次请求拿到新模块,整页重算(docs/feature/reports/view.md
// 裁决记录 6)。装载环境坑见 memory/tsx-dynamic-import-require-cycle.md。

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isReportDefinition, type ReportDefinition } from "../definition/report.ts";
import { isThemeDefinition, type ThemeDefinition } from "../theme.ts";

/** 可预期的装载错误:宿主打一句英文直说问题与下一步,不抛堆栈。 */
export class ReportLoadError extends Error {}

export interface LoadReportOptions {
  /**
   * 按文件 mtime 追加 query 绕开 ESM 模块缓存:同一文件未变时命中缓存,
   * 变更后重新装载。dev server(view)传 true;一次性进程(show / --out)不需要。
   */
  freshImport?: boolean;
}

export async function loadReportFile(
  cwd: string,
  path: string,
  options?: LoadReportOptions,
): Promise<ReportDefinition> {
  const abs = resolve(cwd, path);
  if (!existsSync(abs)) {
    throw new ReportLoadError(
      `Report file not found: ${abs}. Pass --report an explicit path to a module whose default export is a defineReport(...) product.`,
    );
  }
  const plain = pathToFileURL(abs);
  const url = new URL(plain.href);
  if (options?.freshImport) {
    // 只 bust 报告文件本体:它 import 的模块仍走缓存,与「报告文件变更整页重算」的
    // 装载语义一致(依赖变更不追踪)。tsx 与 Node 原生 ESM 都认 file URL 的 query。
    url.searchParams.set("mtime", String(statSync(abs).mtimeMs));
  }
  let mod: { default?: unknown };
  try {
    mod = (await import(url.href)) as { default?: unknown };
  } catch (e) {
    // 个别装载环境(如 vitest 的 vite-node)按「扩展名 + query」误判文件类型;
    // 退化为普通 import(失去变更重载,不失去功能)。仍失败才是真错误。
    if (url.href !== plain.href) {
      try {
        mod = (await import(plain.href)) as { default?: unknown };
      } catch {
        throw new ReportLoadError(
          `Cannot load report file ${abs}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      throw new ReportLoadError(
        `Cannot load report file ${abs}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (!isReportDefinition(mod.default)) {
    throw new ReportLoadError(
      `${path} does not default-export a report. Export the product of defineReport(...) from "niceeval/report" as the default export — ` +
        `a tree (defineReport(<ExperimentComparison />)) or a config object (defineReport({ title, content | pages, … })).`,
    );
  }
  return mod.default;
}

export function isExplicitModulePath(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || /\.(?:[cm]?[jt]sx?)$/i.test(value);
}

export async function loadBuiltInReport(name: string): Promise<ReportDefinition> {
  if (name === "standard") {
    const { standard } = await import("../built-in/index.tsx");
    return standard;
  }
  throw new ReportLoadError(`Unknown built-in report "${name}". Available built-in reports: standard. To load a file, pass an explicit path such as ./reports/site.tsx.`);
}

export async function loadThemeFile(cwd: string, path: string, options?: LoadReportOptions): Promise<ThemeDefinition> {
  const abs = resolve(cwd, path);
  if (!existsSync(abs)) throw new ReportLoadError(`Theme file not found: ${abs}. Pass --theme an explicit path to a module whose default export is defineTheme(...).`);
  const url = new URL(pathToFileURL(abs).href);
  if (options?.freshImport) url.searchParams.set("mtime", String(statSync(abs).mtimeMs));
  let mod: { default?: unknown };
  try {
    mod = (await import(url.href)) as { default?: unknown };
  } catch (e) {
    throw new ReportLoadError(`Cannot load theme file ${abs}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isThemeDefinition(mod.default)) throw new ReportLoadError(`${path} does not default-export a theme. Export defineTheme(...) from "niceeval/report" as the default export.`);
  return mod.default;
}

export async function loadBuiltInTheme(name: string): Promise<ThemeDefinition> {
  if (name === "basalt") {
    const { basalt } = await import("../theme.ts");
    return basalt;
  }
  throw new ReportLoadError(`Unknown built-in theme "${name}". Available built-in themes: basalt. To load a file, pass an explicit path such as ./themes/acme.ts.`);
}
