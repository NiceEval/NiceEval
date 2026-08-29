// discovery + selector 之后的纯 SandboxLayer linker。
// 本模块只读 factory 产物，不读文件、不访问网络、不调用 Provider，也不创建 Sandbox。

import {
  sandboxCommandDeclarationOf,
  sandboxCommandIdentityJson,
  type SandboxCommand,
  type SandboxCommandDeclaration,
} from "./commands.ts";
import {
  normalizeSandboxBeforeMetadata,
  sandboxActionDataOf,
  sandboxAfterActionDataOf,
  type NormalizedSandboxBeforeMetadata,
  type SandboxActionData,
  type SandboxChangeFrequency,
} from "./action.ts";
import {
  sandboxLayer,
  sandboxLayerStateOf,
  sandboxTemplateIdentity,
  type SandboxLayer,
  type SandboxLayerKind,
  type SandboxLayerState,
  type SandboxRequirement,
  type SandboxBeforeDeclaration,
  type SandboxAfterDeclaration,
  type SandboxTemplateDeclaration,
} from "./layer.ts";
import type { JsonValue } from "../shared/types.ts";
import type { SandboxHook } from "./types.ts";
import { Data, Effect } from "effect";
import {
  pluginLifecycleIdentity,
  pluginLifecycleProjection,
  type LinkedPluginLifecycle,
} from "../plugin/contracts.ts";

export interface SandboxLayerDeclarationSite {
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
  readonly expression?: string;
}

export interface LinkedSandboxLayerDeclarationSite {
  readonly file: string;
  readonly line: SandboxDeclaredValue<number>;
  readonly column: SandboxDeclaredValue<number>;
  readonly expression: SandboxDeclaredValue<string>;
}

export type SandboxDeclaredValue<Value> =
  | { readonly _tag: "Omitted" }
  | { readonly _tag: "Declared"; readonly value: Value };

export interface SandboxLayerContributionInput {
  readonly id: string;
  /** undefined 表示作者省略字段；显式 sandboxLayer() 与 undefined 不等价于 Direct Agent。 */
  readonly layer?: SandboxLayer;
  readonly declaredAt?: SandboxLayerDeclarationSite;
}

export interface SandboxLayerPairInput {
  readonly eval: SandboxLayerContributionInput;
  readonly group?: SandboxLayerContributionInput;
  readonly experiment: SandboxLayerContributionInput;
  readonly agent: {
    readonly kind: "direct" | "sandbox";
    readonly name: string;
    readonly sandbox?: SandboxLayer<"command-only">;
  };
}

export interface SandboxLayerOwnerRef {
  readonly kind: "eval" | "eval-group" | "experiment";
  readonly id: string;
}

export interface SandboxAgentOwnerRef {
  readonly kind: "agent";
  readonly id: string;
}

export type SandboxScheduleOwnerRef = SandboxLayerOwnerRef | SandboxAgentOwnerRef;

export interface SandboxDeclarationOrder {
  readonly owner: SandboxScheduleOwnerRef;
  readonly ordinal: number;
}

export interface SandboxBeforeDependencyProjection {
  readonly id: string;
  readonly source: "explicit" | "capability";
  readonly capability?: string;
}

export type SandboxCommandFingerprint =
  | {
      readonly kind: "stable";
      readonly owner: SandboxScheduleOwnerRef;
      readonly index: number;
      readonly id: string;
      readonly revision: string;
      readonly inputs: JsonValue;
    }
  | {
      readonly kind: "opaque";
      readonly owner: SandboxScheduleOwnerRef;
      readonly index: number;
    };

/** 生命周期函数本身不可序列化；这个 marker 只固定其 owner、phase 与追加位置。 */
export interface SandboxLifecycleFingerprint {
  readonly kind: "opaque";
  readonly owner: SandboxScheduleOwnerRef;
  readonly phase: "setup" | "teardown";
  readonly index: number;
}

export interface SandboxLayerDeclarationView {
  readonly owner: SandboxLayerOwnerRef;
  readonly explicit: boolean;
  readonly kind: SandboxLayerKind;
  readonly template: SandboxDeclaredValue<SandboxTemplateDeclaration>;
  readonly commands: readonly SandboxCommandFingerprint[];
  readonly declaredAt: SandboxDeclaredValue<LinkedSandboxLayerDeclarationSite>;
}

export type SandboxLinkIssueCode =
  | "sandbox.template-missing"
  | "sandbox.template-conflict"
  | "sandbox.unexpected-for-direct-agent"
  | "eval-group-direct-agent";

export interface SandboxLinkIssue {
  readonly code: SandboxLinkIssueCode;
  readonly pair: {
    readonly evalId: string;
    readonly experimentId: string;
    readonly agentKind: "direct" | "sandbox";
    readonly agentName: string;
  };
  readonly eval: SandboxLayerDeclarationView;
  readonly group?: SandboxLayerDeclarationView;
  readonly experiment: SandboxLayerDeclarationView;
  readonly summary: string;
  readonly actions: readonly string[];
}

export class SandboxLayerLinkError extends Data.TaggedError("SandboxLayerLinkError")<{
  readonly code: "sandbox.link-failed";
  readonly issues: readonly SandboxLinkIssue[];
  readonly message: string;
}> {}

export type SandboxBeforePlanningFailureReason =
  | "duplicate-action-id"
  | "duplicate-capability-provider"
  | "missing-dependency"
  | "missing-capability"
  | "dependency-cycle";

/** Author-declared DAG failures are planning failures, never Effect defects. */
export class SandboxBeforePlanningError extends Data.TaggedError("SandboxBeforePlanningError")<{
  readonly code: "sandbox.before-planning-failed";
  readonly reason: SandboxBeforePlanningFailureReason;
  readonly occurrencePath: readonly string[];
  /** Every action id directly involved in the failure, in stable declaration order. */
  readonly actionIds: readonly string[];
  readonly actionId?: string;
  readonly dependencyId?: string;
  readonly capability?: string;
  readonly providerActionIds?: readonly string[];
  readonly blockedActionIds?: readonly string[];
  readonly message: string;
}> {}

