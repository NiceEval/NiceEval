// cases: docs/engineering/testing/architecture/unit/reports.md
import { Effect, Result, Schema } from "effect";
import { expect, test } from "vitest";
import { CliInvocationFacts, CliOutput } from "../cli/application.ts";
import { NodeCliArgumentsLive } from "../cli/node-application.ts";
import { ProjectConfiguration } from "../cli/project-configuration.ts";
import { decodeInspectionOperation } from "../inspection/query.ts";
import { RunIdSchema, ExperimentIdSchema } from "../record/codec/identifiers.ts";
import { showCliCommand, showOperations } from "./contribution.ts";

const locator = "@1000000000000";
const entryId = "ae_00000000000000000001";
const base = { current: true, runIds: [], experimentIds: [] } as const;

// @use-case docs/feature/inspection/use-case/inspection-show-as-json.md
test.concurrent("resource JSON selects the documented operations and preserves Attempt line order", () => {
  expect(showOperations(base)).toEqual([{ kind: "project.get" }]);
  expect(showOperations({ ...base, current: false })).toEqual([{ kind: "overview.get" }]);
  const runIds = ["run-a", "run-b"].map((id) => Schema.decodeUnknownSync(RunIdSchema)(id));
  const experimentIds = ["main", "next"].map((id) => Schema.decodeUnknownSync(ExperimentIdSchema)(id));
  expect(showOperations({ ...base, runIds })).toEqual([{ kind: "run.get", runId: "run-a" }, { kind: "run.get", runId: "run-b" }]);
  expect(showOperations({ ...base, experimentIds })).toEqual([{ kind: "experiment.get", experimentId: "main" }, { kind: "experiment.get", experimentId: "next" }]);
  expect(showOperations({ ...base, locator })).toEqual([{ kind: "attempt.get", locator }, { kind: "attempt.usage", locator }]);
  for (const [slice, kind] of [["source", "attempt.sources"], ["timing", "attempt.timing"], ["usage", "attempt.usage"], ["diff", "attempt.diff"]] as const)
    expect(showOperations({ ...base, locator, slice })).toEqual([{ kind, locator }]);
  expect(showOperations({ ...base, locator, slice: "execution", actorId: "actor", eventType: "tool", continuation: "next" })).toEqual([
    { kind: "attempt.trace", locator, actorId: "actor", eventType: "tool", continuation: "next" },
  ]);
});

// @use-case docs/feature/inspection/use-case/inspection-show-as-json.md
test.concurrent("Assertion JSON defaults to compact and selects exact entries without an extra outline line", () => {
  const second = "ae_00000000000000000002";
  expect(showOperations({ ...base, locator, slice: "assertions", entryIds: [entryId, second] })).toEqual([
    { kind: "attempt.assertion.detail", locator, entryId, projection: "compact" },
    { kind: "attempt.assertion.detail", locator, entryId: second, projection: "compact" },
  ]);
  const [operation] = showOperations({ ...base, locator, slice: "assertions", entryIds: [entryId], projection: "full" });
  expect(operation).toMatchObject({ entryId, projection: "full" });
  expect(Result.isSuccess(decodeInspectionOperation(operation))).toBe(true);
  expect(Result.isSuccess(decodeInspectionOperation({ kind: "attempt.assertion.detail", locator, entryId }))).toBe(true);
  expect(Result.isFailure(decodeInspectionOperation({ ...operation, projection: "tiny" }))).toBe(true);
  expect(showOperations({ ...base, locator, slice: "assertions", entryIds: [] })).toEqual([]);
});

// @use-case docs/feature/inspection/use-case/inspection-show-as-json.md
test.concurrent("rejects invalid show options before opening a source", async () => {
  for (const argv of [
    ["--all", "--json"], ["--all", "-o", "json"], ["-o", "csv"], ["--json", "-o", "text"],
    [locator, "--assertions", "--full", "--compact"], [locator, "--entry", entryId],
    [locator, "--assertions", "--usage"], ["--assertions"], [locator, "--reference"],
  ]) {
    let stdout = "";
    let stderr = "";
    const unexpected = Effect.die("Invalid arguments must not open a source");
    const status = await Effect.runPromise(showCliCommand.run(argv).pipe(
      Effect.provide(NodeCliArgumentsLive),
      Effect.provideService(CliInvocationFacts, { facts: unexpected }),
      Effect.provideService(ProjectConfiguration, { prepare: () => unexpected, load: () => unexpected, rebuild: () => unexpected }),
      Effect.provideService(CliOutput, {
        writeStdout: (value) => Effect.sync(() => { stdout += value; }),
        writeStderr: (value) => Effect.sync(() => { stderr += value; }),
        writeStdoutSync: () => {}, writeStderrSync: () => {},
      }),
    ));
    expect(status, JSON.stringify(argv)).toBe(1);
    expect(stdout, JSON.stringify(argv)).toBe("");
    expect(stderr.length, JSON.stringify(argv)).toBeGreaterThan(0);
  }
});
