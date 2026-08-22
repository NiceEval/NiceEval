import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface DockerDfRow {
  readonly Type?: unknown;
  readonly Size?: unknown;
  readonly Reclaimable?: unknown;
}

interface BuildKitObservation {
  readonly scope: "provider";
  readonly backendKind: "buildkit";
  readonly state: "unverified";
  readonly observedAt: string;
  readonly totalBytes: number | null;
  readonly reclaimableEstimateBytes: number | null;
  readonly reason: "shared-builder-unattributed";
}

function bytes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?b)$/iu.exec(value.trim());
  if (match === null) return null;
  const unit = match[2]!.toLowerCase();
  const power = ["b", "kb", "mb", "gb", "tb", "pb"].indexOf(unit);
  if (power < 0) return null;
  return Math.round(Number(match[1]) * 1000 ** power);
}

function sizeHead(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().split(/\s+/u)[0] ?? null;
}

async function observeSharedBuildKit(): Promise<BuildKitObservation> {
  const { stdout } = await execFileAsync("docker", ["system", "df", "--format", "json"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const rows = stdout.split(/\r?\n/u).filter(Boolean).map((line): DockerDfRow => JSON.parse(line));
  const build = rows.find((row) => row.Type === "Build Cache");
  return Object.freeze({
    scope: "provider",
    backendKind: "buildkit",
    state: "unverified",
    observedAt: new Date().toISOString(),
    totalBytes: bytes(build?.Size),
    reclaimableEstimateBytes: bytes(sizeHead(build?.Reclaimable)),
    reason: "shared-builder-unattributed",
  });
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

export async function runCacheCommand(
  positionals: readonly string[],
  options: { readonly json: boolean },
): Promise<number> {
  if (positionals.length !== 1 || positionals[0] !== "inventory") {
    process.stderr.write("Usage: niceeval cache inventory [--json]\n");
    return 2;
  }
  try {
    const observation = await observeSharedBuildKit();
    if (options.json) {
      process.stdout.write(`${JSON.stringify({
        format: "niceeval.cache-inventory",
        schemaVersion: 1,
        scope: { kind: "domains" },
        domains: [],
        providerObservations: [observation],
      }, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(
      `BuildKit · unverified shared-builder capacity\n` +
      `  total ${humanSize(observation.totalBytes)} · provider reclaimable estimate ${humanSize(observation.reclaimableEstimateBytes)}\n` +
      `  NiceEval ownership unknown · not eligible for NiceEval GC\n` +
      `  Provider prune may affect other projects, builder sessions, and builds currently in progress.\n`,
    );
    return 0;
  } catch (cause) {
    process.stderr.write(`cache inventory failed: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 4;
  }
}
