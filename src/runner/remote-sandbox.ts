// 两个 Sandbox 接口适配器,都用 Proxy 实现:接口新增方法时无需在这里逐方法同步,
// 漏一个也不会等到运行时才炸(原实现是 13×2 行手工转发样板)。

import { resolveLocalPath } from "../sandbox/paths.ts";
import type { Sandbox } from "../types.ts";
import { t } from "../i18n/index.ts";

/**
 * remote / 进程内 agent 的占位 Sandbox:没有真实沙箱,除少数元数据字段外,
 * 任何方法一被调用就报清晰错误(而不是静默 no-op 让断言假通过)。
 */
export function createRemoteSandbox(): Sandbox {
  const meta: Partial<Sandbox> = {
    workdir: "",
    sandboxId: "remote",
    otlpHost: "127.0.0.1",
    // stop 是调度器的固定清理路径,必须真 no-op 而不是抛错。
    stop: async () => {},
    // appendLog 是可选能力,必须显式 undefined —— 返回抛错函数会让 `sandbox.appendLog ?` 判真。
    appendLog: undefined,
  };
  return new Proxy(meta as Sandbox, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof Sandbox];
      // 协议探测属性必须回 undefined:返回抛错函数会让这个对象变成 then() 抛错的
      // thenable(await sandbox 直接 reject)、让 JSON.stringify 调到假 toJSON。
      if (typeof prop !== "string" || prop === "then" || prop === "toJSON" || prop === "inspect") {
        return undefined;
      }
      return async () => {
        throw new Error(t("runner.remoteSandboxUnavailable", { method: prop }));
      };
    },
  });
}

/**
 * 给 eval 级 setup 用的 Sandbox 视图:uploadDirectory 的本地路径按 eval 文件所在目录解析
 * (作者写相对路径时相对 eval 文件,而不是进程 cwd);其余成员全部透传。
 */
export function withEvalLocalPaths(sandbox: Sandbox, baseDir: string): Sandbox {
  return new Proxy(sandbox, {
    get(target, prop, receiver) {
      if (prop === "uploadDirectory") {
        return (localDir: string, targetDir?: string, opts?: Parameters<Sandbox["uploadDirectory"]>[2]) =>
          target.uploadDirectory(resolveLocalPath(baseDir, localDir), targetDir, opts);
      }
      const value = Reflect.get(target, prop, receiver);
      // 方法要 bind 回原对象:provider 实现(class 实例)里的 this 不能指向 Proxy。
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
