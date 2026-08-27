import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Effect, Layer } from "effect";
import {
  CliArguments,
  CliInvocationError,
  CliInvocationFacts,
  CliOutput,
  CliPath,
  PackageMetadata,
  type CliOptionDefinition,
  type CliParsedToken,
} from "./application.ts";

const failure = (operation: string, cause: unknown) => new CliInvocationError({ operation, cause });

export const NodeInvocationFactsLive = Layer.succeed(CliInvocationFacts, {
  facts: Effect.sync(() => Object.freeze({
    cwd: process.cwd(), argv: Object.freeze(process.argv.slice(2)), hostname: hostname(), pid: process.pid, platform: process.platform,
    noColor: process.env.NO_COLOR,
    stdout: Object.freeze({ isTTY: process.stdout.isTTY === true, columns: process.stdout.columns }),
    stderr: Object.freeze({ isTTY: process.stderr.isTTY === true, columns: process.stderr.columns }),
  })),
});

export const NodeCliOutputLive = Layer.succeed(CliOutput, {
  writeStdout: (text) => Effect.try({ try: () => { process.stdout.write(text); }, catch: (cause) => failure("write-stdout", cause) }),
  writeStderr: (text) => Effect.try({ try: () => { process.stderr.write(text); }, catch: (cause) => failure("write-stderr", cause) }),
  writeStdoutSync: (text) => { process.stdout.write(text); },
  writeStderrSync: (text) => { process.stderr.write(text); },
});

interface OptionalValueOccurrence {
  readonly name: string;
  readonly value: string | true;
  readonly inlineValue?: boolean;
}

interface NormalizedCliArgv {
  readonly argv: readonly string[];
  readonly originalIndexes: readonly number[];
  readonly optionalValues: ReadonlyMap<number, OptionalValueOccurrence>;
}

function invalidOptionalValue(name: string, value: string, values: readonly string[] | undefined): TypeError {
  const expected = values === undefined ? "a non-empty value" : values.map((candidate) => JSON.stringify(candidate)).join(" or ");
  const error = new TypeError(`Option '--${name}' received ${JSON.stringify(value)}; expected ${expected}`);
  Object.defineProperty(error, "code", {
    configurable: true,
    enumerable: true,
    value: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
  });
  return error;
}

function explicitOptionalValue(
  name: string,
  value: string,
  values: readonly string[] | undefined,
): string {
  if (value.length === 0 || (values !== undefined && !values.includes(value))) {
    throw invalidOptionalValue(name, value, values);
  }
  return value;
}

/**
 * Node parseArgs intentionally has no boolean|string union option. Normalize
 * only options whose owning schema declares that syntax, while retaining an
 * exact index map back to the original argv for root projection.
 */
function normalizeCliArgv(
  argv: readonly string[],
  options: Readonly<Record<string, CliOptionDefinition>>,
): NormalizedCliArgv {
  const normalized: string[] = [];
  const originalIndexes: number[] = [];
  const optionalValues = new Map<number, OptionalValueOccurrence>();

  for (let originalIndex = 0; originalIndex < argv.length; originalIndex += 1) {
    const token = argv[originalIndex]!;
    if (token === "--") {
      for (; originalIndex < argv.length; originalIndex += 1) {
        normalized.push(argv[originalIndex]!);
        originalIndexes.push(originalIndex);
      }
      break;
    }

    const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/u.exec(token);
    const name = match?.[1];
    const definition = name === undefined ? undefined : options[name];
    const optional = definition?.optionalValue;
    if (name === undefined || optional === undefined) {
      normalized.push(token);
      originalIndexes.push(originalIndex);
      continue;
    }

    const normalizedIndex = normalized.length;
    const optionOriginalIndex = originalIndex;
    let value: string | true = optional.default;
    let inlineValue: boolean | undefined;
    if (match![2] !== undefined) {
      value = explicitOptionalValue(name, match![2]!, optional.values);
      inlineValue = true;
    } else if (optional.separated === true) {
      const next = argv[originalIndex + 1];
      const consumesNext = next !== undefined && !next.startsWith("-") &&
        (optional.values === undefined || optional.values.includes(next));
      if (consumesNext) {
        value = explicitOptionalValue(name, next!, optional.values);
        inlineValue = false;
        originalIndex += 1;
      }
    }

    normalized.push(`--${name}`);
    originalIndexes.push(optionOriginalIndex);
    optionalValues.set(normalizedIndex, Object.freeze({
      name,
      value,
      ...(inlineValue === undefined ? {} : { inlineValue }),
    }));
  }

  return Object.freeze({
    argv: Object.freeze(normalized),
    originalIndexes: Object.freeze(originalIndexes),
    optionalValues,
  });
}

export const NodeCliArgumentsLive = Layer.succeed(CliArguments, {
  parse: (argv, options) => {
    const normalized = normalizeCliArgv(argv, options);
    const parserOptions = Object.fromEntries(Object.entries(options).map(([name, option]) => [name, {
      type: option.type,
      ...(option.multiple === undefined ? {} : { multiple: option.multiple }),
      ...(option.short === undefined ? {} : { short: option.short }),
    }]));
    const parsed = parseArgs({
      args: [...normalized.argv],
      options: parserOptions,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
    const values = { ...parsed.values } as Record<string, string | boolean | string[] | undefined>;
    for (const occurrence of normalized.optionalValues.values()) values[occurrence.name] = occurrence.value;
    const tokens = parsed.tokens.map((token): CliParsedToken => {
      const index = normalized.originalIndexes[token.index];
      if (index === undefined) throw new Error(`CLI parser returned an unmapped argv index ${token.index}`);
      if (token.kind !== "option") return Object.freeze({ ...token, index }) as CliParsedToken;
      const occurrence = normalized.optionalValues.get(token.index);
      return occurrence === undefined
        ? Object.freeze({ ...token, index }) as CliParsedToken
        : Object.freeze({
            kind: "option" as const,
            index,
            name: token.name,
            rawName: token.rawName,
            ...(typeof occurrence.value === "string" ? {
              value: occurrence.value,
              inlineValue: occurrence.inlineValue,
            } : {}),
          });
    });
    return Object.freeze({
      values: Object.freeze(values),
      positionals: Object.freeze([...parsed.positionals]),
      tokens: Object.freeze(tokens),
    });
  },
});

export const NodeCliPathLive = Layer.succeed(CliPath, { resolve, isAbsolute });

export const NodePackageMetadataLive = Layer.succeed(PackageMetadata, {
  version: Effect.tryPromise({
    try: async () => JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version as string,
    catch: (cause) => failure("read-package-metadata", cause),
  }),
});

export const NodeCliPlatformLive = Layer.mergeAll(
  NodeInvocationFactsLive,
  NodeCliOutputLive,
  NodeCliArgumentsLive,
  NodeCliPathLive,
  NodePackageMetadataLive,
);
