import type { JsonValue } from "../types.ts";
import { fingerprintPayloadWithHistoricalProviderCache } from "./historical-provider-identity.ts";
import type { ConfigIdentity } from "./config-identity.ts";
import { hashIdentityPayload, slotExecutionIdentityDigestHex } from "./execution-identity.ts";

/** NiceEval-owned identity recipes; these values also drive production encodings. */
export interface IdentityDomains {
  readonly fingerprintAlgorithm: number;
  readonly fingerprintCoverage: number;
  readonly inputIdentity: number;
  readonly configIdentity: number;
  readonly slotInput: number;
}

export const CURRENT_IDENTITY_DOMAINS: IdentityDomains = Object.freeze({
  fingerprintAlgorithm: 6,
  fingerprintCoverage: 4,
  inputIdentity: 1,
  configIdentity: 1,
  slotInput: 1,
});

/** Conditional owner recipe: preserve the legacy judgeAuthoring payload and all
 * non-Judge digests. The source closure deliberately over-selects imports,
 * aliases, wrappers and calls of the ordinary Judge authoring primitives. */
export const ORDINARY_JUDGE_IDENTITY_CHANGE = Object.freeze({
  name: "ordinary-judge-model-context-budget/v1",
  effect: "behavior-changing" as const,
  payloadPath: "ordinaryJudge",
  algorithm: 1,
  summary: "Model context admission replaces default material/audit byte caps. Select source closures containing defineJudge, binaryJudge, factuality, faithfulness, instructionFollowing, pairwisePreference, defineScoreMatch or closeQA (including aliased imports), or a .judge call. Preserve the legacy judgeAuthoring field and omit ordinaryJudge entirely for other Evals.",
});

