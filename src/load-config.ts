// niceeval.config.ts 装载:CLI 与 view 共用。view 本地模式每次重建传 freshImport,
// 让 config.report / config.theme 及其整棵 import 图失效(docs/feature/reports/view.md)。

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { freshImportModule } from "./fresh-import.ts";
import { t } from "./i18n/index.ts";
import type { Config } from "./runner/types.ts";

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
    // vitest 的 vite-node 等环境可能不认 namespaced register;退化普通 import
    // (失去变更重载,不失去功能)。仍失败才是真错误。
    if (options?.freshImport) {
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
