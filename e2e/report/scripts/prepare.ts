import "dotenv/config";

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  copyTreePrivately,
  publishPreparedWorld,
  treeDigest,
  type PreparedClassicAttempt,
  type PreparedClassicHistoryAttempt,
  type PreparedWorld,
  writePreparedWorld,
} from "./world.ts";

const ROOT = process.cwd();
const NICEEVAL_BIN = resolve(ROOT, "node_modules", "niceeval", "bin", "niceeval.js");
const PINNED_ENV = { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", LANGUAGE: "en" };

type JsonRecord = Record<string, unknown>;

interface CommandResult {
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);

const jsonLines = (output: string): readonly JsonRecord[] =>
  output.split("\n").flatMap((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      return isRecord(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });

const runPublicCli = (cwd: string, args: readonly string[]): CommandResult => {
  const result = spawnSync(process.execPath, [NICEEVAL_BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_ENV },
  });
  if (result.error !== undefined) throw result.error;
  return {
    command: args,
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const commandLog = (result: CommandResult): string =>
  [`$ niceeval ${result.command.join(" ")}`, `exit ${result.exitCode}`, result.stdout, result.stderr].join("\n");

const copyProducerProject = (): { readonly temporaryRoot: string; readonly project: string } => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "niceeval-report-classic-producer-"));
  const producer = join(temporaryRoot, "project");
  const excluded = new Set([
    ".e2e-artifacts",
    ".e2e-world",
    ".niceeval",
    "evidence",
    "node_modules",
    "site-export",
    "test",
    "test-results",
  ]);
  cpSync(ROOT, producer, {
    recursive: true,
    dereference: false,
    filter: (source) => {
      const topLevel = relative(ROOT, source).split(sep)[0];
      return topLevel === "" || !excluded.has(topLevel!);
    },
  });
  symlinkSync(resolve(ROOT, "node_modules"), join(producer, "node_modules"), "dir");
  return { temporaryRoot, project: producer };
};

const requireNumber = (value: unknown, label: string): number => {
  assert.equal(typeof value, "number", `${label} must be a number`);
  return value;
};

const requireRecord = (value: unknown, label: string): JsonRecord => {
  assert.ok(isRecord(value), `${label} must be an object`);
  return value;
};

const validateClassicRun = (first: CommandResult, partial: CommandResult): void => {
  assert.equal(first.exitCode, 1, `classic full run must expose its eight intentional failures:\n${first.stderr}`);
  assert.equal(partial.exitCode, 1, `classic partial rerun must expose its two intentional failures:\n${partial.stderr}`);
  const fullEvents = jsonLines(first.stdout).filter((event) => event.event === "eval");
  const partialEvents = jsonLines(partial.stdout).filter((event) => event.event === "eval");
  assert.equal(fullEvents.length, 27, "the first public CLI run must evaluate all three classic experiments");
  assert.equal(partialEvents.length, 9, "the second public CLI run must rerun only classic/memory-a");
  assert.ok(
    partialEvents.every((event) => event.experimentId === "classic/memory-a"),
    "the partial public CLI rerun must not recreate baseline or memory-b",
  );
};

const publicClassicAttempts = (result: CommandResult): readonly PreparedClassicAttempt[] =>
  jsonLines(result.stdout).flatMap((event) => {
      if (
        event.event !== "eval" ||
        typeof event.experimentId !== "string" ||
        typeof event.evalId !== "string" ||
        typeof event.locator !== "string" ||
        (event.verdict !== "passed" && event.verdict !== "failed")
      ) {
        return [];
      }
    return [
      {
        experimentId: event.experimentId,
        evalId: event.evalId,
        locator: event.locator,
        verdict: event.verdict,
      },
    ];
  });

const currentClassicAttempts = (
  fullAttempts: readonly PreparedClassicAttempt[],
  partialAttempts: readonly PreparedClassicAttempt[],
): readonly PreparedClassicAttempt[] => {
  const attempts = [...fullAttempts.filter((attempt) => attempt.experimentId !== "classic/memory-a"), ...partialAttempts];
  assert.equal(attempts.length, 27, "the frozen current Sample must have 27 public-CLI attempt facts");
  assert.equal(
    new Set(attempts.map((attempt) => `${attempt.experimentId}\0${attempt.evalId}`)).size,
    27,
    "the frozen current Sample must expose one attempt per experiment/eval identity",
  );
  assert.ok(
    attempts.every((attempt) => /^@[0-9A-Z]+$/.test(attempt.locator)),
    "the frozen current Sample must expose public @locator identities",
  );
  return attempts;
};

