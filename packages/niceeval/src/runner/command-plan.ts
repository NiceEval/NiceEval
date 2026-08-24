// `niceeval debug <experiment> <eval>` 的纯计划装配器。
//
// 它只消费 discovery/link/physical/carry 已经完成的不可变结果，不执行作者回调，也不从
// Function#toString 或公开 command identity 猜命令。生命周期拓扑在这里组装；human/JSON
// renderer 只做投影，避免两种输出各维护一套“看起来像执行顺序”的第二真相。

import type { AgentIdentity, AgentInstaller } from "../agents/types.ts";
import { agentLifecycleHookCommandsOf } from "../agents/post-setup.ts";
import {
  sandboxCommandPlanOf,
  type SandboxCommand,
  type SandboxCommandPlanCommand,
  type SandboxCommandPlanCondition,
  type SandboxCommandPlanNode,
  type SandboxCommandPlanRedaction,
} from "../sandbox/commands.ts";
import {
  sandboxTemplateCommandPlanLocator,
  type SandboxTemplateCommandPlanLocator,
} from "../sandbox/layer.ts";
import {
  type LinkedSandboxAfter,
  type LinkedSandboxPluginLifecycle,
  type ScheduledSandboxBefore,
  type SandboxBeforeDependencyProjection,
  type SandboxDeclarationOrder,
} from "../sandbox/link.ts";
import {
  mergeSandboxActionState,
  sandboxActionStateCovers,
  type SandboxActionState,
  type SandboxActionPlan,
  type SandboxChangeFrequency,
} from "../sandbox/action.ts";
import { digestOf } from "../sandbox/identity.ts";
import type { JsonValue } from "../shared/types.ts";
import { runPairKey, type PreparedRunPair } from "./sandbox-selection.ts";
import {
  sandboxReusePoolDescriptor,
  type SandboxReusePoolDescriptor,
} from "./sandbox-reuse.ts";
import type { LinkedPluginLifecycle } from "../plugin/contracts.ts";

export interface CommandPlanOwner {
  readonly kind: "eval" | "eval-group" | "experiment" | "agent" | "provider";
  readonly id: string;
  readonly index?: number;
}

export interface CommandPlanReason {
  readonly code: string;
  readonly summary: string;
}

export interface CommandPlanSandboxTemplate {
  readonly owner: CommandPlanOwner;
  readonly provider: string;
  readonly kind: string;
  readonly locator: SandboxTemplateCommandPlanLocator;
}

export interface CommandPlanStep {
  readonly phase: string;
  readonly label?: string;
  readonly owner?: CommandPlanOwner;
  readonly truth: "exact" | "conditional" | "opaque" | "known-no-command";
  readonly condition?: SandboxCommandPlanCondition;
  readonly reason?: CommandPlanReason;
  /** Present only on the real Sandbox creation boundary. */
  readonly template?: CommandPlanSandboxTemplate;
  readonly redactions?: readonly SandboxCommandPlanRedaction[];
  readonly command?: SandboxCommandPlanCommand;
  readonly children?: readonly CommandPlanStep[];
  readonly action?: Readonly<SandboxActionPlan & { readonly kind?: "action" | "command" }> | {
    readonly id: string;
    readonly kind: "command" | "callback";
  };
  readonly declarationOrder?: SandboxDeclarationOrder;
  readonly executionOrder?: {
    readonly topologicalOrdinal: number;
    readonly occurrencePath: readonly string[];
  };
  readonly changeFrequency?: SandboxChangeFrequency;
  readonly schedulingReason?: string;
  readonly dependencies?: readonly SandboxBeforeDependencyProjection[];
  readonly occurrence?: { readonly kind: "attempt" };
  readonly cache?: {
    readonly lookup: "not-probed";
    readonly capability: CommandPlanCacheCapability;
    /** Linked declaration identity; the runtime-only final cache key remains unprobed. */
    readonly prefixIdentity?: string;
    /** Static provider reason; present only when capability is unsupported. */
    readonly capabilityReason?: string;
    /** Dry planning cannot resolve runtime eligibility or a final cache key. */
    readonly runtime: {
      readonly status: "pending";
      readonly finalKey: "not-probed";
    };
    readonly eligibility:
      | { readonly status: "eligible" }
      | {
          readonly status: "ineligible";
          readonly reason: {
            readonly code:
              | "opaque-action"
              | "opaque-ancestor"
              | "provider-unsupported"
              | "unsupported-state"
              | "unsupported-state-ancestor";
          };
        };
    readonly state: {
      readonly declared: SandboxActionState | "opaque";
      readonly cumulative: SandboxActionState | "opaque";
      readonly providerCoverage: SandboxActionState | "unsupported";
      readonly barrier:
        | "none"
        | "opaque-action"
        | "opaque-ancestor"
        | "provider-unsupported"
        | "unsupported-state"
        | "unsupported-state-ancestor";
      /** First action/callback that severed this reusable lineage, when action-addressable. */
      readonly barrierActionId?: string;
    };
  };
}

export type CommandPlanCacheCapability = "persistent" | "invocation-local" | "unsupported";

export interface CommandPlanSlot {
  readonly evalId: string;
  readonly attempt: number;
  readonly action: "carried" | "dispatch";
  readonly activation?: SandboxCommandPlanCondition;
  readonly steps: readonly CommandPlanStep[];
}

export interface CommandPlanPhysicalLifecycleTemplate {
  readonly appliesTo: "each-physical-instance";
  readonly enter: readonly CommandPlanStep[];
  readonly exit: readonly CommandPlanStep[];
}

interface CommandPlanLaneBase {
  readonly id: string;
  readonly slots: readonly CommandPlanSlot[];
}

