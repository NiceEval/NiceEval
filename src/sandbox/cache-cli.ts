import { Effect } from "effect";
import { CacheAdministrationRegistry } from "./cache-administration.ts";
import { CacheAdministrationLive } from "./cache-administration-live.ts";

function humanSize(value: number | null): string {
  if (value === null) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1000 && unit < units.length - 1) {
    amount /= 1000;
    unit += 1;
  }
  return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export async function runCacheCommand(
  positionals: readonly string[],
  options: { readonly json: boolean; readonly domain?: string; readonly apply?: string },
): Promise<number> {
  const command = positionals.length === 1 ? positionals[0] : undefined;
  if (command !== "inventory" && command !== "gc") {
    process.stderr.write("Usage: niceeval cache inventory [--domain <domain-id>] [--json]\n       niceeval cache gc --domain <domain-id> [--apply <plan-id>] [--json]\n");
    return 2;
  }
  if (command === "gc" && options.domain === undefined) {
    process.stderr.write("cache gc requires --domain <domain-id>\n");
    return 2;
  }
  try {
    return await Effect.runPromise(Effect.gen(function* () {
      const registry = yield* CacheAdministrationRegistry;
      const descriptors = yield* Effect.forEach(registry.adapters, (adapter) => adapter.listDomains(), { concurrency: "unbounded" })
        .pipe(Effect.map((groups) => groups.flat()));
      const selected = options.domain === undefined ? undefined : descriptors.find((item) => item.domainId === options.domain);
      if (options.domain !== undefined && selected === undefined) {
        process.stderr.write(`unknown cache domain ${options.domain}\n`);
        return 2;
      }
      if (selected?.state === "unavailable" || selected?.state === "unverified") {
        process.stderr.write(`cache domain ${selected.domainId} is ${selected.state}; ownership is not available\n`);
        return 4;
      }

      if (command === "gc") {
        const adapter = registry.adapters.find((item) => item.providerFamily === selected!.providerFamily)!;
        const domain = yield* adapter.openDomain(selected!);
      if (options.apply !== undefined) {
        const startedAt = new Date().toISOString();
        const result = yield* domain.applyGc(options.apply) as Effect.Effect<{ planId: string; domainId: string; outcomes: Array<{ buildKey: string; status: string; reason: string }> }, Error>;
        const document = {
          format: "niceeval.cache-gc-outcome",
          schemaVersion: 1,
          ...result,
          startedAt,
          finishedAt: new Date().toISOString(),
        };
        if (options.json) process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
        else {
          process.stdout.write(`GC plan ${result.planId}\n`);
          for (const outcome of result.outcomes) process.stdout.write(`  ${outcome.status} ${outcome.buildKey} · ${outcome.reason}\n`);
        }
          return result.outcomes.some((item) => item.status !== "deleted" && item.status !== "already-absent") ? 1 : 0;
      }
        const plan = yield* domain.planGc() as Effect.Effect<{ planId: string; expiresAt: string; candidates: readonly unknown[] }, Error>;
      const document = {
        format: "niceeval.cache-gc-plan",
        schemaVersion: 1,
        plan,
        summary: { candidateCount: plan.candidates.length, exactReclaimBytes: null },
      };
      if (options.json) process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
      else process.stdout.write(`GC preview ${plan.planId} · ${plan.candidates.length} candidates · expires ${plan.expiresAt}\n`);
        return 0;
      }

      const availableDescriptors = descriptors.filter((descriptor) => descriptor.state === "verified-managed" || descriptor.state === "verified-read-only");
      const inventories = yield* Effect.forEach(availableDescriptors, (descriptor) => {
        const adapter = registry.adapters.find((item) => item.providerFamily === descriptor.providerFamily)!;
        return adapter.openDomain(descriptor).pipe(Effect.flatMap((domain) => domain.inventory()));
      }, { concurrency: "unbounded" }) as Effect.Effect<Array<{ domainId: string; backendKind: string; state: string; entries: readonly unknown[] }>, Error>;
      const detailed = selected === undefined ? undefined : inventories.find((item) => item.domainId === selected.domainId)?.entries;
      const observations = options.domain === undefined
        ? yield* Effect.forEach(registry.adapters, (adapter) => adapter.observeProviderCapacity(), { concurrency: "unbounded" }).pipe(Effect.map((groups) => groups.flat()))
        : [];
    if (options.json) {
      process.stdout.write(`${JSON.stringify({
        format: "niceeval.cache-inventory",
        schemaVersion: 1,
        scope: options.domain === undefined ? { kind: "domains" } : { kind: "domain", domainId: selected!.domainId },
        domains: [
          ...inventories.map(({ entries, ...domain }) => ({ ...domain, entryCount: entries.length })),
          ...descriptors.filter((descriptor) => descriptor.state === "unavailable" || descriptor.state === "unverified")
            .map((descriptor) => ({ ...descriptor, entryCount: null })),
        ],
        providerObservations: observations,
        ...(detailed === undefined ? {} : { entries: detailed }),
      }, null, 2)}\n`);
      return 0;
    }
      const taskDomain = inventories[0]!;
      const observation = observations[0]!;
    process.stdout.write(
      `Docker images · managed · ${taskDomain.domainId} · ${taskDomain.entries.length} entries\n` +
      `BuildKit · unverified shared-builder capacity\n` +
      `  total ${humanSize(observation.totalBytes)} · provider reclaimable estimate ${humanSize(observation.reclaimableEstimateBytes)}\n` +
      `  NiceEval ownership unknown · not eligible for NiceEval GC\n` +
      `  Provider prune may affect other projects, builder sessions, and builds currently in progress.\n`,
    );
      return 0;
    }).pipe(Effect.provide(CacheAdministrationLive)));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`cache command failed: ${message}\n`);
    return /expired|corrupt|authority changed/iu.test(message) ? 3 : 4;
  }
}
