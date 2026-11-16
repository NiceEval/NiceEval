import { command } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/eval/README.md
test.concurrent("Eval catalog SDK 保留可定位和修正的 discovery 失败", async () => {
  await evalE2E.case("catalog-errors", async ({ paths }) => {
    const result = await command([process.execPath]).run(
      [
        "--input-type=module",
        "--eval",
        `
        import assert from "node:assert/strict";
        import { mkdir, writeFile } from "node:fs/promises";
        import { resolve } from "node:path";
        import { Effect, Result } from "effect";
        import { evalHost, EvalCatalogError } from "niceeval/eval/host";
        const cwd = resolve("catalog-project");
        await mkdir(resolve(cwd, "evals"), { recursive: true });
        await writeFile(resolve(cwd, "evals/broken.eval.ts"), "export default 42;\\n");
        const result = await Effect.runPromise(Effect.result(evalHost.catalog({ cwd })));
        assert.equal(Result.isFailure(result), true);
        assert.equal(result.failure instanceof EvalCatalogError, true);
        assert.equal(result.failure.cause._tag, "DiscoveryError");
        const [issue] = result.failure.cause.issues;
        assert.equal(issue.code, "discovery.invalid-export");
        assert.match(issue.file, /broken\\.eval\\.ts$/u);
        assert.equal(typeof issue.message, "string");
        assert.equal(Array.isArray(issue.actions), true);
        `,
      ],
      { cwd: paths.projectRoot },
    );
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