export type CommandPlanLane =
  | (CommandPlanLaneBase & {
      readonly kind: "eval";
      readonly ordering: "independent";
      readonly scope?: never;
      readonly physicalLifecycleTemplate?: never;
    })
  | (CommandPlanLaneBase & {
      readonly kind: "sandbox-reuse";
      readonly ordering: "independent";
      readonly scope:
        | { readonly kind: "shared" }
        | { readonly kind: "eval"; readonly evalId: string };
      /** Applied independently to every physical instance; it creates no lane-wide before/after edge. */
      readonly physicalLifecycleTemplate?: CommandPlanPhysicalLifecycleTemplate;
    })
  | (CommandPlanLaneBase & {
      readonly kind: "eval-group";
      readonly ordering: "serial-normalized-eval-id";
      readonly scope?: never;
      readonly beforeSlots: readonly CommandPlanStep[];
      readonly afterSlots: readonly CommandPlanStep[];
      /** Applied independently to every replacement instance used by this capacity-one lane. */
      readonly physicalLifecycleTemplate?: CommandPlanPhysicalLifecycleTemplate;
    });

export interface CommandPlanExperiment {
  readonly experimentId: string;
  /** 计划中的 dispatch 仍可能被 late carry、预算、early-exit 或 fail-fast 阻止。 */
  readonly activation: "conditional" | "inactive";
  readonly beforeLanes: readonly CommandPlanStep[];
  readonly lanes: readonly CommandPlanLane[];
  readonly afterLanes: readonly CommandPlanStep[];
}

export interface CommandPlan {
  readonly completeness: "complete" | "partial";
  readonly opaqueCount: number;
  readonly redactedCount: number;
  readonly experiments: readonly CommandPlanExperiment[];
}

export interface CommandPlanRowInput {
  readonly experimentId: string;
  readonly evalId: string;
  readonly evalGroupId?: string;
  readonly attempts: number;
  /** 不在任何 dispatch group 的坐标就是 carry；这与 dry matrix 的唯一 carry 计划同源。 */
  readonly dispatch: readonly { readonly attempts: readonly number[] }[];
}

export interface AssembleCommandPlanInput {
  readonly rows: readonly CommandPlanRowInput[];
  readonly preparedPairsByKey: ReadonlyMap<string, PreparedRunPair>;
  /** Backend wiring may replace the static provider declaration; debug still never performs lookup. */
  readonly setupPrefixCapability?: (pair: PreparedRunPair) => CommandPlanCacheCapability;
}

const DISPATCH_MAY_NOT_RUN: SandboxCommandPlanCondition = Object.freeze({
  code: "dispatch-admitted",
  summary: "runs only if late carry, budget, early-exit, fail-fast, and cancellation still admit this slot",
});

const PROBE_MISS: SandboxCommandPlanCondition = Object.freeze({
  code: "probe-miss",
  summary: "the preceding probe exits non-zero",
});

const SHARED_INSTANCE_AVAILABLE: SandboxCommandPlanCondition = Object.freeze({
  code: "shared-instance-lifetime",
  summary: "may repeat after provider retirement, reset failure, or lifetime replacement",
});

const AGENT_POST_SETUP_REACHED: SandboxCommandPlanCondition = Object.freeze({
  code: "agent-post-setup-reached",
  summary: "runs only if Adapter setup reached its declared postSetup point",
});

function opaque(
  phase: string,
  code: string,
  summary: string,
  options: {
    owner?: CommandPlanOwner;
    label?: string;
    condition?: SandboxCommandPlanCondition;
    template?: CommandPlanSandboxTemplate;
  } = {},
): CommandPlanStep {
  return {
    phase,
    truth: "opaque",
    reason: { code, summary },
    ...(options.owner === undefined ? {} : { owner: options.owner }),
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.condition === undefined ? {} : { condition: options.condition }),
    ...(options.template === undefined ? {} : { template: options.template }),
  };
}

function knownNoCommand(
  phase: string,
  code: string,
  summary: string,
  options: { owner?: CommandPlanOwner; label?: string; condition?: SandboxCommandPlanCondition } = {},
): CommandPlanStep {
  return {
    phase,
    truth: "known-no-command",
    reason: { code, summary },
    ...(options.owner === undefined ? {} : { owner: options.owner }),
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.condition === undefined ? {} : { condition: options.condition }),
  };
}

function stepFromDeclaration(
  node: SandboxCommandPlanNode,
  phase: string,
  owner: CommandPlanOwner,
  inheritedCondition?: SandboxCommandPlanCondition,
): CommandPlanStep {
  const condition = inheritedCondition ?? node.condition;
  if (node.truth === "exact") {
    return {
      phase,
      truth: "exact",
      owner,
      ...(node.label === undefined ? {} : { label: node.label }),
      ...(condition === undefined ? {} : { condition }),
      command: node.command,
      ...(node.redactions === undefined ? {} : { redactions: node.redactions }),
    };
  }
  if (node.truth === "conditional") {
    return {
      phase,
      truth: "conditional",
      owner,
      ...(node.label === undefined ? {} : { label: node.label }),
      ...(condition === undefined ? {} : { condition }),
      children: node.children.map((child) => stepFromDeclaration(child, phase, owner)),
    };
  }
  if (node.truth === "opaque") {
    return {
      phase,
      truth: "opaque",
      owner,
      ...(node.label === undefined ? {} : { label: node.label }),
      ...(condition === undefined ? {} : { condition }),
      reason: node.reason,
    };
  }
  return {
    phase,
    truth: "known-no-command",
    owner,
    ...(node.label === undefined ? {} : { label: node.label }),
    ...(condition === undefined ? {} : { condition }),
    ...(node.reason === undefined ? {} : { reason: node.reason }),
  };
}

function sameIdentity(left: AgentIdentity, right: AgentIdentity): boolean {
  return left.agent === right.agent && left.version === right.version && left.revision === right.revision;
}

function matchingInstaller(
  installers: readonly AgentInstaller[],
  identity: AgentIdentity,
): AgentInstaller | undefined {
  return installers.find((candidate) => sameIdentity(candidate.identity, identity));
}