function beforePlanningError(input: Omit<
  ConstructorParameters<typeof SandboxBeforePlanningError>[0],
  "code" | "occurrencePath"
> & { readonly occurrencePath: readonly string[] }): SandboxBeforePlanningError {
  return new SandboxBeforePlanningError({
    code: "sandbox.before-planning-failed",
    ...input,
    occurrencePath: Object.freeze([...input.occurrencePath]),
    actionIds: Object.freeze([...input.actionIds]),
    ...(input.providerActionIds === undefined
      ? {}
      : { providerActionIds: Object.freeze([...input.providerActionIds]) }),
    ...(input.blockedActionIds === undefined
      ? {}
      : { blockedActionIds: Object.freeze([...input.blockedActionIds]) }),
  });
}

function sandboxLayerLinkError(issues: readonly SandboxLinkIssue[]): SandboxLayerLinkError {
  const frozen = Object.freeze([...issues]);
  const counts = new Map<SandboxLinkIssueCode, number>();
  for (const issue of frozen) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  const breakdown = [...counts].map(([code, count]) => `${code}=${count}`).join(", ");
  return new SandboxLayerLinkError({
    code: "sandbox.link-failed",
    issues: frozen,
    message:
      `Sandbox layer linking failed for ${frozen.length} pairs` +
      `${breakdown === "" ? "" : ` (${breakdown})`}. No Sandbox was created.`,
  });
}

function declarationSummary(view: SandboxLayerDeclarationView): string {
  const expression = view.declaredAt._tag === "Declared" && view.declaredAt.value.expression._tag === "Declared"
    ? view.declaredAt.value.expression.value
    : view.template._tag === "Declared"
      ? `${view.template.value.provider}:${view.template.value.kind}`
      : view.explicit ? "sandboxLayer()" : "<omitted>";
  const location = view.declaredAt._tag === "Omitted"
    ? "<unknown source>"
    : `${view.declaredAt.value.file}${
      view.declaredAt.value.line._tag === "Omitted" ? "" : `:${view.declaredAt.value.line.value}`
    }`;
  return `${expression} at ${location}`;
}

/** CLI 面向作者的聚合错误；不泄漏框架 stack，逐 pair 给出两处声明与可执行修法。 */
export function formatSandboxLayerLinkError(error: SandboxLayerLinkError): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    lines.push(`${issue.code}: ${issue.summary}`);
    lines.push(`  eval:       ${declarationSummary(issue.eval)}`);
    if (issue.group !== undefined) {
      lines.push(`  eval group: ${declarationSummary(issue.group)}`);
    }
    lines.push(`  experiment: ${declarationSummary(issue.experiment)}`);
    for (const action of issue.actions) lines.push(`  fix: ${action}`);
    lines.push("");
  }
  lines.push(`${error.issues.length} invalid pairs found. No Sandbox was created.`);
  return lines.join("\n");
}

export interface LinkedSandboxCommand {
  readonly owner: SandboxScheduleOwnerRef;
  /** 同一 owner layer 内从零开始的追加序号。 */
  readonly index: number;
  readonly command: SandboxCommand;
  readonly fingerprint: SandboxCommandFingerprint;
}

interface LinkedSandboxBeforeBase {
  readonly owner: SandboxScheduleOwnerRef;
  readonly ordinal: number;
  readonly id: string;
  readonly metadata: NormalizedSandboxBeforeMetadata;
  readonly fingerprint: SandboxCommandFingerprint;
}

export type LinkedSandboxBefore =
  | (LinkedSandboxBeforeBase & {
      readonly kind: "action";
      readonly data: SandboxActionData;
    })
  | (LinkedSandboxBeforeBase & {
      readonly kind: "command";
      readonly declaration: SandboxCommandDeclaration;
    })
  | (LinkedSandboxBeforeBase & {
      readonly kind: "hook";
      readonly hook: SandboxHook;
    });

export type LinkedSandboxAfter =
  | {
      readonly kind: "action";
      readonly owner: SandboxScheduleOwnerRef;
      readonly ordinal: number;
      readonly data: SandboxActionData;
      readonly fingerprint: SandboxCommandFingerprint;
    }
  | {
      readonly kind: "command";
      readonly owner: SandboxScheduleOwnerRef;
      readonly ordinal: number;
      readonly declaration: Extract<SandboxAfterDeclaration, { readonly kind: "command" }>;
      readonly fingerprint: SandboxCommandFingerprint;
    };

export type ScheduledSandboxBefore = LinkedSandboxBefore & {
  readonly dependencies: readonly SandboxBeforeDependencyProjection[];
  readonly executionOrder: {
    readonly topologicalOrdinal: number;
    readonly occurrencePath: readonly string[];
  };
  readonly schedulingReason: string;
};

export interface SandboxLayerFingerprintProjection {
  readonly version: 1;
  readonly templateOwner: SandboxLayerOwnerRef;
  readonly template: JsonValue;
  readonly commands: readonly SandboxCommandFingerprint[];
  readonly requirements?: readonly LinkedSandboxRequirement[];
  /** Ordered cleanup shape; opaque callbacks retain owner + ordinal without serializing closures. */
  readonly after?: readonly SandboxCommandFingerprint[];
  /** 有 hook 时才出现，避免把回调实现或闭包写入 record。 */
  readonly lifecycle?: readonly SandboxLifecycleFingerprint[];
  readonly plugins?: JsonValue;
}

