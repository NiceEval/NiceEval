import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

// Root runner:
//   pnpm e2e --repo package -- --run test/commonjs-init-list.test.ts
// Isolated repo:
//   pnpm test --run test/commonjs-init-list.test.ts
// feature: docs/feature/compile-time-contracts/library.md
// regression: memory/tsx-dynamic-import-require-cycle.md
// init 会改写共享 config，因此整条 case 在私有副本里执行，不碰 Repo 根现场。
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cjs-init-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("a CommonJS consumer can run init and immediately load the generated TypeScript config", async () => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    rmSync(resolve(root, "niceeval.config.ts"), { force: true });
    const init = await niceeval.run(["init"], { cwd: root, env: { LC_ALL: "en_US.UTF-8" } });
    expect(init.exitCode, init.diagnostic()).toBe(0);

    const list = await niceeval.run(["list"], { cwd: root, env: { LC_ALL: "en_US.UTF-8" } });
    expect(list.exitCode, list.diagnostic()).toBe(0);
    expect(list.stdout).toContain("Discovered 0 evals");
    expect(list.stderr).toBe("");
  });
});
