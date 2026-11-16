import { command, createE2EContext } from "@niceeval/testkit";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const e2e = createE2EContext({
  repoId: "record",
  commands: {},
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-run-read-errors-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
});

// @feature docs/feature/run/README.md
test.concurrent("Run Host SDK 保留存储读取失败的分类和操作", async () => {
  await e2e.case("run-read-errors", async ({ paths }) => {
    const result = await command([process.execPath]).run(
      [
        "--input-type=module",
        "--eval",
        `
        import assert from "node:assert/strict";
        import { mkdir, writeFile } from "node:fs/promises";
        import { resolve } from "node:path";
        import { Effect, Result } from "effect";
        import { runHost, RunReadError } from "niceeval/run/host";
        const cwd = resolve("unreadable-project");
        await mkdir(resolve(cwd, ".niceeval"), { recursive: true });
        await writeFile(resolve(cwd, ".niceeval/record.sqlite"), "not a SQLite database");
        const result = await Effect.runPromise(Effect.result(runHost.list({ cwd })));
        assert.equal(Result.isFailure(result), true);
        assert.equal(result.failure instanceof RunReadError, true);
        assert.equal(result.failure.code, "run-read-failed");
        assert.equal(result.failure.cause._tag, "SqliteRecordError");
        assert.equal(typeof result.failure.cause.code, "string");
        assert.equal(typeof result.failure.cause.operation, "string");
        assert.equal(typeof result.failure.cause.message, "string");
        `,
      ],
      { cwd: paths.projectRoot },
    );
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