export interface LinkedSandboxRequirement {
  readonly owner: SandboxScheduleOwnerRef;
  readonly requirement: SandboxRequirement;
}

export interface LinkedSandboxPluginLifecycle {
  readonly owner: SandboxLayerOwnerRef;
  readonly lifecycle: LinkedPluginLifecycle;
}

export interface LinkedSandboxPair {
  readonly kind: "sandbox";
  readonly evalId: string;
  readonly experimentId: string;
  readonly agentName: string;
  readonly templateOwner: SandboxLayerOwnerRef;
  readonly template: SandboxTemplateDeclaration;
  /** template owner 的 commands 在前，另一作者的 commands 在后。 */
  readonly commands: readonly LinkedSandboxCommand[];
  /** Provider-neutral physical requirements declared by Sandbox layers. */
  readonly requirements: readonly LinkedSandboxRequirement[];
  /** 所有作者声明的 action / stable command / opaque callback 经同一 DAG 排序。 */
  readonly before: readonly ScheduledSandboxBefore[];
  /** after 只登记，执行方按此数组逆序解释，不参与 before DAG。 */
  readonly after: readonly LinkedSandboxAfter[];
  /** 物理实例生命周期:template owner 在前,另一 layer 在后。回调不进 record,但保留 marker。 */
  readonly setupHooks: readonly SandboxHook[];
  readonly teardownHooks: readonly SandboxHook[];
  /** Physical lifecycle plugins, in flattened SandboxLayer order. */
  readonly pluginLifecycles: readonly LinkedSandboxPluginLifecycle[];
  /** Eval 自己声明 author hook 或 Sandbox Plugin lifecycle 时实例不得跨 Eval 共用。 */
  readonly hasEvalPhysicalLifecycle: boolean;
  readonly evalGroupId?: string;
  readonly fingerprint: SandboxLayerFingerprintProjection;
}

export interface LinkedDirectPair {
  readonly kind: "direct";
  readonly evalId: string;
  readonly experimentId: string;
  readonly agentName: string;
}

export type LinkedSandboxLayerPair = LinkedSandboxPair | LinkedDirectPair;

function commandFingerprintIdentity(entry: SandboxCommandFingerprint): JsonValue {
  return entry.kind === "stable"
    ? {
        kind: entry.kind,
        owner: { kind: entry.owner.kind, id: entry.owner.id },
        index: entry.index,
        id: entry.id,
        revision: entry.revision,
        inputs: entry.inputs,
      }
    : {
        kind: entry.kind,
        owner: { kind: entry.owner.kind, id: entry.owner.id },
        index: entry.index,
      };
}

/** Single owner-aware identity for every physical Sandbox lifecycle cohort. */
export function sandboxPhysicalLifecycleIdentity(pair: LinkedSandboxLayerPair): JsonValue {
  if (pair.kind === "direct") return Object.freeze({ kind: "direct" });
  const author: JsonValue[] = (pair.fingerprint.lifecycle ?? []).map((entry) => ({
    kind: entry.kind,
    owner: { kind: entry.owner.kind, id: entry.owner.id },
    phase: entry.phase,
    index: entry.index,
  }));
  return Object.freeze({
    author,
    ...((pair.fingerprint.after?.length ?? 0) === 0
      ? {}
      : { after: pair.fingerprint.after!.map(commandFingerprintIdentity) }),
    plugins: pair.fingerprint.plugins ?? [],
  });
}

/**
 * 把 linked pair 按作者重新投影成缓存身份。owner id 不进身份；所在文件的 id/源码分别由
 * experiment key 与 eval source closure 拥有。Experiment 投影进 configHash，Eval 投影进
 * 每条 fingerprint，templateOwner 由两者共同可重建。
 */
export function sandboxLayerIdentityFor(
  linked: LinkedSandboxLayerPair,
  ownerKind: SandboxScheduleOwnerRef["kind"],
): JsonValue {
  if (linked.kind === "direct") return { kind: "direct" };
  const ownsTemplate = linked.templateOwner.kind === ownerKind;
  const commands: JsonValue[] = linked.commands
    .filter((entry) => entry.owner.kind === ownerKind)
    .map((entry): JsonValue => entry.fingerprint.kind === "stable"
      ? {
          kind: "stable" as const,
          index: entry.index,
          id: entry.fingerprint.id,
          revision: entry.fingerprint.revision,
          inputs: entry.fingerprint.inputs,
        }
      : { kind: "opaque" as const, index: entry.index });
  const lifecycle = linked.fingerprint.lifecycle
    ?.filter((entry) => entry.owner.kind === ownerKind)
    .map((entry): JsonValue => ({ kind: entry.kind, phase: entry.phase, index: entry.index }));
  const after = (linked.fingerprint.after ?? [])
    .filter((entry) => entry.owner.kind === ownerKind)
    .map((entry): JsonValue => entry.kind === "stable"
      ? {
          kind: entry.kind,
          index: entry.index,
          id: entry.id,
          revision: entry.revision,
          inputs: entry.inputs,
        }
      : { kind: entry.kind, index: entry.index });
  const requirements = (linked.fingerprint.requirements ?? [])
    .filter((entry) => entry.owner.kind === ownerKind)
    .map((entry): JsonValue => ({
      _tag: entry.requirement._tag,
      docker: {
        api: entry.requirement.docker.api,
        compose: entry.requirement.docker.compose,
        isolation: entry.requirement.docker.isolation,
        minimumDataBytes: entry.requirement.docker.minimumDataBytes,
      },
    }));
  return {
    layer: ownsTemplate
      ? { _tag: "Template", value: sandboxTemplateIdentity(linked.template) }
      : { _tag: "CommandOnly" },
    commands,
    ...(requirements.length === 0 ? {} : { requirements }),
    ...(after.length === 0 ? {} : { after }),
    ...(lifecycle === undefined || lifecycle.length === 0 ? {} : { lifecycle }),
    ...(linked.pluginLifecycles.filter((entry) => entry.owner.kind === ownerKind).length === 0
      ? {}
      : { plugins: pluginLifecycleProjection(linked.pluginLifecycles.filter((entry) => entry.owner.kind === ownerKind).map((entry) => entry.lifecycle)) }),
  };
}

