// tsx namespaced register:整棵 import 子图都是新实例,绕开 ESM 模块缓存。
// view 本地模式的持续重建靠它兑现「改组件 → 浏览器看到新样子」
// (docs/feature/reports/README.md「持续重建」);query cache-busting 只能击穿入口本体。
// 每次调用泄漏一代项目模块实例——dev server 可接受。它不能泛化为「跨实例产品都安全」：
// Report 的身份是 package-private WeakMap。受信任的 Report loader 只在打包 candidate
// 中使用这里的项目图；这里把同一份安装里的 niceeval/* 收束到宿主 canonical CJS graph，
// 它随后仍以宿主 isReport 作精确验收，另一份安装不会被偷偷当作同一 runtime。
// 并发 register 会死锁,整进程串行化 namespaced import。

import * as NodeModule from "node:module";
import { Effect, Semaphore } from "effect";
import { register, type NamespacedUnregister } from "tsx/esm/api";
import { fileURLToPath, pathToFileURL } from "node:url";

let generation = 0;
const generationGate = Semaphore.makeUnsafe(1);

const canonicalRequire = NodeModule.createRequire(import.meta.url);
const canonicalizeNiceEval = fileURLToPath(import.meta.url).endsWith(".cjs");

type UnregisterCanonicalRuntimeResolution = () => Promise<void>;

/**
 * Keep author imports inside the fresh project graph while preserving the exact
 * runtime identity used by a packaged host. Normal project resolution wins:
 * - niceeval/* is redirected only when its ESM facade and this host's CJS entry
 *   are the same physical install;
 * - a missing Effect package/subpath falls back to the dependency beside host.
 */
function registerCanonicalRuntimeResolution(
  namespace: string,
): UnregisterCanonicalRuntimeResolution {
  const hooks = NodeModule.registerHooks({
    resolve: (specifier, context, nextResolve) => {
      const isEffect = isEffectSpecifier(specifier);
      const isNiceEval = canonicalizeNiceEval && isNiceEvalSpecifier(specifier);
      if (
        !belongsToFreshGeneration(context.parentURL, namespace) ||
        (!isEffect && !isNiceEval)
      ) {
        const resolved = nextResolve(specifier, context);
        return forceNamespacedTypeScriptModule(resolved, namespace);
      }
      try {
        const resolved = nextResolve(specifier, context);
        const freshResolved = forceNamespacedTypeScriptModule(resolved, namespace);
        if (!isNiceEval) return freshResolved;
        return resolveCanonicalNiceEval(specifier, freshResolved);
      } catch (cause) {
        if (!isEffect) throw cause;
        if (!isModuleNotFound(cause)) throw cause;
        return {
          shortCircuit: true,
          url: pathToFileURL(canonicalRequire.resolve(specifier)).href,
        };
      }
    },
  });
  return async () => hooks.deregister();
}

function resolveCanonicalNiceEval(
  specifier: string,
  resolved: NodeModule.ResolveFnOutput,
): NodeModule.ResolveFnOutput {
  if (!resolved.url.startsWith("file:")) return resolved;
  const canonicalPath = canonicalRequire.resolve(specifier);
  const resolvedStem = fileURLToPath(resolved.url).replace(/\.mjs$/, "");
  const canonicalStem = canonicalPath.replace(/\.cjs$/, "");
  if (resolvedStem !== canonicalStem) return resolved;
  return {
    shortCircuit: true,
    url: pathToFileURL(canonicalPath).href,
  };
}

function isEffectSpecifier(specifier: string): boolean {
  return specifier === "effect" || specifier.startsWith("effect/");
}

function isNiceEvalSpecifier(specifier: string): boolean {
  return specifier === "niceeval" || specifier.startsWith("niceeval/");
}

// tsx's CJS virtual URLs preserve the generation as `?namespace=…`, while
// its ESM URLs use `tsx-namespace=…`; the unique value scopes both forms.
function belongsToFreshGeneration(parentURL: string | undefined, namespace: string): boolean {
  return parentURL?.includes(`namespace=${encodeURIComponent(namespace)}`) === true;
}

function forceNamespacedTypeScriptModule(
  resolved: NodeModule.ResolveFnOutput,
  namespace: string,
): NodeModule.ResolveFnOutput {
  if (
    !resolved.url.includes("tsx-namespace=" + encodeURIComponent(namespace)) ||
    !resolved.url.includes("tsx-commonjs-virtual-query=1") ||
    (resolved.format !== "commonjs" && resolved.format !== "commonjs-typescript")
  ) {
    return resolved;
  }
  return { ...resolved, format: "module-typescript" };
}

function isModuleNotFound(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

export interface FreshImportGeneration {
  /** Import an entry into this generation's one shared namespaced module graph. */
  import(absPath: string): Promise<{ default?: unknown }>;
  /** Unregister the namespace and unblock the next generation exactly once. */
  close(): Promise<void>;
}

async function importFromNamespace(
  ns: NamespacedUnregister,
  absPath: string,
): Promise<{ default?: unknown }> {
  const url = pathToFileURL(absPath).href;
  const imported = (await ns.import(url, url)) as { default?: unknown };
  const wrapped = imported.default;
  if (
    typeof wrapped === "object" && wrapped !== null &&
    Object.hasOwn(wrapped, "default") &&
    (wrapped as { __esModule?: unknown }).__esModule === true
  ) {
    return wrapped as { default?: unknown };
  }
  return imported;
}

/**
 * Open one fresh project module graph. All imports in the generation share
 * module identity; close releases both tsx and canonical runtime hooks.
 */
export async function createFreshImportGeneration(): Promise<FreshImportGeneration> {
  await Effect.runPromise(generationGate.take(1));

  const releaseGeneration = (): Promise<void> =>
    Effect.runPromise(generationGate.release(1)).then(() => undefined);

  const namespace = `niceeval-fresh-${++generation}`;
  let ns: NamespacedUnregister | undefined;
  let unregisterCanonicalRuntimeResolution: UnregisterCanonicalRuntimeResolution =
    async () => undefined;
  try {
    ns = register({ namespace });
    unregisterCanonicalRuntimeResolution = registerCanonicalRuntimeResolution(namespace);
  } catch (cause) {
    await releaseGeneration();
    throw cause;
  }

  let closed = false;
  return {
    import: (absPath) => {
      if (closed || ns === undefined) {
        return Promise.reject(new Error("fresh import generation is closed"));
      }
      return importFromNamespace(ns, absPath);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      const active = ns;
      ns = undefined;
      try {
        await unregisterCanonicalRuntimeResolution();
      } finally {
        try {
          await active?.unregister();
        } finally {
          await releaseGeneration();
        }
      }
    },
  };
}

/**
 * 装载 abs 路径的模块,其子图(项目内相对 import)全部是新实例。
 * parentURL 取自身 file URL——namespaced import 要求显式 parent。
 */
export async function freshImportModule(absPath: string): Promise<{ default?: unknown }> {
  const fresh = await createFreshImportGeneration();
  try {
    return await fresh.import(absPath);
  } finally {
    await fresh.close();
  }
}