export function selectsOrdinaryJudge(source: readonly (readonly [string, string])[]): boolean {
  return source.some(([, content]) => /\b(?:defineJudge|binaryJudge|factuality|faithfulness|instructionFollowing|pairwisePreference|defineScoreMatch|closeQA)\b|\.\s*judge\s*\(/u.test(content));
}

export type IdentityChangeEffect = "encoding-only" | "behavior-changing";

/**
 * Frozen, credential-free planning data. A pair's seed has attempt 0; callers
 * supply the actual attempt, timeout and any allowed rename projection by copy.
 * Historical recipes return a new input, never mutate this one. Optional digest
 * overrides retain an old hash/slot encoder when changing payloads is insufficient.
 * A recipe changing an inner identity must also rebuild any affected outer hash.
 */
export interface IdentityRebuildInput extends IdentityDomainSide {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly timeout: null | { readonly domain: string; readonly milliseconds: number };
  readonly fingerprintPayload: Readonly<Record<string, unknown>>;
  readonly configIdentity: ConfigIdentity;
  readonly fingerprint?: string;
  readonly configHash?: string;
  readonly executionDigest?: string;
}

/**
 * `retired: true` explicitly withdraws the old recipe, including an intermediate
 * hop. Encoding-only rebuild functions convert the supplied `to` input to `from`;
 * domain bookkeeping is performed by rebuildOriginExecutionDigest.
 */
export type IdentityDomainChange = (
  | {
      readonly kind: "core";
      readonly name: string;
      readonly revision: keyof IdentityDomains;
      readonly from: number;
      readonly to: number;
      readonly summary: string;
    }
  | {
      readonly kind: "owner";
      readonly name: string;
      readonly configPath: string;
      readonly from: string;
      readonly to: string;
      readonly summary: string;
    }
) & { readonly retired?: boolean } & (
  | {
      readonly effect: "encoding-only";
      readonly applies: (input: IdentityRebuildInput) => boolean;
      readonly rebuild: (input: IdentityRebuildInput) => IdentityRebuildInput;
    }
  | { readonly effect: "behavior-changing" }
);

export const IDENTITY_DOMAIN_CHANGES: readonly IdentityDomainChange[] = Object.freeze([{
  kind: "core",
  name: "provider-before-cache-capability/3-to-4",
  revision: "fingerprintAlgorithm",
  from: 3,
  to: 4,
  effect: "encoding-only",
  summary: "Exclude transparent Before cache capabilities from provider execution identity.",
  applies: (input: IdentityRebuildInput) => fingerprintPayloadWithHistoricalProviderCache(input) !== undefined,
  rebuild: (input: IdentityRebuildInput) => ({
    ...input,
    fingerprintPayload: fingerprintPayloadWithHistoricalProviderCache(input)!,
  }),
}, {
  kind: "core",
  name: "sandbox-before-chain-order/4-to-5",
  revision: "fingerprintAlgorithm",
  from: 4,
  to: 5,
  effect: "behavior-changing",
  summary: "Execute each Sandbox before chain in declaration order, including callbacks and Plugin fragments.",
}, {
  kind: "core",
  name: "loader-helper-call-attribution/2-to-3",
  revision: "fingerprintCoverage",
  from: 2,
  to: 3,
  effect: "encoding-only",
  summary: "A loader read made while an Eval entry is on the stack covers only that Eval, even when a shared helper function performs it. " +
    "Coverage only shrinks, so the payload hashes as before: unaffected Evals rebuild the old digest unchanged, and an Eval that drops another Eval's helper-routed file shows an identity mismatch.",
  applies: () => true,
  rebuild: (input: IdentityRebuildInput) => input,
}, {
  kind: "core",
  name: "normalized-source-identity/5-to-6",
  revision: "fingerprintAlgorithm",
  from: 5,
  to: 6,
  effect: "behavior-changing",
  summary: "Hash normalized source with the pinned native parser and ignore ordinary comments in capability selection.",
}, {
  kind: "core",
  name: "parsed-module-graph/3-to-4",
  revision: "fingerprintCoverage",
  from: 3,
  to: 4,
  effect: "behavior-changing",
  summary: "Use one parsed module graph for source identity, Group definitions and loader provenance, including literal runtime dependencies.",
}]);

export interface IdentityDomainSide {
  readonly domains: IdentityDomains;
  readonly config: Readonly<Record<string, JsonValue>>;
}

export type IdentityDomainResolution =
  | { readonly kind: "same" }
  | { readonly kind: "encoding-only"; readonly chain: readonly [IdentityDomainChange, ...IdentityDomainChange[]] }
  | { readonly kind: "behavior-changing"; readonly change: IdentityDomainChange }
  | { readonly kind: "retired"; readonly change: IdentityDomainChange }
  | { readonly kind: "unregistered"; readonly differing: readonly string[] };

const revisions: readonly (keyof IdentityDomains)[] = Object.freeze([
  "fingerprintAlgorithm", "fingerprintCoverage", "inputIdentity", "configIdentity", "slotInput",
]);

/** Only a unique, directed registered path can prove a transition; cycles cannot. */
function registeredChain(
  from: number | JsonValue | undefined,
  to: number | JsonValue | undefined,
  entries: readonly IdentityDomainChange[],
): readonly IdentityDomainChange[] | undefined {
  const paths: IdentityDomainChange[][] = [];
  const visit = (value: typeof from, chain: IdentityDomainChange[], seen: ReadonlySet<unknown>): void => {
    if (value === to) { paths.push(chain); return; }
    if (seen.has(value) || paths.length > 1) return;
    const visited = new Set([...seen, value]);
    for (const change of entries) {
      if (change.from === value) visit(change.to, [...chain, change], visited);
    }
  };
  visit(from, [], new Set());
  return paths.length === 1 ? paths[0] : undefined;
}

/** Owner paths come exclusively from the registry; ordinary config differences are not domains. */
export function resolveIdentityDomains(
  origin: IdentityDomainSide,
  current: IdentityDomainSide,
  registry: readonly IdentityDomainChange[] = IDENTITY_DOMAIN_CHANGES,
): IdentityDomainResolution {
  const chain: IdentityDomainChange[] = [];
  const differing: string[] = [];
  const append = (
    key: string,
    from: number | JsonValue | undefined,
    to: number | JsonValue | undefined,
    entries: readonly IdentityDomainChange[],
  ): void => {
    if (from === to) return;
    const path = registeredChain(from, to, entries);
    if (path === undefined) differing.push(key);
    else chain.push(...path);
  };
  for (const revision of revisions) {
    append(revision, origin.domains[revision], current.domains[revision],
      registry.filter((change) => change.kind === "core" && change.revision === revision));
  }
  const ownerPaths = [...new Set(registry.flatMap((change) => change.kind === "owner" ? [change.configPath] : []))].sort();
  for (const path of ownerPaths) {
    append(`config:${path}`, origin.config[path], current.config[path],
      registry.filter((change) => change.kind === "owner" && change.configPath === path));
  }
  if (differing.length > 0) return Object.freeze({ kind: "unregistered", differing: Object.freeze(differing) });
  const retired = chain.find((change) => change.retired === true);
  if (retired !== undefined) return Object.freeze({ kind: "retired", change: retired });
  const behavior = chain.find((change) => change.effect === "behavior-changing");
  if (behavior !== undefined) return Object.freeze({ kind: "behavior-changing", change: behavior });
  if (chain.length === 0) return Object.freeze({ kind: "same" });
  return Object.freeze({ kind: "encoding-only", chain: Object.freeze(chain) as readonly [IdentityDomainChange, ...IdentityDomainChange[]] });
}

/** Reverse the origin-to-current chain using only frozen data, then hash the old Slot. */
export function rebuildOriginExecutionDigest(
  chain: IdentityDomainResolution & { kind: "encoding-only" },
  input: IdentityRebuildInput,
): string | undefined {
  let rebuilt = input;
  for (const change of [...chain.chain].reverse()) {
    if (change.retired === true || change.effect !== "encoding-only") return undefined;
    const value = change.kind === "core" ? rebuilt.domains[change.revision] : rebuilt.config[change.configPath];
    if (value !== change.to || !change.applies(rebuilt)) return undefined;
    const previous = change.rebuild(rebuilt);
    rebuilt = Object.freeze({
      ...previous,
      domains: change.kind === "core"
        ? Object.freeze({ ...previous.domains, [change.revision]: change.from })
        : previous.domains,
      config: change.kind === "owner"
        ? Object.freeze({ ...previous.config, [change.configPath]: change.from })
        : previous.config,
    });
  }
  if (rebuilt.executionDigest !== undefined) return rebuilt.executionDigest;
  const configHash = rebuilt.configHash ?? hashIdentityPayload(rebuilt.configIdentity);
  const fingerprint = rebuilt.fingerprint ?? hashIdentityPayload({ ...rebuilt.fingerprintPayload, configHash });
  return slotExecutionIdentityDigestHex({
    version: rebuilt.domains.slotInput,
    experimentId: rebuilt.experimentId,
    evalId: rebuilt.evalId,
    attempt: rebuilt.attempt,
    input: { domain: `niceeval.input/fingerprint-v${rebuilt.domains.inputIdentity}`, value: fingerprint },
    config: { domain: `niceeval.config/identity-v${rebuilt.domains.configIdentity}`, value: configHash },
    timeout: rebuilt.timeout,
  });
}
