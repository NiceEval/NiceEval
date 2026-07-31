// Run 级 BuildKey 自动收集:从 PlannedSandboxCase / composeBuildWorksFromPlan 抽出
// 仍需 fresh 的 works,供 prepareSandboxBuilds 与 dockerComposeBuildProvider 消费。

import { dirname } from "node:path";
import { planSandboxCase, type PlannedSandboxCase } from "../sandbox/case.ts";
import { composeBuildWorksFromPlan, dockerComposeBuildProvider } from "../sandbox/compose.ts";
import type { SandboxBuildProvider, SandboxBuildWork } from "../sandbox/build-coordinator.ts";
import {
  collectDockerfileBuildFromPlan,
  dockerfileBuildProvider,
  routeBuildProviders,
  type DockerfileBuildCollection,
} from "../sandbox/dockerfile-build.ts";
import type { BuildKey } from "../sandbox/identity.ts";
import type { DiscoveredEval, SandboxOption } from "../types.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";
import type { AgentRun, RunOptions } from "./types.ts";

export interface CollectedBuildPreparation {
  readonly works: readonly SandboxBuildWork[];
  readonly evalBuildKeys: Readonly<globalThis.Record<string, readonly string[]>>;
  readonly provider: SandboxBuildProvider;
  /** evalId → 规划期 CaseKey(指纹 / attempt 可追溯)。 */
  readonly caseKeys: ReadonlyMap<string, string>;
  /** evalId → 规划好的 case(物化前可复用)。 */
  readonly plans: ReadonlyMap<string, PlannedSandboxCase>;
}

/**
 * 携带规划后,为仍有 fresh attempt 的 eval 收集 Compose / on-demand BuildKey。
 * 完全携带的 (experiment, eval) 不进 works、不造假 provenance。
 */
export async function collectBuildPreparation(opts: {
  readonly evals: readonly DiscoveredEval[];
  readonly agentRuns: readonly AgentRun[];
  readonly configSandbox?: SandboxOption;
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  /** 测试可注入假 provider;省略时 Compose works 用 dockerComposeBuildProvider。 */
  readonly provider?: SandboxBuildProvider;
  readonly providerBaseDir?: string;
}): Promise<CollectedBuildPreparation | undefined> {
  const worksByKey = new Map<BuildKey, SandboxBuildWork>();
  const evalBuildKeys = new Map<string, string[]>();
  const caseKeys = new Map<string, string>();
  const plans = new Map<string, PlannedSandboxCase>();
  let composeBaseDir: string | undefined;
  let composeEnv: Readonly<globalThis.Record<string, string>> | undefined;
  let hasComposeWorks = false;
  const dockerfileCollections: DockerfileBuildCollection[] = [];

  for (const run of opts.agentRuns) {
    if (run.agent.kind !== "sandbox") continue;
    const spec = run.sandbox ?? opts.configSandbox;
    if (spec === undefined) continue;

    for (const evalDef of selectedEvalsForRun(opts.evals as DiscoveredEval[], run)) {
      const carryKey = `${run.experimentId ?? ""}|${evalDef.id}`;
      const carried = opts.carriedAttemptsByKey.get(carryKey);
      if (carried !== undefined && carried.size >= run.attempts) continue;

      const planned = planSandboxCase({
        evalId: evalDef.id,
        environment: evalDef.environment,
        ...(evalDef.defaultProfileId !== undefined ? { defaultProfileId: evalDef.defaultProfileId } : {}),
        spec,
      });
      if (planned.status !== "ready") continue;

      plans.set(evalDef.id, planned.plan);
      if (planned.plan.caseKind === "on-demand-build") {
        const collection = await collectDockerfileBuildFromPlan(planned.plan, { baseDir: evalDef.baseDir });
        if (collection === undefined) {
          caseKeys.set(evalDef.id, planned.plan.caseKey);
          continue;
        }
        dockerfileCollections.push(collection);
        caseKeys.set(evalDef.id, collection.caseKey);
        if (!worksByKey.has(collection.buildKey)) worksByKey.set(collection.buildKey, collection.work);
        const keys = evalBuildKeys.get(evalDef.id) ?? [];
        if (!keys.includes(collection.buildKey)) keys.push(collection.buildKey);
        evalBuildKeys.set(evalDef.id, keys);
        continue;
      }

      caseKeys.set(evalDef.id, planned.plan.caseKey);
      if (planned.plan.caseKind !== "compose" && planned.plan.caseKind !== "cloud-compose") {
        continue;
      }

      const collection = await composeBuildWorksFromPlan(planned.plan, {
        baseDir: evalDef.baseDir,
      });
      if (collection === undefined || collection.works.length === 0) continue;

      hasComposeWorks = true;
      composeBaseDir = evalDef.baseDir;
      const decl =
        planned.plan.declaration.form === "docker" && planned.plan.declaration.value.compose
          ? planned.plan.declaration.value.compose
          : planned.plan.declaration.form === "source" && planned.plan.declaration.value.kind === "compose"
            ? planned.plan.declaration.value
            : undefined;
      if (decl && "env" in decl && decl.env !== undefined) composeEnv = decl.env;

      const keys = evalBuildKeys.get(evalDef.id) ?? [];
      for (const work of collection.works) {
        if (!worksByKey.has(work.buildKey)) worksByKey.set(work.buildKey, work);
        if (!keys.includes(work.buildKey)) keys.push(work.buildKey);
      }
      evalBuildKeys.set(evalDef.id, keys);
    }
  }

  if (worksByKey.size === 0) {
    if (caseKeys.size === 0) return undefined;
    return {
      works: [],
      evalBuildKeys: {},
      provider: opts.provider ?? noopBuildProvider(),
      caseKeys,
      plans,
    };
  }

  const provider = opts.provider ?? providerForCollectedBuilds({
    works: [...worksByKey.values()],
    dockerfileCollections,
    hasComposeWorks,
    composeBaseDir: opts.providerBaseDir ?? composeBaseDir ?? process.cwd(),
    composeEnv,
  });

  return {
    works: [...worksByKey.values()],
    evalBuildKeys: Object.fromEntries(evalBuildKeys),
    provider,
    caseKeys,
    plans,
  };
}

