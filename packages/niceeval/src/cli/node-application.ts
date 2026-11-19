import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { Effect, Layer, Predicate, Schema } from "effect";
import {
  CliArguments,
  CliConfirmation,
  CliInvocationError,
  CliInvocationFacts,
  CliOutput,
  CliPath,
  PackageMetadata,
  type CliOptionDefinition,
  type CliParsedToken,
} from "./application.ts";

const failure = (operation: string, cause: unknown) => new CliInvocationError({ operation, cause });

type CliStdin = NodeJS.ReadStream | (NodeJS.ReadableStream & { isTTY?: false });
type CliWritable = NodeJS.WriteStream | (NodeJS.WritableStream & { isTTY?: false; columns?: number; rows?: number });

export interface NodeCliInvocation {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: CliStdin;
  readonly stdout: CliWritable;
  readonly stderr: CliWritable;
}

const processInvocation = (): NodeCliInvocation => ({
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});

function invocationFacts(invocation: () => NodeCliInvocation) {
  return Layer.succeed(CliInvocationFacts, {
    facts: Effect.sync(() => {
      const { cwd, argv, env, stdout, stderr } = invocation();
      return {
        cwd,
        argv,
        hostname: hostname(),
        pid: process.pid,
        platform: process.platform,
        noColor: env.NO_COLOR,
        stdout: { isTTY: stdout.isTTY === true, columns: stdout.columns },
        stderr: { isTTY: stderr.isTTY === true, columns: stderr.columns },
      };
    }),
  });
}

export function ignoreBrokenOutputPipe(cause: unknown): void {
  if (!Predicate.hasProperty(cause, "code") || cause.code !== "EPIPE") throw cause;
}

function writeNodeOutput(stream: NodeJS.WritableStream, text: string): void {
  // These process-owned streams can emit errors after the application Scope
  // closes. Keep one listener per stream, including standalone CliOutput use.
  if (!stream.listeners("error").includes(ignoreBrokenOutputPipe)) {
    stream.on("error", ignoreBrokenOutputPipe);
  }
  try {
    stream.write(text);
  } catch (cause) {
    ignoreBrokenOutputPipe(cause);
    // Notify bootstrap's interruption owner for synchronous failures too.
    stream.emit("error", cause);
  }
}

function cliOutput(stdout: CliWritable, stderr: CliWritable, write: typeof writeNodeOutput) {
  return Layer.succeed(CliOutput, {
    writeStdout: (text) =>
      Effect.try({ try: () => write(stdout, text), catch: (cause) => failure("write-stdout", cause) }),
    writeStderr: (text) =>
      Effect.try({ try: () => write(stderr, text), catch: (cause) => failure("write-stderr", cause) }),
    writeStdoutSync: (text) => write(stdout, text),
    writeStderrSync: (text) => write(stderr, text),
  });
}

function cliConfirmation(stdin: CliStdin, stderr: CliWritable) {
  return Layer.succeed(CliConfirmation, {
    confirm: (message) =>
      Effect.suspend(() => {
        if (stdin.isTTY !== true || stderr.isTTY !== true) return Effect.succeed(false);
        return Effect.acquireUseRelease(
          Effect.sync(() => createInterface({ input: stdin, output: stderr })),
          (terminal) =>
            Effect.tryPromise({
              try: (signal) => terminal.question(`${message} [y/N] `, { signal }),
              catch: (cause) => failure("confirm", cause),
            }).pipe(Effect.map((answer) => /^y(?:es)?$/iu.test(answer.trim()))),
          (terminal) => Effect.sync(() => terminal.close()),
        );
      }),
  });
}

interface OptionalValueOccurrence {
  readonly name: string;
  readonly value: string | true;
  readonly inlineValue: boolean | undefined;
}

interface NormalizedCliArgv {
  readonly argv: readonly string[];
  readonly originalIndexes: readonly number[];
  readonly optionalValues: ReadonlyMap<number, OptionalValueOccurrence>;
}

function invalidOptionalValue(name: string, value: string, values: readonly string[] | undefined): TypeError {
  const expected =
    values === undefined ? "a non-empty value" : values.map((candidate) => JSON.stringify(candidate)).join(" or ");
  const error = new TypeError(`Option '--${name}' received ${JSON.stringify(value)}; expected ${expected}`);
  Object.defineProperty(error, "code", {
    configurable: true,
    enumerable: true,
    value: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
  });
  return error;
}

function explicitOptionalValue(name: string, value: string, values: readonly string[] | undefined): string {
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
      const consumesNext =
        next !== undefined &&
        !next.startsWith("-") &&
        (optional.values === undefined || optional.values.includes(next));
      if (consumesNext) {
        value = explicitOptionalValue(name, next!, optional.values);
        inlineValue = false;
        originalIndex += 1;
      }
    }

    normalized.push(`--${name}`);
    originalIndexes.push(optionOriginalIndex);
    optionalValues.set(normalizedIndex, {
      name,
      value,
      inlineValue,
    });
  }

  return {
    argv: normalized,
    originalIndexes: originalIndexes,
    optionalValues,
  };
}

export const NodeCliArgumentsLive = Layer.succeed(CliArguments, {
  parse: (argv, options) => {
    const normalized = normalizeCliArgv(argv, options);
    const parserOptions = Object.fromEntries(
      Object.entries(options).map(([name, option]) => [
        name,
        {
          type: option.type,
          ...(option.multiple === undefined ? {} : { multiple: option.multiple }),
          ...(option.short === undefined ? {} : { short: option.short }),
        },
      ]),
    );
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
      if (token.kind !== "option") return { ...token, index } as CliParsedToken;
      const occurrence = normalized.optionalValues.get(token.index);
      return occurrence === undefined
        ? ({ ...token, index } as CliParsedToken)
        : {
            kind: "option" as const,
            index,
            name: token.name,
            rawName: token.rawName,
            ...(typeof occurrence.value === "string"
              ? {
                  value: occurrence.value,
                  ...(occurrence.inlineValue === undefined ? {} : { inlineValue: occurrence.inlineValue }),
                }
              : {}),
          };
    });
    return {
      values: values,
      positionals: parsed.positionals,
      tokens: tokens,
    };
  },
});

export const NodeCliPathLive = Layer.succeed(CliPath, { resolve, isAbsolute });

const decodePackageMetadata = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
);

export const NodePackageMetadataLive = Layer.succeed(PackageMetadata, {
  version: Effect.tryPromise({
    try: async () =>
      decodePackageMetadata(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version,
    catch: (cause) => failure("read-package-metadata", cause),
  }),
});

const nodeCliPlatform = (
  facts: () => NodeCliInvocation,
  { stdin, stdout, stderr }: Pick<NodeCliInvocation, "stdin" | "stdout" | "stderr">,
  write: typeof writeNodeOutput,
) =>
  Layer.mergeAll(
    invocationFacts(facts),
    cliOutput(stdout, stderr, write),
    cliConfirmation(stdin, stderr),
    NodeCliArgumentsLive,
    NodeCliPathLive,
    NodePackageMetadataLive,
  );

export const NodeCliOutputLive = Layer.unwrap(
  Effect.sync(() => cliOutput(process.stdout, process.stderr, writeNodeOutput)),
);

export const NodeCliPlatformLive = Layer.unwrap(
  Effect.sync(() => nodeCliPlatform(processInvocation, process, writeNodeOutput)),
);

export const nodeCliInvocationLayer = (invocation: NodeCliInvocation) =>
  nodeCliPlatform(
    () => invocation,
    invocation,
    (stream, text) => {
      stream.write(text);
    },
  );
