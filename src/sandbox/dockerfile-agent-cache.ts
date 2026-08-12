// Dockerfile task image 的内置 staged Agent 派生镜像缓存。
// 这里只提供内部协调边界；Runner 后续把它接到 DockerfileProviderPlan 的 materialize 前。

import { Deferred, Effect, Exit } from "effect";
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
  readonly imageExists: (locator: string) => Effect.Effect<boolean, Error>;
}

export type DockerfileAgentDerivedImageBuilder = (
  input: DockerfileAgentDerivedImageBuildInput,
  signal: AbortSignal,
) => Effect.Effect<void, Error>;

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
  private readonly inflight = new Map<
    BuildKey,
    Deferred.Deferred<DockerfileAgentCacheResolution, Error>
  >();

  constructor(private readonly hooks: DockerfileAgentCacheHooks) {}

  resolve(
    input: DockerfileAgentCacheRequest,
    signal: AbortSignal,
    build: DockerfileAgentDerivedImageBuilder,
    timing?: RunTimingRecorder,
  ): Effect.Effect<DockerfileAgentCacheResolution, Error> {
    if (!isDockerfileAgentCacheSafeInstaller(input.installer)) {
      return Effect.succeed({ status: "unsupported", locator: input.taskLocator });
    }

    const derivedKey = dockerfileAgentDerivedKey(input);
    const derivedLocator = dockerfileAgentDerivedLocator(derivedKey);
    const imageExists = this.hooks.imageExists;
    return Effect.gen(this, function* () {
      const fresh = yield* Deferred.make<DockerfileAgentCacheResolution, Error>();
      // 读取和登记在一个 synchronous Effect 中完成；两个并发 fiber 不会各自启动一次 build。
      const flight = yield* Effect.sync(() => {
        const pending = this.inflight.get(derivedKey);
        if (pending !== undefined) return { _tag: "Follower" as const, deferred: pending };
        this.inflight.set(derivedKey, fresh);
        return { _tag: "Leader" as const, deferred: fresh };
      });
      if (flight._tag === "Follower") return yield* Deferred.await(flight.deferred);

      const run = Effect.gen(function* () {
        const hit = yield* timedCacheActivity(
          timing,
          "sandbox.build.lookup",
          `agent image lookup ${derivedLocator}`,
          imageExists(derivedLocator),
        );
        if (hit) {
          return { status: "hit" as const, locator: derivedLocator, derivedKey };
        }
        yield* timedCacheActivity(
          timing,
          "sandbox.build.agent",
          `agent image build ${derivedLocator}`,
          build({
            taskLocator: input.taskLocator,
            derivedLocator,
            derivedKey,
            platform: input.platform,
            ensureIdentity: input.ensure.identity,
            installerIdentity: input.installer.identity,
            installMode: "staged",
          }, signal),
        );
        return { status: "built" as const, locator: derivedLocator, derivedKey };
      });
      yield* Effect.intoDeferred(run, flight.deferred).pipe(
        Effect.ensuring(Effect.sync(() => {
          if (this.inflight.get(derivedKey) === flight.deferred) this.inflight.delete(derivedKey);
        })),
      );
      return yield* Deferred.await(flight.deferred);
    });
  }
}

function timedCacheActivity<T>(
  timing: RunTimingRecorder | undefined,
  key: "sandbox.build.lookup" | "sandbox.build.agent",
  label: string,
  run: Effect.Effect<T, Error>,
): Effect.Effect<T, Error> {
  if (timing === undefined) return run;
  return Effect.suspend(() => {
    const startOffsetMs = timing.offsetNow();
    return run.pipe(Effect.onExit((exit) => Effect.sync(() => {
      timing.child({
        key,
        label,
        startOffsetMs,
        durationMs: Math.max(0, timing.offsetNow() - startOffsetMs),
        ...(Exit.isSuccess(exit) ? {} : { failed: true }),
      });
    })));
  });
}
