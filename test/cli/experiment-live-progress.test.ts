import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import fc from "fast-check";
import { decodeExpActivityEvent } from "niceeval/experiment/host";
import { beforeAll, expect, test } from "vitest";
import { runCliInProcess } from "../../packages/niceeval/src/cli/in-process.ts";
import { createLifecycleProject } from "../integration/fixtures/lifecycle-sandbox/harness.ts";

const detailArbitrary = fc.integer({ min: 280, max: 340 }).map((length) => `tool: echo ${"x".repeat(length)}`);
const counterexample = `tool: echo ${"x".repeat(280)}`;
const details = [...fc.sample(detailArbitrary, { seed: -103252275, numRuns: 2 }), counterexample];
const credential = "fixture-known-secret";
let liveOutput: string;
let completeOutput: string;

beforeAll(async () => {
  const project = await createLifecycleProject({
    attempts: 1,
    maxConcurrency: 1,
    failCreates: [],
    scripts: [{ cleanups: 0, beforeFails: false, test: "hold" }],
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.setEncoding("utf8");
  let output = "";
  stdout.on("data", (chunk: string) => {
    output += chunk;
  });
  let invocation: Promise<number> | undefined;
  try {
    const evalPath = join(project.cwd, "evals/e0.eval.ts");
    const source = await readFile(evalPath, "utf8");
    await writeFile(
      evalPath,
      source
        .replace("    await t.send(id);\n", "")
        .replace('    if (script.test === "hold")', '    await t.send(id);\n    if (script.test === "hold")')
        .replace('script.test === "pass", equals(true)', "true, equals(true)"),
    );
    const agentPath = join(project.cwd, "agent.ts");
    await writeFile(
      agentPath,
      (await readFile(agentPath, "utf8")).replace(
        '    record("send", { text: input.text });',
        [
          `    await ctx.sandbox.runCommand("true", [], { sensitiveValues: [${JSON.stringify(credential)}] });`,
          ...details.map((detail) => `    ctx.progress({ message: ${JSON.stringify(detail)} });`),
          `    ctx.progress({ message: "commentary: first line\\nsecond line ${credential}" });`,
          `    ctx.progress({ message: ${JSON.stringify(`tool: echo ${credential.replace("-known", "\u0001-known")}`)} });`,
        ].join("\n"),
      ),
    );

    invocation = runCliInProcess({
      argv: ["exp", "lifecycle", "--rerun", "all", "--json"],
      cwd: project.cwd,
      env: { NO_COLOR: "1" },
      stdin: Readable.from([]),
      stdout,
      stderr,
    });
    await Promise.race([
      project.entered(),
      invocation.then((code) => {
        throw new Error(`Invocation ended early (${code}): ${output}`);
      }),
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    liveOutput = output;
  } finally {
    project.release();
    try {
      if (invocation !== undefined) expect(await invocation).toBe(0);
      completeOutput = output;
    } finally {
      await project.dispose();
    }
  }
});

function events(output: string) {
  return output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

// @feature docs/feature/experiments/README.md#progress-counts
test("JSON reports the current Eval, phase and tool detail before an Attempt settles", () => {
  const liveEvents = events(liveOutput);
  const identity = { experimentId: "lifecycle", displayName: "lifecycle", evalId: "e0", attempt: 0 };
  const activities = liveEvents.filter((event) => event.event === "activity").map(decodeExpActivityEvent);
  expect(activities).toContainEqual({ event: "activity", ...identity, phase: "eval.run" });
  fc.assert(
    fc.property(fc.constantFrom(...details), (detail) => {
      expect(activities).toContainEqual({ event: "activity", ...identity, phase: "agent.run", detail });
    }),
    { examples: [[counterexample]] },
  );
  expect(activities).toContainEqual({
    event: "activity",
    ...identity,
    phase: "agent.run",
    detail: "commentary: first line\nsecond line <redacted>",
  });
  expect(activities).toContainEqual({
    event: "activity",
    ...identity,
    phase: "agent.run",
    detail: "tool: echo <redacted>",
  });
  expect(liveOutput).not.toContain(credential);
  expect(liveEvents).not.toContainEqual(expect.objectContaining({ type: "receipt" }));
  expect(events(completeOutput).at(-1)).toMatchObject({ type: "receipt" });
});
