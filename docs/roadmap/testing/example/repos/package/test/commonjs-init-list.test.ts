import { rmSync } from "node:fs";
import { command } from "@niceeval/testkit";
import { expect, test } from "vitest";

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

// Root runner:
//   pnpm e2e --repo package -- --run test/commonjs-init-list.test.ts
// Isolated repo:
//   pnpm test --run test/commonjs-init-list.test.ts
// regression: b44420d3 — the bin once registered only the ESM tsx loader.
test("a CommonJS consumer can run init and immediately load the generated TypeScript config", async () => {
  rmSync("niceeval.config.ts", { force: true });
  rmSync(".niceeval", { recursive: true, force: true });
  const init = await niceeval.run(["init"], { env: { LC_ALL: "en_US.UTF-8" } });
  expect(init.exitCode, init.diagnostic()).toBe(0);

  const list = await niceeval.run(["list"], { env: { LC_ALL: "en_US.UTF-8" } });
  expect(list.exitCode, list.diagnostic()).toBe(0);
  expect(list.stdout).toContain("Discovered 0 evals");
  expect(list.stderr).toBe("");
});
