// 用户 TypeScript 装载的唯一 runtime：普通 CLI 调用复用 canonical module graph；View 的
// rebuild / fresh discovery 在 generation 开始时清理项目内 module cache，随后在这一代内部
// 保持缓存，使多个入口共享 helper 与 definition identity。依赖包不清理，因此 niceeval/* 与
// effect 始终指向发布包的 canonical runtime。

import { Effect, Semaphore, type Scope } from "effect";
import { createJiti, type Jiti } from "jiti";
import { dirname, isAbsolute, resolve, sep } from "node:path";

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
    if (isAbsolute(filename) && (filename === root || filename.startsWith(prefix))) {
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
    const loader = createJiti(import.meta.url, loaderOptions);
    clearProjectModules(loader, projectRoot);
    return Object.freeze({
      // Jiti's dynamic import ABI is Promise-based; adaptation remains at this I/O leaf.
      import: (absPath: string) => importWith(loader, absPath),
    });
  });
}

/** Promise ABI facade for callers that cannot retain an Effect Scope. */
export function freshImportModule(absPath: string): Promise<{ default?: unknown }> {
  return Effect.runPromise(Effect.scoped(
    acquireFreshImportGeneration(dirname(absPath)).pipe(
      Effect.flatMap((fresh) => Effect.tryPromise(() => fresh.import(absPath))),
    ),
  ));
}