function ensureStep(pair: PreparedRunPair, index: number): CommandPlanStep {
  const agent = pair.run.agent;
  if (agent.kind !== "sandbox") {
    throw new Error("Command plan invariant failed: Direct Agent has no Sandbox ensure step.");
  }
  const owner: CommandPlanOwner = { kind: "agent", id: agent.name };
  const ensure = agent.ensure[index];
  if (ensure === undefined) throw new Error(`Command plan invariant failed: missing Agent ensure #${index}.`);
  const probe = sandboxCommandPlanOf(ensure.probe);
  const probeStep = probe === undefined
    ? opaque(
        "agent.ensure",
        "agent-probe-callback",
        "custom Agent ensure probe; commands are only known when it runs",
        { owner, label: `probe #${index}` },
      )
    : stepFromDeclaration({ ...probe, label: `probe #${index}` }, "agent.ensure", owner);
  const installer = matchingInstaller(agent.installers, ensure.identity);
  const children: CommandPlanStep[] = [probeStep];
  if (installer === undefined) {
    children.push(knownNoCommand(
      "agent.ensure",
      "installer-missing",
      "probe miss stops with a missing-installer error",
      { owner, label: `install #${index}`, condition: PROBE_MISS },
    ));
  } else if (installer.installMode === "verify-only") {
    children.push(knownNoCommand(
      "agent.ensure",
      "verify-only",
      "probe miss stops because this installer is verify-only",
      { owner, label: `install #${index}`, condition: PROBE_MISS },
    ));
  } else {
    children.push(opaque(
      "agent.ensure",
      "agent-installer-callback",
      `${installer.installMode} installer callback; commands are only known when it runs`,
      { owner, label: `install #${index}`, condition: PROBE_MISS },
    ));
    children.push(probe === undefined
      ? opaque(
          "agent.ensure",
          "agent-probe-callback",
          "custom Agent ensure recheck; commands are only known when it runs",
          { owner, label: `recheck #${index}`, condition: PROBE_MISS },
        )
      : stepFromDeclaration({ ...probe, label: `recheck #${index}` }, "agent.ensure", owner, PROBE_MISS));
  }
  return {
    phase: "agent.ensure",
    truth: "conditional",
    owner,
    label: `${ensure.identity.agent}@${ensure.identity.version}`,
    children,
  };
}

function containsOpaque(step: CommandPlanStep): boolean {
  return step.truth === "opaque" || (step.children?.some(containsOpaque) ?? false);
}

function stepForLinkedBefore(pair: PreparedRunPair, entry: ScheduledSandboxBefore): CommandPlanStep {
  const owner: CommandPlanOwner = { kind: entry.owner.kind, id: entry.owner.id };
  if (entry.kind === "action") {
    return {
      phase: "sandbox.before",
      truth: "exact",
      owner,
      action: Object.freeze({ ...entry.data.plan, kind: "action" as const }),
    };
  }
  if (entry.kind === "hook") {
    return opaque(
      "sandbox.before",
      "sandbox-hook-callback",
      "callback-backed SandboxHook receives the public Sandbox only when it runs",
      { owner },
    );
  }
  const declaration = sandboxCommandPlanOf(entry.declaration.command);
  return declaration === undefined
    ? opaque(
        "sandbox.before",
        "sandbox-command-callback",
        "callback-backed SandboxCommand; commands are only known when it runs",
        { owner },
      )
    : stepFromDeclaration(declaration, "sandbox.before", owner);
}

function cacheCapabilityTag(value: unknown): CommandPlanCacheCapability | undefined {
  if (value === "persistent" || value === "invocation-local" || value === "unsupported") return value;
  if (value === null || typeof value !== "object") return undefined;
  const tag = Reflect.get(value, "_tag");
  if (tag === "Persistent") return "persistent";
  if (tag === "InvocationLocal") return "invocation-local";
  if (tag === "Unsupported") return "unsupported";
  return undefined;
}

/** Static debug projection only; a runtime/backend resolver can be supplied to assembleCommandPlan. */
export function providerDeclaredSetupPrefixCapability(pair: PreparedRunPair): CommandPlanCacheCapability {
  if (pair.plan._tag !== "Sandbox") return "unsupported";
  const capabilities = pair.plan.providerPlan.capabilities as object;
  return cacheCapabilityTag(Reflect.get(capabilities, "setupPrefix")) ??
    cacheCapabilityTag(Reflect.get(capabilities, "setupPrefixCache")) ??
    "unsupported";
}

function providerDeclaredSetupPrefixCoverage(
  pair: PreparedRunPair,
): SandboxActionState | "unsupported" {
  if (pair.plan._tag !== "Sandbox") return "unsupported";
  const declaration = pair.plan.providerPlan.capabilities.setupPrefix;
  return declaration._tag === "Persistent" ? declaration.coverage : "unsupported";
}

function providerDeclaredSetupPrefixReason(pair: PreparedRunPair): string | undefined {
  if (pair.plan._tag !== "Sandbox") return undefined;
  const capabilities = pair.plan.providerPlan.capabilities as object;
  for (const candidate of [
    Reflect.get(capabilities, "setupPrefix"),
    Reflect.get(capabilities, "setupPrefixCache"),
  ]) {
    if (candidate === null || typeof candidate !== "object") continue;
    if (Reflect.get(candidate, "_tag") !== "Unsupported") continue;
    const reason = Reflect.get(candidate, "reason");
    if (typeof reason === "string" && reason !== "") return reason;
  }
  return undefined;
}

function hasOpaqueSetupAncestor(pair: PreparedRunPair): boolean {
  if (pair.plan._tag !== "Sandbox") return false;
  const authorSetup = pair.plan.pair.fingerprint.lifecycle?.some((entry) => entry.phase === "setup") ?? false;
  const pluginSetup = pair.plan.pair.pluginLifecycles.some((entry) => entry.lifecycle.hasSetup);
  return authorSetup || pluginSetup;
}

