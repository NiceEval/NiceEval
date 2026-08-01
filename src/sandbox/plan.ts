// Pure link 后的唯一 physical planning 边界。
// Core 不认识 provider 名或 template tag：具体 factory 私绑 Effect planner，本模块只调用并聚合 typed issue。

import { isAbsolute } from "node:path";
import { Data, Effect } from "effect";
import type { JsonValue } from "../shared/types.ts";
import {
  planSandboxTemplate,
  sandboxTemplateIdentity,
  type SandboxProviderPlan,
  type SandboxProviderPlanningError,
  type SandboxTemplateDeclaration,
  type SandboxTemplatePlanningInput,
} from "./layer.ts";
import type {
  LinkedDirectPair,
  LinkedSandboxPair,
  SandboxCommandFingerprint,
  SandboxLayerOwnerRef,
} from "./link.ts";

/** 单一完成态；不再为每个 provider 增加 union member。 */
export type ProviderPlan = SandboxProviderPlan;

export type LinkedRunPlan =
  | { readonly _tag: "Direct"; readonly pair: LinkedDirectPair }
  | {
      readonly _tag: "Sandbox";
      readonly pair: LinkedSandboxPair;
      readonly providerPlan: ProviderPlan;
    };

export interface PlannedLinkedRun {
  readonly pair: LinkedDirectPair | LinkedSandboxPair;
  readonly plan: LinkedRunPlan;
}

export interface SandboxAuthorBaseDirs {
  readonly eval: string;
  readonly experiment: string;
}

export interface LinkedRunPlanInput {
  readonly pair: LinkedDirectPair | LinkedSandboxPair;
  /** 两个值均来自 discovery 完成态；相对 template 按实际 owner 选其中一个。 */
  readonly authorBaseDirs: SandboxAuthorBaseDirs;
}

/**
 * 通用 planner 调用边界。默认实现只调用 template 私绑 planner；测试可注入拦截器，
 * 不需要为 Docker/E2B 等 provider 在 core services 上增加字段。
 */
export interface SandboxPlanningServices {
  readonly planTemplate: (
    template: SandboxTemplateDeclaration,
    input: SandboxTemplatePlanningInput,
  ) => Effect.Effect<ProviderPlan, SandboxProviderPlanningError>;
}

const LIVE_SANDBOX_PLANNING_SERVICES: SandboxPlanningServices = Object.freeze({
  planTemplate: planSandboxTemplate,
});

export function liveSandboxPlanningServices(): SandboxPlanningServices {
  return LIVE_SANDBOX_PLANNING_SERVICES;
}

export interface SandboxPhysicalPlanningIssue {
  readonly code: "sandbox.author-base-dir-invalid" | "sandbox.provider-planning-failed";
  readonly providerCode: string;
  readonly pair: {
    readonly evalId: string;
    readonly experimentId: string;
    readonly agentName: string;
  };
  readonly templateOwner: SandboxLayerOwnerRef;
  readonly baseDir: string;
  readonly summary: string;
  readonly actions: readonly string[];
}

export class SandboxPhysicalPlanningError extends Data.TaggedError(
  "SandboxPhysicalPlanningError",
)<{
  readonly code: "sandbox.physical-planning-failed";
  readonly issues: readonly SandboxPhysicalPlanningIssue[];
  readonly message: string;
}> {}

function pairView(pair: LinkedSandboxPair): SandboxPhysicalPlanningIssue["pair"] {
  return Object.freeze({
    evalId: pair.evalId,
    experimentId: pair.experimentId,
    agentName: pair.agentName,
  });
}

function invalidBaseDirIssue(pair: LinkedSandboxPair, baseDir: string): SandboxPhysicalPlanningIssue {
  return Object.freeze({
    code: "sandbox.author-base-dir-invalid",
    providerCode: "sandbox.author-base-dir-invalid",
    pair: pairView(pair),
    templateOwner: pair.templateOwner,
    baseDir,
    summary:
      `${pair.templateOwner.kind} ${JSON.stringify(pair.templateOwner.id)} has a non-absolute author baseDir ` +
      `${JSON.stringify(baseDir)}.`,
    actions: Object.freeze([
      "Complete discovery before physical planning so every author definition has an absolute baseDir.",
    ]),
  });
}

