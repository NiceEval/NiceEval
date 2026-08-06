import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { expect, test } from "vitest";

function run(argv: readonly [string, ...string[]]) {
  const [command, ...args] = argv;
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, LC_ALL: "en_US.UTF-8" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({
      exitCode,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

// Root runner:
//   pnpm e2e --repo package-commonjs -- --run test/commonjs-init-list.test.ts
// Isolated repo:
//   pnpm test --run test/commonjs-init-list.test.ts
// regression: b44420d3 — the bin once registered only the ESM tsx loader.
test("a CommonJS consumer can run init and immediately load the generated TypeScript config", async () => {
  rmSync("niceeval.config.ts", { force: true });
  rmSync(".niceeval", { recursive: true, force: true });
  const init = await run(["pnpm", "--silent", "exec", "niceeval", "init"]);
  expect(init.exitCode, `stdout:\n${init.stdout}\nstderr:\n${init.stderr}`).toBe(0);

  const list = await run(["pnpm", "--silent", "exec", "niceeval", "list"]);
  expect(list.exitCode, `stdout:\n${list.stdout}\nstderr:\n${list.stderr}`).toBe(0);
  expect(list.stdout).toContain("Discovered 0 evals");
  expect(list.stderr).toBe("");
});