function linkedSetupPrefixBaseIdentity(pair: PreparedRunPair): string {
  if (pair.plan._tag !== "Sandbox") return "linked-base:unsupported";
  const provider = pair.plan.providerPlan;
  const identity = {
    protocol: "niceeval.setup-prefix-linked-plan/v1",
    provider: {
      id: provider.provider,
      plannerRevision: provider.plannerRevision,
      caseKind: provider.caseKind,
      caseKey: provider.build.caseKey,
      buildKeys: [...provider.build.buildKeys],
      identity: provider.identity,
    },
    target: {
      source: provider.target.source,
      platform: { ...provider.target.platform },
    },
    occurrence: {
      kind: "attempt",
      cohort: {
        experimentId: pair.plan.pair.experimentId,
        evalId: pair.plan.pair.evalId,
        agentName: pair.plan.pair.agentName,
      },
    },
  } as unknown as JsonValue;
  return `linked-base:${digestOf(identity)}`;
}

function linkedSetupPrefixActionIdentity(
  parentIdentity: string,
  entry: Extract<ScheduledSandboxBefore, { readonly kind: "action" }>,
  cumulativeState: SandboxActionState,
): string {
  const identity = {
    protocol: "niceeval.setup-prefix-linked-plan/v1",
    parentIdentity,
    owner: {
      kind: entry.owner.kind,
      id: entry.owner.id,
      ordinal: entry.ordinal,
    },
    order: entry.executionOrder.topologicalOrdinal,
    changeFrequency: {
      value: entry.metadata.changeFrequency.value,
      source: entry.metadata.changeFrequency.source,
      ...(entry.metadata.changeFrequency.preset === undefined
        ? {}
        : { preset: entry.metadata.changeFrequency.preset }),
    },
    dependencyEdges: entry.dependencies.map((dependency) => ({ ...dependency })),
    capabilities: {
      requires: [...entry.metadata.requires],
      provides: [...entry.metadata.provides],
    },
    action: {
      id: entry.data.plan.id,
      family: entry.data.plan.family,
      declaredState: entry.data.plan.state,
      cumulativeState,
      input: entry.data.plan.input,
      fingerprint: entry.data.plan.fingerprint,
      steps: entry.data.plan.steps,
    },
  } as unknown as JsonValue;
  return `linked-prefix:${digestOf(identity)}`;
}

function scheduledBeforeSteps(
  pair: PreparedRunPair,
  capabilityOf: (pair: PreparedRunPair) => CommandPlanCacheCapability,
): readonly CommandPlanStep[] {
  if (pair.plan._tag !== "Sandbox") return [];
  const scheduled = pair.plan.pair.before;
  let opaqueAncestor = hasOpaqueSetupAncestor(pair);
  let opaqueBarrierActionId: string | undefined;
  let unsupportedStateAncestor = false;
  let unsupportedStateBarrierActionId: string | undefined;
  let cumulativeState: SandboxActionState | undefined;
  let parentPrefixIdentity = linkedSetupPrefixBaseIdentity(pair);
  const capability = capabilityOf(pair);
  const providerCoverage = capability === "persistent"
    ? providerDeclaredSetupPrefixCoverage(pair)
    : "unsupported";
  const capabilityReason = capability === "unsupported"
    ? providerDeclaredSetupPrefixReason(pair)
    : undefined;
  return Object.freeze(scheduled.map((entry): CommandPlanStep => {
    const projected = stepForLinkedBefore(pair, entry);
    const currentOpaque = containsOpaque(projected);
    const declaredState = entry.kind === "action" ? entry.data.plan.state : "opaque";
    if (entry.kind === "action" && !opaqueAncestor) {
      cumulativeState = mergeSandboxActionState(cumulativeState, entry.data.plan.state);
    }
    const projectedCumulativeState = opaqueAncestor || currentOpaque
      ? "opaque" as const
      : cumulativeState!;
    const prefixIdentity = entry.kind === "action" && !opaqueAncestor && !currentOpaque
      ? linkedSetupPrefixActionIdentity(parentPrefixIdentity, entry, cumulativeState!)
      : undefined;
    const barrier = capability === "unsupported" || providerCoverage === "unsupported"
      ? "provider-unsupported" as const
      : opaqueAncestor
        ? "opaque-ancestor" as const
        : unsupportedStateAncestor
          ? "unsupported-state-ancestor" as const
          : currentOpaque
            ? "opaque-action" as const
            : sandboxActionStateCovers(providerCoverage, projectedCumulativeState as SandboxActionState)
              ? "none" as const
              : "unsupported-state" as const;
    const barrierActionId = barrier === "opaque-action" || barrier === "unsupported-state"
      ? entry.id
      : barrier === "opaque-ancestor"
        ? opaqueBarrierActionId
        : barrier === "unsupported-state-ancestor"
          ? unsupportedStateBarrierActionId
          : undefined;
    const owner = Object.freeze({ kind: entry.owner.kind, id: entry.owner.id });
    const step: CommandPlanStep = Object.freeze({
      ...projected,
      owner,
      action: entry.kind === "action"
        ? projected.action
        : Object.freeze({
            id: entry.id,
            kind: entry.kind === "hook" ? "callback" as const : "command" as const,
          }),
      declarationOrder: Object.freeze({ owner, ordinal: entry.ordinal }),
      executionOrder: entry.executionOrder,
      changeFrequency: entry.metadata.changeFrequency,
      schedulingReason: entry.schedulingReason,
      dependencies: entry.dependencies,
      occurrence: Object.freeze({ kind: "attempt" as const }),
      cache: Object.freeze({
        lookup: "not-probed" as const,
        capability,
        ...(prefixIdentity === undefined ? {} : { prefixIdentity }),
        ...(capabilityReason === undefined ? {} : { capabilityReason }),
        runtime: Object.freeze({
          status: "pending" as const,
          finalKey: "not-probed" as const,
        }),
        eligibility: barrier === "none"
          ? Object.freeze({ status: "eligible" as const })
          : Object.freeze({
              status: "ineligible" as const,
              reason: Object.freeze({ code: barrier }),
            }),
        state: Object.freeze({
          declared: declaredState,
          cumulative: projectedCumulativeState,
          providerCoverage,
          barrier,
          ...(barrierActionId === undefined ? {} : { barrierActionId }),
        }),
      }),
    });
    if (currentOpaque) {
      opaqueAncestor = true;
      opaqueBarrierActionId ??= entry.id;
    }
    if (prefixIdentity !== undefined) parentPrefixIdentity = prefixIdentity;
    if (barrier === "unsupported-state") {
      unsupportedStateAncestor = true;
      unsupportedStateBarrierActionId = entry.id;
    }
    return step;
  }));
}

