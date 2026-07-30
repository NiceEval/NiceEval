// 自定义 case 的 group-keep:进程内登记可序列化 resources 对应的 wake/destroy。
// `niceeval sandbox` 事后命令不加载用户模块——跨进程仍只能靠内置 KEEPABLE_PROVIDERS;
// 同进程内(同一次 run 的 keep / 测试)可经本登记表做 detached cleanup。
// 契约:docs/feature/sandbox/case.md「自定义 case」。

import type { ProviderLocator } from "./case-types.ts";
import type { CustomMaterializeResult } from "./case-types.ts";
import { digestOf } from "./identity.ts";

export interface CustomGroupKeepHandlers {
  readonly resources: ProviderLocator;
  wake(resources: ProviderLocator): Promise<CustomMaterializeResult>;
  destroy(resources: ProviderLocator): Promise<void>;
}

interface RegisteredGroupKeep {
  readonly provider: string;
  readonly profile: string;
  readonly primarySandboxId: string;
  readonly resourcesKey: string;
  readonly handlers: CustomGroupKeepHandlers;
}

const registry = new Map<string, RegisteredGroupKeep>();

function entryKey(provider: string, resources: ProviderLocator): string {
  return `${provider}::${digestOf(resources)}`;
}

export function registerCustomGroupKeep(opts: {
  readonly provider: string;
  readonly profile: string;
  readonly primarySandboxId: string;
  readonly handlers: CustomGroupKeepHandlers;
}): string {
  const key = entryKey(opts.provider, opts.handlers.resources);
  registry.set(key, {
    provider: opts.provider,
    profile: opts.profile,
    primarySandboxId: opts.primarySandboxId,
    resourcesKey: key,
    handlers: opts.handlers,
  });
  return key;
}

export function lookupCustomGroupKeep(
  provider: string,
  resources: ProviderLocator,
): CustomGroupKeepHandlers | undefined {
  return registry.get(entryKey(provider, resources))?.handlers;
}

/** 同进程 detached destroy:命中登记表则调用用户 destroy,并摘除登记。 */
export async function destroyCustomGroupKeep(
  provider: string,
  resources: ProviderLocator,
): Promise<boolean> {
  const key = entryKey(provider, resources);
  const entry = registry.get(key);
  if (entry === undefined) return false;
  await entry.handlers.destroy(resources);
  registry.delete(key);
  return true;
}

/** 同进程 wake:命中则调用用户 wake。 */
export async function wakeCustomGroupKeep(
  provider: string,
  resources: ProviderLocator,
): Promise<CustomMaterializeResult | undefined> {
  const entry = registry.get(entryKey(provider, resources));
  if (entry === undefined) return undefined;
  return entry.handlers.wake(resources);
}

/** 测试用:清空进程内登记。 */
export function clearCustomGroupKeepRegistry(): void {
  registry.clear();
}
