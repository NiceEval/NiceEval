import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import fc from "fast-check";
import { experimentHost } from "niceeval/experiment/host";
import { decodeInspectionDocument, narrowInspectionSuccess } from "niceeval/inspection";
import { runHost } from "niceeval/run/host";
import { runCliInProcess } from "../../../../packages/niceeval/src/cli/in-process.ts";

const FIXTURE = fileURLToPath(new URL("./", import.meta.url));
const harnessKey = Symbol.for("niceeval.test.lifecycle");

export interface Script {
  /** Cleanups registered by the Eval's before callback, in registration order. */
  readonly cleanups: number;
  /** The before callback throws after registering its cleanups. */
  readonly beforeFails: boolean;
  /** `hold` parks the Eval's test until the harness releases it. */
  readonly test: "pass" | "fail" | "throw" | "hold";
  /** A declarative shell step ahead of the callback; see the Eval fixture. */
  readonly step?: "ok" | "fails" | "unknown-dependency";
}

export interface Scenario {
  readonly scripts: readonly Script[];
  readonly attempts: number;
  readonly maxConcurrency: number;
  /** Materialization numbers that fail before the provider acquires anything. */
  readonly failCreates: readonly number[];
}

export type JournalEvent = Record<string, unknown> & { readonly event: string };

export const scriptArbitrary: fc.Arbitrary<Script> = fc.record({
  cleanups: fc.integer({ min: 0, max: 3 }),
  beforeFails: fc.boolean(),
  test: fc.constantFrom("pass", "fail", "throw"),
});

/**
 * `held` generates Evals parked until the harness releases them; `faults: "before"` injects only author before
 * failures, `"create"` only provider materialization failures; otherwise both are mixed.
 */
export function scenarioArbitrary(
  options: { readonly held?: boolean; readonly faults?: "before" | "create" } = {},
): fc.Arbitrary<Scenario> {
  const script: fc.Arbitrary<Script> = options.held
    ? fc.constantFrom<Script>(
        { cleanups: 0, beforeFails: false, test: "hold" },
        { cleanups: 2, beforeFails: false, test: "hold" },
      )
    : options.faults === "create"
      ? fc.record({ cleanups: fc.integer({ min: 0, max: 3 }), beforeFails: fc.constant(false), test: fc.constant("pass") })
      : scriptArbitrary;
  return fc.record({
    scripts: fc.array(script, { minLength: 1, maxLength: 4 }),
    attempts: fc.integer({ min: 1, max: 2 }),
    maxConcurrency: fc.integer({ min: 1, max: 4 }),
    failCreates:
      options.held || options.faults === "before"
        ? fc.constant([])
        : fc.uniqueArray(fc.integer({ min: 0, max: 5 }), { maxLength: 2 }),
  });
}

export interface LifecycleProject {
  readonly cwd: string;
  readonly events: JournalEvent[];
  readonly evalIds: readonly string[];
  /** Resolves once the next held Eval has started; every hold must be waited in order. */
  readonly entered: () => Promise<void>;
  readonly release: () => void;
  readonly abort: AbortController;
  /** Runs the Invocation; resolves with the receipt and the Run's published Attempts. */
  run(): Promise<{ receipt: Awaited<ReturnType<typeof runInvocation>>["receipt"]; attempts: PublishedAttempt[] }>;
  /** Names of resource-group directories still on disk under the project. */
  leftoverGroups(): Promise<string[]>;
  dispose(): Promise<void>;
}

export interface PublishedAttempt {
  readonly evalId: string;
  readonly locator: string;
}