function stepForAfter(entry: LinkedSandboxAfter): CommandPlanStep {
  const owner: CommandPlanOwner = { kind: entry.owner.kind, id: entry.owner.id };
  if (entry.kind === "action") {
    return {
      phase: "sandbox.after",
      truth: "exact",
      owner,
      action: Object.freeze({ ...entry.data.plan, kind: "action" as const }),
    };
  }
  return opaque(
    "sandbox.after",
    "sandbox-cleanup-command",
    "cleanup command is registered for LIFO execution and is only known when it runs",
    { owner },
  );
}

function afterSteps(pair: PreparedRunPair): readonly CommandPlanStep[] {
  if (pair.plan._tag !== "Sandbox") return [];
  return [...pair.plan.pair.after].reverse().map(stepForAfter);
}

function declaredAgentHookStep(
  command: SandboxCommand,
  index: number,
  phase: "agent.post-setup" | "agent.pre-teardown",
  owner: CommandPlanOwner,
  condition?: SandboxCommandPlanCondition,
): CommandPlanStep {
  const declaration = sandboxCommandPlanOf(command);
  const label = `${phase === "agent.post-setup" ? "postSetup" : "preTeardown"} #${index}`;
  return declaration === undefined
    ? opaque(
        phase,
        "agent-lifecycle-hook-callback",
        "callback-backed Agent lifecycle hook; commands are only known when it runs",
        { owner, label, ...(condition === undefined ? {} : { condition }) },
      )
    : stepFromDeclaration({ ...declaration, label }, phase, owner, condition);
}

function agentSetupSteps(pair: PreparedRunPair, owner: CommandPlanOwner): readonly CommandPlanStep[] {
  const agent = pair.run.agent;
  if (agent.setup === undefined) {
    return [knownNoCommand("agent.setup", "hook-omitted", "Agent has no setup callback", { owner })];
  }
  if (agent.kind !== "sandbox") {
    return [opaque(
      "agent.setup",
      "agent-setup-callback",
      "Agent setup callback may execute commands; its body is not inspected",
      { owner },
    )];
  }
  const hooks = agentLifecycleHookCommandsOf(agent);
  if (hooks === undefined) {
    return [opaque(
      "agent.setup",
      "agent-setup-callback",
      "Agent setup callback may execute commands; its body is not inspected",
      { owner },
    )];
  }
  return [
    opaque(
      "agent.setup",
      "adapter-setup-internals",
      "Adapter setup before declared postSetup hooks may execute commands",
      { owner, label: "adapter setup" },
    ),
    ...hooks.postSetup.map((hook, index) => declaredAgentHookStep(
      hook,
      index,
      "agent.post-setup",
      owner,
    )),
  ];
}

function agentTeardownSteps(pair: PreparedRunPair, owner: CommandPlanOwner): readonly CommandPlanStep[] {
  const agent = pair.run.agent;
  if (agent.teardown === undefined) {
    return [knownNoCommand("agent.teardown", "hook-omitted", "Agent has no teardown callback", { owner })];
  }
  if (agent.kind !== "sandbox") {
    return [opaque(
      "agent.teardown",
      "agent-teardown-callback",
      "Agent teardown callback may execute commands; its body is not inspected",
      { owner },
    )];
  }
  const hooks = agentLifecycleHookCommandsOf(agent);
  if (hooks === undefined) {
    return [opaque(
      "agent.teardown",
      "agent-teardown-callback",
      "Agent teardown callback may execute commands; its body is not inspected",
      { owner },
    )];
  }

  const preTeardown = hooks.preTeardown
    .map((hook, index) => ({ hook, index }))
    .reverse()
    .map(({ hook, index }) => declaredAgentHookStep(
      hook,
      index,
      "agent.pre-teardown",
      owner,
      AGENT_POST_SETUP_REACHED,
    ));
  const mayRegisterCleanup = [...hooks.postSetup, ...hooks.preTeardown]
    .some((hook) => sandboxCommandPlanOf(hook) === undefined);
  return [
    ...preTeardown,
    ...(mayRegisterCleanup
      ? [opaque(
          "agent.pre-teardown.cleanup",
          "registered-agent-cleanup-callbacks",
          "callback-backed Agent hooks may register LIFO cleanup commands",
          { owner, condition: AGENT_POST_SETUP_REACHED },
        )]
      : []),
    opaque(
      "agent.teardown",
      "adapter-teardown-remainder",
      "Adapter teardown after declared preTeardown hooks may execute commands",
      { owner, label: "adapter teardown" },
    ),
  ];
}

