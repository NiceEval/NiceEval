// tsx namespaced register:整棵 import 子图都是新实例,绕开 ESM 模块缓存。
// view 本地模式的持续重建靠它兑现「改组件 → 浏览器看到新样子」
// (docs/feature/reports/README.md「持续重建」);query cache-busting 只能击穿入口本体。
// 每次调用泄漏一代项目模块实例——dev server 可接受。它不能泛化为「跨实例产品都安全」：
// Report 的身份是 package-private WeakMap。受信任的 Report loader 只在打包 candidate
// 中使用这里的项目图；这里把同一份安装里的 niceeval/* 收束到宿主 canonical CJS graph，
// 它随后仍以宿主 isReport 作精确验收，另一份安装不会被偷偷当作同一 runtime。
// 并发 register 会死锁,整进程串行化 namespaced import。

import * as NodeModule from "node:module";
import { register } from "tsx/esm/api";
import { fileURLToPath, pathToFileURL } from "node:url";

let generation = 0;
let chain: Promise<void> = Promise.resolve();

const canonicalRequire = NodeModule.createRequire(import.meta.url);
const canonicalizeNiceEval = fileURLToPath(import.meta.url).endsWith(".cjs");

// Node 22.0–22.14 has only the asynchronous customization-hook API. The hook
// stays dormant after this import generation, just like tsx's fallback hook on
// those Node releases; current Node deregisters the synchronous hook instead.
const ASYNC_CANONICAL_RUNTIME_HOOK = `
  import { createRequire } from "node:module";
  import { fileURLToPath, pathToFileURL } from "node:url";

  let active;
  let canonicalizeNiceEval;
  let canonicalRequire;
  let namespace;

  export function initialize(data) {
    active = new Int32Array(data.active);
    canonicalizeNiceEval = data.canonicalizeNiceEval;
    canonicalRequire = createRequire(data.resolutionParentURL);
    namespace = data.namespace;
  }

  export async function resolve(specifier, context, nextResolve) {
    const belongsToGeneration = context.parentURL?.includes(
      "namespace=" + encodeURIComponent(namespace),
    ) === true;
    const isEffect = specifier === "effect" || specifier.startsWith("effect/");
    const isNiceEval = specifier === "niceeval" || specifier.startsWith("niceeval/");
    if (
      Atomics.load(active, 0) !== 1 ||
      !belongsToGeneration ||
      (!isEffect && !(canonicalizeNiceEval && isNiceEval))
    ) {
      const resolved = await nextResolve(specifier, context);
      return forceNamespacedTypeScriptModule(resolved, namespace);
    }
    try {
      const resolved = await nextResolve(specifier, context);
      const freshResolved = forceNamespacedTypeScriptModule(resolved, namespace);
      if (!isNiceEval) return freshResolved;
      const canonicalPath = canonicalRequire.resolve(specifier);
      if (
        resolved.url.startsWith("file:") &&
        fileURLToPath(resolved.url).replace(/\\.mjs$/, "") === canonicalPath.replace(/\\.cjs$/, "")
      ) {
        return { shortCircuit: true, url: pathToFileURL(canonicalPath).href };
      }
      return freshResolved;
    } catch (cause) {
      if (!isEffect) throw cause;
      const code = cause !== null && typeof cause === "object" ? cause.code : undefined;
      if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") throw cause;
      return {
        shortCircuit: true,
        url: pathToFileURL(canonicalRequire.resolve(specifier)).href,
      };
    }
  }

  function forceNamespacedTypeScriptModule(resolved, namespace) {
    if (
      !resolved.url.includes("tsx-namespace=" + encodeURIComponent(namespace)) ||
      !resolved.url.includes("tsx-commonjs-virtual-query=1") ||
      (resolved.format !== "commonjs" && resolved.format !== "commonjs-typescript")
    ) {
      return resolved;
    }
    return { ...resolved, format: "module-typescript" };
  }
`;

const asyncCanonicalRuntimeHookUrl =
  `data:text/javascript;charset=utf-8,${encodeURIComponent(ASYNC_CANONICAL_RUNTIME_HOOK)}`;

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
  if (typeof NodeModule.registerHooks === "function") {
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

  const active = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.store(active, 0, 1);
  NodeModule.register(asyncCanonicalRuntimeHookUrl, {
    parentURL: import.meta.url,
    data: {
      active: active.buffer,
      canonicalizeNiceEval,
      namespace,
      resolutionParentURL: import.meta.url,
    },
  });
  return async () => {
    Atomics.store(active, 0, 0);
  };
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

/**
 * 装载 abs 路径的模块,其子图(项目内相对 import)全部是新实例。
 * parentURL 取自身 file URL——namespaced import 要求显式 parent。
 */
export async function freshImportModule(absPath: string): Promise<{ default?: unknown }> {
  const run = async (): Promise<{ default?: unknown }> => {
    const namespace = `niceeval-fresh-${++generation}`;
    const ns = register({ namespace });
    let unregisterCanonicalRuntimeResolution: UnregisterCanonicalRuntimeResolution =
      async () => undefined;
    const url = pathToFileURL(absPath).href;
    try {
      unregisterCanonicalRuntimeResolution = registerCanonicalRuntimeResolution(namespace);
      const imported = (await ns.import(url, url)) as { default?: unknown };
      // tsx 在 CJS 宿主里装载 ESM 风格的 TypeScript 时会把模块命名空间再包成
      // `{ default: { __esModule: true, default: ... } }`。普通 dynamic import 没有这一层；
      // fresh 与普通装载必须交给 discovery / config / report 相同的命名空间形状。
      const wrapped = imported.default;
      if (
        typeof wrapped === "object" && wrapped !== null &&
        Object.hasOwn(wrapped, "default") &&
        (wrapped as { __esModule?: unknown }).__esModule === true
      ) {
        return wrapped as { default?: unknown };
      }
      return imported;
    } finally {
      try {
        await unregisterCanonicalRuntimeResolution();
      } finally {
        await ns.unregister();
      }
    }
  };
  const next = chain.then(run, run);
  // 不让上游失败打断队列;吞掉以便后续调用仍能挂上。
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