function providerIssue(
  pair: LinkedSandboxPair,
  baseDir: string,
  failure: SandboxProviderPlanningError,
): SandboxPhysicalPlanningIssue {
  return Object.freeze({
    code: "sandbox.provider-planning-failed",
    providerCode: failure.code,
    pair: pairView(pair),
    templateOwner: pair.templateOwner,
    baseDir,
    summary: failure.summary,
    actions: Object.freeze([...failure.actions]),
  });
}

function planningError(issues: readonly SandboxPhysicalPlanningIssue[]): SandboxPhysicalPlanningError {
  const frozen = Object.freeze([...issues]);
  return new SandboxPhysicalPlanningError({
    code: "sandbox.physical-planning-failed",
    issues: frozen,
    message:
      `Sandbox physical planning failed for ${frozen.length} pair${frozen.length === 1 ? "" : "s"}. ` +
      "No provider build or Sandbox creation was started.",
  });
}

/**
 * 对完整 linked matrix 规划并聚合全部 typed issue。Direct pair 不调用任何 planner；
 * provider planner 只允许只读 physical/network I/O，不 build、不 create。
 */
export function planLinkedRuns(
  inputs: readonly LinkedRunPlanInput[],
  services: SandboxPlanningServices = liveSandboxPlanningServices(),
): Effect.Effect<readonly PlannedLinkedRun[], SandboxPhysicalPlanningError> {
  return Effect.gen(function* () {
    const plans: PlannedLinkedRun[] = [];
    const issues: SandboxPhysicalPlanningIssue[] = [];
    for (const input of inputs) {
      if (input.pair.kind === "direct") {
        plans.push(Object.freeze({
          pair: input.pair,
          plan: Object.freeze({ _tag: "Direct", pair: input.pair }),
        }));
        continue;
      }
      const baseDir = input.authorBaseDirs[input.pair.templateOwner.kind];
      if (!isAbsolute(baseDir)) {
        issues.push(invalidBaseDirIssue(input.pair, baseDir));
        continue;
      }
      const planned = yield* Effect.either(services.planTemplate(
        input.pair.template,
        Object.freeze({ authorBaseDir: baseDir }),
      ));
      if (planned._tag === "Left") {
        issues.push(providerIssue(input.pair, baseDir, planned.left));
        continue;
      }
      plans.push(Object.freeze({
        pair: input.pair,
        plan: Object.freeze({ _tag: "Sandbox", pair: input.pair, providerPlan: planned.right }),
      }));
    }
    if (issues.length > 0) return yield* planningError(issues);
    return Object.freeze(plans);
  });
}

/** Provider identity 已由 factory planner 一次构造并冻结，core 不再重新解释 provider 字段。 */
export function providerPlanIdentity(plan: ProviderPlan): JsonValue {
  return plan.identity;
}

function commandFingerprintIdentity(command: SandboxCommandFingerprint): JsonValue {
  return command.kind === "stable"
    ? {
        kind: "stable",
        owner: { kind: command.owner.kind, id: command.owner.id },
        index: command.index,
        id: command.id,
        revision: command.revision,
        inputs: command.inputs,
      }
    : {
        kind: "opaque",
        owner: { kind: command.owner.kind, id: command.owner.id },
        index: command.index,
      };
}

/** Pair-owned plan 的稳定身份；opaque callbacks 与 runtime closures 都不进入 JSON。 */
export function linkedRunPlanIdentity(plan: LinkedRunPlan): JsonValue {
  if (plan._tag === "Direct") {
    return {
      version: 1,
      mode: "direct",
      pair: {
        evalId: plan.pair.evalId,
        experimentId: plan.pair.experimentId,
        agentName: plan.pair.agentName,
      },
    };
  }
  return {
    version: 1,
    mode: "sandbox",
    pair: {
      evalId: plan.pair.evalId,
      experimentId: plan.pair.experimentId,
      agentName: plan.pair.agentName,
    },
    templateOwner: { kind: plan.pair.templateOwner.kind, id: plan.pair.templateOwner.id },
    template: sandboxTemplateIdentity(plan.pair.template),
    commands: plan.pair.fingerprint.commands.map(commandFingerprintIdentity),
    providerPlan: providerPlanIdentity(plan.providerPlan),
  };
}
