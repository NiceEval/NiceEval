// niceeval.config.ts 装载:CLI 与 view 共用。view 本地模式每次重建传 freshImport,
// 让 config.report / config.theme 及其整棵 import 图失效(docs/feature/reports/README.md)。

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { freshImportModule } from "./fresh-import.ts";
import { t } from "./i18n/index.ts";
import type { Config } from "./runner/types.ts";

function needsAdditionalTsxLoader(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ERR_UNKNOWN_FILE_EXTENSION"
  );
}

export async function loadConfigFile(
  cwd: string,
  options?: { freshImport?: boolean },
): Promise<Config> {
  const path = join(cwd, "niceeval.config.ts");
  if (!existsSync(path)) {
    throw new Error(t("cli.config.missing"));
  }
  let mod: { default?: Config };
  try {
    mod = options?.freshImport
      ? ((await freshImportModule(path)) as { default?: Config })
      : ((await import(pathToFileURL(path).href)) as { default?: Config });
  } catch (e) {
    // 全局 tsx hook 能装载 config.ts，但 Node ESM 在某些项目形态下会让它的静态
    // import 回落原生 loader；config 一旦 import 了 Report .tsx 就报
    // ERR_UNKNOWN_FILE_EXTENSION。只对这个装载能力错误补一层 tsx hook
    // 重试，用户模块自己抛错时不重放副作用。
    if (!options?.freshImport && needsAdditionalTsxLoader(e)) {
      const url = pathToFileURL(path).href;
      register();
      // 这是一次性 CLI 装载器：保留 hook 到进程结束。不用 namespace——
      // config 图可能进入 CJS package，tsx 在 Node builtin URL 上传播 namespace query
      // 会把 node:util 误当文件读取。query 只击穿上一次失败的入口 cache。
      mod = (await import(`${url}?niceeval-config=${Date.now()}`)) as { default?: Config };
    // vitest 的 vite-node 等环境可能不认 namespaced register;退化普通 import
    // (失去变更重载,不失去功能)。仍失败才是真错误。
    } else if (options?.freshImport) {
      try {
        mod = (await import(pathToFileURL(path).href)) as { default?: Config };
      } catch {
        throw e instanceof Error ? e : new Error(String(e));
      }
    } else {
      throw e;
    }
  }
  if (!mod.default) throw new Error(t("cli.config.noDefault"));
  return mod.default;
}
