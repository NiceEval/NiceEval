// 跨进程保证：进程终止与信号——失败挂起等待进程 stdin，回车或 SIGINT 后继续收尾
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import fc from "fast-check";
import { expect, test } from "vitest";
import { createFixtureProject } from "../integration/fixtures/adapter-trace-usage-harness/harness.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const lineEnding = fc.constantFrom("\n", "\r");

const sources = {
  "adapter.ts": `
    import { defineAdapter } from "niceeval/adapter";
    import { appendFileSync } from "node:fs";
    export default defineAdapter({
      name: "pause-fixture", behaviorRevision: "1",
      create(ctx) {
        ctx.onCleanup(() => appendFileSync(new URL("./cleanup.txt", import.meta.url), "closed\\n"));
        return {};
      },
    });
  `,
  "experiments/fixture.ts": `
    import { defineExperiment } from "niceeval";
    import adapter from "../adapter.ts";
    export default defineExperiment({ adapter, evals: ["failure"] });
  `,
  "evals/failure.eval.ts": `
    import adapter from "../adapter.ts";
    export default adapter.defineEval({ test() { throw new Error("fixture fails"); } });
  `,
};

for (const mode of ["enter", "interrupt", "pipe"] as const) {
  // @feature docs/feature/sandbox/README.md#failure-pause
  test(`failed Attempt performs cleanup after ${mode}`, async () => {
    await fc.assert(
      fc.asyncProperty(lineEnding, async (enter) => {
        const project = await createFixtureProject("niceeval-failure-pause", sources);
        const marker = join(project.cwd, "cleanup.txt");
        const tty = "Object.defineProperty(process.stdin, 'isTTY', { value: true });";
        const args = mode === "pipe" ? [] : ["--import", `data:text/javascript,${encodeURIComponent(tty)}`];
        await writeFile(join(project.cwd, "niceeval.config.ts"), "export default { maxConcurrency: 1 };");
        const child = execa(
          process.execPath,
          [...process.execArgv, ...args, cli, "exp", "fixture", "--pause-on-failure"],
          { cwd: project.cwd, stdin: "pipe", reject: false, timeout: 8_000 },
        );
        try {
          if (mode !== "pipe") {
            const prompted = Promise.withResolvers<void>();
            let stderr = "";
            child.stderr!.on("data", (chunk) => {
              stderr += chunk.toString();
              if (stderr.includes("Press [Enter]")) prompted.resolve();
            });
            await Promise.race([
              prompted.promise,
              child.then((result) => {
                throw new Error(`CLI exited before the pause prompt: ${result.stderr}`);
              }),
            ]);
            expect(existsSync(marker)).toBe(false);
            // A stray input byte does not acknowledge the pause.
            child.stdin!.write("x");
            if (mode === "interrupt") child.kill("SIGINT");
            else child.stdin!.end(enter);
          } else {
            child.stdin!.end();
          }
          const result = await child;
          expect(result.timedOut, result.stderr).toBe(false);
          expect(result.exitCode, result.stderr).toBe(mode === "interrupt" ? 130 : 1);
          expect(await readFile(marker, "utf8")).toBe("closed\n");
          if (mode === "pipe")
            expect(result.stdout).toContain("Pause on failure needs an interactive single-attempt terminal");
        } finally {
          child.kill();
          await child.catch(() => {});
          await project.dispose();
        }
      }),
      { numRuns: 1 },
    );
  }, 10_000);
}
