// --report / --theme 的装载:两个宿主(show / view)共用的中性入口。复用跑用户 .ts 配置的
// 同一 tsx 加载机制(bin 里已 register)。show 一进程一次装载;view 的 dev server
// 每次重建用 tsx namespaced register 装载入口及其整棵 import 子图
// (docs/feature/reports/README.md「持续重建」——改组件与改报告文件同级)。
// 装载环境坑见 memory/tsx-dynamic-import-require-cycle.md、
// memory/view-hot-reload-needs-namespace-import.md。

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { isReportDefinition, type ReportDefinition } from "../definition/report.ts";
import { isThemeDefinition, type ThemeDefinition } from "../theme.ts";

/** 可预期的装载错误:宿主打一句英文直说问题与下一步,不抛堆栈。 */
export class ReportLoadError extends Error {}

export interface LoadReportOptions {
  /**
   * 绕开 ESM 模块缓存:入口及其项目内 import 子图全部是新实例。
   * dev server(view)传 true;一次性进程(show / --out)不需要。
   */
  freshImport?: boolean;
}

let freshGeneration = 0;
let freshChain: Promise<unknown> = Promise.resolve();

/** 报告按自身所在项目解释 JSX/paths，而不是继承启动 niceeval 的 cwd。 */
function nearestTsconfig(file: string): string | undefined {
  let dir = dirname(file);
  const root = parse(dir).root;
  for (;;) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

/**
 * tsx namespaced register:整棵子图新实例。与 src/fresh-import.ts 同原语;
 * 本文件进 dist/report 编译单元,不能相对 import 那份源码,逻辑并行维护。
 * 并发 register 会死锁,串行化。
 */
async function projectImport(abs: string, fresh: boolean): Promise<{ default?: unknown }> {
  const run = async (): Promise<{ default?: unknown }> => {
    const tsconfig = nearestTsconfig(abs);
    const ns = register({
      namespace: fresh
        ? `niceeval-report-fresh-${++freshGeneration}`
        : `niceeval-report-${createHash("sha256").update(abs).digest("hex").slice(0, 16)}`,
      ...(tsconfig !== undefined ? { tsconfig } : {}),
    });
    const url = pathToFileURL(abs).href;
    // 某些宿主（尤其已经装了自己的 TS loader 的进程）会先把外部 TSX 按 classic JSX
    // 编译。报告契约不要求作者 import React；而 render 回调在 import 结束后才执行，所以
    // runtime 必须在整个报告宿主进程内可见，不能只在装载窗口临时挂上。
    const globals = globalThis as typeof globalThis & { React?: unknown };
    globals.React ??= await import("react");
    try {
      return (await ns.import(url, url)) as { default?: unknown };
    } finally {
      await ns.unregister();
    }
  };
  const next = freshChain.then(run, run);
  freshChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
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
  let mod: { default?: unknown };
  try {
    // 普通 show 也走文件所属项目的 tsconfig；freshImport 只表达宿主是否期望重载，
    // scoped namespace 本身已令入口及项目内子图获得独立身份。
    mod = await projectImport(abs, options?.freshImport === true);
  } catch (e) {
    // 个别装载环境(如 vitest 的 vite-node)不认 namespaced register;
    // 退化为普通 import(失去变更重载,不失去功能)。仍失败才是真错误。
    if (options?.freshImport) {
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
        `a page render function (defineReport((sample) => <Page>…</Page>)) or a config object (defineReport({ title?, pages: [{ id, title, render }], … })).`,
    );
  }
  return mod.default;
}

export function isExplicitModulePath(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || /\.(?:[cm]?[jt]sx?)$/i.test(value);
}

export async function loadBuiltInReport(name: string): Promise<ReportDefinition> {
  if (name === "standard" || name === "failures" || name === "stability") {
    const views = await import("../built-in/legacy.ts");
    return views[name];
  }
  throw new ReportLoadError(`Unknown built-in report "${name}". Available built-in reports: standard, failures, stability. To load a file, pass an explicit path such as ./reports/site.tsx.`);
}

export async function loadThemeFile(cwd: string, path: string, options?: LoadReportOptions): Promise<ThemeDefinition> {
  const abs = resolve(cwd, path);
  if (!existsSync(abs)) throw new ReportLoadError(`Theme file not found: ${abs}. Pass --theme an explicit path to a module whose default export is defineTheme(...).`);
  const plain = pathToFileURL(abs);
  let mod: { default?: unknown };
  try {
    mod = await projectImport(abs, options?.freshImport === true);
  } catch (e) {
    if (options?.freshImport) {
      try {
        mod = (await import(plain.href)) as { default?: unknown };
      } catch {
        throw new ReportLoadError(`Cannot load theme file ${abs}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      throw new ReportLoadError(`Cannot load theme file ${abs}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!isThemeDefinition(mod.default)) throw new ReportLoadError(`${path} does not default-export a theme. Export defineTheme(...) from "niceeval/report" as the default export.`);
  return mod.default;
}

export async function loadBuiltInTheme(name: string): Promise<ThemeDefinition> {
  if (name === "basalt" || name === "chalk") {
    const themes = await import("../theme.ts");
    return themes[name];
  }
  throw new ReportLoadError(`Unknown built-in theme "${name}". Available built-in themes: basalt, chalk. To load a file, pass an explicit path such as ./themes/acme.ts.`);
}
