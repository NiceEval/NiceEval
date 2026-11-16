import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Data, Effect, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const TIMEOUT_MS = 30 * 60 * 1000;

export class ConcordCliResponseInvalid extends Data.TaggedError("ConcordCliResponseInvalid")<{
  readonly op: string;
  readonly message: string;
}> {}
export class ConcordCliFailed extends Data.TaggedError("ConcordCliFailed")<{
  readonly op: string;
  readonly message: string;
}> {}
export class ConcordCliTimeout extends Data.TaggedError("ConcordCliTimeout")<{
  readonly op: string;
  readonly message: string;
}> {}
export class ConcordCliOutputLimit extends Data.TaggedError("ConcordCliOutputLimit")<{
  readonly op: string;
  readonly message: string;
}> {}

/** Transport syntax/budgets only. Governance validation belongs to the CLI. */
export function parseConcordCliJson(text: string): unknown {
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("JSON exceeds 32 MiB");
  let position = 0;
  let nodes = 0;
  const whitespace = () => {
    while (/[\t\n\r ]/u.test(text[position] ?? "\0")) position++;
  };
  const invalid = (message: string): never => {
    throw new Error(`${message} at offset ${position}`);
  };
  const string = (): string => {
    const start = position++;
    for (; position < text.length; position++) {
      const char = text[position];
      if (char === "\\") {
        position++;
        continue;
      }
      if (char === '"') return JSON.parse(text.slice(start, ++position)) as string;
    }
    return invalid("Unterminated JSON string");
  };
  const value = (depth: number): unknown => {
    if (++nodes > 200000) return invalid("JSON exceeds 200000 nodes");
    whitespace();
    const char = text[position];
    if ((char === "{" || char === "[") && depth >= 64) return invalid("JSON exceeds depth 64");
    if (char === '"') return string();
    if (char === "{") {
      position++;
      whitespace();
      const object: Record<string, unknown> = Object.create(null);
      if (text[position] === "}") {
        position++;
        return object;
      }
      for (;;) {
        whitespace();
        if (text[position] !== '"') return invalid("Expected JSON object key");
        const key = string();
        if (Object.hasOwn(object, key)) return invalid("Duplicate JSON key");
        whitespace();
        if (text[position++] !== ":") return invalid("Expected JSON colon");
        object[key] = value(depth + 1);
        whitespace();
        const separator = text[position++];
        if (separator === "}") return object;
        if (separator !== ",") return invalid("Expected JSON object separator");
      }
    }
    if (char === "[") {
      position++;
      whitespace();
      const array: unknown[] = [];
      if (text[position] === "]") {
        position++;
        return array;
      }
      for (;;) {
        if (array.length >= 50000) return invalid("JSON array exceeds 50000 items");
        array.push(value(depth + 1));
        whitespace();
        const separator = text[position++];
        if (separator === "]") return array;
        if (separator !== ",") return invalid("Expected JSON array separator");
      }
    }
    for (const [token, decoded] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(token, position)) {
        position += token.length;
        return decoded;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(text.slice(position));
    if (!number) return invalid("Expected JSON value");
    position += number[0].length;
    const decoded = Number(number[0]);
    if (!Number.isFinite(decoded)) return invalid("Non-finite JSON number");
    return decoded;
  };
  const decoded = value(0);
  whitespace();
  if (position !== text.length) return invalid("Trailing JSON output");
  return decoded;
}

function collectOutput<E>(stream: Stream.Stream<Uint8Array, E>, op: string, channel: string, limit: number) {
  return Effect.gen(function* () {
    let size = 0;
    const chunks: Uint8Array[] = [];
    yield* Stream.runForEach(stream, (chunk) => {
      size += chunk.byteLength;
      if (size > limit)
        return Effect.fail(new ConcordCliOutputLimit({ op, message: `${channel} exceeds ${limit} bytes` }));
      chunks.push(chunk);
      return Effect.void;
    });
    return Buffer.concat(chunks);
  });
}

/** Bounded, scoped transport; stderr is drained but never exposed as it may contain input. */
const runProcess = Effect.fn("concord.runProcess")(function* (root: string, command: string, args: readonly string[]) {
  const op = command === "concord" ? args.join(" ") : command;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const environment = { ...process.env };
      for (const name of Object.keys(environment))
        if (name.startsWith("GIT_") || name === "NODE_TEST_CONTEXT") delete environment[name];
      environment.GIT_TERMINAL_PROMPT = "0";
      environment.GIT_NO_REPLACE_OBJECTS = "1";
      environment.GIT_GRAFT_FILE = process.platform === "win32" ? "NUL" : "/dev/null";
      environment.GIT_NO_LAZY_FETCH = "1";
      const child = yield* ChildProcess.make(command, args, {
        cwd: root,
        shell: false,
        env: environment,
        killSignal: "SIGTERM",
        forceKillAfter: "2 seconds",
      });
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectOutput(child.stdout, op, "stdout", MAX_BYTES),
          collectOutput(child.stderr, op, "stderr", MAX_STDERR_BYTES),
          child.exitCode,
          Stream.run(Stream.empty, child.stdin),
        ],
        { concurrency: "unbounded" },
      );
      if (Number(exitCode) !== 0) {
        let code: string | undefined;
        if (command === "concord")
          for (const bytes of [stdout, stderr]) {
            try {
              code = Schema.decodeUnknownSync(
                Schema.Struct({
                  ok: Schema.Literal(false),
                  error: Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9]{0,127}$/u)),
                }),
                { onExcessProperty: "ignore" },
              )(parseConcordCliJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))).error;
              break;
            } catch {
              /* Never echo arbitrary subprocess output or input data. */
            }
          }
        return yield* new ConcordCliFailed({
          op,
          message: `${command} exited ${exitCode}${code === undefined ? "" : ` (${code})`}`,
        });
      }
      return stdout;
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: TIMEOUT_MS,
      orElse: () => Effect.fail(new ConcordCliTimeout({ op, message: `command exceeded ${TIMEOUT_MS} ms` })),
    }),
    Effect.mapError((error) =>
      error instanceof ConcordCliOutputLimit || error instanceof ConcordCliFailed || error instanceof ConcordCliTimeout
        ? error
        : new ConcordCliFailed({ op, message: `Unable to run ${command}` }),
    ),
  );
});

