import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { Effect, Result } from "effect";
import fc from "fast-check";
import { experimentDisplayName } from "niceeval";
import { decodeExpPlanDocument, decodeExpStartEvent, decodeExpTerminalEvent } from "niceeval/experiment/host";
import { decodeInspectionDocument } from "niceeval/inspection";
import { runHost } from "niceeval/run/host";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runCliInProcess } from "../../packages/niceeval/src/cli/in-process.ts";
import { createRecordProject } from "../integration/fixtures/record-harness/project.ts";

const displayName = "Baseline 基准";
const renamed = "Updated 基准";
const experimentId = "compare/primary";
let cwd: string;

async function cli(argv: string[], root = cwd) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const code = await runCliInProcess({
    argv,
    cwd: root,
    env: { NO_COLOR: "1" },
    stdin: Readable.from([]),
    stdout,
    stderr,
  });
  return { code, out: stdout.read()?.toString() ?? "", err: stderr.read()?.toString() ?? "" };
}

function success(result: Awaited<ReturnType<typeof cli>>) {
  if (result.code !== 0) throw new Error(result.err || result.out);
  return result.out;
}

function ndjson(output: string): unknown[] {
  return output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function selectedRuns(output: string) {
  return ndjson(output).flatMap((value) => {
    const decoded = decodeInspectionDocument(value);
    if (!decoded.success) throw new Error(decoded.reason);
    if (decoded.value.outcome !== "success" || decoded.value.operation === "run.list")
      throw new Error(JSON.stringify(decoded.value));
    return decoded.value.selection.selectedRuns ?? [];
  });
}

let listed: Awaited<ReturnType<typeof cli>>;
let unknownSelector: Awaited<ReturnType<typeof cli>>;
let invalid: Awaited<ReturnType<typeof cli>>;
let firstEvents: unknown[];
let firstDry: ReturnType<typeof decodeExpPlanDocument>;
let secondDry: ReturnType<typeof decodeExpPlanDocument>;
let secondText: string;
let exactShow: string;
let defaultShow: string;
let historicalShow: string;
let historicalCwd: string;
let historicalRun: { runId: string; experimentId: string };
let firstRunId: string;
let secondRunId: string;
let firstLocator: string;
let secondLocator: string;
let sharedTitles: readonly ReturnType<typeof decodeExpPlanDocument>[];

async function publishedLocator(runId: string) {
  const { run } = await Effect.runPromise(runHost.get({ cwd, runId }));
  const publication = run.slots[0]?.publication;
  if (publication?.state !== "published") throw new Error("Expected a published Attempt");
  return publication.attemptLocator;
}

beforeAll(async () => {
  cwd = await createRecordProject("niceeval-display-name-", { held: false });
  const original = join(cwd, "experiments/runs.ts");
  const source = await readFile(original, "utf8");
  const nested = join(cwd, "experiments/compare");
  await mkdir(nested);
  const definition = (title: string | undefined) =>
    source
      .replace("../adapter.ts", "../../adapter.ts")
      .replace(
        "{ adapter,",
        `{ adapter, description: "Definition details", ${title === undefined ? "" : `displayName: ${JSON.stringify(title)},`}`,
      );
  await rm(original);
  const primary = join(nested, "primary.ts");
  await Promise.all([
    writeFile(primary, definition(displayName)),
    writeFile(join(nested, "duplicate.ts"), definition(displayName)),
    writeFile(join(nested, "unnamed.ts"), definition(undefined)),
  ]);

  listed = await cli(["exp", "list", "compare", "--json"]);
  unknownSelector = await cli(["exp", "list", displayName]);
  firstDry = decodeExpPlanDocument(JSON.parse(success(await cli(["exp", experimentId, "--dry", "--json"]))));
  firstEvents = ndjson(success(await cli(["exp", experimentId, "--json"])));
  const [runId] = decodeExpTerminalEvent(firstEvents.at(-1)).receipt.createdRunIds;
  if (runId === undefined) throw new Error("Expected one published Run");
  firstRunId = runId;
  firstLocator = await publishedLocator(firstRunId);
  await writeFile(primary, definition(renamed));
  secondDry = decodeExpPlanDocument(JSON.parse(success(await cli(["exp", experimentId, "--dry", "--json"]))));
  secondText = success(await cli(["exp", experimentId]));
  const { runs } = await Effect.runPromise(runHost.list({ cwd }));
  const secondRun = runs.find((run) => run.runId !== firstRunId);
  if (secondRun === undefined) throw new Error("Expected the carried Run");
  secondRunId = secondRun.runId;
  secondLocator = await publishedLocator(secondRunId);
  exactShow = success(await cli(["show", `run:${firstRunId}`, `run:${secondRunId}`, "--json"]));
  defaultShow = success(await cli(["show", "--json"]));

  const shared = join(nested, "shared.ts");
  const observations = [];
  for (const value of ["baseline", "candidate"]) {
    await writeFile(
      shared,
      definition(undefined).replace(
        "export default defineExperiment({ adapter,",
        `const mode = ${JSON.stringify(value)};\nexport default defineExperiment({ adapter, displayName: mode, flags: { mode },`,
      ),
    );
    observations.push(
      decodeExpPlanDocument(JSON.parse(success(await cli(["exp", "compare/shared", "--dry", "--json"])))),
    );
  }
  sharedTitles = observations;

  await writeFile(primary, definition("invalid\u007fcontrol"));
  invalid = await cli(["exp", experimentId, "--dry", "--json"]);

  historicalCwd = await mkdtemp(join(tmpdir(), "niceeval-display-name-history-"));
  const directory = join(historicalCwd, ".niceeval");
  await mkdir(directory);
  const fixture = new URL(
    "../integration/fixtures/execution-trace-navigation/record-3-without-index.sqlite.gz",
    import.meta.url,
  );
  await writeFile(join(directory, "record.sqlite"), gunzipSync(await readFile(fixture)));
  const [previous] = (await Effect.runPromise(runHost.list({ cwd: historicalCwd }))).runs;
  if (previous === undefined) throw new Error("Expected a same-format historical Run");
  historicalRun = previous;
  historicalShow = success(await cli(["show", `run:${previous.runId}`, "--json"], historicalCwd));
});

// @feature docs/feature/experiment-authoring-display-names/README.md#presentation-snapshot
test("an execution field still contributes to identity when it also supplies the title", () => {
  const [baseline, candidate] = sharedTitles.map((plan) => plan.matrix[0]);
  expect(baseline).toMatchObject({ experimentId: "compare/shared", displayName: "baseline" });
  expect(candidate).toMatchObject({ experimentId: "compare/shared", displayName: "candidate" });
  expect(baseline?.slots[0]?.executionIdentityDigest).not.toEqual(candidate?.slots[0]?.executionIdentityDigest);
});

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  if (historicalCwd !== undefined) await rm(historicalCwd, { recursive: true, force: true });
});

