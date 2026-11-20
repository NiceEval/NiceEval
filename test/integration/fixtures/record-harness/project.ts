// Deterministic Record fixture project: eval `first` publishes immediately, eval `held`
// blocks until the test creates `gates/release`, so a Run stays active with one published slot.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

const require = createRequire(new URL("../../../../packages/niceeval/package.json", import.meta.url));

export async function createRecordProject(prefix: string, options: { readonly held: boolean }): Promise<string> {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), prefix));
  try {
    await Promise.all(["evals", "experiments", "gates", "node_modules"].map((dir) => mkdir(join(cwd, dir))));
    const gates = JSON.stringify(join(cwd, "gates"));
    await Promise.all([
      symlink(dirname(require.resolve("effect/package.json")), join(cwd, "node_modules", "effect"), "dir"),
      writeFile(join(cwd, "package.json"), JSON.stringify({ name: "record-fixture", private: true, type: "module" })),
      writeFile(
        join(cwd, "niceeval.config.ts"),
        `import { defineConfig } from "niceeval";\nexport default defineConfig({ maxConcurrency: 2, maxRetries: 0 });\n`,
      ),
      writeFile(
        join(cwd, "adapter.ts"),
        `
        import { defineAdapter } from "niceeval/adapter";
        import { equals } from "niceeval/expect";
        export default defineAdapter({
          name: "record-property", behaviorRevision: "1", create: () => ({}),
          assertions: ({ check }) => ({ ready: () => check(1, equals(1)) }),
        });
      `,
      ),
      writeFile(
        join(cwd, "experiments", "runs.ts"),
        `
        import { defineExperiment } from "niceeval";
        import adapter from "../adapter.ts";
        export default defineExperiment({ adapter, evals: ${JSON.stringify(options.held ? ["first", "held"] : ["first"])}, attempts: 1 });
      `,
      ),
      writeFile(
        join(cwd, "evals", "first.eval.ts"),
        `
        import adapter from "../adapter.ts";
        export default adapter.defineEval({ test(t) { t.ready(); } });
      `,
      ),
      writeFile(
        join(cwd, "evals", "held.eval.ts"),
        `
        import { existsSync, writeFileSync } from "node:fs";
        import { join } from "node:path";
        import { setTimeout } from "node:timers/promises";
        import adapter from "../adapter.ts";
        export default adapter.defineEval({
          async test(t) {
            writeFileSync(join(${gates}, "entered"), "1");
            while (!existsSync(join(${gates}, "release"))) await setTimeout(10);
            t.ready();
          },
        });
      `,
      ),
    ]);
    return cwd;
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

export async function waitForGate(cwd: string, name: "entered" | "release", timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(join(cwd, "gates", name))) {
    if (Date.now() >= deadline) throw new Error(`Gate ${name} was not reached`);
    await setTimeout(10);
  }
}

export async function openGate(cwd: string, name: "entered" | "release"): Promise<void> {
  await writeFile(join(cwd, "gates", name), "1");
}
