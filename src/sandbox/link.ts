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
  type SandboxLayer,
  type SandboxLayerKind,
  type SandboxTemplateDeclaration,
} from "./layer.ts";
import type { JsonValue } from "../shared/types.ts";

export interface SandboxLayerDeclarationSite {
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
  readonly expression?: string;
}

export interface SandboxLayerContributionInput {
  readonly id: string;
  /** undefined 表示作者省略字段；显式 sandboxLayer() 与 undefined 不等价于 Direct Agent。 */
  readonly layer?: SandboxLayer;
  readonly declaredAt?: SandboxLayerDeclarationSite;
}

export interface SandboxLayerPairInput {
  readonly eval: SandboxLayerContributionInput;
  readonly experiment: SandboxLayerContributionInput;
  readonly agent: {
    readonly kind: "direct" | "sandbox";
    readonly name: string;
  };
}

export interface SandboxLayerOwnerRef {
  readonly kind: "eval" | "experiment";
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

export interface SandboxLayerDeclarationView {
  readonly owner: SandboxLayerOwnerRef;
  readonly explicit: boolean;
  readonly kind: SandboxLayerKind;
  readonly template?: SandboxTemplateDeclaration;
  readonly commands: readonly SandboxCommandFingerprint[];
  readonly declaredAt?: SandboxLayerDeclarationSite;
}

export type SandboxLinkIssueCode =
  | "sandbox.template-missing"
  | "sandbox.template-conflict"
  | "sandbox.unexpected-for-direct-agent";

export interface SandboxLinkIssue {
  readonly code: SandboxLinkIssueCode;
  readonly pair: {
    readonly evalId: string;
    readonly experimentId: string;
    readonly agentKind: "direct" | "sandbox";
    readonly agentName: string;
  };
  readonly eval: SandboxLayerDeclarationView;
  readonly experiment: SandboxLayerDeclarationView;
  readonly summary: string;
  readonly actions: readonly string[];
}

export class SandboxLayerLinkError extends Error {
  readonly code = "sandbox.link-failed" as const;
  readonly issues: readonly SandboxLinkIssue[];