export const requestConcordCli = Effect.fn("requestConcordCli")(function* (root: string, args: readonly string[]) {
  const output = yield* runProcess(root, "concord", ["--root", root, "--json", "--server", "command", ...args]);
  return yield* Effect.try({
    try: () => parseConcordCliJson(new TextDecoder("utf-8", { fatal: true }).decode(output)),
    catch: (error) => new ConcordCliResponseInvalid({ op: args.join(" "), message: String(error) }),
  });
});

// Decode the public fields consumed here; additive CLI fields are intentionally projected away.
const PublicCaseSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^neref_[0-9a-f]{32}$/u)),
  file: Schema.String.check(Schema.isPattern(/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\\0\r\n]+$/u)),
  line: Schema.Int.check(Schema.isGreaterThan(0)),
  name: Schema.NonEmptyString,
  contract: Schema.NonEmptyString,
  contractKind: Schema.Literals(["feature", "use-case"]),
  issues: Schema.Array(Schema.NonEmptyString),
  status: Schema.Literals(["active", "retired"]),
  framework: Schema.Literals(["node:test", "vitest", "@playwright/test", "marker"]),
  skipped: Schema.Boolean,
});
const TestListSchema = Schema.Struct({ operation: Schema.Literal("test-list"), cases: Schema.Array(PublicCaseSchema) });
export const readConcordTestList = Effect.fn("readConcordTestList")(function* (root: string) {
  const value = yield* requestConcordCli(root, ["test", "list"]);
  return (yield* Schema.decodeUnknownEffect(TestListSchema, { onExcessProperty: "ignore" })(value).pipe(
    Effect.mapError((error) => new ConcordCliResponseInvalid({ op: "test list", message: String(error) })),
  )).cases;
});

/** Historical queries must run against a real isolated checkout, including its config and contracts. */
export const readConcordTestListAtRevision = Effect.fn("readConcordTestListAtRevision")(function* (
  root: string,
  revision: string,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const temporary = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => mkdtemp(join(tmpdir(), "niceeval-pr-history-")),
          catch: (error) => new ConcordCliFailed({ op: "history", message: String(error) }),
        }),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      const checkout = join(temporary, "checkout");
      yield* runProcess(root, "git", [
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--shared",
        "--no-checkout",
        "--",
        root,
        checkout,
      ]);
      yield* runProcess(checkout, "git", ["-c", "core.hooksPath=/dev/null", "checkout", "--detach", revision]);
      return yield* readConcordTestList(checkout);
    }),
  );
});
