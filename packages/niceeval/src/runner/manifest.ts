import { executionDigestForExperiment, type RenameIdentityTarget } from "./rename-identity.ts";
import { resolveIdentityDomains, rebuildOriginExecutionDigest, type IdentityRebuildInput, type IdentityDomainChange } from "./identity-domains.ts";
// Identity explanations are detached, credential-free planning values.
// Contract: docs/feature/experiments/architecture/cache.md, “差异说明”.
import { Schema } from "effect";
import type { JsonValue } from "../types.ts";
import type { RunContext } from "../record/model/run-context.ts";
import { IdentityJsonSchema, type IdentityManifestEntry } from "../record/family/identity-manifests/schema.ts";

export type { EvalManifest } from "../record/manifest.ts";

export const IdentityDeltaSchema = Schema.Struct({
  selector: Schema.String,
  kind: Schema.Literals(["added", "removed", "changed", "unknown"]),
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
});
export type IdentityDelta = Schema.Schema.Type<typeof IdentityDeltaSchema>;
export type IdentityDiagnosticFact =
  | { readonly label: string; readonly value: JsonValue }
  | { readonly label: string; readonly from: JsonValue; readonly to: JsonValue };
export interface IdentityDiagnostic {
  readonly code: string;
  readonly summary: string;
  readonly facts?: readonly IdentityDiagnosticFact[];
  readonly observedDeltas?: readonly IdentityDelta[];
  readonly limitations?: readonly string[];
  readonly causes?: readonly IdentityDiagnostic[];
}
export const IdentityDiagnosticSchema: Schema.Codec<IdentityDiagnostic> = Schema.suspend(() => Schema.Struct({
  code: Schema.String,
  summary: Schema.String,
  facts: Schema.optionalKey(Schema.Array(Schema.Union([
    Schema.Struct({ label: Schema.String, value: IdentityJsonSchema }),
    Schema.Struct({ label: Schema.String, from: IdentityJsonSchema, to: IdentityJsonSchema }),
  ]))),
  observedDeltas: Schema.optionalKey(Schema.Array(IdentityDeltaSchema)),
  limitations: Schema.optionalKey(Schema.Array(Schema.String)),
  causes: Schema.optionalKey(Schema.Array(IdentityDiagnosticSchema)),
}));
export const IdentityExplanationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("match"), via: Schema.NonEmptyArray(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("changed"), deltas: Schema.NonEmptyArray(IdentityDeltaSchema) }),
  Schema.Struct({ kind: Schema.Literal("unexplained"), diagnostic: IdentityDiagnosticSchema }),
]);
export type IdentityExplanation = Schema.Schema.Type<typeof IdentityExplanationSchema>;

export const shortHash = (value: string): string => value.slice(0, 12);
const serializeValue = (value: JsonValue): string =>
  (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 512);
const canonical = (value: JsonValue): string => JSON.stringify(value, (_key, item: unknown) =>
  item !== null && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : item);

function faceDeltas<T extends JsonValue>(
  prefix: string, from: Readonly<Record<string, T>>, to: Readonly<Record<string, T>>,
  render: (value: T) => string = serializeValue,
): IdentityDelta[] {
  return [...new Set([...Object.keys(from), ...Object.keys(to)])].sort().flatMap((key): IdentityDelta[] => {
    const hasFrom = Object.hasOwn(from, key), hasTo = Object.hasOwn(to, key);
    if (hasFrom && hasTo && canonical(from[key]!) === canonical(to[key]!)) return [];
    return [Object.freeze({
      selector: `${prefix}:${key}`,
      kind: !hasFrom ? "added" as const : !hasTo ? "removed" as const : "changed" as const,
      ...(hasFrom ? { from: render(from[key]!) } : {}),
      ...(hasTo ? { to: render(to[key]!) } : {}),
    })];
  });
}

export function identityDeltas(historical: IdentityManifestEntry, current: IdentityManifestEntry): readonly IdentityDelta[] {
  const plan = faceDeltas("plan",
    historical.plan === undefined ? {} : { physical: historical.plan },
    current.plan === undefined ? {} : { physical: current.plan });
  return Object.freeze([
    ...faceDeltas("config", historical.config, current.config),
    ...plan,
    ...faceDeltas("plugins", historical.plugins ?? {}, current.plugins ?? {}),
    ...faceDeltas("source", historical.source, current.source, shortHash),
    ...faceDeltas("data", historical.data, current.data, shortHash),
  ]);
}

