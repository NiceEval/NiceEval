// niceeval.config.ts 装载:CLI 与 view 共用。view 本地模式每次重建都使用 fresh import,
// 让当前配置模块图重新求值。

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { freshImportModule, importProjectModule } from "./fresh-import.ts";
import { withSandboxScriptRoot } from "./sandbox/script.ts";
import type { Config } from "./runner/types.ts";

function loadConfigModule(cwd: string, rebuild: boolean): Effect.Effect<Config, unknown> {
  return Effect.gen(function* () {
    const path = join(cwd, "niceeval.config.ts");
    yield* Effect.try({ try: () => {
      if (!existsSync(path)) throw new Error(`Could not find niceeval.config.ts.
Ways to fix:
  - [init] Run \`npx niceeval init\` to scaffold niceeval.config.ts and evals/
  - [cd] Run from the project root that contains niceeval.config.ts
  Docs: node_modules/niceeval/docs-site/zh/tutorials/quickstart.mdx`);
    }, catch: (cause) => cause });
    const mod = yield* (rebuild
      ? freshImportModule(path)
      : Effect.tryPromise({ try: () => withSandboxScriptRoot(cwd, () => importProjectModule(path)), catch: (cause) => cause }));
    return yield* Effect.try({ try: () => {
      if (!mod.default) throw new Error(`niceeval.config.ts must default export defineConfig(...).`);
      return mod.default as Config;
    }, catch: (cause) => cause });
  });
}

/** Canonical trusted module load; callers that need fresh evaluation use rebuild. */
export function loadConfigModuleOnce(cwd: string): Effect.Effect<Config, unknown> {
  return loadConfigModule(cwd, false);
}

/** Serial callers deliberately request a new module graph rather than a boolean mode. */
export function rebuildConfigModule(cwd: string): Effect.Effect<Config, unknown> {
  return loadConfigModule(cwd, true);
}