function sandboxLifecycleHooks(
  pair: PreparedRunPair,
  phase: "setup" | "teardown",
  condition?: SandboxCommandPlanCondition,
): readonly CommandPlanStep[] {
  if (pair.plan._tag !== "Sandbox") return [];
  const markers = pair.plan.pair.fingerprint.lifecycle?.filter((entry) => entry.phase === phase) ?? [];
  const ordered = phase === "teardown" ? [...markers].reverse() : markers;
  return ordered.map((entry) => opaque(
    `sandbox.${phase}`,
    "sandbox-lifecycle-callback",
    `${phase} hook callback; commands are only known when it runs`,
    {
      owner: { ...entry.owner, index: entry.index },
      ...(condition === undefined ? {} : { condition }),
    },
  ));
}

function pluginLifecycleSteps(
  lifecycles: readonly LinkedPluginLifecycle[],
  phase: "setup" | "teardown",
  owner: CommandPlanOwner,
  condition?: SandboxCommandPlanCondition,
): readonly CommandPlanStep[] {
  const ordered = phase === "teardown" ? [...lifecycles].reverse() : lifecycles;
  return ordered
    .filter((entry) => phase === "setup" ? entry.hasSetup : entry.hasTeardown)
    .map((entry) => opaque(
      `plugin.lifecycle.${phase}`,
      `plugin-lifecycle-${phase}-callback`,
      `Plugin ${entry.name} (${entry.instanceKey}) ${phase} callback is opaque`,
      { owner, label: `${entry.name}:${entry.instanceKey}`, ...(condition === undefined ? {} : { condition }) },
    ));
}

function sandboxPluginLifecycleSteps(
  lifecycles: readonly LinkedSandboxPluginLifecycle[],
  phase: "setup" | "teardown",
  condition?: SandboxCommandPlanCondition,
): readonly CommandPlanStep[] {
  const ordered = phase === "teardown" ? [...lifecycles].reverse() : lifecycles;
  return ordered
    .filter((entry) => phase === "setup" ? entry.lifecycle.hasSetup : entry.lifecycle.hasTeardown)
    .map(({ lifecycle, owner }) => opaque(
      `plugin.lifecycle.${phase}`,
      `plugin-lifecycle-${phase}-callback`,
      `Plugin ${lifecycle.name} (${lifecycle.instanceKey}) ${phase} callback is opaque`,
      {
        owner,
        label: `${lifecycle.name}:${lifecycle.instanceKey}`,
        ...(condition === undefined ? {} : { condition }),
      },
    ));
}

function physicalBefore(pair: PreparedRunPair, shared: boolean): readonly CommandPlanStep[] {
  if (pair.plan._tag !== "Sandbox") return [];
  const provider: CommandPlanOwner = { kind: "provider", id: pair.plan.providerPlan.provider };
  const template = pair.plan.pair.template;
  return [
    opaque(
      "sandbox.create",
      "provider-provisioning",
      "provider provisioning is an internal runtime boundary",
      {
        owner: provider,
        template: {
          owner: pair.plan.pair.templateOwner,
          provider: template.provider,
          kind: template.kind,
          locator: sandboxTemplateCommandPlanLocator(template),
        },
        ...(shared ? { condition: SHARED_INSTANCE_AVAILABLE } : {}),
      },
    ),
    ...sandboxLifecycleHooks(pair, "setup", shared ? SHARED_INSTANCE_AVAILABLE : undefined),
    ...sandboxPluginLifecycleSteps(
      pair.plan.pair.pluginLifecycles,
      "setup",
      shared ? SHARED_INSTANCE_AVAILABLE : undefined,
    ),
    opaque(
      "sandbox.baseline-anchor",
      "provider-baseline-anchor",
      "provider baseline/reset anchor is resolved against the live Sandbox",
      { owner: provider, ...(shared ? { condition: SHARED_INSTANCE_AVAILABLE } : {}) },
    ),
  ];
}

function physicalAfter(pair: PreparedRunPair, shared: boolean): readonly CommandPlanStep[] {
  if (pair.plan._tag !== "Sandbox") return [];
  const provider: CommandPlanOwner = { kind: "provider", id: pair.plan.providerPlan.provider };
  return [
    ...sandboxPluginLifecycleSteps(
      pair.plan.pair.pluginLifecycles,
      "teardown",
      shared ? SHARED_INSTANCE_AVAILABLE : undefined,
    ),
    ...sandboxLifecycleHooks(pair, "teardown", shared ? SHARED_INSTANCE_AVAILABLE : undefined),
    opaque(
      "sandbox.finalize",
      "provider-finalizer",
      "provider release, stop, or retained-instance finalization is resolved at runtime",
      { owner: provider, ...(shared ? { condition: SHARED_INSTANCE_AVAILABLE } : {}) },
    ),
  ];
}

function attemptBody(
  pair: PreparedRunPair,
  shared: boolean,
  capabilityOf: (pair: PreparedRunPair) => CommandPlanCacheCapability,
): readonly CommandPlanStep[] {
  const evalOwner: CommandPlanOwner = { kind: "eval", id: pair.evalDef.id };
  const agentOwner: CommandPlanOwner = { kind: "agent", id: pair.run.agent.name };
  const provider = pair.plan._tag === "Sandbox"
    ? ({ kind: "provider", id: pair.plan.providerPlan.provider } satisfies CommandPlanOwner)
    : undefined;
  return [
    ...(shared && provider !== undefined
      ? [opaque(
          "sandbox.reuse-ready",
          "provider-reuse-readiness",
          "the shared instance may be reset, retired, or replaced before this slot",
          { owner: provider, condition: SHARED_INSTANCE_AVAILABLE },
        )]
      : []),
    ...scheduledBeforeSteps(pair, capabilityOf),
    ...pluginLifecycleSteps(pair.plugin.evalLifecycles, "setup", evalOwner),
    ...(pair.run.agent.kind === "sandbox"
      ? pair.run.agent.ensure.map((_, index) => ensureStep(pair, index))
      : []),
    ...(pair.plan._tag === "Sandbox"
      ? [opaque(
          "sandbox.baseline",
          "sandbox-baseline-capture",
          "the diff baseline is captured from the live Sandbox after preparation",
          { owner: provider! },
        )]
      : []),
    ...agentSetupSteps(pair, agentOwner),
    opaque(
      "eval.test",
      "eval-test-callback",
      "Eval test and any Agent.send calls are runtime callbacks; their commands and branches are not inspected",
      { owner: evalOwner },
    ),
    ...agentTeardownSteps(pair, agentOwner),
    ...pluginLifecycleSteps(pair.plugin.evalLifecycles, "teardown", evalOwner),
    ...afterSteps(pair),
    ...(pair.plan._tag === "Sandbox"
      ? [opaque(
          "sandbox.cleanup",
          "registered-cleanup-callbacks",
          "Sandbox command callbacks may register LIFO cleanup commands while running",
          { owner: evalOwner },
        )]
      : [knownNoCommand(
          "sandbox.cleanup",
          "direct-agent",
          "Direct Agent attempts have no Sandbox command cleanup registry",
          { owner: evalOwner },
        )]),
    ...(shared && provider !== undefined
      ? [opaque(
          "sandbox.reset-or-retire",
          "provider-reset-or-retire",
          "the provider resets the shared instance or retires it after this slot",
          { owner: provider, condition: SHARED_INSTANCE_AVAILABLE },
        )]
      : []),
  ];
}

