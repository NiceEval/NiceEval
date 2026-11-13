// cases: docs/engineering/testing/architecture/unit/experiments-runner.md
// Unit exception: synthetic historical domains have no published package/CLI input.
// The release gate must distinguish recipe drift before such a package is published.
import { resolve } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { defineAdapter } from "../adapter.ts";
import { defineEval } from "../define.ts";
import { hashEvalSource } from "../record/source-hash.ts";
import { FINGERPRINT_ALGORITHM_VERSION, FINGERPRINT_COVERAGE_VERSION } from "../record/manifest.ts";
import { linkedRunRecordIdentity, type LinkedRunPlan } from "../sandbox/plan.ts";
import { linkPluginPair, preparePluginRun } from "../plugin/link.ts";
import { discoverEval, type AgentRun } from "./types.ts";
import { configIdentityForRun } from "./config-identity.ts";
import { fingerprintWithManifest, hashConfigIdentity } from "./fingerprint.ts";
import { hashIdentityPayload, slotExecutionIdentityDigestHex } from "./execution-identity.ts";
import {
  CURRENT_IDENTITY_DOMAINS,
  IDENTITY_DOMAIN_CHANGES,
  rebuildOriginExecutionDigest,
  resolveIdentityDomains,
  type IdentityDomainChange,
  type IdentityDomainSide,
  type IdentityDomains,
  type IdentityRebuildInput,
} from "./identity-domains.ts";
import releaseSnapshot from "./identity-domains.release.json" with { type: "json" };

const guidance = "更换 domain 并登记变更，再更新快照";
type Digests = { readonly fingerprint: string; readonly configIdentity: string; readonly slotInput: string };
type Snapshot = {
  readonly domains: IdentityDomains;
  readonly registryNames: readonly string[];
  readonly samples: readonly {
    readonly name: string;
    readonly domains: IdentityDomains;
    readonly ownerDomains: IdentityDomainSide["config"];
    readonly fixture: typeof releaseSnapshot.samples[number]["fixture"];
    readonly digests: Digests;
  }[];
};
type Sample = { readonly input: IdentityRebuildInput; readonly digests: Digests };

/** Data-only fixture: the source read boundary receives captured bytes, never a project file. */
async function calculateSample(fixture: Snapshot["samples"][number]["fixture"]): Promise<Sample> {
  const adapter = defineAdapter({ name: "release-fixture", behaviorRevision: "1", create: () => ({}) });
  const definition = defineEval({ tags: fixture.tags, metadata: fixture.metadata, test: () => {} });
  const sourcePath = resolve(fixture.sourcePath);
  const evalDef = discoverEval(definition, {
    id: fixture.evalId, baseDir: resolve("evals"), sourcePath,
    loaderDataPaths: [], criteriaPaths: [], privatePaths: [], definition,
    source: { path: fixture.sourcePath, content: fixture.sourceContent, sha256: hashEvalSource(fixture.sourceContent) },
  });
  const run: AgentRun = {
    adapter, flags: fixture.flags, attempts: 3, earlyExit: false, sandboxBeforeCache: "use",
    experimentId: fixture.experimentId, experimentBaseDir: resolve("experiments"),
    experimentSourcePath: resolve("experiments/release.ts"), selectedEvalIds: [fixture.evalId],
    timeoutMs: fixture.timeoutMs,
  };
  const pluginRun = preparePluginRun(run);
  const plugin = linkPluginPair(evalDef, pluginRun);
  const plan: LinkedRunPlan = { _tag: "Direct", pair: {
    kind: "direct", evalId: evalDef.id, experimentId: run.experimentId, agentName: adapter.name,
  } };
  const result = await Effect.runPromise(fingerprintWithManifest({
    key: `${run.experimentId}|${evalDef.id}`, run: pluginRun.run, sourceRun: run, evalDef,
    plan, identity: linkedRunRecordIdentity(plan), plugin,
  }, new Map([[sourcePath, Effect.succeed(fixture.sourceContent)]])));
  const configIdentity = hashConfigIdentity(configIdentityForRun(pluginRun.run, plan));
  const input = { ...result.rebuildInput, attempt: fixture.attempt };
  return {
    input,
    digests: {
      fingerprint: result.fingerprint,
      configIdentity,
      slotInput: slotExecutionIdentityDigestHex({
        experimentId: fixture.experimentId, evalId: fixture.evalId, attempt: fixture.attempt,
        input: { domain: `niceeval.input/fingerprint-v${CURRENT_IDENTITY_DOMAINS.inputIdentity}`, value: result.fingerprint },
        config: { domain: `niceeval.config/identity-v${CURRENT_IDENTITY_DOMAINS.configIdentity}`, value: configIdentity },
        timeout: input.timeout,
      }),
    },
  };
}