function providerForCollectedBuilds(opts: {
  readonly works: readonly SandboxBuildWork[];
  readonly dockerfileCollections: readonly DockerfileBuildCollection[];
  readonly hasComposeWorks: boolean;
  readonly composeBaseDir: string;
  readonly composeEnv?: Readonly<globalThis.Record<string, string>>;
}): SandboxBuildProvider {
  const routes = new Map<BuildKey, SandboxBuildProvider>();
  if (opts.dockerfileCollections.length > 0) {
    const provider = dockerfileBuildProvider(opts.dockerfileCollections);
    for (const collection of opts.dockerfileCollections) routes.set(collection.buildKey, provider);
  }
  if (opts.hasComposeWorks) {
    const provider = dockerComposeBuildProvider({
      baseDir: opts.composeBaseDir,
      ...(opts.composeEnv !== undefined ? { env: opts.composeEnv } : {}),
    });
    for (const work of opts.works) {
      if (!routes.has(work.buildKey)) routes.set(work.buildKey, provider);
    }
  }
  return routes.size > 0 ? routeBuildProviders(routes) : noopBuildProvider();
}

/** 把收集结果压成 RunOptions.buildPreparation(works 为空时仍可只带 caseKeys 经旁路下发)。 */
export function toBuildPreparation(
  collected: CollectedBuildPreparation,
): NonNullable<RunOptions["buildPreparation"]> | undefined {
  if (collected.works.length === 0) return undefined;
  return {
    works: collected.works,
    evalBuildKeys: collected.evalBuildKeys,
    provider: collected.provider,
  };
}

function noopBuildProvider(): SandboxBuildProvider {
  return {
    async lookup() {
      return undefined;
    },
    async build(work) {
      throw new Error(
        `no sandbox build provider for BuildKey ${JSON.stringify(work.buildKey)} — ` +
          `inject buildPreparation.provider or use a Compose-capable docker sandbox`,
      );
    },
  };
}

/** 测试辅助:Compose 文件所在目录。 */
export function composeFileDir(file: string): string {
  return dirname(file);
}
