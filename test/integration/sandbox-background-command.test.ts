import { rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import fc from "fast-check";
import { beforeAll, expect, test } from "vitest";
import { createLifecycleProject, runCli, showAttempt } from "./fixtures/lifecycle-sandbox/harness.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { decodeInspectionDocument, narrowInspectionSuccess } =
  require("niceeval/inspection") as typeof import("../../packages/niceeval/src/inspection/public.ts");

const EXIT_MODES = ["pass", "failed", "throw", "timeout", "cancel"] as const;
type Mode = (typeof EXIT_MODES)[number] | "handles";

async function observeAttempt(mode: Mode, { code, reverse }: { code: number; reverse: boolean }) {
  const project = await createLifecycleProject({
    scripts: [{ cleanups: 0, beforeFails: false, test: "hold" }],
    attempts: 1,
    maxConcurrency: 1,
    failCreates: [],
  });
  try {
    await rename(join(project.cwd, "evals/background.eval.ts.txt"), join(project.cwd, "evals/e0.eval.ts"));
    await writeFile(join(project.cwd, "evals/background.json"), JSON.stringify({ mode, code, reverse }));
    const running = project.run();
    if (mode === "cancel") {
      await Promise.race([project.entered(), running.then(() => undefined)]);
      project.abort.abort();
    }
    const { attempts } = await running;
    expect(attempts, JSON.stringify(project.events)).toHaveLength(1);
    const locator = attempts[0]!.locator;
    const [attempt, commands] = await Promise.all([
      showAttempt(project.cwd, locator), recordedCommands(project.cwd, locator, mode === "handles"),
    ]);
    return { mode, code, reverse, attempt, commands, events: project.events };
  } finally {
    await project.dispose();
  }
}

async function showDocument(cwd: string, locator: string, selector: string) {
  const output = await runCli(cwd, ["show", locator, selector, "--json"]);
  expect(output.code, output.stderr).toBe(0);
  const decoded = decodeInspectionDocument(JSON.parse(output.stdout));
  if (!decoded.success) throw new Error(decoded.reason);
  return decoded.value;
}

async function recordedCommands(cwd: string, locator: string, all: boolean) {
  const trace = narrowInspectionSuccess(await showDocument(cwd, locator, "execution"), "attempt.trace");
  if (!trace.success) throw new Error(trace.reason);
  const ids = all ? trace.value.trace.identityIndex.commandIds : trace.value.trace.commands.items.map(({ commandId }) => commandId);
  const details = await Promise.all(ids.map(async (commandId) => {
    const document = narrowInspectionSuccess(await showDocument(cwd, locator, commandId), "attempt.trace.detail");
    if (!document.success) throw new Error(document.reason);
    if (document.value.detail.kind !== "command") throw new Error("Expected command details");
    return document.value.detail;
  }));
  return details.map((detail) => ({
    ...detail,
    display: detail.invocation.kind === "shell"
      ? detail.invocation.command
      : [detail.invocation.executable, ...detail.invocation.arguments].join(" "),
  }));
}

const input = fc.record({ code: fc.integer({ min: 1, max: 125 }), reverse: fc.boolean() });
type Observation = Awaited<ReturnType<typeof observeAttempt>>;
let handleAttempts: Observation[] = [];
let exitAttempts: Observation[] = [];

beforeAll(async () => {
  // Publish generated Attempts and read their public evidence once. Each rule
  // below only consumes the observations it needs.
  for (const sample of [
    { code: 1, reverse: false },
    ...fc.sample(input, { numRuns: 1, seed: 260_501 }),
  ]) {
    handleAttempts.push(await observeAttempt("handles", sample));
  }
  const exits = fc.sample(input, { numRuns: EXIT_MODES.length, seed: 260_502 });
  for (const [index, mode] of EXIT_MODES.entries()) {
    exitAttempts.push(await observeAttempt(mode, exits[index]!));
  }
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
  for (const { mode, attempt, commands, events } of exitAttempts) {
      expect(attempt.verdict, mode).toBe(mode === "pass" ? "passed" : mode === "failed" ? "failed" : "errored");
      const stopAt = events.findIndex(({ event }) => event === "stop");
      expect(events.filter(({ event }) => event === "stop"), mode).toEqual([
        expect.objectContaining({ pendingCommands: [] }),
      ]);
      const terminated = events.filter(({ event }) => event === "background-terminated");
      expect(terminated.map(({ label }) => label).sort(), mode).toEqual(["one", "two"]);
      expect(terminated.every((event) => events.indexOf(event) < stopAt), mode).toBe(true);
      const outcomes = commands
        .filter(({ display }) => display.startsWith("niceeval-test-background hold "))
        .map(({ checked, outcome }) => ({ checked, outcome }));
      expect(outcomes).toEqual(Array.from({ length: 2 }, () => ({
        checked: false, outcome: { kind: "terminated", reason: "cancelled" },
      })));
  }
});
