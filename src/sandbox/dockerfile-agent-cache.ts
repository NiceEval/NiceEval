// Dockerfile task image 的内置 staged Agent 派生镜像缓存。
// 这里只提供内部协调边界；Runner 后续把它接到 DockerfileProviderPlan 的 materialize 前。

import { digestOf, type BuildKey } from "./identity.ts";
import { AGENT_DOCKERFILE_CACHE_SAFE, type DockerfileAgentCacheSafeInstaller } from "../agents/cache-marker.ts";
import type { AgentEnsure, AgentIdentity, AgentInstaller } from "../agents/types.ts";
import type { RunTimingRecorder } from "../runner/timing.ts";

export const DOCKERFILE_AGENT_DERIVED_MATERIALIZER_REVISION = "dockerfile-agent-1";

export interface DockerfileAgentCacheRequest {
  readonly taskLocator: string;
  readonly platform: string;
  readonly ensure: AgentEnsure;
  readonly installer: AgentInstaller;
}

export interface DockerfileAgentDerivedImageBuildInput {
  readonly taskLocator: string;
  readonly derivedLocator: string;
  readonly derivedKey: BuildKey;
  readonly platform: string;
  readonly ensureIdentity: AgentIdentity;
  readonly installerIdentity: AgentIdentity;
  readonly installMode: "staged";
}

export interface DockerfileAgentCacheHooks {
  readonly imageExists: (locator: string) => Promise<boolean>;
}

export type DockerfileAgentDerivedImageBuilder = (
  input: DockerfileAgentDerivedImageBuildInput,
  signal: AbortSignal,
) => Promise<void>;

export type DockerfileAgentCacheResolution =
  | { readonly status: "unsupported"; readonly locator: string }
  | {
      readonly status: "hit" | "built";
      readonly locator: string;
      readonly derivedKey: BuildKey;
    };

export function isDockerfileAgentCacheSafeInstaller(
  installer: AgentInstaller,
): installer is Extract<AgentInstaller, { readonly installMode: "staged" }> & DockerfileAgentCacheSafeInstaller {
  return installer.installMode === "staged" && installer[AGENT_DOCKERFILE_CACHE_SAFE] === true;
}

/** Derived key 不读取 installer 闭包、prepare 或任何 credentials，只认稳定身份投影。 */
export function dockerfileAgentDerivedKey(input: DockerfileAgentCacheRequest): BuildKey {
  return digestOf({
    materializerRevision: DOCKERFILE_AGENT_DERIVED_MATERIALIZER_REVISION,
    taskLocator: input.taskLocator,
    platform: input.platform,
    ensure: {
      agent: input.ensure.identity.agent,
      version: input.ensure.identity.version,
      revision: input.ensure.identity.revision,
    },
    installer: {
      agent: input.installer.identity.agent,
      version: input.installer.identity.version,
      revision: input.installer.identity.revision,
      mode: input.installer.installMode,
    },
  });
}

export function dockerfileAgentDerivedLocator(derivedKey: BuildKey): string {
  return `niceeval-agent:${derivedKey.slice(0, 32)}`;
}

export class DockerfileAgentImageCoordinator {
  private readonly inflight = new Map<BuildKey, Promise<DockerfileAgentCacheResolution>>();

  constructor(private readonly hooks: DockerfileAgentCacheHooks) {}

  resolve(
    input: DockerfileAgentCacheRequest,
    signal: AbortSignal,
    build: DockerfileAgentDerivedImageBuilder,
    timing?: RunTimingRecorder,
  ): Promise<DockerfileAgentCacheResolution> {
    if (!isDockerfileAgentCacheSafeInstaller(input.installer)) {
      return Promise.resolve({ status: "unsupported", locator: input.taskLocator });
    }

    const derivedKey = dockerfileAgentDerivedKey(input);
    const pending = this.inflight.get(derivedKey);
    if (pending !== undefined) return pending;

    const derivedLocator = dockerfileAgentDerivedLocator(derivedKey);
    const run = (async (): Promise<DockerfileAgentCacheResolution> => {
      const hit = await timedCacheActivity(
        timing,
        "sandbox.build.lookup",
        `agent image lookup ${derivedLocator}`,
        () => this.hooks.imageExists(derivedLocator),
      );
      if (hit) {
        return { status: "hit", locator: derivedLocator, derivedKey };
      }
      await timedCacheActivity(
        timing,
        "sandbox.build.agent",
        `agent image build ${derivedLocator}`,
        () => build({
          taskLocator: input.taskLocator,
          derivedLocator,
          derivedKey,
          platform: input.platform,
          ensureIdentity: input.ensure.identity,
          installerIdentity: input.installer.identity,
          installMode: "staged",
        }, signal),
      );
      return { status: "built", locator: derivedLocator, derivedKey };
    })().finally(() => {
      this.inflight.delete(derivedKey);
    });
    this.inflight.set(derivedKey, run);
    return run;
  }
}

async function timedCacheActivity<T>(
  timing: RunTimingRecorder | undefined,
  key: "sandbox.build.lookup" | "sandbox.build.agent",
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  if (timing === undefined) return run();
  const startOffsetMs = timing.offsetNow();
  try {
    const result = await run();
    timing.child({
      key,
      label,
      startOffsetMs,
      durationMs: Math.max(0, timing.offsetNow() - startOffsetMs),
    });
    return result;
  } catch (error) {
    timing.child({
      key,
      label,
      startOffsetMs,
      durationMs: Math.max(0, timing.offsetNow() - startOffsetMs),
      failed: true,
    });
    throw error;
  }
}
