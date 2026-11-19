// rerun: pnpm e2e test --repo eval -- --run test/test-cleanup.test.ts
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { inspectAttempt } from "./inspection.ts";

// @use-case docs/feature/eval/use-case/fixtures-lifecycle.md
test.concurrent("判定完成后按逆序释放评估与 before 登记的资源", async () => {
  await evalE2E.case("test-cleanup", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    await writeFile(
      join(projectRoot, "experiments", "test-cleanup.ts"),
      `
      import { appendFileSync } from "node:fs";
      import { defineExperiment } from "niceeval";
      import { deterministicSandboxAgent } from "../agents/sandbox.ts";
      import { readLimitedSandbox } from "./assertion-sandbox.ts";
      export default defineExperiment({
        adapter: deterministicSandboxAgent,
        sandbox: readLimitedSandbox.before((_, context) => {
          context.onCleanup((_, cleanup) => {
            appendFileSync("cleanup.log", Object.isFrozen(cleanup) ? "before cleanup\\n" : "mutable before cleanup\\n");
            throw new Error("before cleanup fixture failed");
          });
        }),
        evals: ["test-cleanup"],
      });
    `,
    );
    await writeFile(
      join(projectRoot, "evals", "test-cleanup.eval.ts"),
      `
      import assert from "node:assert/strict";
      import { appendFileSync } from "node:fs";
      import { defineEval } from "niceeval";
      import { defineJudge } from "niceeval/expect";
      export default defineEval({
        test(t) {
          t.onCleanup(() => {
            assert.throws(() => t.onCleanup(() => {}), /t\\.onCleanup.*registration is closed/);
            appendFileSync("cleanup.log", "first cleanup and closed registration\\n");
          });
          t.onCleanup((context) => {
            assert.ok(Object.isFrozen(context));
            assert.notEqual(context.signal, t.signal);
            assert.equal(context.signal.aborted, false);
            assert.ok(context.timeoutMs > 0 && context.deadlineAt > Date.now());
            appendFileSync("cleanup.log", "second cleanup\\n");
            throw new Error("cleanup fixture failed");
          });
          t.judge("answer", defineJudge({ rubric: "Evaluate the answer." })).gate(0.5).label("deferred judge");
          appendFileSync("cleanup.log", "test ending\\n");
          queueMicrotask(() => {
            try {
              t.onCleanup(() => appendFileSync("cleanup.log", "late cleanup executed\\n"));
              appendFileSync("cleanup.log", "late registration accepted\\n");
            } catch (error) {
              appendFileSync("cleanup.log", error.message + "\\n");
            }
          });
        },
      });
    `,
    );

    const journal = join(projectRoot, "cleanup.log");
    const server = createServer((request, response) => {
      const parts: Buffer[] = [];
      request.on("data", (chunk: Buffer) => parts.push(chunk));
      request.on("end", async () => {
        const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
        const precheck = payload.messages.some((message: { content: string }) => message.content === "Precheck.");
        if (!precheck) {
          await setTimeout(30);
          await appendFile(journal, "judge answered\n");
        }
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            id: "cleanup-judge",
            object: "chat.completion",
            created: 0,
            model: "judge-e2e",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "cleanup-judge-call",
                      type: "function",
                      function: {
                        name: payload.tool_choice.function.name,
                        arguments: JSON.stringify({ measurement: 1, rationale: "Fixture score" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Judge fixture has no TCP address");
      const run = await niceeval.run(["exp", "test-cleanup", "--rerun", "all", "--json"], {
        env: {
          ...process.env,
          NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          NICEEVAL_E2E_JUDGE_KEY: "fixture-only",
        },
      });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const result = only(run.expEvalEvents(), (event) => event.evalId === "test-cleanup", run.diagnostic());
      expect(result.verdict).toBe("passed");
      expect(await readFile(journal, "utf8")).toBe(
        "test ending\nt.onCleanup() registration is closed\njudge answered\nsecond cleanup\nfirst cleanup and closed registration\nbefore cleanup\n",
      );
      const trace = await inspectAttempt(niceeval, projectRoot, result.locator!, "attempt.trace");
      expect(trace.document.trace.diagnostics.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "teardown-failed",
            phase: "attempt.after",
            summary: "Cleanup for eval:test-cleanup test(t) failed: cleanup fixture failed",
          }),
          expect.objectContaining({
            code: "teardown-failed",
            phase: "attempt.after",
            summary:
              "Cleanup for experiment:test-cleanup/experiment:test-cleanup:before:0 failed: before cleanup fixture failed",
          }),
        ]),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

// @use-case docs/feature/eval/use-case/fixtures-lifecycle.md
test.concurrent("评估正文抛错后仍释放已登记的宿主资源", async () => {
  await evalE2E.case("test-cleanup-throws", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    await writeFile(
      join(projectRoot, "experiments", "test-cleanup-throws.ts"),
      `
      import { defineExperiment } from "niceeval";
      export default defineExperiment({ evals: ["test-cleanup-throws"] });
    `,
    );
    await writeFile(
      join(projectRoot, "evals", "test-cleanup-throws.eval.ts"),
      `
      import { writeFile } from "node:fs/promises";
      import { defineEval } from "niceeval";
      export default defineEval({
        async test(t) {
          t.onCleanup(() => writeFile("released.txt", "released"));
          throw new Error("fixture test failed");
        },
      });
    `,
    );
    const run = await niceeval.run(["exp", "test-cleanup-throws", "--rerun", "all", "--json"]);
    const result = only(run.expEvalEvents(), (event) => event.evalId === "test-cleanup-throws", run.diagnostic());
    expect(result.verdict).toBe("errored");
    expect(await readFile(join(projectRoot, "released.txt"), "utf8")).toBe("released");
  });
});
