/** Internal-only marker; this module is intentionally not re-exported by any package entrypoint. */
export const AGENT_DOCKERFILE_CACHE_SAFE: unique symbol = Symbol("niceeval.agent.dockerfile-cache-safe");

export interface DockerfileAgentCacheSafeInstaller {
  readonly [AGENT_DOCKERFILE_CACHE_SAFE]: true;
}
