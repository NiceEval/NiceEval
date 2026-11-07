// Historical fingerprint v3 encoding only. These retired strings never declare
// live provider capabilities or participate in Before cache lookup.
import type { IdentityRebuildInput } from "./identity-domains.ts";

type ObjectValue = Readonly<Record<string, unknown>>;
const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined;

function historicalCacheCapability(moduleId: string): ObjectValue | undefined {
  switch (moduleId) {
    case "niceeval/dockerfile":
    case "niceeval/docker-image":
    case "niceeval/e2b-template":
    case "niceeval/opensandbox-image":
      return { _tag: "Persistent", coverage: "all" };
    case "niceeval/dockerfile-profile-docker-data":
    case "niceeval/docker-image-profile-docker-data":
      return { _tag: "Persistent", coverage: "dockerData" };
    case "niceeval/incus-vm": return { _tag: "PreparedArtifact", coverage: "all" };
    case "niceeval/docker-compose": return { _tag: "Unsupported", reason: "Docker Compose state spans a container group and mounted resources." };
    case "niceeval/dockerfile-ephemeral":
    case "niceeval/docker-image-ephemeral":
      return { _tag: "Unsupported", reason: "Persistent setup-prefix cache is unsupported for Docker Profile sandboxes and for read-only rootfs or tmpfs surfaces." };
    case "niceeval/vercel-snapshot": return { _tag: "Unsupported", reason: "Vercel Sandbox does not expose a NiceEval setup-prefix capture contract." };
    case "niceeval/instabox-snapshot": return { _tag: "Unsupported", reason: "Instabox before snapshot caching is not supported." };
    case "custom-case": return { _tag: "Unsupported", reason: "custom case has no declared setup-prefix capture contract" };
    default: return moduleId.startsWith("custom-provider:")
      ? { _tag: "Unsupported", reason: "custom provider has no declared setup-prefix capture contract" }
      : undefined;
  }
}

/** Reconstruct only the retired cache capability slot from frozen plan inputs. */
export function fingerprintPayloadWithHistoricalProviderCache(input: IdentityRebuildInput): ObjectValue | undefined {
  const pairPlan = object(input.fingerprintPayload.pairPlan);
  if (pairPlan?.mode === "direct") return input.fingerprintPayload;
  const providerPlan = object(pairPlan?.providerPlan);
  const capabilities = object(providerPlan?.capabilities);
  if (pairPlan?.mode !== "sandbox" || providerPlan?.version !== 3 ||
    typeof providerPlan.providerModule !== "string" || capabilities === undefined) return undefined;
  const capability = historicalCacheCapability(providerPlan.providerModule);
  if (capability === undefined) return undefined;
  return {
    ...input.fingerprintPayload,
    pairPlan: { ...pairPlan, providerPlan: { ...providerPlan, capabilities: { ...capabilities, setupPrefix: capability } } },
  };
}
