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
  type NormalizedNestedDockerRequirement,
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
  readonly "eval-group"?: string;
  readonly experiment: string;
}

export interface LinkedRunPlanInput {
  readonly pair: LinkedDirectPair | LinkedSandboxPair;
  /** 两个值均来自 discovery 完成态；相对 template 按实际 owner 选其中一个。 */
  readonly authorBaseDirs: SandboxAuthorBaseDirs;
  /** Runner 已经能在创建资源前裁决的运行能力要求。 */
  readonly requirements: readonly SandboxPhysicalCapabilityRequirement[];
}

export type SandboxPhysicalCapabilityRequirement =
  | { readonly _tag: "Reuse" }
  | { readonly _tag: "Retention" }
  | { readonly _tag: "SessionDuration"; readonly milliseconds: number }
  | { readonly _tag: "DockerExecution"; readonly docker: NormalizedNestedDockerRequirement };

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
  readonly code:
    | "sandbox.author-base-dir-invalid"
    | "sandbox.provider-planning-failed"
    | "sandbox.capability-unavailable";
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

export type SandboxPhysicalPlanningIssues = readonly [
  SandboxPhysicalPlanningIssue,
  ...SandboxPhysicalPlanningIssue[],
];

export class SandboxPhysicalPlanningError extends Data.TaggedError(
  "SandboxPhysicalPlanningError",
)<{
  readonly code: "sandbox.physical-planning-failed";
  readonly issues: SandboxPhysicalPlanningIssues;
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

function capabilityIssue(
  pair: LinkedSandboxPair,
  baseDir: string,
  providerCode: string,
  summary: string,
  actions: readonly string[],
): SandboxPhysicalPlanningIssue {
  return Object.freeze({
    code: "sandbox.capability-unavailable",
    providerCode,
    pair: pairView(pair),
    templateOwner: pair.templateOwner,
    baseDir,
    summary,
    actions: Object.freeze([...actions]),
  });
}

function capabilityIssues(
  pair: LinkedSandboxPair,
  baseDir: string,
  plan: SandboxProviderPlan,
  requirements: readonly SandboxPhysicalCapabilityRequirement[],
): readonly SandboxPhysicalPlanningIssue[] {
  const issues: SandboxPhysicalPlanningIssue[] = [];
  for (const requirement of requirements) {
    if (requirement._tag === "DockerExecution") {
      const provided = plan.capabilities.dockerExecution;
      const capacitySatisfied = provided?.capacity._tag === "Attested"
        ? provided.capacity.bytes >= requirement.docker.minimumDataBytes
        : provided?.capacity.acceptedByExperiment === true;
      const composeSatisfied = requirement.docker.compose === "not-required" || provided?.compose === "v2";
      if (
        provided === undefined ||
        provided.api !== requirement.docker.api ||
        provided.isolation !== requirement.docker.isolation ||
        provided.daemon !== "sandbox-private" ||
        !composeSatisfied ||
        !capacitySatisfied
      ) {
        issues.push(capabilityIssue(
          pair,
          baseDir,
          "sandbox-capability-unsatisfied",
          `Provider ${JSON.stringify(plan.provider)} cannot satisfy Docker execution requirement ` +
            `${JSON.stringify(requirement.docker)}; provided ${JSON.stringify(provided ?? null)}.`,
          [
            "Select a Sandbox Provider that proves the requested Docker API, Compose, dedicated kernel, and data capacity.",
            "For the isolated development Incus domain only, set acceptDevelopmentDomain: true explicitly; this does not attest capacity or make the run reference-comparable.",
          ],
        ));
      }
      continue;
    }
    if (requirement._tag === "Reuse" && plan.capabilities.reuse._tag === "Unsupported") {
      const group = pair.evalGroupId;
      issues.push(capabilityIssue(
        pair,
        baseDir,
        "sandbox.reuse-unavailable",
        group === undefined
          ? `Provider ${JSON.stringify(plan.provider)} cannot satisfy sandboxReuse: ${plan.capabilities.reuse.reason}.`
          : `Provider ${JSON.stringify(plan.provider)} cannot run Eval Group ${JSON.stringify(group)} because Sandbox reuse is unavailable: ${plan.capabilities.reuse.reason}.`,
        group === undefined
          ? ["Select a provider with Sandbox reuse support, or disable sandboxReuse for this Experiment."]
          : ["Select a provider with Sandbox reuse support, or remove these Evals from the Eval Group."],
      ));
      continue;
    }
    if (requirement._tag === "Retention" && plan.capabilities.retention._tag === "DestroyOnly") {
      issues.push(capabilityIssue(
        pair,
        baseDir,
        "sandbox.retention-unavailable",
        `Provider ${JSON.stringify(plan.provider)} cannot retain this Sandbox Case after the Attempt.`,
        ["Select a provider with suspendable retention, or remove --keep-sandbox."],
      ));
      continue;
    }
    if (
      requirement._tag === "SessionDuration" &&
      plan.capabilities.sessionLimit._tag === "Bounded" &&
      requirement.milliseconds > plan.capabilities.sessionLimit.milliseconds
    ) {
      issues.push(capabilityIssue(
        pair,
        baseDir,
        "sandbox.session-limit-exceeded",
        `Provider ${JSON.stringify(plan.provider)} limits Sandbox sessions to ` +
          `${plan.capabilities.sessionLimit.milliseconds}ms, below the requested ${requirement.milliseconds}ms.`,
        ["Lower the resolved Attempt timeout, or select a provider with a sufficient session limit."],
      ));
    }
  }
  return Object.freeze(issues);
}

function planningError(issues: SandboxPhysicalPlanningIssues): SandboxPhysicalPlanningError {
  const frozen = Object.freeze([
    issues[0],
    ...issues.slice(1),
  ] as [SandboxPhysicalPlanningIssue, ...SandboxPhysicalPlanningIssue[]]);
  return new SandboxPhysicalPlanningError({
    code: "sandbox.physical-planning-failed",
    issues: frozen,
    message:
      `Sandbox physical planning failed for ${frozen.length} pair${frozen.length === 1 ? "" : "s"}. ` +
      "No provider build or Sandbox creation was started.",
  });
}

/** CLI 面向作者的完整规划反馈：保留每条 pair、provider code 与可执行修法。 */
export function formatSandboxPhysicalPlanningError(error: SandboxPhysicalPlanningError): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    lines.push(`${issue.providerCode}: ${issue.summary}`);
    lines.push(
      `  pair: ${issue.pair.experimentId} × ${issue.pair.evalId} (${issue.pair.agentName})`,
    );
    lines.push(
      `  template: ${issue.templateOwner.kind} ${JSON.stringify(issue.templateOwner.id)} at ${issue.baseDir}`,
    );
    for (const action of issue.actions) lines.push(`  fix: ${action}`);
    lines.push("");
  }
  lines.push(
    `${error.issues.length} unavailable Sandbox plan${error.issues.length === 1 ? "" : "s"} found. ` +
      "No provider build or Sandbox creation was started.",
  );
  return lines.join("\n");
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
      if (baseDir === undefined) {
        issues.push(invalidBaseDirIssue(input.pair, "<missing eval-group base directory>"));
        continue;
      }
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
      const gaps = capabilityIssues(input.pair, baseDir, planned.right, input.requirements);
      if (gaps.length > 0) {
        issues.push(...gaps);
        continue;
      }
      plans.push(Object.freeze({
        pair: input.pair,
        plan: Object.freeze({ _tag: "Sandbox", pair: input.pair, providerPlan: planned.right }),
      }));
    }
    if (issues.length > 0) return yield* planningError([issues[0], ...issues.slice(1)]);
    return Object.freeze(plans);
  });
}

