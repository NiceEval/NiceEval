// 用户 TypeScript 装载的唯一 runtime：普通 CLI 调用复用 canonical module graph；View 的
// rebuild / fresh discovery 在 generation 开始时清理项目内 module cache，随后在这一代内部
// 保持缓存，使多个入口共享 helper 与 definition identity。依赖包不清理，因此 niceeval/* 与
// effect 始终指向发布包的 canonical runtime。

import { Effect, Semaphore, type Scope } from "effect";
import { createJiti, type Jiti } from "jiti";
import { dirname, extname, isAbsolute, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withSandboxScriptRoot } from "./sandbox/script.ts";

const generationGate = Semaphore.makeUnsafe(1);
const loaderOptions = Object.freeze({
  interopDefault: false,
  moduleCache: true,
  tsconfigPaths: true,
});
const cachedLoader = createJiti(import.meta.url, loaderOptions);

function unwrapDefault(imported: unknown): { default?: unknown } {
  if (typeof imported !== "object" || imported === null) return { default: imported };
  const module = imported as { default?: unknown; __esModule?: unknown };
  const wrapped = module.default;
  if (
    typeof wrapped === "object" && wrapped !== null &&
    Object.hasOwn(wrapped, "default") &&
    (wrapped as { __esModule?: unknown }).__esModule === true
  ) return wrapped as { default?: unknown };
  return module;
}

async function importWith(loader: Jiti, absPath: string): Promise<{ default?: unknown }> {
  return unwrapDefault(await loader.import(absPath));
}

/** Load one trusted project module through the process-wide cached project graph. */
export function importProjectModule(absPath: string): Promise<{ default?: unknown }> {
  return importWith(cachedLoader, absPath);
}

function clearProjectModules(loader: Jiti, projectRoot: string): void {
  const root = resolve(projectRoot);
  const prefix = `${root}${sep}`;
  for (const filename of Object.keys(loader.cache)) {
    if (isAbsolute(filename) && !filename.includes(`${sep}node_modules${sep}`) &&
      (filename === root || filename.startsWith(prefix))) {
      delete loader.cache[filename];
    }
  }
}

export interface FreshImportGeneration {
  /** Import an entry into this generation's one shared project module graph. */
  import(absPath: string): Promise<{ default?: unknown }>;
}

/**
 * Open one fresh project module graph. The gate makes project-cache eviction atomic with all
 * imports in the generation; the caller's Scope releases the gate. Dependencies outside
 * projectRoot retain canonical process identity.
 */
export function acquireFreshImportGeneration(
  projectRoot = process.cwd(),
): Effect.Effect<FreshImportGeneration, never, Scope.Scope> {
  return Effect.gen(function*() {
    // Register this finalizer before constructing the loader: Jiti setup or cache eviction
    // may throw, but neither may strand the generation permit.
    yield* Effect.acquireRelease(generationGate.take(1), () => generationGate.release(1));
    const loader = createJiti(import.meta.url, { ...loaderOptions, tryNative: false });
    clearProjectModules(loader, projectRoot);
    const evaluated = new Map<string, Promise<{ default?: unknown }>>();
    const importFresh = (absPath: string): Promise<{ default?: unknown }> => {
      const existing = evaluated.get(absPath);
      if (existing !== undefined) return existing;
      const pending = evaluate(absPath, new Set());
      evaluated.set(absPath, pending);
      return pending;
    };
    const evaluate = async (absPath: string, ancestors: ReadonlySet<string>): Promise<{ default?: unknown }> => {
      const source = await readFile(absPath, "utf8");
      const visiting = new Set([...ancestors, absPath]);
      // Native ESM imports bypass Jiti's evictable cache, even with tryNative:false.
      // Evaluate the static project closure through Jiti before importing its parent.
      // Package dependencies retain their canonical runtime and are never re-evaluated.
      const transformed = loader.transform({ filename: absPath, source, async: true, ts: /\.[cm]?tsx?$/.test(absPath) });
      const runtimeImports = new Set([...transformed.matchAll(/\bjitiImport\(["']([^"']+)["']/g)].map(match => match[1]));
      for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)) {
        const specifier = match[1];
        if (specifier === undefined || !runtimeImports.has(specifier) || (!specifier.startsWith(".") && !specifier.startsWith("/"))) continue;
        const url = loader.esmResolve(specifier, pathToFileURL(absPath).href);
        if (!url.startsWith("file:")) continue;
        const dependency = fileURLToPath(url);
        if (!dependency.startsWith(`${resolve(projectRoot)}${sep}`) || dependency.includes(`${sep}node_modules${sep}`) || !/\.[cm]?[jt]sx?$/.test(extname(dependency)) || visiting.has(dependency)) continue;
        let pending = evaluated.get(dependency);
        if (pending === undefined) {
          pending = evaluate(dependency, visiting);
          evaluated.set(dependency, pending);
        }
        await pending;
      }
      return unwrapDefault(await loader.evalModule(source, { filename: absPath, async: true, forceTranspile: true }));
    };
    return Object.freeze({
      // Jiti's dynamic import ABI is Promise-based; adaptation remains at this I/O leaf.
      import: (absPath: string) => withSandboxScriptRoot(projectRoot, () => importFresh(absPath)),
    });
  });
}

/** Load one fresh entry while retaining the generation gate until import settles. */
export function freshImportModule(absPath: string) {
  return Effect.scoped(
    acquireFreshImportGeneration(dirname(absPath)).pipe(
      Effect.flatMap((fresh) => Effect.tryPromise(() => fresh.import(absPath))),
    ),
  );
}
