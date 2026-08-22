import { Data, type Effect } from "effect";

/** A feature-owned root command. Commands are immutable values, not services or registrations. */
export interface CliCommandContribution<R, E> {
  readonly name: string;
  readonly summary: string;
  readonly run: (argv: readonly string[]) => Effect.Effect<number, E, R>;
}

export class CliCommandCompositionError extends Error {
  readonly _tag = "CliCommandCompositionError";
}

/** Feature-owned typed failure consumed by the one CLI failure boundary. */
export class CliFeatureError extends Data.TaggedError("CliFeatureError")<{
  readonly feature: string;
  readonly operation: string;
  readonly cause: unknown;
  readonly exitCode: number;
}> {}

const COMMAND_NAME = /^[a-z][a-z0-9-]*$/u;

/** Validate once at the composition edge and preserve the caller's deterministic help order. */
export function composeCliCommands<R, E>(
  coreNames: readonly string[],
  contributions: readonly CliCommandContribution<R, E>[],
): readonly CliCommandContribution<R, E>[] {
  const occupied = new Set(coreNames);
  const result: CliCommandContribution<R, E>[] = [];
  for (const contribution of contributions) {
    if (!COMMAND_NAME.test(contribution.name)) {
      throw new CliCommandCompositionError(`Invalid CLI feature command name: ${JSON.stringify(contribution.name)}`);
    }
    if (contribution.summary.trim() === "") {
      throw new CliCommandCompositionError(`CLI feature command ${contribution.name} requires a summary`);
    }
    if (occupied.has(contribution.name)) {
      throw new CliCommandCompositionError(`Duplicate CLI root command: ${contribution.name}`);
    }
    occupied.add(contribution.name);
    result.push(Object.freeze(contribution));
  }
  return Object.freeze(result);
}

/** Root feature routing happens before the core flag parser can rewrite feature argv. */
export function matchCliFeatureCommand<R, E>(
  argv: readonly string[],
  contributions: readonly CliCommandContribution<R, E>[],
): { readonly command: CliCommandContribution<R, E>; readonly argv: readonly string[] } | undefined {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const name = normalized[0];
  if (name === undefined) return undefined;
  const command = contributions.find((candidate) => candidate.name === name);
  return command === undefined ? undefined : Object.freeze({ command, argv: Object.freeze(normalized.slice(1)) });
}

export function renderFeatureCommandIndex<R, E>(
  contributions: readonly CliCommandContribution<R, E>[],
): string {
  if (contributions.length === 0) return "";
  return `\nFeature commands:\n${contributions.map(({ name, summary }) => `  niceeval ${name.padEnd(12)} ${summary}`).join("\n")}\n`;
}