interface NormalizedContribution {
  readonly owner: SandboxLayerOwnerRef;
  readonly explicit: boolean;
  readonly state: SandboxLayerState;
  readonly view: SandboxLayerDeclarationView;
}

interface NormalizedScheduleContribution {
  readonly owner: SandboxScheduleOwnerRef;
  readonly explicit: boolean;
  readonly state: SandboxLayerState;
}

interface TemplateContribution extends NormalizedContribution {
  readonly state: SandboxLayerState<"template-bearing">;
}

const OMITTED_LAYER = sandboxLayer();

function freezeOwner(kind: SandboxLayerOwnerRef["kind"], id: string): SandboxLayerOwnerRef {
  return Object.freeze({ kind, id });
}

function declaredValue<Value>(value: Value | undefined): SandboxDeclaredValue<Value> {
  return value === undefined
    ? Object.freeze({ _tag: "Omitted" })
    : Object.freeze({ _tag: "Declared", value });
}

function freezeSite(
  site: SandboxLayerDeclarationSite | undefined,
): SandboxDeclaredValue<LinkedSandboxLayerDeclarationSite> {
  if (site === undefined) return Object.freeze({ _tag: "Omitted" });
  return Object.freeze({ _tag: "Declared", value: Object.freeze({
    file: site.file,
    line: declaredValue(site.line),
    column: declaredValue(site.column),
    expression: declaredValue(site.expression),
  }) });
}

function fingerprintCommand(
  owner: SandboxScheduleOwnerRef,
  index: number,
  declaration: SandboxCommandDeclaration,
): SandboxCommandFingerprint {
  if (declaration.kind === "opaque") return Object.freeze({ kind: "opaque", owner, index });
  return Object.freeze({
    kind: "stable",
    owner,
    index,
    id: declaration.identity.id,
    revision: declaration.identity.revision,
    inputs: sandboxCommandIdentityJson(declaration.identity.inputs),
  });
}

function actionFingerprint(
  owner: SandboxScheduleOwnerRef,
  index: number,
  data: SandboxActionData,
): SandboxCommandFingerprint {
  return Object.freeze({
    kind: "stable" as const,
    owner,
    index,
    id: data.metadata.id,
    revision: "sandbox-action/v1",
    inputs: {
      family: data.plan.family,
      state: data.plan.state,
      input: data.plan.input,
      steps: data.plan.steps,
      fingerprint: data.plan.fingerprint,
      scheduling: {
        changeFrequency: data.metadata.changeFrequency.value,
        dependsOn: data.metadata.dependsOn.map((reference) => reference.id),
        requires: [...data.metadata.requires],
        provides: [...data.metadata.provides],
      },
    } as unknown as JsonValue,
  });
}

function afterDeclarationFingerprint(
  owner: SandboxScheduleOwnerRef,
  ordinal: number,
  declaration: SandboxAfterDeclaration,
): SandboxCommandFingerprint {
  if (declaration.kind === "action") {
    return actionFingerprint(owner, ordinal, sandboxAfterActionDataOf(declaration.action));
  }
  return Object.freeze({ kind: "opaque" as const, owner, index: ordinal });
}

function generatedBeforeId(owner: SandboxScheduleOwnerRef, ordinal: number): string {
  return `${owner.kind}:${owner.id}:before:${ordinal}`;
}

function beforeFromDeclaration(
  owner: SandboxScheduleOwnerRef,
  ordinal: number,
  declaration: SandboxBeforeDeclaration,
): LinkedSandboxBefore {
  if (declaration.kind === "action") {
    const data = sandboxActionDataOf(declaration.action);
    return Object.freeze({
      kind: "action" as const,
      owner,
      ordinal,
      id: data.metadata.id,
      metadata: data.metadata,
      data,
      fingerprint: actionFingerprint(owner, ordinal, data),
    });
  }
  if (declaration.kind === "hook") {
    const id = generatedBeforeId(owner, ordinal);
    return Object.freeze({
      kind: "hook" as const,
      owner,
      ordinal,
      id,
      metadata: normalizeSandboxBeforeMetadata({ id }),
      hook: declaration.hook,
      fingerprint: Object.freeze({ kind: "opaque" as const, owner, index: ordinal }),
    });
  }
  const command = declaration.declaration;
  const explicit = command.kind === "stable" && command.metadata.explicitId;
  const id = explicit ? command.identity.id : generatedBeforeId(owner, ordinal);
  const metadata = command.kind === "stable"
    ? Object.freeze({ ...command.metadata.scheduling, id })
    : normalizeSandboxBeforeMetadata({ id });
  return Object.freeze({
    kind: "command" as const,
    owner,
    ordinal,
    id,
    metadata,
    declaration: command,
    fingerprint: fingerprintCommand(owner, ordinal, command),
  });
}

/** @internal Agent ensure uses the same command declaration/link path as author-owned before entries. */
export function linkSandboxCommandBefore(
  owner: SandboxScheduleOwnerRef,
  ordinal: number,
  command: SandboxCommand,
): LinkedSandboxBefore {
  return beforeFromDeclaration(owner, ordinal, Object.freeze({
    kind: "command" as const,
    declaration: sandboxCommandDeclarationOf(command),
  }));
}

