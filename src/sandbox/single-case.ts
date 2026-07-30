// 单 Sandbox case 迁移:产物槽位提取、keep 守卫、能力兑现检查。
// 实际 create + materializePlannedCase 接线在 resolve.ts 的 createMaterializedCase。
// 契约单源:docs/feature/sandbox/case.md。

import type { CustomEnvironmentCase, MaterializedSandboxCase, SandboxCapability } from "./case-types.ts";
import type { PlannedSandboxCase } from "./case.ts";
import type { SandboxOption } from "./types.ts";
import { KEEPABLE_PROVIDERS } from "./keep.ts";

/** 单实例 create 所需的产物槽位:与 ResolvedSandbox 上 docker/e2b/vercel/local 字段对齐。 */
export interface PrebuiltProductSlots {
  readonly image?: string;
  readonly template?: string;
  readonly snapshotId?: string;
  readonly dir?: string;
}

/**
 * 从 planned case 取出预制/基础产物槽位。
 * Compose、自定义、按需构建(尚无 locator)返回 undefined——调用方不得把它们浅覆盖进 spec。
 */
export function prebuiltProductSlotsOf(plan: PlannedSandboxCase): PrebuiltProductSlots | undefined {
  const decl = plan.declaration;

  if (decl.form === "docker") {
    if ("image" in decl.value && typeof decl.value.image === "string") {
      return { image: decl.value.image };
    }
    return undefined;
  }
  if (decl.form === "e2b") {
    if ("template" in decl.value && typeof decl.value.template === "string") {
      return { template: decl.value.template };
    }
    return undefined;
  }
  if (decl.form === "vercel") {
    return { snapshotId: decl.value.snapshotId };
  }
  if (decl.form === "base") {
    const product = decl.product as globalThis.Record<string, unknown>;
    const slots: {
      image?: string;
      template?: string;
      snapshotId?: string;
      dir?: string;
    } = {};
    if (typeof product.image === "string" && product.image !== "(runtime-default)") {
      slots.image = product.image;
    }
    if (typeof product.template === "string") slots.template = product.template;
    if (typeof product.snapshotId === "string") slots.snapshotId = product.snapshotId;
    if (typeof product.dir === "string" && product.dir !== "(git-root)") slots.dir = product.dir;
    return Object.keys(slots).length > 0 ? slots : {};
  }
  return undefined;
}

/** 把预制产物浅覆盖进 spec,供既有 createProvider 路径消费;行为与旧 environments 派生一致。 */
export function specWithPrebuiltProduct(spec: SandboxOption, plan: PlannedSandboxCase): SandboxOption {
  const slots = prebuiltProductSlotsOf(plan);
  if (slots === undefined) {
    throw new Error(
      `planned sandbox case ${JSON.stringify(plan.evalId)} kind ${JSON.stringify(plan.caseKind)} ` +
        `is not a prebuilt single-Sandbox product — refuse to shallow-merge into create path`,
    );
  }
  return { ...spec, ...slots } as SandboxOption;
}

/**
 * `--keep-sandbox` 与 case 能力的创建前守卫。
 * - 内置 docker/e2b/vercel 单实例:走既有 KEEPABLE_PROVIDERS。
 * - local:永不 keep。
 * - 自定义 case:只有声明了 `group-keep` 且提供了序列化 resources + wake + destroy 才允许。
 */
export function assertKeepAllowedForCase(opts: {
  readonly plan: PlannedSandboxCase;
  readonly provider: string;
  readonly keepRequested: boolean;
}): void {
  if (!opts.keepRequested) return;

  if (opts.plan.caseKind === "custom") {
    const custom = opts.plan.declaration.form === "custom" ? opts.plan.declaration.value : undefined;
    if (custom === undefined || !hasGroupKeep(custom)) {
      throw new Error(
        `--keep-sandbox is not supported with custom sandbox case ${JSON.stringify(opts.plan.evalId)} ` +
          `on provider "${opts.provider}": declare capability "group-keep" with serializable resources, wake, and destroy, ` +
          `or drop --keep-sandbox`,
      );
    }
    return;
  }

  if (opts.provider === "local" || !KEEPABLE_PROVIDERS.has(opts.provider)) {
    throw new Error(
      `--keep-sandbox is not supported with the "${opts.provider}" provider: ` +
        (opts.provider === "local"
          ? "it never destroys the sandbox in the first place, so there is nothing to register for later retention. Drop --keep-sandbox, or use docker / e2b / vercel."
          : `expected one of: ${[...KEEPABLE_PROVIDERS].join(", ")}. Drop --keep-sandbox.`),
    );
  }
}

export function hasGroupKeep(custom: CustomEnvironmentCase): boolean {
  return (
    custom.capabilities?.includes("group-keep") === true &&
    custom.groupKeep !== undefined &&
    custom.groupKeep.resources !== undefined &&
    typeof custom.groupKeep.wake === "function" &&
    typeof custom.groupKeep.destroy === "function"
  );
}

/** 自定义 case 声明了 `services` 能力时,materialize 必须交出 ServiceController。 */
export function assertCustomCapabilitiesHonored(
  plan: PlannedSandboxCase,
  materialized: MaterializedSandboxCase,
): void {
  if (plan.caseKind !== "custom" || plan.declaration.form !== "custom") return;
  const caps = plan.declaration.value.capabilities ?? [];
  if (caps.includes("services") && materialized.services === undefined) {
    throw new Error(
      `custom sandbox case ${JSON.stringify(plan.evalId)} declared capability "services" ` +
        `but materialize() did not return a ServiceController`,
    );
  }
  if (caps.includes("group-keep") && plan.declaration.value.groupKeep === undefined) {
    throw new Error(
      `custom sandbox case ${JSON.stringify(plan.evalId)} declared capability "group-keep" without groupKeep handlers`,
    );
  }
}

/** 测试与合流用:本迁移层覆盖的 case kind(Compose 不在内)。 */
export const SINGLE_SANDBOX_CASE_KINDS = ["prebuilt", "on-demand-build", "custom"] as const;

export type SingleSandboxCaseKind = (typeof SINGLE_SANDBOX_CASE_KINDS)[number];

export function isSingleSandboxCaseKind(kind: string): kind is SingleSandboxCaseKind {
  return (SINGLE_SANDBOX_CASE_KINDS as readonly string[]).includes(kind);
}

/** 能力位是否含 group-keep(合流 keep 路径可读)。 */
export function caseCapabilitiesOf(plan: PlannedSandboxCase): readonly SandboxCapability[] {
  if (plan.declaration.form === "custom") return plan.declaration.value.capabilities ?? [];
  return [];
}