// @feature docs/feature/experiment-authoring-display-names/README.md#presentation-validation
test("lists equal titles independently and falls back to the full ID", () => {
  const { experiments } = JSON.parse(success(listed));
  const titles = new Map([
    ["compare/duplicate", displayName],
    [experimentId, displayName],
    ["compare/unnamed", "compare/unnamed"],
  ]);
  fc.assert(
    fc.property(fc.constantFrom(...titles), ([id, title]) => {
      expect(experiments).toContainEqual(expect.objectContaining({ experimentId: id, displayName: title }));
    }),
    { examples: [[["compare/unnamed", "compare/unnamed"]]] },
  );
  expect(experiments.map((entry: { experimentId: string }) => entry.experimentId)).toEqual([...titles.keys()]);
  expect(unknownSelector).toMatchObject({ code: 2 });
  expect(invalid).toMatchObject({ code: 2 });
  expect(invalid.out).toBe("");
});

// @feature docs/feature/experiment-authoring-display-names/README.md#presentation-snapshot
test("uses the current title in Preview and execution while preserving history and reuse", () => {
  expect(firstDry.matrix[0]).toMatchObject({ experimentId, displayName });
  expect(secondDry.matrix[0]).toMatchObject({ experimentId, displayName: renamed });
  expect(firstDry.matrix[0]?.slots[0]?.executionIdentityDigest).toEqual(
    secondDry.matrix[0]?.slots[0]?.executionIdentityDigest,
  );
  expect(secondDry.matrix[0]?.slots[0]?.state).toBe("reused");
  expect(firstLocator).toBe(secondLocator);
  expect(decodeExpStartEvent(firstEvents[0]).experiments).toEqual([{ experimentId, displayName }]);
  expect(firstEvents).toContainEqual(expect.objectContaining({ event: "eval", experimentId, displayName }));
  expect(decodeExpTerminalEvent(firstEvents.at(-1)).receipt).not.toHaveProperty("displayName");
  expect(secondText).toContain(`${renamed} [${experimentId}] → ${secondRunId}`);
  const expected = [
    { runId: firstRunId, experimentId, displayName, displayNameState: "recorded" },
    { runId: secondRunId, experimentId, displayName: renamed, displayNameState: "recorded" },
  ].sort((left, right) => left.runId.localeCompare(right.runId));
  expect(selectedRuns(exactShow)).toEqual(expected);
  expect(selectedRuns(defaultShow)).toEqual(expected);
});

// @feature docs/feature/experiment-authoring-display-names/README.md#presentation-snapshot
test("reads an older Run with the full ID fallback", () => {
  expect(selectedRuns(historicalShow)).toEqual([
    {
      runId: historicalRun.runId,
      experimentId: historicalRun.experimentId,
      displayName: historicalRun.experimentId,
      displayNameState: "fallback-missing",
    },
  ]);
});

// @feature docs/feature/experiment-authoring-display-names/README.md#presentation-validation
test("validates the UTF-8 byte limit and one-line scalar text at the public boundary", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 80 }), (length) => {
      const title = "界".repeat(length);
      const result = experimentDisplayName(title);
      if (length <= 53) expect(Result.isSuccess(result) && result.success).toBe(title);
      else expect(Result.isFailure(result) && result.failure.reason).toBe("too-long");
    }),
  );
  expect(experimentDisplayName("a".repeat(160))).toEqual(Result.succeed("a".repeat(160)));
  for (const [title, reason] of [
    ["", "empty"],
    ["a ", "leading-or-trailing-whitespace"],
    ["a\u007fb", "control-character"],
    ["a\ud800b", "invalid-unicode"],
  ]) {
    expect(experimentDisplayName(title!)).toEqual(Result.fail({ code: "experiment-display-name-invalid", reason }));
  }
});
