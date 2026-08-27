// 用户 TypeScript 装载的唯一 runtime：普通 CLI 调用复用 canonical module graph；View 的
// rebuild / fresh discovery 在 generation 开始时清理项目内 module cache，随后在这一代内部
// 保持缓存，使多个入口共享 helper 与 definition identity。依赖包不清理，因此 niceeval/* 与
// effect 始终指向发布包的 canonical runtime。

import { Effect, Semaphore } from "effect";
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
  /** Close the generation and unblock the next caller exactly once. */
  close(): Promise<void>;
}

/**
 * Open one fresh project module graph. The gate makes project-cache eviction atomic with all
 * imports in the generation; dependencies outside projectRoot retain canonical process identity.
 */
export async function createFreshImportGeneration(
  projectRoot = process.cwd(),
): Promise<FreshImportGeneration> {
  await Effect.runPromise(generationGate.take(1));
  const releaseGeneration = (): Promise<void> =>
    Effect.runPromise(generationGate.release(1)).then(() => undefined);
  const loader = createJiti(import.meta.url, loaderOptions);
  clearProjectModules(loader, projectRoot);
  let closed = false;
  return {
    import: (absPath) => closed
      ? Promise.reject(new Error("fresh import generation is closed"))
      : importWith(loader, absPath),
    close: async () => {
      if (closed) return;
      closed = true;
      await releaseGeneration();
    },
  };
}

/** Load one absolute entry from a fresh project graph and close the generation. */
export async function freshImportModule(absPath: string): Promise<{ default?: unknown }> {
  const fresh = await createFreshImportGeneration(dirname(absPath));
  try {
    return await fresh.import(absPath);
  } finally {
    await fresh.close();
  }
}