function fingerprintLifecycle(
  owner: SandboxScheduleOwnerRef,
  phase: SandboxLifecycleFingerprint["phase"],
  hooks: readonly SandboxHook[],
): readonly SandboxLifecycleFingerprint[] {
  return Object.freeze(hooks.map((_, index) => Object.freeze({
    kind: "opaque" as const,
    owner,
    phase,
    index,
  })));
}

function normalizeAgentContribution(
  input: SandboxLayerPairInput["agent"],
): NormalizedScheduleContribution {
  const owner = Object.freeze({ kind: "agent" as const, id: input.name });
  const state = sandboxLayerStateOf(input.sandbox ?? OMITTED_LAYER);
  if (state.kind !== "command-only") {
    throw new TypeError("Sandbox Agent layers must be command-only and cannot provide a template");
  }
  return Object.freeze({ owner, explicit: input.sandbox !== undefined, state });
}

function normalizeContribution(
  kind: SandboxLayerOwnerRef["kind"],
  input: SandboxLayerContributionInput,
): NormalizedContribution {
  const owner = freezeOwner(kind, input.id);
  const explicit = input.layer !== undefined;
  const state = sandboxLayerStateOf(input.layer ?? OMITTED_LAYER);
  const commands = Object.freeze(
    state.before.map((declaration, index) =>
      beforeFromDeclaration(owner, index, declaration).fingerprint),
  );
  const template: SandboxDeclaredValue<SandboxTemplateDeclaration> = state.kind === "template-bearing"
    ? declaredValue(state.template)
    : Object.freeze({ _tag: "Omitted" });
  const view = Object.freeze({
    owner,
    explicit,
    kind: state.kind,
    template,
    commands,
    declaredAt: freezeSite(input.declaredAt),
  });
  return Object.freeze({ owner, explicit, state, view });
}

/** Stable identity of one author-owned layer, before it is linked with the other owners. */
export function sandboxLayerDefinitionIdentity(layer: SandboxLayer | undefined): JsonValue {
  const contribution = normalizeContribution("eval-group", { id: "<definition>", layer });
  const commands: JsonValue[] = contribution.view.commands.map((command): JsonValue => command.kind === "stable"
    ? {
        kind: "stable",
        index: command.index,
        id: command.id,
        revision: command.revision,
        inputs: command.inputs,
      }
    : { kind: "opaque", index: command.index });
  const lifecycle: JsonValue[] = [
    ...fingerprintLifecycle(contribution.owner, "setup", contribution.state.setupHooks),
    ...fingerprintLifecycle(contribution.owner, "teardown", contribution.state.teardownHooks),
  ].map((entry) => ({ kind: entry.kind, phase: entry.phase, index: entry.index }));
  const after: JsonValue[] = contribution.state.after.map((declaration, ordinal): JsonValue => {
    const entry = afterDeclarationFingerprint(contribution.owner, ordinal, declaration);
    return entry.kind === "stable"
      ? { kind: entry.kind, index: entry.index, id: entry.id, revision: entry.revision, inputs: entry.inputs }
      : { kind: entry.kind, index: entry.index };
  });
  return {
    layer: contribution.state.kind === "template-bearing"
      ? { _tag: "Template", value: sandboxTemplateIdentity(contribution.state.template) }
      : { _tag: "CommandOnly" },
    commands,
    ...(after.length === 0 ? {} : { after }),
    ...(lifecycle.length === 0 ? {} : { lifecycle }),
  };
}

function pairRef(input: SandboxLayerPairInput): SandboxLinkIssue["pair"] {
  return Object.freeze({
    evalId: input.eval.id,
    experimentId: input.experiment.id,
    agentKind: input.agent.kind,
    agentName: input.agent.name,
  });
}

function isTemplateContribution(
  contribution: NormalizedContribution,
): contribution is TemplateContribution {
  return contribution.state.kind === "template-bearing";
}

function issue(
  code: SandboxLinkIssueCode,
  pair: SandboxLinkIssue["pair"],
  evalContribution: NormalizedContribution,
  experimentContribution: NormalizedContribution,
  groupContribution?: NormalizedContribution,
): SandboxLinkIssue {
  const group = groupContribution === undefined ? {} : { group: groupContribution.view };
  if (code === "sandbox.template-missing") {
    return Object.freeze({
      code,
      pair,
      eval: evalContribution.view,
      ...group,
      experiment: experimentContribution.view,
      summary: groupContribution === undefined
        ? `Eval "${pair.evalId}" and Experiment "${pair.experimentId}" do not declare a Sandbox template.`
        : `Eval Group "${groupContribution.owner.id}", Eval "${pair.evalId}", and Experiment "${pair.experimentId}" do not declare a Sandbox template.`,
      actions: Object.freeze([
        groupContribution === undefined
          ? "Declare one template-bearing SandboxLayer on the Eval or Experiment."
          : "Declare one template-bearing SandboxLayer on the Eval Group or Experiment; grouped Eval members may only contribute prepare commands.",
        "If this pairing is unintended, change the Experiment selector so the pair is not linked.",
      ]),
    });
  }
  if (code === "sandbox.template-conflict") {
    return Object.freeze({
      code,
      pair,
      eval: evalContribution.view,
      ...group,
      experiment: experimentContribution.view,
      summary: groupContribution === undefined
        ? `Eval "${pair.evalId}" and Experiment "${pair.experimentId}" both declare a Sandbox template.`
        : `Eval Group "${groupContribution.owner.id}", Eval "${pair.evalId}", and Experiment "${pair.experimentId}" declare more than one Sandbox template.`,
      actions: Object.freeze([
        "Keep exactly one template-bearing layer; NiceEval starts one Sandbox Case and does not merge or prioritize templates.",
        "If only some combinations are compatible, split the Experiment selector.",
      ]),
    });
  }
  if (code === "eval-group-direct-agent") {
    return Object.freeze({
      code,
      pair,
      eval: evalContribution.view,
      ...group,
      experiment: experimentContribution.view,
      summary: `Eval Group "${groupContribution!.owner.id}" cannot run with Direct Agent "${pair.agentName}".`,
      actions: Object.freeze([
        "Use a Sandbox Agent for every Experiment that selects this Eval Group.",
        "If the Experiment must stay direct, change its selector so it does not select grouped Evals.",
      ]),
    });
  }
  return Object.freeze({
    code,
    pair,
    eval: evalContribution.view,
    ...group,
    experiment: experimentContribution.view,
    summary: `Direct Agent "${pair.agentName}" cannot use an explicit SandboxLayer.`,
    actions: Object.freeze([
      "Remove every explicit Eval/Experiment sandbox declaration for this pairing.",
      "If the task needs Sandbox operations, use a Sandbox Agent instead.",
    ]),
  });
}

