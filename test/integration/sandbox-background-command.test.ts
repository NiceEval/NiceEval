import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import fc from "fast-check";
import { beforeAll, expect, test } from "vitest";
import { selectInspectionOperation, withOperational } from "./fixtures/adapter-trace-usage-harness/harness.ts";
import { createLifecycleProject } from "./fixtures/lifecycle-sandbox/harness.ts";

const EXIT_MODES = ["pass", "failed", "throw", "timeout", "cancel"] as const;
type Mode = (typeof EXIT_MODES)[number] | "handles";
type Sample = { mode: Mode; code: number; reverse: boolean };

async function observeAttempts(samples: readonly Sample[]) {
  const project = await createLifecycleProject({
    scripts: samples.map(() => ({ cleanups: 0, beforeFails: false, test: "hold" })),
    attempts: 1,
    maxConcurrency: 1,
    failCreates: [],
  });
  try {
    const source = await readFile(join(project.cwd, "evals/background.eval.ts.txt"), "utf8");
    const byEval = new Map(samples.map((sample, index) => [project.evalIds[index]!, sample]));
    await Promise.all(
      [...byEval].flatMap(([evalId, sample]) => [
        writeFile(join(project.cwd, "evals", `${evalId}.eval.ts`), source.replaceAll("CASE_FILE", evalId)),
        writeFile(join(project.cwd, "evals", `${evalId}.json`), JSON.stringify({ evalId, ...sample })),
      ]),
    );
    const running = project.run();
    if (samples.some(({ mode }) => mode === "cancel")) {
      await Promise.race([project.entered(), running.then(() => undefined)]);
      project.abort.abort();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(
              () => reject(new Error(`Cancellation did not publish: ${JSON.stringify(project.events)}`)),
              5_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
    }
    const { attempts } = await running;
    expect(attempts, JSON.stringify(project.events)).toHaveLength(samples.length);
    return await withOperational(project.cwd, (facts) => attempts.map(({ evalId, locator }) => {
      const sample = byEval.get(evalId)!;
      const { mode } = sample;
      // Attempts execute serially, so the journal segment belongs to this Eval.
      const start = project.events.findIndex((event) => event.event === "background-eval" && event.evalId === evalId);
      expect(start, JSON.stringify(project.events)).toBeGreaterThanOrEqual(0);
      const end = project.events.findIndex((event, index) => index > start && event.event === "background-eval");
      const events = project.events.slice(start, end < 0 ? undefined : end);
      const { attempt } = selectInspectionOperation(facts, { kind: "attempt.get", locator });
      const { trace } = selectInspectionOperation(facts, { kind: "attempt.trace", locator });
      const commandIds = mode === "handles"
        ? trace.identityIndex.commandIds
        : trace.commands.items.map(({ commandId }) => commandId);
      const commands = commandIds.map((commandId) => {
        const { detail } = selectInspectionOperation(facts, {
          kind: "attempt.trace.detail",
          locator,
          selector: { kind: "command", commandId },
        });
        if (detail.kind !== "command") throw new Error("Expected command details");
        const { invocation } = detail;
        const display = invocation.kind === "shell"
          ? invocation.command
          : [invocation.executable, ...invocation.arguments].join(" ");
        return { ...detail, display };
      });
      return { ...sample, attempt, commands, events };
    }));
  } finally {
    await project.dispose();
  }
}

const input = fc.record({ code: fc.integer({ min: 1, max: 125 }), reverse: fc.boolean() });
type Observation = Awaited<ReturnType<typeof observeAttempts>>[number];
let handleAttempts: Observation[] = [];
let exitAttempts: Observation[] = [];

beforeAll(async () => {
  const handles = [
    { code: 1, reverse: false },
    ...fc.sample(input, { numRuns: 1, seed: 260_501 }),
  ].map((sample): Sample => ({ ...sample, mode: "handles" }));
  const exits = fc.sample(input, { numRuns: EXIT_MODES.length, seed: 260_502 });
  const exitSamples = EXIT_MODES.map((mode, index) => ({ ...exits[index]!, mode }));
  // Share discovery and Record initialization. Invocation cancellation needs its own project.
  const completed = await observeAttempts([...handles, ...exitSamples.filter(({ mode }) => mode !== "cancel")]);
  handleAttempts = completed.filter(({ mode }) => mode === "handles");
  exitAttempts = completed.filter(({ mode }) => mode !== "handles");
  await fc.assert(
    fc.asyncProperty(input, async (sample) => {
      const [observation] = await observeAttempts([{ ...sample, mode: "cancel" }]);
      assertDrained(observation!);
      exitAttempts.push(observation!);
    }),
    { numRuns: 2, seed: 260_503, examples: [[{ code: 1, reverse: false }]] },
  );
}, 45_000);

// @feature docs/feature/sandbox/library/operations.md#后台命令
test("background handles share terminal results and record only their own checked waits", () => {
  for (const { attempt, code, commands, reverse } of handleAttempts) {
      expect(attempt.verdict, JSON.stringify({ code, reverse })).toBe("passed");
      const find = (text: string) => commands.find(({ display }) => display === `niceeval-test-background ${text}`);
      expect(find(`hold one ${code}`)).toMatchObject({ checked: false, outcome: { kind: "exited", exitCode: code } });
      expect(find(`hold two ${code}`)).toMatchObject({ checked: true, outcome: { kind: "exited", exitCode: code } });
      expect(find(`exit ignored-exit ${code}`)).toMatchObject({ checked: false, outcome: { kind: "exited", exitCode: code } });
      expect(find("missing ignored")).toMatchObject({ checked: false, outcome: { kind: "not-started", reason: "spawn-failed" } });
      expect(find("hold killed")).toMatchObject({ checked: false, outcome: { kind: "terminated", reason: "cancelled" } });
      expect(find("exit <redacted>")).toMatchObject({ checked: true, stdout: { text: "<redacted>" } });
  }
});

// @feature docs/feature/sandbox/library/operations.md#后台命令
test("each Attempt exit drains its background commands before the group stops", () => {
  for (const observation of exitAttempts) assertDrained(observation);
});

function assertDrained({ mode, attempt, commands, events }: Observation) {
  expect(attempt.verdict, mode).toBe(mode === "pass" ? "passed" : mode === "failed" ? "failed" : "errored");
  const stopAt = events.findIndex(({ event }) => event === "stop");
  expect(events.filter(({ event }) => event === "stop"), mode).toEqual([expect.objectContaining({ pendingCommands: [] })]);
  const terminated = events.filter(({ event }) => event === "background-terminated");
  expect(terminated.map(({ label }) => label).sort(), mode).toEqual(["one", "two"]);
  expect(terminated.every((event) => events.indexOf(event) < stopAt), mode).toBe(true);
  const outcomes = commands
    .filter(({ display }) => display.startsWith("niceeval-test-background hold "))
    .map(({ checked, outcome }) => ({ checked, outcome }));
  expect(outcomes).toEqual(
    Array.from({ length: 2 }, () => ({
      checked: false, outcome: { kind: "terminated", reason: "cancelled" },
    })),
  );
}