/** Only persisted context fields whose selector exists in the current manifest are comparable. */
export function legacyIdentityDeltas(input: {
  readonly current: IdentityManifestEntry;
  readonly context?: RunContext;
  readonly source?: Readonly<Record<string, string>>;
}): readonly IdentityDelta[] {
  const prior: Record<string, JsonValue> = {};
  const current: Record<string, JsonValue> = {};
  const execution = input.context?.execution;
  const put = (path: string, value: JsonValue) => {
    if (!Object.hasOwn(input.current.config, path)) return;
    prior[path] = value; current[path] = input.current.config[path]!;
  };
  if (execution !== undefined) {
    if (execution.adapter === null) put("adapter", null);
    for (const [key, value] of Object.entries(execution.adapter ?? {})) put(`adapter.${key}`, value);
    for (const path of ["model", "reasoningEffort"] as const) {
      if (Object.hasOwn(input.current.config, path)) {
        current[path] = input.current.config[path]!;
        if (execution[path] !== null) prior[path] = execution[path];
      }
    }
    for (const path of Object.keys(input.current.config).filter((path) => path.startsWith("flags."))) {
      const key = path.slice(6);
      if (Object.hasOwn(execution.flags, key)) put(path, execution.flags[key] as JsonValue);
      else current[path] = input.current.config[path]!;
    }
    // Run context stores Plugin identities, not the pair-owned Plugin graph.
    // Compare only keys carrying an exact persisted identity at both ends.
    const pluginProjection = Schema.decodeUnknownResult(Schema.Struct({
      lifecycles: Schema.Array(Schema.Struct({ name: Schema.String, key: Schema.String, identity: IdentityJsonSchema })),
    }))(input.current.config.plugins);
    if (pluginProjection._tag === "Success") {
      const from: JsonValue[] = [], to: JsonValue[] = [];
      for (const plugin of pluginProjection.success.lifecycles) {
        const recorded = execution.plugins?.find((entry) => entry.name === plugin.name && entry.key === plugin.key);
        if (recorded === undefined) continue;
        from.push({ name: recorded.name, key: recorded.key, identity: recorded.identity as JsonValue });
        to.push({ name: plugin.name, key: plugin.key, identity: plugin.identity });
      }
      if (from.length > 0) { prior.plugins = from; current.plugins = to; }
    }
  }
  const priorSource: Record<string, string> = {}, currentSource: Record<string, string> = {};
  for (const [path, hash] of Object.entries(input.source ?? {})) {
    if (Object.hasOwn(input.current.source, path)) {
      priorSource[path] = hash; currentSource[path] = input.current.source[path]!;
    }
  }
  return Object.freeze([...faceDeltas("config", prior, current), ...faceDeltas("source", priorSource, currentSource, shortHash)]);
}

export function unexplainedIdentity(
  code: string, summary: string, observedDeltas?: readonly IdentityDelta[],
  limitations?: readonly string[], facts?: readonly IdentityDiagnosticFact[],
): IdentityExplanation {
  return Object.freeze({ kind: "unexplained", diagnostic: Object.freeze({
    code, summary,
    ...(observedDeltas === undefined ? {} : { observedDeltas: Object.freeze([...observedDeltas]) }),
    ...(limitations === undefined ? {} : { limitations: Object.freeze([...limitations]) }),
    ...(facts === undefined ? {} : { facts: Object.freeze([...facts]) }),
  }) });
}

