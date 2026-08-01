// SandboxLayer 的统一规划边界：discovery + selector 后做一次 pure link，再把 template
// 窄适配给存量 provider/case 内核。check / --dry / run 都消费 AgentRun.linkedSandboxes，
// 不在后续阶段重新挑 template。

import { resolve } from "node:path";
import { Cause, Effect, Exit, Option } from "effect";
import {
  dockerSandbox as legacyDockerSandbox,
  e2bSandbox as legacyE2BSandbox,
  localSandbox as legacyLocalSandbox,
  vercelSandbox as legacyVercelSandbox,
} from "../define.ts";
import { composeSandbox, dockerfileSandbox, isSandboxSource } from "../sandbox/case.ts";
import { dockerComposeMaterializer } from "../sandbox/compose.ts";
import { isSandboxLayer, type SandboxLocation, type SandboxTemplateDeclaration } from "../sandbox/layer.ts";
import {
  linkSandboxLayers,
  type LinkedSandboxLayerPair,
  type LinkedSandboxPair,
  type SandboxLayerPairInput,
} from "../sandbox/link.ts";
import { sandboxRecommendedConcurrency, sandboxRunInfo } from "../sandbox/resolve.ts";
import type { SandboxOption } from "../sandbox/types.ts";
import type { AgentRun, DiscoveredEval, PlannedSandboxPair, SandboxRunInfo } from "./types.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";

/** environments 表是存量 provider spec 的内部数据字段；只服务未迁移测试夹具。 */
function specEnvironments(spec: SandboxOption): Readonly<globalThis.Record<string, globalThis.Record<string, unknown>>> | undefined {
  const environments = (spec as { environments?: unknown }).environments;
  if (typeof environments !== "object" || environments === null) return undefined;
  return environments as Readonly<globalThis.Record<string, globalThis.Record<string, unknown>>>;
}

function deriveSpec(spec: SandboxOption, profile: string): SandboxOption | undefined {
  const override = specEnvironments(spec)?.[profile];
  if (override === undefined) return undefined;
  return { ...spec, ...override } as SandboxOption;
}

function missingEnvironmentsError(run: AgentRun, missing: ReadonlyArray<readonly [string, string]>): Error {
  const entries = missing.map(([id, profile]) => `  ${id} -> ${JSON.stringify(profile)}`).join("\n");
  return new Error(
    `sandbox spec for experiment ${JSON.stringify(run.experimentId ?? run.agent.name)} has no environments entry for:\n${entries}`,
  );
}

function isLegacySandboxSpec(value: unknown): value is SandboxOption {
  return value !== null && typeof value === "object" && !isSandboxLayer(value) && typeof (value as { provider?: unknown }).provider === "string";
}

function localLocation(location: SandboxLocation, baseDir: string): string | URL {
  if (location.kind === "url") return new URL(location.value);
  return resolve(baseDir, location.value);
}

function physicalPlanForTemplate(
  linked: LinkedSandboxPair,
  evalDef: DiscoveredEval,
  run: AgentRun,
): PlannedSandboxPair {
  const baseDir = linked.templateOwner.kind === "eval"
    ? evalDef.baseDir
    : (run.experimentBaseDir ?? process.cwd());
  const template: SandboxTemplateDeclaration = linked.template;

  if (template.provider === "docker" && template.kind === "compose") {
    const environment = composeSandbox({
      file: localLocation(template.file, baseDir),
      mainService: template.workspaceService,
      ...(template.build !== undefined ? { build: template.build } : {}),
      ...(template.executionUser !== undefined ? { executionUser: template.executionUser } : {}),
      ...(template.env !== undefined ? { env: template.env } : {}),
    });
    return {
      linked,
      sandboxSpec: legacyDockerSandbox({
        materializers: { compose: dockerComposeMaterializer({ baseDir }) },
      }),
      environment,
    };
  }

  if (template.provider === "docker" && template.kind === "dockerfile") {
    return {
      linked,
      sandboxSpec: legacyDockerSandbox(),
      environment: dockerfileSandbox({
        context: localLocation(template.context, baseDir),
        ...(template.dockerfile !== undefined ? { dockerfile: template.dockerfile } : {}),
        ...(template.buildArgs !== undefined ? { buildArgs: template.buildArgs } : {}),
      }),
    };
  }

  if (template.provider === "docker" && template.kind === "image") {
    return { linked, sandboxSpec: legacyDockerSandbox({ image: template.image }) };
  }
  if (template.provider === "e2b") {
    return {
      linked,
      sandboxSpec: legacyE2BSandbox({
        template: template.template,
        ...(template.lifetimeMs !== undefined ? { lifetimeMs: template.lifetimeMs } : {}),
      }),
    };
  }
  if (template.provider === "vercel") {
    return {
      linked,
      sandboxSpec: legacyVercelSandbox({
        snapshotId: template.snapshotId,
        ...(template.lifetimeMs !== undefined ? { lifetimeMs: template.lifetimeMs } : {}),
      }),
    };
  }
  if (template.provider === "local") {
    return {
      linked,
      sandboxSpec: legacyLocalSandbox({
        ...(template.dir !== undefined ? { dir: resolve(baseDir, template.dir) } : {}),
      }),
    };
  }
  const exhaustive: never = template;
  throw new Error(`unsupported linked Sandbox template: ${JSON.stringify(exhaustive)}`);
}

