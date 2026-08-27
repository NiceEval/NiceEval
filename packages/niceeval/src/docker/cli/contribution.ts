import { Effect } from "effect";
import { CliArguments, CliOutput, type CliOptionDefinition } from "../../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../../cli/contribution.ts";
import { DockerCacheAdministration } from "../cache-administration.ts";
import { runDockerProfileCommand } from "../../sandbox/docker-profile/cli.ts";

export const DOCKER_OPTIONS = Object.freeze({
  /** Render Docker administration results as JSON. */
  json: Object.freeze({ type: "boolean", help: Object.freeze({ summary: "Render Docker administration results as JSON.", visibility: "public" }) }),
  /** Select one NiceEval-owned Docker cache domain. */
  domain: Object.freeze({ type: "string", help: Object.freeze({ summary: "Select one NiceEval-owned Docker cache domain.", visibility: "public" }) }),
  /** Apply a previously issued Docker cache GC plan. */
  apply: Object.freeze({ type: "string", help: Object.freeze({ summary: "Apply a previously issued Docker cache GC plan.", visibility: "public" }) }),
  /** Print Docker command help. */
  help: Object.freeze({ type: "boolean", short: "h", help: Object.freeze({ summary: "Print Docker command help.", visibility: "public" }) }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export type DockerCliError = CliFeatureError;

const DOCKER_HELP = `niceeval docker — Docker-specific administration

Usage:
  niceeval docker profile list [--json]
  niceeval docker profile doctor <alias> [--json]
  niceeval docker cache inventory [--domain <domain-id>] [--json]
  niceeval docker cache gc --domain <domain-id> [--apply <plan-id>] [--json]

Commands:
  profile    inspect and diagnose managed Docker execution profiles
  cache      inspect and safely reclaim NiceEval-owned Docker image cache
`;

const CACHE_HELP = `niceeval docker cache — NiceEval-owned Docker image cache

Usage:
  niceeval docker cache inventory [--domain <domain-id>] [--json]
  niceeval docker cache gc --domain <domain-id> [--apply <plan-id>] [--json]
`;

const dockerFailure = (operation: string, cause: unknown, exitCode = 4) =>
  new CliFeatureError({ feature: "docker", operation, cause, exitCode });

const DOCKER_COMMAND_OPTIONS = Object.freeze({
  "profile/list": Object.freeze(["json", "help"]),
  "profile/doctor": Object.freeze(["json", "help"]),
  "cache/inventory": Object.freeze(["json", "domain", "help"]),
  "cache/gc": Object.freeze(["json", "domain", "apply", "help"]),
  profile: Object.freeze(["help"]),
  cache: Object.freeze(["help"]),
  root: Object.freeze(["help"]),
} satisfies Readonly<Record<string, readonly string[]>>);

function dockerCommandKey(positionals: readonly string[]): keyof typeof DOCKER_COMMAND_OPTIONS {
  const [root, subcommand] = positionals;
  if (root === "profile" && (subcommand === "list" || subcommand === "doctor")) return `profile/${subcommand}`;
  if (root === "cache" && (subcommand === "inventory" || subcommand === "gc")) return `cache/${subcommand}`;
  if (root === "profile") return "profile";
  if (root === "cache") return "cache";
  return "root";
}

function output(
  channel: "stdout" | "stderr",
  text: string,
): Effect.Effect<void, DockerCliError, CliOutput> {
  return Effect.flatMap(CliOutput, (io) => channel === "stdout" ? io.writeStdout(text) : io.writeStderr(text)).pipe(
    Effect.mapError((cause) => dockerFailure(`write ${channel}`, cause)),
  );
}

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

interface CacheInventory {
  readonly domainId: string;
  readonly backendKind: string;
  readonly state: string;
  readonly entries: readonly unknown[];
}

interface GcPlan {
  readonly planId: string;
  readonly expiresAt: string;
  readonly candidates: readonly unknown[];
}

interface GcOutcome {
  readonly planId: string;
  readonly domainId: string;
  readonly outcomes: readonly { readonly buildKey: string; readonly status: string; readonly reason: string }[];
}

function cacheCommand(
  positionals: readonly string[],
  options: { readonly json: boolean; readonly domain?: string; readonly apply?: string; readonly help: boolean },
): Effect.Effect<number, DockerCliError, CliOutput | DockerCacheAdministration> {
  return Effect.gen(function* () {
    const command = positionals.length === 1 ? positionals[0] : undefined;
    if (options.help || command === undefined) {
      yield* output("stdout", CACHE_HELP);
      return command === undefined && !options.help ? 2 : 0;
    }
    if (command !== "inventory" && command !== "gc") {
      yield* output("stderr", `Unknown Docker cache command "${command}".\n${CACHE_HELP}`);
      return 2;
    }
    if (command === "gc" && options.domain === undefined) {
      yield* output("stderr", "docker cache gc requires --domain <domain-id>\n");
      return 2;
    }

    const administration = yield* DockerCacheAdministration;
    const descriptors = yield* administration.listDomains().pipe(
      Effect.mapError((cause) => dockerFailure("list Docker cache domains", cause)),
    );
    const selected = options.domain === undefined
      ? undefined
      : descriptors.find((item) => item.domainId === options.domain);
    if (options.domain !== undefined && selected === undefined) {
      yield* output("stderr", `unknown Docker cache domain ${options.domain}\n`);
      return 2;
    }
    if (selected?.state === "unavailable" || selected?.state === "unverified") {
      yield* output("stderr", `Docker cache domain ${selected.domainId} is ${selected.state}; ownership is not available\n`);
      return 4;
    }

    if (command === "gc") {
      const domain = yield* administration.openDomain(selected!).pipe(
        Effect.mapError((cause) => dockerFailure("open Docker cache domain", cause)),
      );
      if (options.apply !== undefined) {
        const startedAt = new Date().toISOString();
        const result = (yield* domain.applyGc(options.apply).pipe(
          Effect.mapError((cause) => dockerFailure("apply Docker cache GC plan", cause)),
        )) as GcOutcome;
        const document = {
          format: "niceeval.cache-gc-outcome",
          schemaVersion: 1,
          ...result,
          startedAt,
          finishedAt: new Date().toISOString(),
        };
        yield* output("stdout", options.json
          ? `${JSON.stringify(document, null, 2)}\n`
          : `GC plan ${result.planId}\n${result.outcomes.map((item) => `  ${item.status} ${item.buildKey} · ${item.reason}\n`).join("")}`);
        return result.outcomes.some((item) => item.status !== "deleted" && item.status !== "already-absent") ? 1 : 0;
      }
      const plan = (yield* domain.planGc().pipe(
        Effect.mapError((cause) => dockerFailure("plan Docker cache GC", cause)),
      )) as GcPlan;
      const document = {
        format: "niceeval.cache-gc-plan",
        schemaVersion: 1,
        plan,
        summary: { candidateCount: plan.candidates.length, exactReclaimBytes: null },
      };
      yield* output("stdout", options.json
        ? `${JSON.stringify(document, null, 2)}\n`
        : `GC preview ${plan.planId} · ${plan.candidates.length} candidates · expires ${plan.expiresAt}\n`);
      return 0;
    }

    const available = descriptors.filter(({ state }) => state === "verified-managed" || state === "verified-read-only");
    const inventories = (yield* Effect.forEach(available, (descriptor) => administration.openDomain(descriptor).pipe(
      Effect.flatMap((domain) => domain.inventory()),
      Effect.mapError((cause) => dockerFailure("read Docker cache inventory", cause)),
    ), { concurrency: "unbounded" })) as readonly CacheInventory[];
    const observations = options.domain === undefined
      ? yield* administration.observeBuildKitCapacity().pipe(
        Effect.mapError((cause) => dockerFailure("observe Docker BuildKit capacity", cause)),
      )
      : [];
    const detailed = selected === undefined
      ? undefined
      : inventories.find((item) => item.domainId === selected.domainId)?.entries;
    if (options.json) {
      yield* output("stdout", `${JSON.stringify({
        format: "niceeval.cache-inventory",
        schemaVersion: 1,
        scope: selected === undefined ? { kind: "domains" } : { kind: "domain", domainId: selected.domainId },
        domains: [
          ...inventories.map(({ entries, ...domain }) => ({ ...domain, entryCount: entries.length })),
          ...descriptors.filter(({ state }) => state === "unavailable" || state === "unverified")
            .map((descriptor) => ({ ...descriptor, entryCount: null })),
        ],
        providerObservations: observations,
        ...(detailed === undefined ? {} : { entries: detailed }),
      }, null, 2)}\n`);
      return 0;
    }
    const taskDomain = inventories[0];
    const observation = observations[0];
    const text = taskDomain === undefined
      ? "No managed Docker image cache domains.\n"
      : `Docker images · managed · ${taskDomain.domainId} · ${taskDomain.entries.length} entries\n`;
    yield* output("stdout", observation === undefined ? text : text +
      `BuildKit · unverified shared-builder capacity\n` +
      `  total ${humanSize(observation.totalBytes)} · provider reclaimable estimate ${humanSize(observation.reclaimableEstimateBytes)}\n` +
      `  NiceEval ownership unknown · not eligible for NiceEval GC\n` +
      `  Provider prune may affect other projects, builder sessions, and builds currently in progress.\n`);
    return 0;
  });
}

export const dockerCliCommand: CliCommandContribution<
  CliArguments | CliOutput | DockerCacheAdministration,
  DockerCliError
> = Object.freeze({
  name: "docker",
  summary: "inspect Docker profiles, image cache, and BuildKit capacity",
  options: DOCKER_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parser.parse(argv, DOCKER_OPTIONS),
      catch: (cause) => dockerFailure("parse Docker command", cause, 2),
    });
    const positionals = parsed.positionals;
    const providedOptions = parsed.tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name);
    const commandKey = dockerCommandKey(positionals);
    const unsupportedOption = providedOptions.find(
      (name) => !DOCKER_COMMAND_OPTIONS[commandKey].includes(name),
    );
    if (unsupportedOption !== undefined) {
      const commandLabel = positionals.length === 0 ? "" : ` ${positionals.join(" ")}`;
      yield* output(
        "stderr",
        `niceeval docker${commandLabel} does not accept --${unsupportedOption}.\n`,
      );
      return 2;
    }
    const json = parsed.values.json === true;
    const help = parsed.values.help === true;
    const root = positionals[0];
    if (help && root === "cache") return yield* cacheCommand(positionals.slice(1), { json, help: true });
    if (help || root === undefined) {
      yield* output("stdout", DOCKER_HELP);
      return 0;
    }
    if (root === "cache") {
      return yield* cacheCommand(positionals.slice(1), {
        json,
        help: false,
        ...(typeof parsed.values.domain === "string" ? { domain: parsed.values.domain } : {}),
        ...(typeof parsed.values.apply === "string" ? { apply: parsed.values.apply } : {}),
      });
    }
    if (root === "profile") {
      const io = yield* CliOutput;
      return yield* Effect.tryPromise({
        try: () => runDockerProfileCommand(positionals, {
          json,
          out: io.writeStdoutSync,
          err: io.writeStderrSync,
        }),
        catch: (cause) => dockerFailure("run Docker profile command", cause),
      });
    }
    yield* output("stderr", `Unknown Docker command "${root}".\n${DOCKER_HELP}`);
    return 2;
  }),
});