/** Called only for unequal Core execution digests; equality never needs a manifest. */
export function explainIdentityMismatch(input: {
  readonly historical?: IdentityManifestEntry;
  readonly current?: IdentityManifestEntry;
  readonly context?: RunContext;
  readonly source?: Readonly<Record<string, string>>;
}): IdentityExplanation {
  if (input.historical === undefined || input.current === undefined) {
    return unexplainedIdentity("identity-manifest-missing",
      "The historical identity manifest is missing; only persisted context and matching source paths can be compared.",
      input.current === undefined ? undefined : legacyIdentityDeltas({ current: input.current, ...(input.context === undefined ? {} : { context: input.context }), ...(input.source === undefined ? {} : { source: input.source }) }),
      ["Physical plan, managed data, remaining configuration, and identity domains cannot be compared without the identity manifest."]);
  }
  const deltas = identityDeltas(input.historical, input.current);
  if (canonical(input.historical.domains) !== canonical(input.current.domains)) {
    return unexplainedIdentity("identity-domain-changed", "The identity domains changed; execution equivalence must be rebuilt.", deltas);
  }
  if (deltas.length > 0) return Object.freeze({ kind: "changed", deltas: [deltas[0]!, ...deltas.slice(1)] as const });
  return unexplainedIdentity("unversioned-identity-change",
    "Execution identity changed without a domain version change or a comparable input difference.", deltas,
    ["NiceEval changed execution identity without a corresponding versioned input change."]);
}

/** Domain compatibility is decided from immutable origin facts and frozen current inputs. */
export function classifyIdentityDomains(input: {
  readonly historical: IdentityManifestEntry | undefined;
  readonly current: IdentityManifestEntry | undefined;
  readonly historicalDigest: string;
  readonly rebuildInput?: IdentityRebuildInput;
  readonly explanation: IdentityExplanation;
}): IdentityExplanation {
  if (input.historical === undefined || input.current === undefined) return input.explanation;
  const resolved = resolveIdentityDomains(input.historical, input.current);
  if (resolved.kind === "same") return input.explanation;
  const deltas = identityDeltas(input.historical, input.current);
  const changeFacts = (change: IdentityDomainChange): readonly IdentityDiagnosticFact[] => [
    { label: "name", value: change.name },
    { label: "kind", value: change.kind },
    { label: "from", value: change.from },
    { label: "to", value: change.to },
    { label: "effect", value: change.effect },
  ];
  if (resolved.kind === "encoding-only") {
    if (input.rebuildInput !== undefined && rebuildOriginExecutionDigest(resolved, input.rebuildInput) === input.historicalDigest) {
      return Object.freeze({ kind: "match", via: [resolved.chain[0].name, ...resolved.chain.slice(1).map((change) => change.name)] as const });
    }
    return unexplainedIdentity("identity-domain-changed", "The registered identity change cannot reconstruct the historical execution from the current frozen inputs.", deltas,
      ["The current inputs cannot be proven equivalent in the historical identity domain."], resolved.chain.flatMap(changeFacts));
  }
  if (resolved.kind === "unregistered") {
    return unexplainedIdentity("identity-domain-unregistered", "The historical identity domain has no registered transition to the current domain.", deltas,
      ["No historical identity recipe is available."], resolved.differing.map((key) => ({ label: "domain", value: key })));
  }
  return unexplainedIdentity(resolved.kind === "retired" ? "identity-domain-retired" : "identity-domain-changed",
    resolved.kind === "retired" ? "The historical identity recipe has been retired." : "The registered identity change changes execution behavior.",
    deltas, undefined, changeFacts(resolved.change));
}

/** The finite rename rule may compose with a registered pure domain conversion. */
export function executionDigestForManifestOrigin(
  target: RenameIdentityTarget & { readonly identityManifest?: IdentityManifestEntry; readonly renameRebuildInput?: (experimentId: string) => IdentityRebuildInput | undefined },
  experimentId: string,
  historical: IdentityManifestEntry | undefined,
): string | undefined {
  // Without a historical manifest the domain is unknown, but callers compare the
  // result byte-for-byte with the origin digest: equality under the current
  // recipe already proves the origin used it. Only a domain rebuild needs both.
  if (historical === undefined || target.identityManifest === undefined) return executionDigestForExperiment(target, experimentId);
  const resolution = resolveIdentityDomains(historical, target.identityManifest);
  if (resolution.kind === "same") return executionDigestForExperiment(target, experimentId);
  if (resolution.kind !== "encoding-only") return undefined;
  const input = target.renameRebuildInput?.(experimentId);
  return input === undefined ? undefined : rebuildOriginExecutionDigest(resolution, {
    ...input, attempt: target.attempt, timeout: target.timeout ?? null,
  });
}