/** Release-policy oracle: fixed expected digests stay in the signed-in data file. */
function assertReleaseSnapshot(
  snapshot: Snapshot,
  samples: readonly Sample[],
  domains: IdentityDomains = CURRENT_IDENTITY_DOMAINS,
  registry: readonly IdentityDomainChange[] = IDENTITY_DOMAIN_CHANGES,
): void {
  const require = (condition: boolean, reason: string): void => {
    if (!condition) throw new Error(`${reason}: ${guidance}`);
  };
  const transition = resolveIdentityDomains({ domains: snapshot.domains, config: {} }, { domains, config: {} }, registry);
  require(transition.kind !== "unregistered", "Unregistered current identity domain");
  require(transition.kind === "same", "Current domain snapshot changed");
  require(JSON.stringify([...snapshot.registryNames].sort()) === JSON.stringify(registry.map((entry) => entry.name).sort()), "Registry name snapshot changed");
  const covered = new Set<string>();
  for (const entry of registry) {
    if (entry.effect === "encoding-only" && entry.retired !== true) {
      require(typeof entry.applies === "function" && typeof entry.rebuild === "function", `Missing old computation for ${entry.name}`);
    }
  }
  require(snapshot.samples.length === samples.length, "Missing identity sample");
  let currentSample = false;
  for (const [index, previous] of snapshot.samples.entries()) {
    const sample = samples[index];
    const resolution = resolveIdentityDomains({
      domains: previous.domains, config: { ...sample.input.config, ...previous.ownerDomains },
    }, { domains, config: sample.input.config }, registry);
    require(resolution.kind !== "unregistered", `Unregistered sample ${previous.name}`);
    if (resolution.kind === "same") {
      currentSample = true;
      require((["fingerprint", "configIdentity", "slotInput"] as const).every((key) => sample.digests[key] === previous.digests[key]),
        `Same-domain digest drift for ${previous.name}`);
    } else if (resolution.kind === "encoding-only") {
      let digest: string | undefined;
      try {
        digest = rebuildOriginExecutionDigest(resolution, sample.input);
      } catch (cause) {
        throw new Error(`Old computation failed for ${previous.name}: ${guidance}`, { cause });
      }
      require(digest === previous.digests.slotInput,
        `Old computation cannot reconstruct ${previous.name}`);
      resolution.chain.forEach((entry) => covered.add(entry.name));
    }
  }
  require(currentSample, "Missing fixed digests in the current domains");
  for (const entry of registry) {
    if (entry.effect === "encoding-only" && entry.retired !== true) {
      const target = entry.kind === "core"
        ? { domains: { ...domains, [entry.revision]: entry.to }, config: {} }
        : { domains, config: { [entry.configPath]: entry.to } };
      // A later behavior change forbids rebuilding through that hop. Historical
      // encoding recipes are checked separately against their frozen snapshot.
      if (resolveIdentityDomains(target, { domains, config: {} }, registry).kind !== "behavior-changing") {
        require(covered.has(entry.name), `Missing old-domain sample for ${entry.name}`);
      }
    }
  }
}

const side = (patch: Partial<IdentityDomains> = {}, config: IdentityDomainSide["config"] = {}): IdentityDomainSide => ({
  domains: { ...CURRENT_IDENTITY_DOMAINS, ...patch }, config,
});
const encoding = (from: number, to: number): IdentityDomainChange & { effect: "encoding-only" } => ({
  kind: "core", name: `input/${from}-${to}`, revision: "inputIdentity", from, to,
  effect: "encoding-only", summary: "Identity envelope only", applies: () => true, rebuild: (input) => input,
});

