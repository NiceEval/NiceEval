import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { runCliInProcess } =
  require("./src/cli/in-process.ts") as typeof import("../../packages/niceeval/src/cli/in-process.ts");
const { decodeExpPlanDocument, experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");

const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");

async function invoke(cwd: string, ...argv: string[]) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const code = await runCliInProcess({ cwd, argv, env: { NO_COLOR: "1" }, stdin: Readable.from([]), stdout, stderr });
  return {
    code,
    stdout: stdout.read()?.toString() ?? "",
    stderr: stderr.read()?.toString() ?? "",
  };
}

let cwd: string;
const hostCwd = process.cwd();

beforeAll(async () => {
  cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-cli-cwd-"));
  await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(cwd, dir))));
  await Promise.all([
    writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
    writeFile(join(cwd, "input.txt"), "before"),
    writeFile(join(cwd, "niceeval.config.ts"), "export default {};"),
    writeFile(
      join(cwd, "adapter.ts"),
      `
      import { defineAdapter } from "niceeval/adapter";
      import { equals } from "niceeval/expect";
      export default defineAdapter({
        name: "cwd-fixture", behaviorRevision: "1", create: () => ({}),
        assertions: ({ check }) => ({ ready: () => check(1, equals(1)) }),
      });
    `,
    ),
    writeFile(
      join(cwd, "evals", "cwd.eval.ts"),
      `
      import adapter from "../adapter.ts";
      import { loadText } from "niceeval/loaders";
      const input = await loadText("input.txt");
      export default adapter.defineEval({ test(t) { if (input) t.ready(); } });
    `,
    ),
    writeFile(
      join(cwd, "experiments", "cwd.ts"),
      `
      import { defineExperiment } from "niceeval";
      import adapter from "../adapter.ts";
      export default defineExperiment({ adapter, evals: ["cwd"], attempts: 1 });
    `,
    ),
  ]);
  expect(cwd).not.toBe(hostCwd);
  const execution = await invoke(cwd, "exp", "cwd", "--rerun", "all", "--json");
  expect(execution.code, execution.stderr + execution.stdout).toBe(0);
  await writeFile(join(cwd, "input.txt"), "preview");
  const preview = await invoke(cwd, "exp", "cwd", "--dry", "--json");
  expect(preview.code, preview.stderr).toBe(0);
  const plan = decodeExpPlanDocument(JSON.parse(preview.stdout));
  expect(plan.matrix[0]?.slots[0]?.reason).toBe("identity-mismatch");
});

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

// @feature docs/feature/experiments/README.md#progress-counts
test.for([1, 2])("exp dry reports project-relative identity changes for the injected cwd (sample %s)", async () => {
  const data = fc.constantFrom("after", "replacement", "changed");
  await fc.assert(
    fc.asyncProperty(data, async (contents) => {
      await writeFile(join(cwd, "input.txt"), contents);
      const planned = await Effect.runPromise(
        experimentHost.invocation.plan({
          cwd,
          experimentSelector: "cwd",
          config: {},
          preview: true,
        }),
      );
      if (planned.status !== "ready" || planned.dry === undefined) {
        throw new Error(`Expected a dry plan, got ${JSON.stringify(planned)}`);
      }
      const slot = planned.dry.slots[0];
      expect(slot?.state === "gap" && slot.reason).toBe("identity-mismatch");
      const change = slot?.comparisons.find(({ recordedClaim }) => recordedClaim === "execution-identity")?.explanation;
      expect(change?.kind === "changed" && change.deltas.map(({ selector }) => selector)).toEqual(["data:input.txt"]);
      const readback = planned.dry.readbacks[0];
      if (readback?.state !== "prior" || readback.sourceFiles.state !== "available") {
        throw new Error(`Expected source files in the dry plan, got ${JSON.stringify(readback)}`);
      }
      expect(readback.sourceFiles.value.map(({ path }) => path)).toContain("evals/cwd.eval.ts");
      expect(process.cwd()).toBe(hostCwd);
    }),
    { numRuns: 1 },
  );
});