function stepsForDispatch(
  pair: PreparedRunPair,
  shared: boolean,
  capabilityOf: (pair: PreparedRunPair) => CommandPlanCacheCapability,
): readonly CommandPlanStep[] {
  if (pair.plan._tag === "Direct") {
    return [
      knownNoCommand(
        "sandbox.create",
        "direct-agent",
        "Direct Agent has no Sandbox or configured Sandbox template",
        { owner: { kind: "agent", id: pair.run.agent.name } },
      ),
      ...attemptBody(pair, false, capabilityOf),
    ];
  }
  return shared
    ? attemptBody(pair, true, capabilityOf)
    : [...physicalBefore(pair, false), ...attemptBody(pair, false, capabilityOf), ...physicalAfter(pair, false)];
}

interface RowWithPair extends CommandPlanRowInput {
  readonly pair: PreparedRunPair;
}

type CommandPlanLaneSpec =
  | { readonly kind: "eval"; readonly key: string; readonly id: string }
  | { readonly kind: "eval-group"; readonly key: string; readonly id: string }
  | {
      readonly kind: "sandbox-reuse";
      readonly key: string;
      readonly id: string;
      readonly scope:
        | { readonly kind: "shared" }
        | { readonly kind: "eval"; readonly evalId: string };
    };

function dispatchAttempts(row: CommandPlanRowInput): ReadonlySet<number> {
  return new Set(row.dispatch.flatMap((group) => group.attempts));
}

function reuseDescriptorFor(row: RowWithPair): SandboxReusePoolDescriptor | undefined {
  return sandboxReusePoolDescriptor({
    run: row.pair.run,
    evalId: row.evalId,
    ...(row.evalGroupId === undefined ? {} : { evalGroupId: row.evalGroupId }),
    plan: row.pair.plan,
  });
}

function laneSpecFor(row: RowWithPair): CommandPlanLaneSpec {
  const descriptor = reuseDescriptorFor(row);
  if (row.evalGroupId !== undefined) {
    if (
      descriptor?.scope.kind !== "eval-group" ||
      descriptor.scope.evalGroupId !== row.evalGroupId
    ) {
      throw new Error(
        `Command plan invariant failed: Eval Group ${row.evalGroupId} has no matching reuse-pool descriptor.`,
      );
    }
    return { kind: "eval-group", key: descriptor.key, id: row.evalGroupId };
  }
  if (descriptor !== undefined) {
    if (descriptor.scope.kind === "eval-group") {
      throw new Error(`Command plan invariant failed: ungrouped Eval ${row.evalId} received a Group pool scope.`);
    }
    return {
      kind: "sandbox-reuse",
      key: descriptor.key,
      id: descriptor.key,
      scope: descriptor.scope,
    };
  }
  return { kind: "eval", key: `eval:${row.evalId}`, id: row.evalId };
}

function physicalLifecycleTemplate(pair: PreparedRunPair): CommandPlanPhysicalLifecycleTemplate {
  return Object.freeze({
    appliesTo: "each-physical-instance" as const,
    enter: physicalBefore(pair, true),
    exit: physicalAfter(pair, true),
  });
}

function laneFor(
  rows: readonly RowWithPair[],
  spec: CommandPlanLaneSpec,
  capabilityOf: (pair: PreparedRunPair) => CommandPlanCacheCapability,
): CommandPlanLane {
  const first = rows[0]!;
  const shared = spec.kind !== "eval";
  const sortedRows = spec.kind === "eval-group"
    ? [...rows].sort((a, b) => a.evalId.localeCompare(b.evalId))
    : rows;
  const slots: CommandPlanSlot[] = [];
  for (const row of sortedRows) {
    const dispatch = dispatchAttempts(row);
    for (let attempt = 0; attempt < row.attempts; attempt++) {
      const action = dispatch.has(attempt) ? "dispatch" : "carried";
      slots.push({
        evalId: row.evalId,
        attempt,
        action,
        ...(action === "dispatch" ? { activation: DISPATCH_MAY_NOT_RUN } : {}),
        steps: action === "dispatch" ? stepsForDispatch(row.pair, shared, capabilityOf) : [],
      });
    }
  }
  const hasDispatch = slots.some((slot) => slot.action === "dispatch");
  if (spec.kind === "eval") {
    return { kind: "eval", id: spec.id, ordering: "independent", slots };
  }
  if (spec.kind === "sandbox-reuse") {
    return {
      kind: "sandbox-reuse",
      id: spec.id,
      ordering: "independent",
      scope: spec.scope,
      ...(hasDispatch ? { physicalLifecycleTemplate: physicalLifecycleTemplate(first.pair) } : {}),
      slots,
    };
  }
  return {
    kind: "eval-group",
    id: spec.id,
    ordering: "serial-normalized-eval-id",
    beforeSlots: hasDispatch
      ? pluginLifecycleSteps(first.pair.plugin.groupLifecycles, "setup", { kind: "eval-group", id: spec.id }, DISPATCH_MAY_NOT_RUN)
      : [],
    afterSlots: hasDispatch
      ? pluginLifecycleSteps(first.pair.plugin.groupLifecycles, "teardown", { kind: "eval-group", id: spec.id }, DISPATCH_MAY_NOT_RUN)
      : [],
    ...(hasDispatch ? { physicalLifecycleTemplate: physicalLifecycleTemplate(first.pair) } : {}),
    slots,
  };
}