function legacySandboxForEval(run: AgentRun, evalDef: DiscoveredEval, fallback?: SandboxOption): SandboxOption | undefined {
  const authored = isLegacySandboxSpec(run.sandbox) ? run.sandbox : undefined;
  const spec = authored ?? fallback;
  if (spec === undefined || evalDef.environment === undefined) return spec;
  const cached = run.resolvedSandboxes?.get(evalDef.id);
  if (cached !== undefined) return cached;
  if (isSandboxSource(evalDef.environment) || (typeof evalDef.environment === "object" && evalDef.environment !== null)) {
    const cache = run.resolvedSandboxes ?? new Map<string, SandboxOption>();
    cache.set(evalDef.id, spec);
    run.resolvedSandboxes = cache;
    return spec;
  }
  const derived = deriveSpec(spec, evalDef.environment);
  if (derived === undefined) throw missingEnvironmentsError(run, [[evalDef.id, evalDef.environment]]);
  const cache = run.resolvedSandboxes ?? new Map<string, SandboxOption>();
  cache.set(evalDef.id, derived);
  run.resolvedSandboxes = cache;
  return derived;
}

/** 该 Eval x Experiment 配对唯一的物理 spec；选择权威仍是 linked pair。 */
export function sandboxForEval(run: AgentRun, evalDef: DiscoveredEval, fallback?: SandboxOption): SandboxOption | undefined {
  const planned = run.linkedSandboxes?.get(evalDef.id);
  if (planned !== undefined) return planned.sandboxSpec;
  return legacySandboxForEval(run, evalDef, fallback);
}

export function sandboxEnvironmentForEval(run: AgentRun, evalDef: DiscoveredEval): DiscoveredEval["environment"] {
  return run.linkedSandboxes?.get(evalDef.id)?.environment ?? evalDef.environment;
}

export function linkedSandboxForEval(run: AgentRun, evalDef: DiscoveredEval): LinkedSandboxLayerPair | undefined {
  return run.linkedSandboxes?.get(evalDef.id)?.linked;
}