const OWNER_ORDER: Readonly<Record<SandboxScheduleOwnerRef["kind"], number>> = Object.freeze({
  experiment: 0,
  "eval-group": 1,
  eval: 2,
  agent: 3,
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareReady(left: LinkedSandboxBefore, right: LinkedSandboxBefore): number {
  return left.metadata.changeFrequency.value - right.metadata.changeFrequency.value ||
    OWNER_ORDER[left.owner.kind] - OWNER_ORDER[right.owner.kind] ||
    compareText(left.owner.id, right.owner.id) ||
    left.ordinal - right.ordinal;
}

/** @internal Pure Kahn scheduler shared by link and debug planning; it never invokes declarations. */
export function scheduleSandboxBefore(
  entries: readonly LinkedSandboxBefore[],
  occurrencePath: readonly string[],
): Effect.Effect<readonly ScheduledSandboxBefore[], SandboxBeforePlanningError> {
  return Effect.suspend(() => {
    const byId = new Map<string, LinkedSandboxBefore>();
    for (const entry of entries) {
      if (byId.has(entry.id)) {
        return Effect.fail(beforePlanningError({
          reason: "duplicate-action-id",
          occurrencePath,
          actionIds: [entry.id],
          actionId: entry.id,
          message: `sandbox.before-planning-failed (duplicate-action-id): action ${JSON.stringify(entry.id)} is declared more than once`,
        }));
      }
      byId.set(entry.id, entry);
    }

    const capabilityProviders = new Map<string, LinkedSandboxBefore>();
    for (const entry of entries) {
      for (const capability of entry.metadata.provides) {
        const previous = capabilityProviders.get(capability);
        if (previous !== undefined) {
          const providerActionIds = [previous.id, entry.id];
          return Effect.fail(beforePlanningError({
            reason: "duplicate-capability-provider",
            occurrencePath,
            actionIds: providerActionIds,
            capability,
            providerActionIds,
            message: `sandbox.before-planning-failed (duplicate-capability-provider): capability ${JSON.stringify(capability)} is provided by ${providerActionIds.map((id) => JSON.stringify(id)).join(" and ")}`,
          }));
        }
        capabilityProviders.set(capability, entry);
      }
    }

    const dependencies = new Map<string, SandboxBeforeDependencyProjection[]>();
    const outgoing = new Map<string, Set<string>>();
    const indegree = new Map(entries.map((entry) => [entry.id, 0]));
    const addEdge = (
      dependency: LinkedSandboxBefore,
      dependent: LinkedSandboxBefore,
      projection: SandboxBeforeDependencyProjection,
    ): void => {
      const targets = outgoing.get(dependency.id) ?? new Set<string>();
      if (!targets.has(dependent.id)) {
        targets.add(dependent.id);
        outgoing.set(dependency.id, targets);
        indegree.set(dependent.id, (indegree.get(dependent.id) ?? 0) + 1);
      }
      const projections = dependencies.get(dependent.id) ?? [];
      projections.push(Object.freeze(projection));
      dependencies.set(dependent.id, projections);
    };

    for (const entry of entries) {
      for (const reference of entry.metadata.dependsOn) {
        const dependency = byId.get(reference.id);
        if (dependency === undefined) {
          return Effect.fail(beforePlanningError({
            reason: "missing-dependency",
            occurrencePath,
            actionIds: [entry.id, reference.id],
            actionId: entry.id,
            dependencyId: reference.id,
            message: `sandbox.before-planning-failed (missing-dependency): action ${JSON.stringify(entry.id)} depends on missing action ${JSON.stringify(reference.id)}`,
          }));
        }
        addEdge(dependency, entry, { id: dependency.id, source: "explicit" });
      }
      for (const capability of entry.metadata.requires) {
        const dependency = capabilityProviders.get(capability);
        if (dependency === undefined) {
          return Effect.fail(beforePlanningError({
            reason: "missing-capability",
            occurrencePath,
            actionIds: [entry.id],
            actionId: entry.id,
            capability,
            message: `sandbox.before-planning-failed (missing-capability): action ${JSON.stringify(entry.id)} requires missing capability ${JSON.stringify(capability)}`,
          }));
        }
        addEdge(dependency, entry, { id: dependency.id, source: "capability", capability });
      }
    }

    const ready = entries.filter((entry) => indegree.get(entry.id) === 0).sort(compareReady);
    const ordered: ScheduledSandboxBefore[] = [];
    while (ready.length > 0) {
      const entry = ready.shift()!;
      const entryDependencies = Object.freeze([...(dependencies.get(entry.id) ?? [])]);
      const frequency: SandboxChangeFrequency = entry.metadata.changeFrequency;
      ordered.push(Object.freeze({
        ...entry,
        dependencies: entryDependencies,
        executionOrder: Object.freeze({
          topologicalOrdinal: ordered.length,
          occurrencePath: Object.freeze([...occurrencePath]),
        }),
        schedulingReason: entryDependencies.length === 0
          ? `ready-set frequency=${frequency.value}; owner=${entry.owner.kind}:${entry.owner.id}; ordinal=${entry.ordinal}`
          : `dependencies satisfied (${entryDependencies.map((dependency) => dependency.id).join(", ")}); ` +
            `ready-set frequency=${frequency.value}; owner=${entry.owner.kind}:${entry.owner.id}; ordinal=${entry.ordinal}`,
      }));
      for (const dependentId of outgoing.get(entry.id) ?? []) {
        const remaining = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, remaining);
        if (remaining === 0) ready.push(byId.get(dependentId)!);
      }
      ready.sort(compareReady);
    }
    if (ordered.length !== entries.length) {
      const blocked = entries.filter((entry) => (indegree.get(entry.id) ?? 0) > 0).map((entry) => entry.id);
      return Effect.fail(beforePlanningError({
        reason: "dependency-cycle",
        occurrencePath,
        actionIds: blocked,
        blockedActionIds: blocked,
        message: `sandbox.before-planning-failed (dependency-cycle): blocked actions ${blocked.map((id) => JSON.stringify(id)).join(", ")}`,
      }));
    }
    return Effect.succeed(Object.freeze(ordered));
  });
}

function linkedBefore(
  contributions: readonly NormalizedScheduleContribution[],
  occurrencePath: readonly string[],
): Effect.Effect<readonly ScheduledSandboxBefore[], SandboxBeforePlanningError> {
  const entries = contributions.flatMap((contribution) =>
    contribution.state.before.map((declaration, ordinal) =>
      beforeFromDeclaration(contribution.owner, ordinal, declaration)));
  return scheduleSandboxBefore(entries, occurrencePath);
}

function linkedAfter(contributions: readonly NormalizedScheduleContribution[]): readonly LinkedSandboxAfter[] {
  return Object.freeze(contributions.flatMap((contribution) =>
    contribution.state.after.map((declaration, ordinal): LinkedSandboxAfter => declaration.kind === "action"
      ? Object.freeze({
          kind: "action" as const,
          owner: contribution.owner,
          ordinal,
          data: sandboxAfterActionDataOf(declaration.action),
          fingerprint: afterDeclarationFingerprint(contribution.owner, ordinal, declaration),
        })
      : Object.freeze({
          kind: "command" as const,
          owner: contribution.owner,
          ordinal,
          declaration,
          fingerprint: afterDeclarationFingerprint(contribution.owner, ordinal, declaration),
        }))));
}

function linkedCommands(
  first: NormalizedScheduleContribution,
  ...rest: readonly NormalizedScheduleContribution[]
): {
  readonly commands: readonly LinkedSandboxCommand[];
} {
  const commands: LinkedSandboxCommand[] = [];
  for (const contribution of [first, ...rest]) {
    contribution.state.commands.forEach((declaration, index) => {
      const fingerprint = fingerprintCommand(contribution.owner, index, declaration);
      commands.push(Object.freeze({ owner: contribution.owner, index, command: declaration.command, fingerprint }));
    });
  }
  return Object.freeze({ commands: Object.freeze(commands) });
}

function linkSandboxPair(
  pair: SandboxLinkIssue["pair"],
  templateOwner: TemplateContribution,
  otherOwners: readonly NormalizedContribution[],
  agentOwner: NormalizedScheduleContribution,
): Effect.Effect<LinkedSandboxPair, SandboxBeforePlanningError> {
  const template = templateOwner.state.template;
  const linked = linkedCommands(templateOwner, ...otherOwners, agentOwner);
  const scheduleContributions: NormalizedScheduleContribution[] = [templateOwner, ...otherOwners, agentOwner];
  const declarationContributions = [...scheduleContributions].sort((left, right) =>
    OWNER_ORDER[left.owner.kind] - OWNER_ORDER[right.owner.kind] ||
    compareText(left.owner.id, right.owner.id));
  const after = linkedAfter(declarationContributions);
  const lifecycle = Object.freeze([
    ...fingerprintLifecycle(templateOwner.owner, "setup", templateOwner.state.setupHooks),
    ...otherOwners.flatMap((owner) => fingerprintLifecycle(owner.owner, "setup", owner.state.setupHooks)),
    ...fingerprintLifecycle(agentOwner.owner, "setup", agentOwner.state.setupHooks),
    ...fingerprintLifecycle(templateOwner.owner, "teardown", templateOwner.state.teardownHooks),
    ...otherOwners.flatMap((owner) => fingerprintLifecycle(owner.owner, "teardown", owner.state.teardownHooks)),
    ...fingerprintLifecycle(agentOwner.owner, "teardown", agentOwner.state.teardownHooks),
  ]);
  const requirements = Object.freeze(declarationContributions.flatMap((contribution) =>
    contribution.state.requirements.map((requirement) => Object.freeze({
      owner: contribution.owner,
      requirement,
    }))));
  return Effect.map(
    linkedBefore(declarationContributions, [pair.experimentId, pair.evalId, "attempt"]),
    (before): LinkedSandboxPair => {
      const fingerprints = Object.freeze(before.map((entry) => entry.fingerprint));
      const afterFingerprints = Object.freeze(after.map((entry) => entry.fingerprint));
      const fingerprint = Object.freeze({
        version: 1 as const,
        templateOwner: templateOwner.owner,
        template: sandboxTemplateIdentity(template),
        commands: fingerprints,
        ...(requirements.length === 0 ? {} : { requirements }),
        ...(afterFingerprints.length === 0 ? {} : { after: afterFingerprints }),
        ...(lifecycle.length === 0 ? {} : { lifecycle }),
      });
      return Object.freeze({
        kind: "sandbox",
        evalId: pair.evalId,
        experimentId: pair.experimentId,
        agentName: pair.agentName,
        templateOwner: templateOwner.owner,
        template,
        commands: linked.commands,
        requirements,
        before,
        after,
        setupHooks: Object.freeze([
          ...templateOwner.state.setupHooks,
          ...otherOwners.flatMap((owner) => owner.state.setupHooks),
          ...agentOwner.state.setupHooks,
        ]),
        teardownHooks: Object.freeze([
          ...templateOwner.state.teardownHooks,
          ...otherOwners.flatMap((owner) => owner.state.teardownHooks),
          ...agentOwner.state.teardownHooks,
        ]),
        pluginLifecycles: Object.freeze([]),
        hasEvalPhysicalLifecycle: [templateOwner, ...otherOwners].some((owner) => owner.owner.kind === "eval" && owner.state.setupHooks.length + owner.state.teardownHooks.length > 0),
        ...([templateOwner, ...otherOwners].find((owner) => owner.owner.kind === "eval-group") === undefined
          ? {}
          : { evalGroupId: [templateOwner, ...otherOwners].find((owner) => owner.owner.kind === "eval-group")!.owner.id }),
        fingerprint,
      });
    },
  );
}

/** @internal Attach automatically projected Plugin sandbox fragments after author layer linking. */
export function attachSandboxPluginLifecycles(
  pair: LinkedSandboxLayerPair,
  byOwner: Readonly<Partial<Record<SandboxLayerOwnerRef["kind"], readonly LinkedPluginLifecycle[]>>>,
): LinkedSandboxLayerPair {
  if (pair.kind === "direct") return pair;
  const ownerOrder: readonly SandboxLayerOwnerRef["kind"][] = pair.templateOwner.kind === "eval"
    ? ["eval", "experiment"]
    : pair.templateOwner.kind === "eval-group"
      ? ["eval-group", "experiment", "eval"]
      : ["experiment", "eval-group", "eval"];
  const entries = Object.freeze(ownerOrder.flatMap((kind) => (byOwner[kind] ?? []).map((lifecycle) => Object.freeze({
    owner: kind === "eval"
      ? Object.freeze({ kind, id: pair.evalId })
      : kind === "eval-group"
        ? Object.freeze({ kind, id: pair.evalGroupId! })
        : Object.freeze({ kind, id: pair.experimentId }),
    lifecycle,
  }))));
  if (entries.length === 0) return pair;
  const plugins: JsonValue[] = entries.map((entry) => ({
    owner: { kind: entry.owner.kind, id: entry.owner.id },
    lifecycle: pluginLifecycleIdentity(entry.lifecycle),
  }));
  return Object.freeze({
    ...pair,
    pluginLifecycles: entries,
    hasEvalPhysicalLifecycle:
      pair.hasEvalPhysicalLifecycle || entries.some((entry) => entry.owner.kind === "eval"),
    fingerprint: Object.freeze({
      ...pair.fingerprint,
      plugins,
    }),
  });
}

/**
 * 对 discovery/selector 产出的实际 pair 全矩阵做一次纯 link。发现任何问题时遍历完全部输入后
 * 通过 Effect error channel 返回聚合错误；调用方因此可以在任何 Provider I/O 前一次展示全部修法。
 */
export function linkSandboxLayers(
  pairs: readonly SandboxLayerPairInput[],
): Effect.Effect<readonly LinkedSandboxLayerPair[], SandboxLayerLinkError | SandboxBeforePlanningError> {
  return Effect.suspend((): Effect.Effect<
    readonly LinkedSandboxLayerPair[],
    SandboxLayerLinkError | SandboxBeforePlanningError
  > => {
    const linked: Array<Effect.Effect<LinkedSandboxLayerPair, SandboxBeforePlanningError>> = [];
    const issues: SandboxLinkIssue[] = [];

    for (const input of pairs) {
      const pair = pairRef(input);
      const evalContribution = normalizeContribution("eval", input.eval);
      const experimentContribution = normalizeContribution("experiment", input.experiment);
      const groupContribution = input.group === undefined ? undefined : normalizeContribution("eval-group", input.group);
      const agentContribution = normalizeAgentContribution(input.agent);

      if (pair.agentKind === "direct") {
        if (groupContribution !== undefined) {
          issues.push(issue("eval-group-direct-agent", pair, evalContribution, experimentContribution, groupContribution));
        } else if (evalContribution.explicit || experimentContribution.explicit) {
          issues.push(issue("sandbox.unexpected-for-direct-agent", pair, evalContribution, experimentContribution));
        } else {
          linked.push(Effect.succeed(Object.freeze({
            kind: "direct",
            evalId: pair.evalId,
            experimentId: pair.experimentId,
            agentName: pair.agentName,
          })));
        }
        continue;
      }

      const contributions = [experimentContribution, ...(groupContribution === undefined ? [] : [groupContribution]), evalContribution];
      const templates = contributions.filter(isTemplateContribution);
      if (templates.length === 0) {
        issues.push(issue("sandbox.template-missing", pair, evalContribution, experimentContribution, groupContribution));
      } else if (templates.length > 1) {
        issues.push(issue("sandbox.template-conflict", pair, evalContribution, experimentContribution, groupContribution));
      } else {
        const template = templates[0]!;
        const ordered = template.owner.kind === "eval-group"
          ? [template, experimentContribution, evalContribution]
          : template.owner.kind === "experiment"
            ? [template, ...(groupContribution === undefined ? [] : [groupContribution]), evalContribution]
            : [template, experimentContribution];
        linked.push(linkSandboxPair(
          pair,
          template,
          ordered.filter((owner) => owner !== template),
          agentContribution,
        ));
      }
    }

    return issues.length > 0
      ? Effect.fail(sandboxLayerLinkError(issues))
      : Effect.map(Effect.all(linked), (values) => Object.freeze(values));
  });
}