async function runInvocation(cwd: string, scenario: Scenario, signal: AbortSignal) {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "lifecycle",
      config: { maxConcurrency: scenario.maxConcurrency },
      overrides: { rerun: "all", earlyExit: false },
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan Run: ${JSON.stringify(planned)}`);
  return Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan, signal }));
}

export async function createLifecycleProject(
  scenario: Scenario,
  onEvent?: (event: JournalEvent) => void,
): Promise<LifecycleProject> {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-lifecycle-property-"));
  try {
    await cp(FIXTURE, cwd, { recursive: true });
    await mkdir(join(cwd, "node_modules"));
    await symlink(dirname(fileURLToPath(import.meta.resolve("effect/package.json"))), join(cwd, "node_modules/effect"), "dir");
    await rm(join(cwd, "harness.ts"));
    for (const source of ["agent.ts", "sandbox.ts", "journal.ts", "experiments/lifecycle.ts", "niceeval.config.ts"]) {
      await rename(join(cwd, `${source}.txt`), join(cwd, source));
    }
    const experiment = join(cwd, "experiments/lifecycle.ts");
    await writeFile(experiment, (await readFile(experiment, "utf8")).replace("ATTEMPTS", String(scenario.attempts)));
    const source = await readFile(join(cwd, "evals/scripted.eval.ts.txt"), "utf8");
    await rm(join(cwd, "evals/scripted.eval.ts.txt"));
    const evalIds = scenario.scripts.map((_, index) => `e${index}`);
    await Promise.all(
      scenario.scripts.flatMap((script, index) => [
        writeFile(join(cwd, "evals", `${evalIds[index]}.json`), JSON.stringify(script)),
        writeFile(join(cwd, "evals", `${evalIds[index]}.eval.ts`), source.replaceAll("CASE_FILE", evalIds[index]!)),
      ]),
    );
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }

  const events: JournalEvent[] = [];
  const release = Promise.withResolvers<void>();
  const enteredQueue: Array<PromiseWithResolvers<void>> = scenario.scripts.flatMap((script) =>
    script.test === "hold" ? Array.from({ length: scenario.attempts }, () => Promise.withResolvers<void>()) : [],
  );
  let entered = 0;
  const registry: Map<string, unknown> =
    (Reflect.get(process, harnessKey) as Map<string, unknown> | undefined) ?? new Map();
  Reflect.set(process, harnessKey, registry);
  registry.set(cwd, {
    events,
    onEvent,
    release: release.promise,
    entered: () => enteredQueue[entered++]?.resolve(),
    failCreates: new Set(scenario.failCreates),
  });
  const abort = new AbortController();
  let waited = 0;

  return {
    cwd,
    events,
    evalIds: scenario.scripts.map((_, index) => `e${index}`),
    entered: () => {
      const next = enteredQueue[waited++];
      if (next === undefined) throw new Error("No further held Eval is expected");
      return next.promise;
    },
    release: () => release.resolve(),
    abort,
    async run() {
      const { receipt } = await runInvocation(cwd, scenario, abort.signal);
      const attempts: PublishedAttempt[] = [];
      for (const runId of receipt.createdRunIds) {
        const { run } = await Effect.runPromise(runHost.get({ cwd, runId }));
        for (const slot of run.slots) {
          if (slot.publication.state === "published") {
            attempts.push({ evalId: slot.evalId, locator: slot.publication.attemptLocator });
          }
        }
      }
      return { receipt, attempts };
    },
    async leftoverGroups() {
      return (await readdir(cwd)).filter((name) => name.startsWith("resource-group-")).sort();
    },
    async dispose() {
      release.resolve();
      registry.delete(cwd);
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

/** Reads an Attempt's outline through the in-process `show --json` command. */
export async function showAttempt(cwd: string, locator: string) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks: Buffer[] = [];
  stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await runCliInProcess({
    argv: ["show", locator, "--json"],
    cwd,
    env: { NO_COLOR: "1" },
    stdin: Readable.from([]),
    stdout,
    stderr,
  });
  stdout.end();
  await finished(stdout);
  if (code !== 0) throw new Error(`show ${locator} exited ${code}: ${stderr.read()?.toString()}`);
  const [line] = Buffer.concat(chunks).toString().split("\n").filter(Boolean);
  const decoded = decodeInspectionDocument(JSON.parse(line!));
  if (!decoded.success) throw new Error(decoded.reason);
  const outline = narrowInspectionSuccess(decoded.value, "attempt.get");
  if (!outline.success) throw new Error(outline.reason);
  return outline.value.attempt;
}

/** Runs the real command program in this process and collects both standard streams. */
export async function runCli(cwd: string, argv: readonly string[], env: Record<string, string> = {}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  stdout.on("data", (chunk: Buffer) => out.push(chunk));
  stderr.on("data", (chunk: Buffer) => err.push(chunk));
  const code = await runCliInProcess({
    argv: [...argv],
    cwd,
    env: { NO_COLOR: "1", ...env },
    stdin: Readable.from([]),
    stdout,
    stderr,
  });
  stdout.end();
  stderr.end();
  await Promise.all([finished(stdout), finished(stderr)]);
  return { code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() };
}