  constructor(issues: readonly SandboxLinkIssue[]) {
    const counts = new Map<SandboxLinkIssueCode, number>();
    for (const issue of issues) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    const breakdown = [...counts].map(([code, count]) => `${code}=${count}`).join(", ");
    super(
      `Sandbox layer linking failed for ${issues.length} pair${issues.length === 1 ? "" : "s"}` +
        `${breakdown === "" ? "" : ` (${breakdown})`}. No Sandbox was created.`,
    );
    this.name = "SandboxLayerLinkError";
    this.issues = Object.freeze([...issues]);
  }
}

export interface LinkedSandboxCommand {
  readonly owner: SandboxLayerOwnerRef;
  /** 同一 owner layer 内从零开始的追加序号。 */
  readonly index: number;
  readonly command: SandboxCommand;
  readonly fingerprint: SandboxCommandFingerprint;
}

export interface SandboxCarryIneligibility {
  readonly code: "sandbox.command-opaque";
  readonly owner: SandboxLayerOwnerRef;
  readonly commandIndex: number;
  readonly reason: string;
}

export interface SandboxLayerFingerprintProjection {
  readonly version: 1;
  readonly templateOwner: SandboxLayerOwnerRef;
  readonly template: SandboxTemplateDeclaration;
  readonly commands: readonly SandboxCommandFingerprint[];
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
  readonly fingerprint: SandboxLayerFingerprintProjection;
  readonly carryEligible: boolean;
  readonly carryIneligibleReasons: readonly SandboxCarryIneligibility[];
}

export interface LinkedDirectPair {
  readonly kind: "direct";
  readonly evalId: string;
  readonly experimentId: string;
  readonly agentName: string;
}

export type LinkedSandboxLayerPair = LinkedSandboxPair | LinkedDirectPair;

interface NormalizedContribution {
  readonly owner: SandboxLayerOwnerRef;
  readonly explicit: boolean;
  readonly state: ReturnType<typeof sandboxLayerStateOf>;
  readonly view: SandboxLayerDeclarationView;
}

const OMITTED_LAYER = sandboxLayer();

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function freezeOwner(kind: SandboxLayerOwnerRef["kind"], id: string): SandboxLayerOwnerRef {
  return Object.freeze({ kind, id: nonEmpty(id, `${kind}.id`) });
}

function freezeSite(site: SandboxLayerDeclarationSite | undefined): SandboxLayerDeclarationSite | undefined {
  if (site === undefined) return undefined;
  const result = {
    file: nonEmpty(site.file, "sandbox declaration file"),
    ...(site.line !== undefined ? { line: site.line } : {}),
    ...(site.column !== undefined ? { column: site.column } : {}),
    ...(site.expression !== undefined ? { expression: site.expression } : {}),
  };
  if (result.line !== undefined && (!Number.isInteger(result.line) || result.line <= 0)) {
    throw new TypeError("sandbox declaration line must be a positive integer");
  }
  if (result.column !== undefined && (!Number.isInteger(result.column) || result.column <= 0)) {
    throw new TypeError("sandbox declaration column must be a positive integer");
  }
  return Object.freeze(result);
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
  const view = Object.freeze({
    owner,
    explicit,
    kind: state.kind,
    ...(state.template !== undefined ? { template: state.template } : {}),
    commands,
    ...(input.declaredAt !== undefined ? { declaredAt: freezeSite(input.declaredAt) } : {}),
  });
  return Object.freeze({ owner, explicit, state, view });
}

function pairRef(input: SandboxLayerPairInput): SandboxLinkIssue["pair"] {
  if (input.agent.kind !== "direct" && input.agent.kind !== "sandbox") {
    throw new TypeError('agent.kind must be "direct" or "sandbox"');
  }
  return Object.freeze({
    evalId: nonEmpty(input.eval.id, "eval.id"),
    experimentId: nonEmpty(input.experiment.id, "experiment.id"),
    agentKind: input.agent.kind,
    agentName: nonEmpty(input.agent.name, "agent.name"),
  });
}

function issue(
  code: SandboxLinkIssueCode,
  pair: SandboxLinkIssue["pair"],
  evalContribution: NormalizedContribution,
  experimentContribution: NormalizedContribution,
): SandboxLinkIssue {
  if (code === "sandbox.template-missing") {
    return Object.freeze({
      code,
      pair,
      eval: evalContribution.view,
      experiment: experimentContribution.view,
      summary: `Eval "${pair.evalId}" and Experiment "${pair.experimentId}" do not declare a Sandbox template.`,
      actions: Object.freeze([
        "Declare one template-bearing SandboxLayer on the Eval or Experiment.",
        "If this pairing is unintended, change the Experiment selector so the pair is not linked.",
      ]),
    });
  }
  if (code === "sandbox.template-conflict") {
    return Object.freeze({
      code,
      pair,
      eval: evalContribution.view,
      experiment: experimentContribution.view,
      summary: `Eval "${pair.evalId}" and Experiment "${pair.experimentId}" both declare a Sandbox template.`,
      actions: Object.freeze([
        "Remove one template-bearing layer; NiceEval starts one Sandbox Case and does not merge or prioritize templates.",
        "If only some combinations are compatible, split the Experiment selector.",
      ]),
    });
  }
  return Object.freeze({
    code,
    pair,
    eval: evalContribution.view,
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
  second: NormalizedContribution,
): {
  readonly commands: readonly LinkedSandboxCommand[];
  readonly reasons: readonly SandboxCarryIneligibility[];
} {
  const commands: LinkedSandboxCommand[] = [];
  const reasons: SandboxCarryIneligibility[] = [];
  for (const contribution of [first, second]) {
    contribution.state.commands.forEach((declaration, index) => {
      const fingerprint = fingerprintCommand(contribution.owner, index, declaration);
      commands.push(Object.freeze({ owner: contribution.owner, index, command: declaration.command, fingerprint }));
      if (declaration.kind === "opaque") {
        reasons.push(Object.freeze({
          code: "sandbox.command-opaque",
          owner: contribution.owner,
          commandIndex: index,
          reason:
            `${contribution.owner.kind} "${contribution.owner.id}" prepare command #${index + 1} is an opaque callback; ` +
            "wrap it with defineSandboxCommand({ id, revision, inputs }, run) to enable cross-Run carry.",
        }));
      }
    });
  }
  return Object.freeze({ commands: Object.freeze(commands), reasons: Object.freeze(reasons) });
}

function linkSandboxPair(
  pair: SandboxLinkIssue["pair"],
  evalContribution: NormalizedContribution,
  experimentContribution: NormalizedContribution,
): LinkedSandboxPair {
  const evalOwnsTemplate = evalContribution.state.kind === "template-bearing";
  const templateOwner = evalOwnsTemplate ? evalContribution : experimentContribution;
  const otherOwner = evalOwnsTemplate ? experimentContribution : evalContribution;
  const template = templateOwner.state.template;
  if (template === undefined) throw new Error("internal SandboxLayer link invariant: legal pair has no template");
  const linked = linkedCommands(templateOwner, otherOwner);
  const fingerprints = Object.freeze(linked.commands.map((entry) => entry.fingerprint));
  const fingerprint = Object.freeze({
    version: 1 as const,
    templateOwner: templateOwner.owner,
    template,
    commands: fingerprints,
  });
  return Object.freeze({
    kind: "sandbox",
    evalId: pair.evalId,
    experimentId: pair.experimentId,
    agentName: pair.agentName,
    templateOwner: templateOwner.owner,
    template,
    commands: linked.commands,
    fingerprint,
    carryEligible: linked.reasons.length === 0,
    carryIneligibleReasons: linked.reasons,
  });
}

/**
 * 对 discovery/selector 产出的实际 pair 全矩阵做一次纯 link。发现任何问题时遍历完全部输入后
 * 统一抛出 SandboxLayerLinkError；调用方因此可以在任何 Provider I/O 前一次展示全部修法。
 */
export function linkSandboxLayers(pairs: readonly SandboxLayerPairInput[]): readonly LinkedSandboxLayerPair[] {
  const linked: LinkedSandboxLayerPair[] = [];
  const issues: SandboxLinkIssue[] = [];

  for (const input of pairs) {
    const pair = pairRef(input);
    const evalContribution = normalizeContribution("eval", input.eval);
    const experimentContribution = normalizeContribution("experiment", input.experiment);

    if (pair.agentKind === "direct") {
      if (evalContribution.explicit || experimentContribution.explicit) {
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

    const templateCount = Number(evalContribution.state.kind === "template-bearing") +
      Number(experimentContribution.state.kind === "template-bearing");
    if (templateCount === 0) {
      issues.push(issue("sandbox.template-missing", pair, evalContribution, experimentContribution));
    } else if (templateCount === 2) {
      issues.push(issue("sandbox.template-conflict", pair, evalContribution, experimentContribution));
    } else {
      linked.push(linkSandboxPair(pair, evalContribution, experimentContribution));
    }
  }

  if (issues.length > 0) throw new SandboxLayerLinkError(issues);
  return Object.freeze(linked);
}
