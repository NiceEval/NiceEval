import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect, Either } from "effect";

import { CliArguments, CliInvocationFacts, CliOutput, type CliOptionDefinition } from "../../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../../cli/contribution.ts";
import {
  canonicalInspectionJson,
  canonicalJsonValue,
  decodeInspectionRequest,
  inspectionBehaviorVersion,
  inspectionHost,
  InspectionHostError,
  InspectionSourceError,
  openInspectionSource,
  operationalInspectionSource,
  snapshotInspectionSource,
  type InspectionDocument,
  type InspectionFailureCode,
  type InspectionFailureDocument,
  type InspectionOperationId,
  type InspectionRequest,
  type InspectionSource,
} from "../index.ts";

const help = (summary: string) => Object.freeze({ summary, visibility: "public" as const });
const option = (value: CliOptionDefinition): CliOptionDefinition => Object.freeze(value);

export const QUERY_CLI_OPTIONS = Object.freeze({
  record: option({ type: "string", help: help("Read one Host-exported RecordSnapshot file.") }),
  request: option({ type: "string", help: help("Read one niceeval.query/v1 request from a file or -.") }),
  help: option({ type: "boolean", short: "h", help: help("Print query help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const QUERY_HELP = `niceeval query — execute one fixed Inspection operation

Usage:
  niceeval query discover [--record <RecordSnapshot>]
  niceeval query explain [--record <RecordSnapshot>] --request <file|->
  niceeval query run [--record <RecordSnapshot>] --request <file|->
`;

type Requirements = CliArguments | CliInvocationFacts | CliOutput;
type Error = CliFeatureError;
const QUERY_FAILURE_EXIT_CODE = 2;

function failure(operation: string, cause: unknown): Error {
  return new CliFeatureError({ feature: "inspection query", operation, cause, exitCode: 1 });
}

function write(channel: "stdout" | "stderr", text: string) {
  return Effect.flatMap(CliOutput, (output) => channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text)).pipe(
    Effect.mapError((cause) => failure(`write ${channel}`, cause)),
  );
}

function usage(message: string) {
  return writeQueryFailure(failure("parse arguments", new Error(message)));
}

function runQuery(argv: readonly string[]): Effect.Effect<number, Error, Requirements> {
  return Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsedResult = yield* Effect.try({
      try: () => parser.parse(argv, QUERY_CLI_OPTIONS),
      catch: (cause) => failure("parse arguments", cause),
    }).pipe(Effect.either);
    if (Either.isLeft(parsedResult)) return yield* writeQueryFailure(parsedResult.left);
    const parsed = parsedResult.right;
    if (parsed.values.help === true) {
      yield* write("stdout", QUERY_HELP);
      return 0;
    }
    if (parsed.positionals.length !== 1 || !["discover", "explain", "run"].includes(parsed.positionals[0]!)) {
      return yield* usage("niceeval query expects exactly one of discover, explain, or run.");
    }
    const action = parsed.positionals[0] as "discover" | "explain" | "run";
    if (action === "discover") {
      if (parsed.values.request !== undefined) return yield* usage("query discover does not accept --request.");
      if (typeof parsed.values.record === "string") {
        const facts = yield* invocationFacts();
        const opened = Effect.scoped(openInspectionSource(snapshotInspectionSource(facts.cwd, parsed.values.record))).pipe(
          Effect.asVoid,
          Effect.mapError((cause) => failure("open Record source", cause)),
        );
        const result = yield* opened.pipe(Effect.either);
        if (Either.isLeft(result)) return yield* writeQueryFailure(result.left);
      }
      const encoded = canonicalJsonValue(inspectionHost.discover());
      if (Either.isLeft(encoded)) return yield* writeQueryFailure(failure("encode discovery", encoded.left));
      yield* write("stdout", encoded.right);
      return 0;
    }
    if (typeof parsed.values.request !== "string") return yield* usage(`query ${action} requires --request <file|->.`);
    let operation: InspectionOperationId | undefined;
    const result = yield* Effect.gen(function* () {
      const facts = yield* invocationFacts();
      const request = yield* readQueryRequest(parsed.values.request as string, facts.cwd);
      operation = request.operation.kind;
      const source = sourceFromValues(facts.cwd, parsed.values.record);
      const document = yield* Effect.scoped(Effect.gen(function* () {
        const opened = yield* openInspectionSource(source).pipe(
          Effect.mapError((cause) => failure("open Record source", cause)),
        );
        return yield* (action === "explain"
          ? inspectionHost.explain(opened, request)
          : inspectionHost.run(opened, request)).pipe(
          Effect.mapError((cause) => failure(`${action} Inspection operation`, cause)),
        );
      }));
      yield* writeDocument(document);
      return 0;
    }).pipe(Effect.either);
    return Either.isRight(result)
      ? result.right
      : yield* writeQueryFailure(result.left, operation);
  });
}

function sourceFromValues(cwd: string, record: string | boolean | string[] | undefined): InspectionSource {
  return typeof record === "string" ? snapshotInspectionSource(cwd, record) : operationalInspectionSource(cwd);
}

function invocationFacts() {
  return Effect.flatMap(CliInvocationFacts, ({ facts }) => facts).pipe(
    Effect.mapError((cause) => failure("read invocation facts", cause)),
  );
}

function readQueryRequest(pathname: string, cwd: string): Effect.Effect<InspectionRequest, Error> {
  return Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => pathname === "-" ? readStandardInput() : readFile(resolve(cwd, pathname), "utf8"),
      catch: (cause) => failure("read request", cause),
    });
    if (Buffer.byteLength(text, "utf8") > 1_048_576) return yield* Effect.fail(failure("read request", "request exceeds 1 MiB"));
    const value = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: (cause) => failure("parse request JSON", cause) });
    const decoded = decodeInspectionRequest(value);
    return Either.isLeft(decoded) ? yield* Effect.fail(failure("decode request", decoded.left)) : decoded.right;
  });
}

function readStandardInput(): Promise<string> {
  return new Promise((resolveInput, rejectInput) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
    };
    const onData = (chunk: Buffer | string): void => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteLength += bytes.byteLength;
      if (byteLength > 1_048_576) {
        cleanup();
        rejectInput(new Error("request exceeds 1 MiB"));
      } else chunks.push(bytes);
    };
    const onEnd = (): void => { cleanup(); resolveInput(Buffer.concat(chunks).toString("utf8")); };
    const onError = (cause: Error): void => { cleanup(); rejectInput(cause); };
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}

function writeDocument(document: InspectionDocument) {
  const encoded = canonicalInspectionJson(document);
  return Either.isLeft(encoded) ? Effect.fail(failure("encode result", encoded.left)) : write("stdout", encoded.right);
}

function writeQueryFailure(
  error: Error,
  operation?: InspectionOperationId,
): Effect.Effect<number, Error, CliOutput> {
  const document = queryFailureDocument(error, operation);
  const encoded = canonicalJsonValue(document);
  if (Either.isLeft(encoded)) return Effect.fail(failure("encode failure document", encoded.left));
  return Effect.gen(function* () {
    yield* write("stdout", encoded.right);
    yield* write("stderr", `niceeval query failed: ${document.failure.code}\n`);
    return QUERY_FAILURE_EXIT_CODE;
  });
}

function queryFailureDocument(
  error: Error,
  operation?: InspectionOperationId,
): InspectionFailureDocument {
  const detail = queryFailureDetail(error);
  return Object.freeze({
    protocol: "niceeval.query/v1" as const,
    outcome: "failure" as const,
    operation: operation ?? null,
    behaviorVersion: operation === undefined ? null : inspectionBehaviorVersion(operation),
    failure: Object.freeze(detail),
  });
}

function queryFailureDetail(error: Error): InspectionFailureDocument["failure"] {
  const cause = error.cause;
  if (cause instanceof InspectionHostError) {
    if (cause.code === "inspection-selection-missing") {
      return Object.freeze({
        code: cause.code,
        reason: cause.reason,
        correction: "choose-existing-selection" as const,
      });
    }
    if (cause.code === "inspection-request-invalid") {
      return Object.freeze({
        code: cause.code,
        reason: "The query request does not match niceeval.query/v1.",
        correction: "fix-request" as const,
      });
    }
    return Object.freeze({
      code: "inspection-operation-failed" as const,
      reason: "The fixed Inspection operation could not be completed.",
      correction: "retry" as const,
    });
  }
  if (cause instanceof InspectionSourceError) {
    return Object.freeze({
      code: "inspection-source-invalid" as const,
      reason: "The selected Record source could not be opened.",
      correction: "fix-record-source" as const,
    });
  }
  if (isInspectionCodecFailure(cause)) {
    return Object.freeze({
      code: cause.code,
      reason: cause.code === "inspection-request-invalid"
        ? "The query request does not match niceeval.query/v1."
        : "NiceEval could not encode the fixed Inspection result.",
      correction: cause.code === "inspection-request-invalid"
        ? "fix-request" as const
        : "upgrade-or-report" as const,
    });
  }
  const requestFailure = ["parse arguments", "read request", "parse request JSON", "decode request"].includes(error.operation);
  return Object.freeze({
    code: (requestFailure ? "inspection-request-invalid" : "inspection-operation-failed") as InspectionFailureCode,
    reason: requestFailure
      ? "The query request could not be read as niceeval.query/v1."
      : "The fixed Inspection operation could not be completed.",
    correction: requestFailure ? "fix-request" as const : "retry" as const,
  });
}

function isInspectionCodecFailure(
  value: unknown,
): value is { readonly code: "inspection-request-invalid" | "inspection-result-invalid" } {
  return typeof value === "object" && value !== null &&
    (Reflect.get(value, "code") === "inspection-request-invalid" ||
      Reflect.get(value, "code") === "inspection-result-invalid");
}

export const inspectionQueryCliCommand: CliCommandContribution<Requirements, Error> = Object.freeze({
  name: "query",
  summary: "run one fixed machine Inspection operation",
  options: QUERY_CLI_OPTIONS,
  run: runQuery,
});