/** 只做 discovery + selector 后的纯 link；check 在这里停止。 */
export function linkRunSandboxes(evals: DiscoveredEval[], runs: AgentRun[], fallback?: SandboxOption): void {
  const inputs: SandboxLayerPairInput[] = [];
  const owners: Array<{ run: AgentRun; evalDef: DiscoveredEval }> = [];

  for (const run of runs) {
    const selected = selectedEvalsForRun(evals, run);
    const legacy = isLegacySandboxSpec(run.sandbox) || fallback !== undefined;
    if (legacy) {
      if (run.agent.kind === "direct") continue;
      const spec = isLegacySandboxSpec(run.sandbox) ? run.sandbox : fallback;
      if (spec === undefined) continue;
      const missing: Array<readonly [string, string]> = [];
      for (const evalDef of selected) {
        if (evalDef.environment === undefined || typeof evalDef.environment !== "string") {
          legacySandboxForEval(run, evalDef, fallback);
          continue;
        }
        if (deriveSpec(spec, evalDef.environment) === undefined) missing.push([evalDef.id, evalDef.environment]);
        else legacySandboxForEval(run, evalDef, fallback);
      }
      if (missing.length > 0) throw missingEnvironmentsError(run, missing);
      continue;
    }

    for (const evalDef of selected) {
      if (run.linkedSandboxes?.has(evalDef.id)) continue;
      inputs.push({
        eval: {
          id: evalDef.id,
          layer: evalDef.sandbox,
          declaredAt: { file: evalDef.sourcePath },
        },
        experiment: {
          id: run.experimentId ?? run.agent.name,
          layer: isSandboxLayer(run.sandbox) ? run.sandbox : undefined,
          ...(run.experimentSourcePath !== undefined
            ? { declaredAt: { file: run.experimentSourcePath } }
            : {}),
        },
        agent: { kind: run.agent.kind, name: run.agent.name },
      });
      owners.push({ run, evalDef });
    }
  }

  if (inputs.length === 0) return;
  const exit = Effect.runSyncExit(linkSandboxLayers(inputs));
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    if (Option.isSome(failure)) throw failure.value;
    throw Cause.squash(exit.cause);
  }
  const linked = exit.value;
  linked.forEach((pair, index) => {
    const owner = owners[index]!;
    const map = owner.run.linkedSandboxes ?? new Map<string, PlannedSandboxPair>();
    map.set(owner.evalDef.id, { linked: pair });
    owner.run.linkedSandboxes = map;
  });
}

/**
 * 所有非 check 入口在同一份 pure-link matrix 上补物理适配。这个阶段不能重新选择 template。
 * fallback 仅保留给存量内部单测；公开 Config 已不再拥有 sandbox。
 */
export function prepareRunSandboxes(evals: DiscoveredEval[], runs: AgentRun[], fallback?: SandboxOption): void {
  linkRunSandboxes(evals, runs, fallback);
  for (const run of runs) {
    for (const evalDef of selectedEvalsForRun(evals, run)) {
      const existing = run.linkedSandboxes?.get(evalDef.id);
      if (existing === undefined || existing.linked.kind === "direct" || existing.sandboxSpec !== undefined) continue;
      run.linkedSandboxes!.set(
        evalDef.id,
        physicalPlanForTemplate(existing.linked, evalDef, run),
      );
    }
  }
}

/** 结果记录按 Eval 投影真实 linked template；混合数据集不虚构一个 Experiment 级默认。 */
export function sandboxProjection(run: AgentRun, fallback?: SandboxOption): {
  sandbox?: SandboxRunInfo;
  sandboxByEval?: globalThis.Record<string, SandboxRunInfo>;
} {
  if (run.agent.kind !== "sandbox") return {};
  if (run.linkedSandboxes !== undefined) {
    const sandboxByEval: globalThis.Record<string, SandboxRunInfo> = {};
    for (const [evalId, pair] of [...run.linkedSandboxes].sort(([a], [b]) => a.localeCompare(b))) {
      const info = sandboxRunInfo(pair.sandboxSpec);
      if (info !== undefined) sandboxByEval[evalId] = info;
    }
    return Object.keys(sandboxByEval).length > 0 ? { sandboxByEval } : {};
  }
  const authored = isLegacySandboxSpec(run.sandbox) ? run.sandbox : fallback;
  const sandbox = sandboxRunInfo(authored);
  const sandboxByEval: globalThis.Record<string, SandboxRunInfo> = {};
  for (const [evalId, derived] of [...(run.resolvedSandboxes ?? new Map())].sort(([a], [b]) => a.localeCompare(b))) {
    const info = sandboxRunInfo(derived);
    if (info !== undefined) sandboxByEval[evalId] = info;
  }
  return {
    ...(sandbox !== undefined ? { sandbox } : {}),
    ...(Object.keys(sandboxByEval).length > 0 ? { sandboxByEval } : {}),
  };
}

export function resolvedSandboxRecommendedConcurrency(
  evals: DiscoveredEval[],
  runs: AgentRun[],
  fallback?: SandboxOption,
): number {
  prepareRunSandboxes(evals, runs, fallback);
  const recommendations: number[] = [];
  for (const run of runs) {
    if (run.agent.kind !== "sandbox") continue;
    for (const evalDef of selectedEvalsForRun(evals, run)) {
      recommendations.push(sandboxRecommendedConcurrency(sandboxForEval(run, evalDef, fallback)));
    }
  }
  return recommendations.length > 0 ? Math.min(...recommendations) : 10;
}