const classicHistoryAttempts = (
  fullAttempts: readonly PreparedClassicAttempt[],
  partialAttempts: readonly PreparedClassicAttempt[],
): readonly PreparedClassicHistoryAttempt[] => [
  ...fullAttempts.map((attempt) => ({ ...attempt, sourceRun: "full" as const })),
  ...partialAttempts.map((attempt) => ({ ...attempt, sourceRun: "memory-a-rerun" as const })),
];

const historyFactKey = (attempt: PreparedClassicAttempt): string =>
  `${attempt.experimentId}\0${attempt.evalId}\0${attempt.locator}\0${attempt.verdict}`;

const validateClassicRecord = (
  producer: string,
  expectedHistory: readonly PreparedClassicHistoryAttempt[],
): void => {
  const current = runPublicCli(producer, ["show", "--json"]);
  assert.equal(current.exitCode, 0, current.stderr);
  const document = requireRecord(JSON.parse(current.stdout), "show --json document");
  assert.equal(document.format, "niceeval.show", "show JSON format");
  assert.equal(document.schemaVersion, 1, "show JSON schemaVersion");
  assert.equal(document.view, "leaderboard", "show JSON view");
  const sample = requireRecord(document.sample, "show JSON sample");
  assert.deepEqual(sample.experiments, ["classic/baseline", "classic/memory-a", "classic/memory-b"]);
  const data = requireRecord(document.data, "show JSON data");
  const hero = requireRecord(data.hero, "show JSON hero");
  assert.equal(requireNumber(hero.runs, "show JSON hero.runs"), 3);
  const summary = requireRecord(data.summary, "show JSON summary");
  assert.equal(requireNumber(summary.experiments, "summary.experiments"), 3);
  assert.equal(requireNumber(summary.attempts, "summary.attempts"), 27);
  const verdicts = requireRecord(summary.evalVerdicts, "summary.evalVerdicts");
  assert.equal(requireNumber(verdicts.passed, "summary.evalVerdicts.passed"), 19);
  assert.equal(requireNumber(verdicts.failed, "summary.evalVerdicts.failed"), 8);
  const cost = requireRecord(summary.totalCostUSD, "summary.totalCostUSD");
  assert.equal(requireNumber(cost.value, "summary.totalCostUSD.value"), 0.16000000000000003);
  assert.equal(requireNumber(cost.samples, "summary.totalCostUSD.samples"), 24);
  assert.equal(requireNumber(cost.total, "summary.totalCostUSD.total"), 27);
  const charts = data.charts;
  assert.ok(Array.isArray(charts), "show JSON charts must be an array");
  const points = requireRecord(charts[0], "show JSON scatter chart").points;
  assert.ok(Array.isArray(points), "show JSON scatter points must be an array");
  assert.equal(points.length, 3);

  const history = runPublicCli(producer, ["show", "--history", "--json"]);
  assert.equal(history.exitCode, 0, history.stderr);
  const historyDocument = requireRecord(JSON.parse(history.stdout), "show --history --json document");
  const sections = requireRecord(historyDocument.data, "history JSON data").sections;
  assert.ok(Array.isArray(sections), "history JSON sections must be an array");
  const attempts = sections.flatMap((section) => {
    const item = requireRecord(section, "history JSON section");
    assert.equal(typeof item.experimentId, "string", "history section experimentId");
    assert.equal(typeof item.evalId, "string", "history section evalId");
    assert.ok(Array.isArray(item.attempts), "history section attempts must be an array");
    return item.attempts.map((attempt) => {
      const value = requireRecord(attempt, "history attempt");
      assert.equal(typeof value.locator, "string", "history attempt locator");
      assert.ok(value.verdict === "passed" || value.verdict === "failed", "history attempt verdict");
      assert.equal(typeof value.locatorRunId, "string", "history attempt locatorRunId");
      return {
        experimentId: item.experimentId as string,
        evalId: item.evalId as string,
        locator: value.locator as string,
        verdict: value.verdict as "passed" | "failed",
        locatorRunId: value.locatorRunId as string,
      };
    });
  });
  assert.equal(attempts.length, 36, "history must retain three full runs plus the local memory-a rerun");
  assert.deepEqual(
    attempts.map(historyFactKey).sort(),
    expectedHistory.map(historyFactKey).sort(),
    "show --history must preserve every producer locator under its exact experiment/eval/verdict identity",
  );
  const runIds = new Set<string>();
  for (const sourceRun of ["full", "memory-a-rerun"] as const) {
    const sourceAttempts = expectedHistory.filter((attempt) => attempt.sourceRun === sourceRun);
    const experiments = new Set(sourceAttempts.map((attempt) => attempt.experimentId));
    for (const experimentId of experiments) {
      const locators = new Set(
        sourceAttempts.filter((attempt) => attempt.experimentId === experimentId).map((attempt) => attempt.locator),
      );
      const groupRunIds = new Set(
        attempts.filter((attempt) => locators.has(attempt.locator)).map((attempt) => attempt.locatorRunId),
      );
      assert.equal(groupRunIds.size, 1, `${sourceRun}/${experimentId} history locators must belong to one run`);
      runIds.add([...groupRunIds][0]!);
    }
  }
  assert.equal(runIds.size, 4, "history must retain three full-run experiment runs plus one memory-a rerun");
};

