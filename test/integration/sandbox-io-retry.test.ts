import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Clock, Duration, Effect, Random } from "effect";
import fc from "fast-check";
import { beforeAll, expect, test } from "vitest";
import { experimentHost } from "niceeval/experiment/host";
import { createLifecycleProject } from "./fixtures/lifecycle-sandbox/harness.ts";

const codes = ["ECONNRESET", "ETIMEDOUT", "EACCES", "ENOENT", "ok"] as const;
type Script = (typeof codes)[number][];
const script = fc.array(fc.constantFrom(...codes), { minLength: 1, maxLength: 5 });
const scripts = fc.array(script, { minLength: 1, maxLength: 6 });
const transient = new Set(["ECONNRESET", "ETIMEDOUT"]);

function expected(script: Script) {
  const requests: string[] = [];
  for (let index = 0; index < 3; index++) {
    const code = script[index] ?? "ok";
    requests.push(code);
    if (code === "ok" || !transient.has(code)) break;
  }
  const last = requests.at(-1)!;
  return { requests, result: last === "ok" ? { value: "fixture content" } : { code: last } };
}

const providerRead = `async (path: string) => {
      const match = /retry-(\\d+)\\.txt$/.exec(path);
      if (!match) return readFile(at(path), "utf8");
      const index = Number(match[1]);
      const input = JSON.parse(await readFile(join(projectRoot, "reads.json"), "utf8"));
      const count = requests.get(index) ?? 0;
      requests.set(index, count + 1);
      const code = input[index][count] ?? "ok";
      record("retry-request", { index, code });
      if (code !== "ok") throw Object.assign(new Error("Fixture read failed"), { code });
      return "fixture content";
    }`;

const evalSource = `
import { readFile } from "node:fs/promises";
import { defineEval } from "niceeval";
import { record } from "../journal.ts";

export default defineEval({
  async test(t) {
    const input = JSON.parse(await readFile(new URL("../reads.json", import.meta.url), "utf8"));
    for (const index of input.keys()) {
      const result = await t.sandbox.readText("retry-" + index + ".txt").then(
        (value) => ({ value }),
        (error) => ({ code: error.code }),
      );
      record("retry-result", { index, result });
    }
  },
});
`;

async function observe(input: Script[]) {
  const project = await createLifecycleProject({
    scripts: [{ cleanups: 0, beforeFails: false, test: "pass" }],
    attempts: 1,
    maxConcurrency: 1,
    failCreates: [],
  });
  try {
    const providerPath = join(project.cwd, "sandbox.ts");
    const provider = await readFile(providerPath, "utf8");
    const readText = 'readText: (path: string) => readFile(at(path), "utf8"),';
    if (!provider.includes(readText)) throw new Error("Lifecycle provider readText fixture changed");
    await Promise.all([
      writeFile(
        providerPath,
        provider
          .replace("const sandbox = {", "const requests = new Map<number, number>();\n  const sandbox = {")
          .replace(readText, `readText: ${providerRead},`),
      ),
      writeFile(join(project.cwd, "reads.json"), JSON.stringify(input)),
      writeFile(join(project.cwd, "evals/e0.eval.ts"), evalSource),
    ]);

    const planned = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd: project.cwd,
        experimentSelector: "lifecycle",
        config: { maxConcurrency: 1 },
        overrides: { rerun: "all", earlyExit: false },
      }),
    );
    if (planned.status !== "ready") throw new Error(`Could not plan Run: ${JSON.stringify(planned)}`);

    const invocation = experimentHost.invocation.run({ plan: planned.plan });
    const { summary } = await Effect.runPromise(
      Clock.clockWith((clock) =>
        invocation.pipe(
          Effect.provideService(Clock.Clock, {
            currentTimeMillis: clock.currentTimeMillis,
            currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
            currentTimeNanos: clock.currentTimeNanos,
            currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
            monotonicTimeNanos: clock.monotonicTimeNanos,
            monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
            // Elapse the two IO backoffs immediately. Keep the real lifecycle deadlines.
            sleep: (duration) => ([125, 250].includes(Duration.toMillis(duration)) ? Effect.void : clock.sleep(duration)),
          }),
          Effect.provideService(Random.Random, { nextDoubleUnsafe: () => 0, nextIntUnsafe: () => 0 }),
        ),
      ),
    );
    expect(summary.passed, JSON.stringify(project.events)).toBe(1);
    return input.map((_, index) => {
      const events = project.events.filter((event) => event.index === index);
      return {
        requests: events.filter((event) => event.event === "retry-request").map((event) => event.code),
        result: events.find((event) => event.event === "retry-result")?.result,
      };
    });
  } finally {
    await project.dispose();
  }
}

let input: Script[];
let actual: Awaited<ReturnType<typeof observe>>;

beforeAll(async () => {
  // Run the generated scripts inside one Attempt to keep the property below the integration cost limit.
  input = [
    ["ECONNRESET", "ok"],
    ["ETIMEDOUT", "ECONNRESET", "ETIMEDOUT", "ok"],
    ["EACCES", "ok"],
    ["ECONNRESET", "ENOENT", "ok"],
    ...fc.sample(scripts, { seed: 260_601, numRuns: Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 4) }).flat(),
  ];
  actual = await observe(input);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("idempotent Sandbox reads retry transient failures up to the limit and preserve terminal results", () => {
  expect(actual.map((observation, index) => ({ input: input[index], ...observation }))).toEqual(
    input.map((script) => ({ input: script, ...expected(script) })),
  );
});
