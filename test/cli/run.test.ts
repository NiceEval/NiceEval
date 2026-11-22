import { PassThrough, Readable } from "node:stream";
import fc from "fast-check";
import { expect, test } from "vitest";
import { runCliInProcess } from "../../packages/niceeval/src/cli/in-process.ts";

// @use-case docs/feature/run/use-case/查看运行.md#list
test("run list rejects nonpositive limits before emitting a machine document", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ max: 0 }), async (limit) => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const code = await runCliInProcess({
        argv: ["run", "list", "--json", "--limit", String(limit)],
        cwd: process.cwd(),
        env: { NO_COLOR: "1" },
        stdin: Readable.from([]),
        stdout,
        stderr,
      });
      expect(code).toBe(1);
      expect(stdout.read()).toBeNull();
      expect(stderr.read()?.toString()).toContain("--limit");
    }),
    { numRuns: 12, examples: [[0]] },
  );
});
