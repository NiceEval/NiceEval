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
  /** Present only on the real Sandbox materialization boundary. */
  readonly template?: CommandPlanSandboxTemplate;
  readonly redactions?: readonly SandboxCommandPlanRedaction[];
  readonly command?: SandboxCommandPlanCommand;
  readonly children?: readonly CommandPlanStep[];
}

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

function ensureSteps(pair: PreparedRunPair): readonly CommandPlanStep[] {
  const agent = pair.run.agent;
  if (agent.kind !== "sandbox") return [];
  const owner: CommandPlanOwner = { kind: "agent", id: agent.name };
  return agent.ensure.map((ensure, index): CommandPlanStep => {
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
  });
}

function prepareSteps(pair: PreparedRunPair): readonly CommandPlanStep[] {
  if (pair.plan._tag !== "Sandbox") return [];
  return pair.plan.pair.commands.map((entry): CommandPlanStep => {
    const owner: CommandPlanOwner = { ...entry.owner, index: entry.index };
    const declaration = sandboxCommandPlanOf(entry.command);
    return declaration === undefined
      ? opaque(
          "sandbox.prepare",
          "sandbox-command-callback",
          "callback-backed SandboxCommand; commands are only known when it runs",
          { owner },
        )
      : stepFromDeclaration(declaration, "sandbox.prepare", owner);
  });
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

function physicalBefore(pair: PreparedRunPair, shared: boolean): readonly CommandPlanStep[] {
  if (pair.plan._tag !== "Sandbox") return [];
  const provider: CommandPlanOwner = { kind: "provider", id: pair.plan.providerPlan.provider };
  const template = pair.plan.pair.template;
  return [
    opaque(
      "sandbox.materialize",
      "provider-materialization",
      "provider materialization is an internal runtime boundary",
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
    ...pluginLifecycleSteps(
      pair.plan.pair.pluginLifecycles.map((entry) => entry.lifecycle),
      "setup",
      provider,
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
    ...pluginLifecycleSteps(
      pair.plan.pair.pluginLifecycles.map((entry) => entry.lifecycle),
      "teardown",
      provider,
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

function attemptBody(pair: PreparedRunPair, shared: boolean): readonly CommandPlanStep[] {
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
    ...prepareSteps(pair),
    ...pluginLifecycleSteps(pair.plugin.evalLifecycles, "setup", evalOwner),
    ...ensureSteps(pair),
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

function stepsForDispatch(pair: PreparedRunPair, shared: boolean): readonly CommandPlanStep[] {
  if (pair.plan._tag === "Direct") {
    return [
      knownNoCommand(
        "sandbox.materialize",
        "direct-agent",
        "Direct Agent has no Sandbox or configured Sandbox template",
        { owner: { kind: "agent", id: pair.run.agent.name } },
      ),
      ...attemptBody(pair, false),
    ];
  }
  return shared
    ? attemptBody(pair, true)
    : [...physicalBefore(pair, false), ...attemptBody(pair, false), ...physicalAfter(pair, false)];
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

function laneFor(rows: readonly RowWithPair[], spec: CommandPlanLaneSpec): CommandPlanLane {
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
        steps: action === "dispatch" ? stepsForDispatch(row.pair, shared) : [],
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
    const lanes = [...byLane.values()].map(({ rows: laneRows, spec }) => laneFor(laneRows, spec));
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