const parseArgs = (): { output: string } => {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--out");
  if (outputIndex === -1 || args[outputIndex + 1] === undefined || args.length !== 2) {
    throw new Error("usage: tsx scripts/prepare.ts --out <world-directory>");
  }
  return { output: resolve(args[outputIndex + 1]!) };
};

const prepareClassic = (output: string): void => {
  const { temporaryRoot, project: producer } = copyProducerProject();
  const draft = `${output}.draft-${process.pid}`;
  const logs: string[] = [];
  try {
    const full = runPublicCli(producer, ["exp", "classic", "--rerun", "all", "--json"]);
    logs.push(commandLog(full));
    const partial = runPublicCli(producer, ["exp", "classic/memory-a", "--rerun", "all", "--json"]);
    logs.push(commandLog(partial));
    validateClassicRun(full, partial);
    const fullAttempts = publicClassicAttempts(full);
    const partialAttempts = publicClassicAttempts(partial);
    const attempts = currentClassicAttempts(fullAttempts, partialAttempts);
    const historyAttempts = classicHistoryAttempts(fullAttempts, partialAttempts);
    assert.equal(historyAttempts.length, 36, "the frozen history must have 36 public-CLI attempt facts");
    validateClassicRecord(producer, historyAttempts);
    const exported = runPublicCli(producer, ["view", "--report", "./reports/classic.tsx", "--out", ".prepared-classic", "--no-open"]);
    logs.push(commandLog(exported));
    assert.equal(exported.exitCode, 0, exported.stderr);

    mkdirSync(draft, { recursive: true });
    const recordDir = join(producer, ".niceeval");
    const digest = treeDigest(recordDir);
    copyTreePrivately(recordDir, join(draft, "classic", "record"), digest);
    copyTreePrivately(join(producer, ".prepared-classic"), join(draft, "classic", "site"));
    writeFileSync(join(draft, "producer.log"), `${logs.join("\n\n")}\n`, "utf8");
    const world: PreparedWorld = {
      schemaVersion: 1,
      classic: { status: "ready", recordDir: "classic/record", exportDir: "classic/site", seedDigest: digest },
      classicAttempts: attempts,
      classicHistoryAttempts: historyAttempts,
      legacy: { status: "unavailable", reason: "legacy profile is prepared by the default coordinator lane" },
    };
    writePreparedWorld(draft, world);
    publishPreparedWorld(draft, output);
    process.stdout.write(`prepared frozen classic World: ${output}\n`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
    rmSync(draft, { recursive: true, force: true });
  }
};

prepareClassic(parseArgs().output);