function experimentLifecycle(
  pair: PreparedRunPair,
  side: "setup" | "teardown",
  hasDispatch: boolean,
): CommandPlanStep {
  const owner: CommandPlanOwner = { kind: "experiment", id: pair.run.experimentId };
  if (!hasDispatch) {
    return knownNoCommand(
      `experiment.${side}`,
      "all-slots-carried",
      "all selected slots are carried, so experiment lifecycle does not run",
      { owner },
    );
  }
  const callback = side === "setup" ? pair.sourceRun.setup : pair.sourceRun.teardown;
  return callback === undefined
    ? knownNoCommand(`experiment.${side}`, "hook-omitted", `Experiment has no ${side} callback`, { owner })
    : opaque(
        `experiment.${side}`,
        `experiment-${side}-callback`,
        `Experiment ${side} callback may execute host or Sandbox commands; its body is not inspected`,
        { owner, condition: DISPATCH_MAY_NOT_RUN },
      );
}

function countEvidence(steps: readonly CommandPlanStep[]): { opaque: number; redacted: number } {
  let opaqueCount = 0;
  let redactedCount = 0;
  const visit = (step: CommandPlanStep): void => {
    if (step.truth === "opaque") opaqueCount++;
    if ((step.redactions?.length ?? 0) > 0) redactedCount++;
    if (step.template?.locator._tag === "Redacted") {
      redactedCount += step.template.locator.redactions.length;
    }
    for (const child of step.children ?? []) visit(child);
  };
  for (const step of steps) visit(step);
  return { opaque: opaqueCount, redacted: redactedCount };
}

/**
 * 组装按 Experiment → lane → slot 的保证顺序。不同 lane 可能并发，因此这里有意不产生一条
 * 虚假的全局序号；Group lane 只按规范化 Eval ID、再 attempt index 稳定串行。
 */
export function assembleCommandPlan(input: AssembleCommandPlanInput): CommandPlan {
  const setupPrefixCapability = input.setupPrefixCapability ?? providerDeclaredSetupPrefixCapability;
  const rows: RowWithPair[] = input.rows.map((row) => {
    const pair = input.preparedPairsByKey.get(runPairKey(row.experimentId, row.evalId));
    if (pair === undefined) {
      throw new Error(`Command plan invariant failed: missing prepared pair for ${row.experimentId}/${row.evalId}.`);
    }
    return { ...row, pair };
  });
  const byExperiment = new Map<string, RowWithPair[]>();
  for (const row of rows) {
    const current = byExperiment.get(row.experimentId) ?? [];
    current.push(row);
    byExperiment.set(row.experimentId, current);
  }

  const experiments: CommandPlanExperiment[] = [];
  for (const [experimentId, experimentRows] of byExperiment) {
    const byLane = new Map<string, { readonly spec: CommandPlanLaneSpec; readonly rows: RowWithPair[] }>();
    for (const row of experimentRows) {
      const spec = laneSpecFor(row);
      const current = byLane.get(spec.key);
      if (current === undefined) {
        byLane.set(spec.key, { spec, rows: [row] });
      } else {
        current.rows.push(row);
      }
    }
    const lanes = [...byLane.values()].map(({ rows: laneRows, spec }) =>
      laneFor(laneRows, spec, setupPrefixCapability));
    const hasDispatch = lanes.some((lane) => lane.slots.some((slot) => slot.action === "dispatch"));
    const representative = experimentRows[0]!.pair;
    experiments.push({
      experimentId,
      activation: hasDispatch ? "conditional" : "inactive",
      beforeLanes: [
        experimentLifecycle(representative, "setup", hasDispatch),
        ...(hasDispatch ? pluginLifecycleSteps(representative.plugin.experimentLifecycles, "setup", { kind: "experiment", id: experimentId }, DISPATCH_MAY_NOT_RUN) : []),
      ],
      lanes,
      afterLanes: [
        ...(hasDispatch ? pluginLifecycleSteps(representative.plugin.experimentLifecycles, "teardown", { kind: "experiment", id: experimentId }, DISPATCH_MAY_NOT_RUN) : []),
        experimentLifecycle(representative, "teardown", hasDispatch),
      ],
    });
  }

  let opaqueCount = 0;
  let redactedCount = 0;
  for (const experiment of experiments) {
    const groups = [
      experiment.beforeLanes,
      ...experiment.lanes.flatMap((lane) => [
        ...(lane.kind === "eval-group" ? [lane.beforeSlots] : []),
        lane.physicalLifecycleTemplate?.enter ?? [],
        ...lane.slots.map((slot) => slot.steps),
        lane.physicalLifecycleTemplate?.exit ?? [],
        ...(lane.kind === "eval-group" ? [lane.afterSlots] : []),
      ]),
      experiment.afterLanes,
    ];
    for (const steps of groups) {
      const count = countEvidence(steps);
      opaqueCount += count.opaque;
      redactedCount += count.redacted;
    }
  }
  return {
    completeness: opaqueCount > 0 || redactedCount > 0 ? "partial" : "complete",
    opaqueCount,
    redactedCount,
    experiments,
  };
}
