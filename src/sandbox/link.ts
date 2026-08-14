// discovery + selector 之后的纯 SandboxLayer linker。
// 本模块只读 factory 产物，不读文件、不访问网络、不调用 Provider，也不创建 Sandbox。

import {
  sandboxCommandIdentityJson,
  type SandboxCommand,
  type SandboxCommandDeclaration,
} from "./commands.ts";
import {
  sandboxLayer,
  sandboxLayerStateOf,
  sandboxTemplateIdentity,
  type SandboxLayer,
  type SandboxLayerKind,
  type SandboxLayerState,
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
  };
}

export interface SandboxLayerOwnerRef {
  readonly kind: "eval" | "eval-group" | "experiment";
  readonly id: string;
}

export type SandboxCommandFingerprint =
  | {
      readonly kind: "stable";
      readonly owner: SandboxLayerOwnerRef;
      readonly index: number;
      readonly id: string;
      readonly revision: string;
      readonly inputs: JsonValue;
    }
  | {
      readonly kind: "opaque";
      readonly owner: SandboxLayerOwnerRef;
      readonly index: number;
    };

/** 生命周期函数本身不可序列化；这个 marker 只固定其 owner、phase 与追加位置。 */
export interface SandboxLifecycleFingerprint {
  readonly kind: "opaque";
  readonly owner: SandboxLayerOwnerRef;
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

function sandboxLayerLinkError(issues: readonly SandboxLinkIssue[]): SandboxLayerLinkError {
  const frozen = Object.freeze([...issues]);
  const counts = new Map<SandboxLinkIssueCode, number>();
  for (const issue of frozen) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  const breakdown = [...counts].map(([code, count]) => `${code}=${count}`).join(", ");
  return new SandboxLayerLinkError({
    code: "sandbox.link-failed",
    issues: frozen,
    message:
      `Sandbox layer linking failed for ${frozen.length} pair${frozen.length === 1 ? "" : "s"}` +
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
  lines.push(`${error.issues.length} invalid pair${error.issues.length === 1 ? "" : "s"} found. No Sandbox was created.`);
  return lines.join("\n");
}

export interface LinkedSandboxCommand {
  readonly owner: SandboxLayerOwnerRef;
  /** 同一 owner layer 内从零开始的追加序号。 */
  readonly index: number;
  readonly command: SandboxCommand;
  readonly fingerprint: SandboxCommandFingerprint;
}

export interface SandboxLayerFingerprintProjection {
  readonly version: 1;
  readonly templateOwner: SandboxLayerOwnerRef;
  readonly template: JsonValue;
  readonly commands: readonly SandboxCommandFingerprint[];
  /** 有 hook 时才出现，避免把回调实现或闭包写入 record。 */
  readonly lifecycle?: readonly SandboxLifecycleFingerprint[];
  readonly plugins?: JsonValue;
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
  ownerKind: SandboxLayerOwnerRef["kind"],
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
  return {
    layer: ownsTemplate
      ? { _tag: "Template", value: sandboxTemplateIdentity(linked.template) }
      : { _tag: "CommandOnly" },
    commands,
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
  owner: SandboxLayerOwnerRef,
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

function fingerprintLifecycle(
  owner: SandboxLayerOwnerRef,
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

function normalizeContribution(
  kind: SandboxLayerOwnerRef["kind"],
  input: SandboxLayerContributionInput,
): NormalizedContribution {
  const owner = freezeOwner(kind, input.id);
  const explicit = input.layer !== undefined;
  const state = sandboxLayerStateOf(input.layer ?? OMITTED_LAYER);
  const commands = Object.freeze(
    state.commands.map((declaration, index) => fingerprintCommand(owner, index, declaration)),
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
  return {
    layer: contribution.state.kind === "template-bearing"
      ? { _tag: "Template", value: sandboxTemplateIdentity(contribution.state.template) }
      : { _tag: "CommandOnly" },
    commands,
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

function linkedCommands(
  first: NormalizedContribution,
  ...rest: readonly NormalizedContribution[]
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
): LinkedSandboxPair {
  const template = templateOwner.state.template;
  const linked = linkedCommands(templateOwner, ...otherOwners);
  const fingerprints = Object.freeze(linked.commands.map((entry) => entry.fingerprint));
  const lifecycle = Object.freeze([
    ...fingerprintLifecycle(templateOwner.owner, "setup", templateOwner.state.setupHooks),
    ...otherOwners.flatMap((owner) => fingerprintLifecycle(owner.owner, "setup", owner.state.setupHooks)),
    ...fingerprintLifecycle(templateOwner.owner, "teardown", templateOwner.state.teardownHooks),
    ...otherOwners.flatMap((owner) => fingerprintLifecycle(owner.owner, "teardown", owner.state.teardownHooks)),
  ]);
  const fingerprint = Object.freeze({
    version: 1 as const,
    templateOwner: templateOwner.owner,
    template: sandboxTemplateIdentity(template),
    commands: fingerprints,
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
    setupHooks: Object.freeze([...templateOwner.state.setupHooks, ...otherOwners.flatMap((owner) => owner.state.setupHooks)]),
    teardownHooks: Object.freeze([...templateOwner.state.teardownHooks, ...otherOwners.flatMap((owner) => owner.state.teardownHooks)]),
    pluginLifecycles: Object.freeze([]),
    hasEvalPhysicalLifecycle: [templateOwner, ...otherOwners].some((owner) => owner.owner.kind === "eval" && owner.state.setupHooks.length + owner.state.teardownHooks.length > 0),
    ...([templateOwner, ...otherOwners].find((owner) => owner.owner.kind === "eval-group") === undefined
      ? {}
      : { evalGroupId: [templateOwner, ...otherOwners].find((owner) => owner.owner.kind === "eval-group")!.owner.id }),
    fingerprint,
  });
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
): Effect.Effect<readonly LinkedSandboxLayerPair[], SandboxLayerLinkError> {
  return Effect.suspend(() => {
    const linked: LinkedSandboxLayerPair[] = [];
    const issues: SandboxLinkIssue[] = [];

    for (const input of pairs) {
      const pair = pairRef(input);
      const evalContribution = normalizeContribution("eval", input.eval);
      const experimentContribution = normalizeContribution("experiment", input.experiment);
      const groupContribution = input.group === undefined ? undefined : normalizeContribution("eval-group", input.group);

      if (pair.agentKind === "direct") {
        if (groupContribution !== undefined) {
          issues.push(issue("eval-group-direct-agent", pair, evalContribution, experimentContribution, groupContribution));
        } else if (evalContribution.explicit || experimentContribution.explicit) {
          issues.push(issue("sandbox.unexpected-for-direct-agent", pair, evalContribution, experimentContribution));
        } else {
          linked.push(Object.freeze({
            kind: "direct",
            evalId: pair.evalId,
            experimentId: pair.experimentId,
            agentName: pair.agentName,
          }));
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
        linked.push(linkSandboxPair(pair, template, ordered.filter((owner) => owner !== template)));
      }
    }

    return issues.length > 0
      ? Effect.fail(sandboxLayerLinkError(issues))
      : Effect.succeed(Object.freeze(linked));
  });
}
