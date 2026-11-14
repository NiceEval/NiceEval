import { Effect, Schema } from "effect";
import { repoRootDir } from "./discovery.ts";
import { runOwnedProcess, hasSuccessfulOwnedProcessResult } from "./owned-process.ts";
import { parseBridgeJson, BRIDGE_BYTES } from "./bridge-json.ts";
import { engineError } from "./repository-evidence.ts";

// Project only the public fields we consume: additive CLI fields are allowed.
const CaseSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^neref_[a-f0-9]{32}$/u)),
  file: Schema.String,
  line: Schema.Int,
  contract: Schema.String,
  contractKind: Schema.Literals(["feature", "use-case"]),
  issues: Schema.Array(Schema.String),
  status: Schema.Literals(["active", "retired"]),
  markerEndLine: Schema.optionalKey(Schema.Int),
  native: Schema.optionalKey(Schema.String),
});
export type ConcordCase = typeof CaseSchema.Type;
export const listConcordCases = Effect.fn("listConcordCases")(function* (root = repoRootDir()) {
  const result = yield* runOwnedProcess(["concord", "--root", root, "--json", "test", "list"], {
    cwd: root,
    env: process.env,
    output: "capture",
    stream: false,
    strictUtf8: true,
    stdoutBytes: BRIDGE_BYTES,
    stderrBytes: 1024 * 1024,
    timeoutMs: 120_000,
  }).pipe(Effect.mapError(engineError));
  if (!hasSuccessfulOwnedProcessResult(result))
    return yield* Effect.fail(
      engineError(`concord test list failed (${result.signal ?? result.exitCode}): ${result.stderr}`),
    );
  return yield* Effect.try({
    try: () =>
      Schema.decodeUnknownSync(
        Schema.Struct({ operation: Schema.Literal("test-list"), cases: Schema.Array(CaseSchema) }),
        { onExcessProperty: "ignore" },
      )(parseBridgeJson(result.stdout)).cases,
    catch: engineError,
  });
});
