import { Data, type Effect } from "effect";
import type { CliOptionDefinition, CliParsedToken, CliParsedTokens } from "./application.ts";

/** A feature-owned root command. Commands are immutable values, not services or registrations. */
export interface CliCommandContribution<R, E> {
  readonly name: string;
  readonly summary: string;
  /** Complete parser schema for options this root command actually owns. */
  readonly options: Readonly<Record<string, CliOptionDefinition>>;
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
  /** Feature-owned terminal text; the root only writes it once. */
  readonly display?: string;
}> {}

const COMMAND_NAME = /^[a-z][a-z0-9-]*$/u;
const OPTION_NAME = /^[a-z][a-z0-9-]*$/u;

function sameOptionShape(left: CliOptionDefinition, right: CliOptionDefinition): boolean {
  const leftOptional = left.optionalValue;
  const rightOptional = right.optionalValue;
  return left.type === right.type &&
    left.multiple === right.multiple &&
    left.short === right.short &&
    (leftOptional === undefined
      ? rightOptional === undefined
      : rightOptional !== undefined &&
        leftOptional.default === rightOptional.default &&
        leftOptional.separated === rightOptional.separated &&
        (leftOptional.values === undefined
          ? rightOptional.values === undefined
          : rightOptional.values !== undefined &&
            leftOptional.values.length === rightOptional.values.length &&
            leftOptional.values.every((value, index) => value === rightOptional.values![index])));
}

function validateOptionSchema(name: string, options: Readonly<Record<string, CliOptionDefinition>>): void {
  if (!Object.isFrozen(options)) {
    throw new CliCommandCompositionError(`CLI feature command ${name} must freeze its option schema`);
  }
  const shortNames = new Set<string>();
  for (const [optionName, option] of Object.entries(options)) {
    if (!OPTION_NAME.test(optionName)) {
      throw new CliCommandCompositionError(`Invalid CLI option name ${JSON.stringify(optionName)} for ${name}`);
    }
    if (!Object.isFrozen(option) || option.help === undefined || !Object.isFrozen(option.help)) {
      throw new CliCommandCompositionError(`CLI option --${optionName} for ${name} must be immutable`);
    }
    if ((option.type !== "string" && option.type !== "boolean") || (option.multiple !== undefined && option.multiple !== true)) {
      throw new CliCommandCompositionError(`Invalid parser shape for CLI option --${optionName} on ${name}`);
    }
    if (option.optionalValue !== undefined) {
      const optional = option.optionalValue;
      if (option.type !== "boolean" || option.multiple !== undefined || option.short !== undefined || !Object.isFrozen(optional)) {
        throw new CliCommandCompositionError(
          `CLI option --${optionName} on ${name} has an invalid optional-value shape`,
        );
      }
      if (optional.default !== true && (typeof optional.default !== "string" || optional.default.length === 0)) {
        throw new CliCommandCompositionError(
          `CLI option --${optionName} on ${name} requires a non-empty optional-value default`,
        );
      }
      if (optional.values !== undefined) {
        if (!Object.isFrozen(optional.values) || optional.values.length === 0 ||
          optional.values.some((value) => value.length === 0) ||
          new Set(optional.values).size !== optional.values.length ||
          (typeof optional.default === "string" && !optional.values.includes(optional.default))) {
          throw new CliCommandCompositionError(
            `CLI option --${optionName} on ${name} requires a frozen, unique optional-value vocabulary containing its default`,
          );
        }
      }
    }
    if (option.short !== undefined) {
      if (!/^[A-Za-z0-9]$/u.test(option.short) || shortNames.has(option.short)) {
        throw new CliCommandCompositionError(`Invalid or duplicate short option ${JSON.stringify(option.short)} on ${name}`);
      }
      shortNames.add(option.short);
    }
    if (option.help.summary.trim() === "" || (option.help.visibility !== "public" && option.help.visibility !== "hidden")) {
      throw new CliCommandCompositionError(`CLI option --${optionName} on ${name} requires valid help metadata`);
    }
  }
}

/** Validate once at the composition edge and preserve the caller's deterministic help order. */
export function composeCliCommands<R, E>(
  contributions: readonly CliCommandContribution<R, E>[],
): readonly CliCommandContribution<R, E>[] {
  const occupied = new Set<string>();
  const result: CliCommandContribution<R, E>[] = [];
  for (const contribution of contributions) {
    if (!Object.isFrozen(contribution)) {
      throw new CliCommandCompositionError(`CLI feature command ${contribution.name} must be immutable`);
    }
    if (!COMMAND_NAME.test(contribution.name)) {
      throw new CliCommandCompositionError(`Invalid CLI feature command name: ${JSON.stringify(contribution.name)}`);
    }
    if (contribution.summary.trim() === "") {
      throw new CliCommandCompositionError(`CLI feature command ${contribution.name} requires a summary`);
    }
    validateOptionSchema(contribution.name, contribution.options);
    if (occupied.has(contribution.name)) {
      throw new CliCommandCompositionError(`Duplicate CLI root command: ${contribution.name}`);
    }
    occupied.add(contribution.name);
    result.push(Object.freeze(contribution));
  }
  // Composition must reject parser conflicts even before a caller asks for the
  // aggregate schema used by the root parser.
  composeCliOptionSchema(result);
  return Object.freeze(result);
}