describe("identity domain release contract", () => {
  it("keeps the released Eval, configuration and slot digests in their declared domains", async () => {
    const samples = await Promise.all(releaseSnapshot.samples.map((sample) => calculateSample(sample.fixture)));
    assertReleaseSnapshot(releaseSnapshot, samples);
    const historicalDomains = { ...CURRENT_IDENTITY_DOMAINS, fingerprintAlgorithm: 4 };
    const historicalRegistry = IDENTITY_DOMAIN_CHANGES.filter((entry) => entry.name === "provider-before-cache-capability/3-to-4");
    assertReleaseSnapshot({
      domains: historicalDomains,
      registryNames: historicalRegistry.map((entry) => entry.name),
      samples: releaseSnapshot.samples.slice(0, 2),
    }, samples.slice(0, 2).map((sample) => ({
      ...sample, input: { ...sample.input, domains: historicalDomains },
    })), historicalDomains, historicalRegistry);
    expect(FINGERPRINT_ALGORITHM_VERSION).toBe(CURRENT_IDENTITY_DOMAINS.fingerprintAlgorithm);
    expect(FINGERPRINT_COVERAGE_VERSION).toBe(CURRENT_IDENTITY_DOMAINS.fingerprintCoverage);
    expect(Object.isFrozen(samples[0].input.fingerprintPayload)).toBe(true);
    expect(Object.isFrozen(samples[0].input.configIdentity)).toBe(true);
  });

  it("reconstructs the retired provider cache slot without changing execution inputs", async () => {
    const sample = await calculateSample(releaseSnapshot.samples[0].fixture);
    const providerPlan = {
      version: 3, providerModule: "niceeval/docker-image",
      capabilities: { retention: { _tag: "Suspendable" }, reuse: { _tag: "Supported" }, sessionLimit: { _tag: "Unlimited" } },
    };
    const pairPlan = { mode: "sandbox", providerPlan };
    const input = { ...sample.input, domains: { ...sample.input.domains, fingerprintAlgorithm: 4 }, fingerprintPayload: { ...sample.input.fingerprintPayload, pairPlan } };
    const resolution = resolveIdentityDomains(side({ fingerprintAlgorithm: 3 }), side({ fingerprintAlgorithm: 4 }));
    expect(resolution.kind).toBe("encoding-only");
    if (resolution.kind !== "encoding-only") throw new Error("Missing provider identity transition");
    const oldPayload = { ...input.fingerprintPayload, pairPlan: {
      ...pairPlan, providerPlan: { ...providerPlan, capabilities: {
        ...providerPlan.capabilities, setupPrefix: { _tag: "Persistent", coverage: "all" },
      } },
    } };
    const expected = slotExecutionIdentityDigestHex({
      experimentId: input.experimentId, evalId: input.evalId, attempt: input.attempt,
      input: { domain: "niceeval.input/fingerprint-v1", value: hashIdentityPayload(oldPayload) },
      config: { domain: "niceeval.config/identity-v1", value: sample.digests.configIdentity }, timeout: input.timeout,
    });
    expect(rebuildOriginExecutionDigest(resolution, input)).toBe(expected);
    expect(providerPlan.capabilities).not.toHaveProperty("setupPrefix");
    expect(rebuildOriginExecutionDigest(resolution, { ...input, fingerprintPayload: {
      ...input.fingerprintPayload, pairPlan: { ...pairPlan, providerPlan: { ...providerPlan, providerModule: "unknown/provider" } },
    } })).toBeUndefined();
  });

  it("rejects an unregistered domain, same-domain drift and absent or incorrect old computation", async () => {
    const sample = await calculateSample(releaseSnapshot.samples[0].fixture);
    const oldSnapshot: Snapshot = { ...releaseSnapshot, samples: [{ ...releaseSnapshot.samples[0], domains: CURRENT_IDENTITY_DOMAINS, digests: sample.digests }] };
    const newer = { ...CURRENT_IDENTITY_DOMAINS, inputIdentity: 2 };
    const entry = encoding(1, 2);
    const current = {
      input: { ...sample.input, domains: newer },
      digests: { ...sample.digests, slotInput: slotExecutionIdentityDigestHex({
        experimentId: sample.input.experimentId, evalId: sample.input.evalId, attempt: sample.input.attempt,
        input: { domain: "niceeval.input/fingerprint-v2", value: sample.digests.fingerprint },
        config: { domain: "niceeval.config/identity-v1", value: sample.digests.configIdentity }, timeout: sample.input.timeout,
      }) },
    };
    const registered: Snapshot = {
      ...oldSnapshot, domains: newer, registryNames: [entry.name], samples: [oldSnapshot.samples[0], {
        ...oldSnapshot.samples[0], domains: newer, digests: current.digests,
      }],
    };
    const currentSamples = [current, current];
    expect(() => assertReleaseSnapshot(oldSnapshot, [current], newer)).toThrow(guidance);
    expect(() => assertReleaseSnapshot(oldSnapshot, [{ ...sample, digests: { ...sample.digests, fingerprint: "drift" } }])).toThrow(guidance);
    const missing = { ...entry, rebuild: undefined } as unknown as IdentityDomainChange;
    expect(() => assertReleaseSnapshot(registered, currentSamples, newer, [missing])).toThrow(guidance);
    expect(() => assertReleaseSnapshot(registered, currentSamples, newer, [{ ...entry, rebuild: () => { throw new Error("No old encoder"); } }])).toThrow(guidance);
    expect(() => assertReleaseSnapshot(registered, currentSamples, newer, [{ ...entry, rebuild: (input) => ({ ...input, fingerprint: "wrong" }) }])).toThrow(guidance);
    expect(() => assertReleaseSnapshot(registered, currentSamples, newer, [entry])).not.toThrow();
  });
});

