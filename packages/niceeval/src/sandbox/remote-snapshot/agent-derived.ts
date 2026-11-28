import type { AgentInstall, AgentInstaller } from "../../agents/types.ts";
import { AGENT_DOCKERFILE_CACHE_SAFE } from "../../agents/cache-marker.ts";
import type { BeforeCacheDeclaration, BeforeCacheEligibility } from "../backend.ts";
import { digestOf } from "../identity.ts";
import type { LinkedRunPlan } from "../plan.ts";

export interface PlannedAgentDerivedNode {
  readonly key: string;
  readonly declaration: BeforeCacheDeclaration;
  readonly positions: readonly string[];
  readonly declaringOwner: string;
  readonly installs: readonly AgentInstall[];
  readonly installers: readonly AgentInstaller[];
}

export function cacheableAgentInstallers(
  installs: readonly AgentInstall[],
  installers: readonly AgentInstaller[],
): readonly AgentInstaller[] | undefined {
  if (installs.length === 0) return undefined;
  const matched: AgentInstaller[] = [];
  for (const install of installs) {
    const installer = installers.find(
      (candidate) =>
        candidate.identity.agent === install.identity.agent &&
        candidate.identity.version === install.identity.version &&
        candidate.identity.revision === install.identity.revision,
    );
    if (installer?.installMode !== "staged" || installer[AGENT_DOCKERFILE_CACHE_SAFE] !== true) return undefined;
    matched.push(installer);
  }
  return matched;
}

/** Cache-only identity: this node never participates in Attempt or config identity. */
export function plannedAgentDerivedNode(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
  eligibility: Extract<BeforeCacheEligibility, { readonly _tag: "Eligible" }>,
  installs: readonly AgentInstall[],
  installers: readonly AgentInstaller[],
  parent?: { readonly key: string; readonly positions: readonly string[] },
): PlannedAgentDerivedNode | undefined {
  const matched = cacheableAgentInstallers(installs, installers);
  if (matched === undefined) return undefined;

  const declarationMetadata = {
    domain: "niceeval.remote-snapshot-agent-derived",
    parent: parent?.key ?? {
      baseIdentity: eligibility.baseIdentity,
      provider: plan.providerPlan.provider,
      plannerRevision: plan.providerPlan.plannerRevision,
      keyScope: { ...eligibility.keyScope },
    },
    target: { ...plan.providerPlan.target.platform },
    installs: installs.map((install, index) => ({
      install: { ...install.identity },
      installer: { ...matched[index]!.identity },
      installMode: matched[index]!.installMode,
    })),
  };
  const key = `agent-derived:${digestOf(declarationMetadata)}`;
  return {
    key,
    declaringOwner: `agent:${plan.pair.agentName}`,
    positions: [...(parent?.positions ?? []), "niceeval.agent-install"],
    installs,
    installers,
    declaration: {
      baseIdentity: eligibility.baseIdentity,
      beforeCacheKey: key,
      declarationDigest: `sha256:${digestOf(declarationMetadata)}`,
      requiredState: "all" as const,
      cacheFormat: eligibility.keyScope.cacheFormat,
      changeFrequency: 100,
      declarationMetadata,
    },
  };
}
