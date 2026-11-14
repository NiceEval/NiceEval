import { executionDigestForExperiment, type RenameIdentityTarget } from "./rename-identity.ts";
// Identity explanations are detached, credential-free planning values.
// Contract: docs/feature/experiments/architecture/cache.md, “差异说明”.
import * as Schema from "effect/Schema";
import type { JsonValue } from "../types.ts";
import type { RunContext } from "../record/model/run-context.ts";
import { IdentityJsonSchema, type IdentityManifestEntry } from "../record/family/identity-manifests/schema.ts";
import type { IdentityDelta, IdentityDiagnosticFact, IdentityExplanation } from "./identity-explanation-schema.ts";

export type { EvalManifest } from "../record/manifest.ts";
export {
  IdentityDeltaSchema,
  IdentityDiagnosticSchema,
  IdentityExplanationSchema,
  type IdentityDelta,
  type IdentityDiagnosticFact,
  type IdentityDiagnostic,
  type IdentityExplanation,
} from "./identity-explanation-schema.ts";

export const shortHash = (value: string): string => value.slice(0, 12);
const serializeValue = (value: JsonValue): string =>
  (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 512);
const canonical = (value: JsonValue): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );

function faceDeltas<T extends JsonValue>(
  prefix: string,
  from: Readonly<Record<string, T>>,
  to: Readonly<Record<string, T>>,
  render: (value: T) => string = serializeValue,
): IdentityDelta[] {
  return [...new Set([...Object.keys(from), ...Object.keys(to)])].sort().flatMap((key): IdentityDelta[] => {
    const hasFrom = Object.hasOwn(from, key),
      hasTo = Object.hasOwn(to, key);
    if (hasFrom && hasTo && canonical(from[key]!) === canonical(to[key]!)) return [];
    return [
      Object.freeze({
        selector: `${prefix}:${key}`,
        kind: !hasFrom ? ("added" as const) : !hasTo ? ("removed" as const) : ("changed" as const),
        ...(hasFrom ? { from: render(from[key]!) } : {}),
        ...(hasTo ? { to: render(to[key]!) } : {}),
      }),
    ];
  });
}

export function identityDeltas(
  historical: IdentityManifestEntry,
  current: IdentityManifestEntry,
): readonly IdentityDelta[] {
  const plan = faceDeltas(
    "plan",
    historical.plan === undefined ? {} : { physical: historical.plan },
    current.plan === undefined ? {} : { physical: current.plan },
  );
  return Object.freeze([
    ...faceDeltas("niceeval", historical.niceeval, current.niceeval),
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
    prior[path] = value;
    current[path] = input.current.config[path]!;
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
    const pluginProjection = Schema.decodeUnknownResult(
      Schema.Struct({
        lifecycles: Schema.Array(
          Schema.Struct({ name: Schema.String, key: Schema.String, identity: IdentityJsonSchema }),
        ),
      }),
    )(input.current.config.plugins);
    if (pluginProjection._tag === "Success") {
      const from: JsonValue[] = [],
        to: JsonValue[] = [];
      for (const plugin of pluginProjection.success.lifecycles) {
        const recorded = execution.plugins?.find((entry) => entry.name === plugin.name && entry.key === plugin.key);
        if (recorded === undefined) continue;
        from.push({ name: recorded.name, key: recorded.key, identity: recorded.identity as JsonValue });
        to.push({ name: plugin.name, key: plugin.key, identity: plugin.identity });
      }
      if (from.length > 0) {
        prior.plugins = from;
        current.plugins = to;
      }
    }
  }
  const priorSource: Record<string, string> = {},
    currentSource: Record<string, string> = {};
  for (const [path, hash] of Object.entries(input.source ?? {})) {
    if (Object.hasOwn(input.current.source, path)) {
      priorSource[path] = hash;
      currentSource[path] = input.current.source[path]!;
    }
  }
  return Object.freeze([
    ...faceDeltas("config", prior, current),
    ...faceDeltas("source", priorSource, currentSource, shortHash),
  ]);
}

export function unexplainedIdentity(
  code: string,
  summary: string,
  observedDeltas?: readonly IdentityDelta[],
  limitations?: readonly string[],
  facts?: readonly IdentityDiagnosticFact[],
): IdentityExplanation {
  return Object.freeze({
    kind: "unexplained",
    diagnostic: Object.freeze({
      code,
      summary,
      ...(observedDeltas === undefined ? {} : { observedDeltas: Object.freeze([...observedDeltas]) }),
      ...(limitations === undefined ? {} : { limitations: Object.freeze([...limitations]) }),
      ...(facts === undefined ? {} : { facts: Object.freeze([...facts]) }),
    }),
  });
}

/** Called only for unequal Core execution digests; equality never needs a manifest. */
export function explainIdentityMismatch(input: {
  readonly historical?: IdentityManifestEntry;
  readonly current?: IdentityManifestEntry;
  readonly context?: RunContext;
  readonly source?: Readonly<Record<string, string>>;
}): IdentityExplanation {
  if (input.historical === undefined || input.current === undefined) {
    return unexplainedIdentity(
      "identity-manifest-missing",
      "The historical identity manifest is missing; only persisted context and matching source paths can be compared.",
      input.current === undefined
        ? undefined
        : legacyIdentityDeltas({
            current: input.current,
            ...(input.context === undefined ? {} : { context: input.context }),
            ...(input.source === undefined ? {} : { source: input.source }),
          }),
      [
        "Physical plan, managed data, remaining configuration, and NiceEval identity cannot be compared without the identity manifest.",
      ],
    );
  }
  const deltas = identityDeltas(input.historical, input.current);
  const niceevalChanged = deltas.some((delta) => delta.selector.startsWith("niceeval:"));
  if (niceevalChanged)
    return unexplainedIdentity(
      "niceeval-identity-changed",
      "NiceEval identity changed. Rerun the affected experiments.",
      deltas,
    );
  if (deltas.length > 0) return Object.freeze({ kind: "changed", deltas: [deltas[0]!, ...deltas.slice(1)] as const });
  return unexplainedIdentity(
    "niceeval-identity-changed",
    "NiceEval identity calculation changed. Rerun the affected experiments.",
    deltas,
  );
}

/** Finite rename proof uses only the current frozen fingerprint recipe. */
export function executionDigestForManifestOrigin(
  target: RenameIdentityTarget & { readonly identityManifest?: IdentityManifestEntry },
  experimentId: string,
  historical: IdentityManifestEntry | undefined,
): string | undefined {
  if (
    historical !== undefined &&
    target.identityManifest !== undefined &&
    canonical(historical.niceeval) !== canonical(target.identityManifest.niceeval)
  )
    return undefined;
  return executionDigestForExperiment(target, experimentId);
}
