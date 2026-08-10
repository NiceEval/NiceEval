// tsx namespaced register:整棵 import 子图都是新实例,绕开 ESM 模块缓存。
// view 本地模式的持续重建靠它兑现「改组件 → 浏览器看到新样子」
// (docs/feature/reports/view.md「持续重建」);query cache-busting 只能击穿入口本体。
// 每次调用泄漏一代模块实例——dev server 可接受。品牌校验走 Symbol.for,跨实例安全。
// 并发 register 会死锁,整进程串行化 namespaced import。

import { register } from "tsx/esm/api";
import { pathToFileURL } from "node:url";

let generation = 0;
let chain: Promise<void> = Promise.resolve();

/**
 * 装载 abs 路径的模块,其子图(项目内相对 import)全部是新实例。
 * parentURL 取自身 file URL——namespaced import 要求显式 parent。
 */
export async function freshImportModule(absPath: string): Promise<{ default?: unknown }> {
  const run = async (): Promise<{ default?: unknown }> => {
    const ns = register({ namespace: `niceeval-fresh-${++generation}` });
    const url = pathToFileURL(absPath).href;
    try {
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
      await ns.unregister();
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