describe("identity domain planning", () => {
  it("distinguishes unchanged domains, missing registration and registered owner domains from ordinary config", () => {
    expect(resolveIdentityDomains(side(), side({}, { model: "different" }))).toEqual({ kind: "same" });
    expect(resolveIdentityDomains(side({ fingerprintAlgorithm: 0 }), side())).toEqual({ kind: "unregistered", differing: ["fingerprintAlgorithm"] });
    const owner: IdentityDomainChange = { kind: "owner", name: "provider/v1-v2", configPath: "provider.domain", from: "v1", to: "v2", effect: "behavior-changing", summary: "New preparation" };
    expect(resolveIdentityDomains(side({}, { "provider.domain": "v1" }), side({}, { "provider.domain": "v2" }), [owner]))
      .toEqual({ kind: "behavior-changing", change: owner });
    expect(resolveIdentityDomains(side({}, { "provider.domain": "v0" }), side({}, { "provider.domain": "v2" }), [owner]))
      .toEqual({ kind: "unregistered", differing: ["config:provider.domain"] });
    expect(resolveIdentityDomains(side({ inputIdentity: 0 }), side(), [encoding(0, 0)]).kind).toBe("unregistered");
  });

  it("blocks behavior changes and retired intermediate hops instead of rebuilding across them", () => {
    const first = encoding(0, 1);
    const second = encoding(1, 2);
    const behavior: IdentityDomainChange = { ...second, effect: "behavior-changing" };
    expect(resolveIdentityDomains(side({ inputIdentity: 0 }), side({ inputIdentity: 2 }), [behavior, first]))
      .toEqual({ kind: "behavior-changing", change: behavior });
    const retired = { ...first, retired: true };
    expect(resolveIdentityDomains(side({ inputIdentity: 0 }), side({ inputIdentity: 2 }), [second, retired]))
      .toEqual({ kind: "retired", change: retired });
    expect(resolveIdentityDomains(side({ inputIdentity: 0 }), side({ inputIdentity: 2 }), [first, second, encoding(0, 2)]).kind)
      .toBe("unregistered");
  });

  it("rebuilds multiple core and owner hops backwards from frozen inputs and stops on predicate failure", async () => {
    const sample = await calculateSample(releaseSnapshot.samples[0].fixture);
    const calls: string[] = [];
    const older = { ...sample.input, domains: { ...sample.input.domains, inputIdentity: 0 } };
    const current = { ...sample.input, domains: { ...sample.input.domains, inputIdentity: 2 }, config: { "provider.domain": "v2" } };
    const first = { ...encoding(0, 1), rebuild: (input: IdentityRebuildInput) => {
      calls.push(`old:${input.domains.inputIdentity}`);
      return { ...input, configHash: sample.digests.configIdentity, fingerprint: sample.digests.fingerprint };
    } };
    const second = { ...encoding(1, 2), rebuild: (input: IdentityRebuildInput) => { calls.push(`new:${input.domains.inputIdentity}`); return input; } };
    const owner: IdentityDomainChange = { kind: "owner", name: "owner/v1-v2", configPath: "provider.domain", from: "v1", to: "v2", effect: "encoding-only", summary: "Owner encoding", applies: (input) => input.config["provider.domain"] === "v2", rebuild: (input) => { calls.push("owner"); return input; } };
    const resolution = resolveIdentityDomains({ ...older, config: { "provider.domain": "v1" } }, current, [second, owner, first]);
    expect(resolution.kind).toBe("encoding-only");
    if (resolution.kind !== "encoding-only") throw new Error("Expected registered encoding chain");
    expect(resolution.chain.map((entry) => entry.name)).toEqual([first.name, second.name, owner.name]);
    const expected = slotExecutionIdentityDigestHex({
      experimentId: older.experimentId, evalId: older.evalId, attempt: older.attempt,
      input: { domain: "niceeval.input/fingerprint-v0", value: sample.digests.fingerprint },
      config: { domain: "niceeval.config/identity-v1", value: sample.digests.configIdentity }, timeout: older.timeout,
    });
    expect(rebuildOriginExecutionDigest(resolution, current)).toBe(expected);
    expect(calls).toEqual(["owner", "new:2", "old:1"]);
    calls.length = 0;
    const blocked = { ...resolution, chain: [first, second, { ...owner, applies: () => false }] as const };
    expect(rebuildOriginExecutionDigest(blocked, current)).toBeUndefined();
    expect(calls).toEqual([]);
    expect(current.domains.inputIdentity).toBe(2);
    expect(current.config["provider.domain"]).toBe("v2");
    expect(rebuildOriginExecutionDigest(resolution, { ...current, domains: older.domains })).toBeUndefined();
  });
});