/**
 * Merge feature-owned schemas at the composition edge. Reusing an option name is
 * only sound when Node will parse it with exactly the same syntax in every owner.
 */
export function composeCliOptionSchema<R, E>(
  contributions: readonly CliCommandContribution<R, E>[],
  applicationOptions: Readonly<Record<string, CliOptionDefinition>> = {},
): Readonly<Record<string, CliOptionDefinition>> {
  const options: Record<string, CliOptionDefinition> = {};
  const owners = new Map<string, string>();
  const shortOwners = new Map<string, { readonly name: string; readonly owner: string }>();
  for (const [name, option] of Object.entries(applicationOptions)) {
    options[name] = Object.freeze({ ...option });
    owners.set(name, "application");
    if (option.short !== undefined) shortOwners.set(option.short, { name, owner: "application" });
  }
  for (const contribution of contributions) {
    validateOptionSchema(contribution.name, contribution.options);
    for (const [name, option] of Object.entries(contribution.options)) {
      const existing = options[name];
      if (existing !== undefined && !sameOptionShape(existing, option)) {
        throw new CliCommandCompositionError(
          `Conflicting CLI option --${name}: ${owners.get(name)} and ${contribution.name} declare different parser shapes`,
        );
      }
      if (existing === undefined) {
        options[name] = option;
        owners.set(name, contribution.name);
      }
      if (option.short !== undefined) {
        const priorShort = shortOwners.get(option.short);
        if (priorShort !== undefined && priorShort.name !== name) {
          throw new CliCommandCompositionError(
            `Conflicting CLI short option -${option.short}: --${priorShort.name} (${priorShort.owner}) and --${name} (${contribution.name})`,
          );
        }
        shortOwners.set(option.short, { name, owner: contribution.name });
      }
    }
  }
  return Object.freeze(options);
}

export interface CliRootToken {
  readonly index: number;
  readonly name: string;
}

/** First positional Node token identifies the root without rewriting the raw argv. */
export function locateCliRoot(tokens: readonly CliParsedToken[]): CliRootToken | undefined {
  const token = tokens.find((candidate) => candidate.kind === "positional");
  return token === undefined ? undefined : Object.freeze({ index: token.index, name: token.value });
}

/** Delete exactly the command token: flags before/after it and `--` retain byte order. */
export function projectCliArgvWithoutRoot(
  argv: readonly string[],
  root: CliRootToken,
): readonly string[] {
  if (root.index < 0 || root.index >= argv.length || argv[root.index] !== root.name) {
    throw new CliCommandCompositionError(`CLI root token ${JSON.stringify(root.name)} has an invalid argv index`);
  }
  return Object.freeze(argv.filter((_, index) => index !== root.index));
}

function precedingGlobalHelpOrVersion(tokens: readonly CliParsedToken[], root: CliRootToken): boolean {
  return tokens.some((token) => token.kind === "option" && token.index < root.index &&
    (token.name === "help" || token.name === "version"));
}

export type CliFeatureRoute<R, E> =
  | Readonly<{
      readonly kind: "application-option";
      readonly option: "help" | "version";
      readonly root: CliRootToken;
    }>
  | Readonly<{
      readonly kind: "command";
      readonly command: CliCommandContribution<R, E>;
      readonly argv: readonly string[];
      readonly root: CliRootToken;
    }>;

/** Route one indexed root token while keeping application help/version formal capabilities. */
export function matchCliFeatureCommand<R, E>(
  argv: readonly string[],
  parsed: CliParsedTokens,
  contributions: readonly CliCommandContribution<R, E>[],
): CliFeatureRoute<R, E> | undefined {
  const root = locateCliRoot(parsed.tokens);
  if (root === undefined) return undefined;
  const command = contributions.find((candidate) => candidate.name === root.name);
  if (command === undefined) return undefined;

  const applicationHelp = parsed.tokens.some((token) => token.kind === "option" && token.name === "help" &&
    (token.index < root.index || !Object.hasOwn(command.options, "help")));
  if (applicationHelp) return Object.freeze({ kind: "application-option", option: "help", root });
  const applicationVersion = parsed.tokens.some((token) => token.kind === "option" && token.name === "version" &&
    (token.index < root.index || !Object.hasOwn(command.options, "version")));
  if (applicationVersion) return Object.freeze({ kind: "application-option", option: "version", root });
  if (precedingGlobalHelpOrVersion(parsed.tokens, root)) {
    throw new CliCommandCompositionError("Application help/version routing lost its owner");
  }
  return Object.freeze({ kind: "command", command, argv: projectCliArgvWithoutRoot(argv, root), root });
}

export function renderFeatureCommandIndex<R, E>(
  contributions: readonly CliCommandContribution<R, E>[],
): string {
  if (contributions.length === 0) return "";
  return `\nFeature commands:\n${contributions.map(({ name, summary }) => `  niceeval ${name.padEnd(12)} ${summary}`).join("\n")}\n`;
}