/** Provider record projection 已由 factory planner 一次构造并冻结，不含任何私有输入原值。 */
export function providerPlanRecordIdentity(plan: ProviderPlan): JsonValue {
  return plan.identity;
}

/** Fingerprint 认同一份可重算 projection；私有输入只通过 plan 内的稳定摘要贡献身份。 */
export function providerPlanFingerprintIdentity(plan: ProviderPlan): JsonValue {
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

function requirementIdentity(
  entry: LinkedSandboxPair["requirements"][number],
): JsonValue {
  return {
    owner: { kind: entry.owner.kind, id: entry.owner.id },
    requirement: {
      _tag: entry.requirement._tag,
      docker: {
        api: entry.requirement.docker.api,
        compose: entry.requirement.docker.compose,
        isolation: entry.requirement.docker.isolation,
        minimumDataBytes: entry.requirement.docker.minimumDataBytes,
      },
    },
  };
}

function linkedRunPublishableIdentity(plan: LinkedRunPlan): JsonValue {
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
    ...(plan.pair.requirements.length === 0
      ? {}
      : { requirements: plan.pair.requirements.map(requirementIdentity) }),
    ...((plan.pair.fingerprint.after?.length ?? 0) === 0
      ? {}
      : { after: plan.pair.fingerprint.after!.map(commandFingerprintIdentity) }),
    providerPlan: providerPlanRecordIdentity(plan.providerPlan),
  };
}

/** `sandboxPlansByEval` 的唯一落盘投影；整个返回值可安全 JSON 序列化。 */
export function linkedRunRecordIdentity(plan: LinkedRunPlan): JsonValue {
  return linkedRunPublishableIdentity(plan);
}

/** Eval fingerprint 的唯一计划投影；与 record 同构，保证可从磁盘重算。 */
export function linkedRunFingerprintIdentity(plan: LinkedRunPlan): JsonValue {
  return linkedRunPublishableIdentity(plan);
}
