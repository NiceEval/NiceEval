import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import fc from "fast-check";
import { beforeAll, expect, test } from "vitest";
import { createFixtureProject } from "../integration/fixtures/adapter-trace-usage-harness/harness.ts";
import { runCli } from "../integration/fixtures/lifecycle-sandbox/harness.ts";

const observed: Array<{ legacy: string; result: Awaited<ReturnType<typeof runCli>>; original: string; retained: string }> = [];
beforeAll(async () => {
  for (const legacy of ["locks", ...fc.sample(fc.constantFrom("sessions", "teardowns"), { seed: 450027, numRuns: 2 })]) {
    const project = await createFixtureProject("legacy-record-diagnostic", {
      "niceeval.config.ts": "export default {};",
      "evals/one.eval.ts": `import { defineEval } from "niceeval"; export default defineEval({ test() {} });`,
      "experiments/one.ts": `import { defineExperiment } from "niceeval"; import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter"; export default defineExperiment({ evals: ["one"], adapter: defineAgent({ name: "unused", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }) });`,
    });
    try {
      const directory = join(project.cwd, ".niceeval", legacy);
      await mkdir(directory, { recursive: true });
      const path = join(directory, "unknown-owner.json");
      const original = '{"owner":"predecessor","preserve":true}\n';
      await writeFile(path, original);
      const result = await runCli(project.cwd, ["exp", "one", "--rerun", "all", "--json"]);
      observed.push({ legacy, result, original, retained: await readFile(path, "utf8") });
    } finally { await project.dispose(); }
  }
});

// @feature docs/feature/run/README.md#interrupt-recovery
test("rejecting predecessor storage preserves the classified cause and recovery instructions", () => {
  for (const { result, original, retained } of observed) {
    expect(result.code, result.stderr).toBe(1);
    expect(result.stderr).toContain("record-schema-unsupported");
    expect(result.stderr).toContain("No automatic migration is available");
    expect(result.stderr).toContain("original NiceEval version");
    expect(result.stderr).toContain("separate project copy without .niceeval");
    expect(retained).toBe(original);
  }
});
