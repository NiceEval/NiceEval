// rerun: pnpm e2e test --repo inspection -- --run test/judge-retry-policy.test.ts
import { only, defined } from "@niceeval/testkit";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { inspectionE2E, inspectionCaseArtifacts } from "./support.ts";

// @feature docs/feature/judge/README.md
test.concurrent.each([
  { mode: "recover", match: "ordinary", count: 3, state: "matched" },
  { mode: "recover", match: "managed", count: 3, state: "matched" },
  { mode: "backoff", match: "ordinary", count: 2, state: "matched" },
  { mode: "persistent", match: "ordinary", count: 3, state: "unavailable" },
  { mode: "deadline", match: "ordinary", count: 1, state: "unavailable" },
  { mode: "header-no-retry", match: "ordinary", count: 1, state: "unavailable" },
  { mode: "body-no-retry", match: "ordinary", count: 1, state: "unavailable" },
  { mode: "protocol", match: "ordinary", count: 1, state: "errored" },
])("Judge retries transient requests within its deadline: $mode / $match", async ({ mode, match, count, state }) => {
  const sentAt: number[] = [];
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      sentAt.push(Date.now());
      const ordinal = sentAt.length;
      const success = (mode === "recover" && ordinal === 3) || (mode === "backoff" && ordinal === 2);
      const status = success ? 200 : mode === "protocol" ? 400 : mode === "recover" && ordinal === 2 ? 429 : 502;
      response.writeHead(status, {
        "Content-Type": "application/json",
        ...(mode === "backoff" ? {} : { "Retry-After": mode === "deadline" ? "120" : "0.05" }),
        ...(mode === "header-no-retry" ? { "x-should-retry": "false" } : {}),
      });
      response.end(
        JSON.stringify(
          success
            ? {
                id: "retry-success",
                model: "retry-fixture",
                object: "chat.completion",
                created: 0,
                usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
                choices: [
                  {
                    index: 0,
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "result",
                          type: "function",
                          function: {
                            name: "record_score_match",
                            arguments: JSON.stringify({ measurement: 1, rationale: "Correct answer" }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }
            : {
                error: {
                  message: "Fixture upstream failure",
                  ...(mode === "body-no-retry" ? { retryable: false } : {}),
                },
              },
        ),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture did not bind");
  try {
    await inspectionE2E.case(
      `retry-${mode}-${match}`,
      { artifacts: inspectionCaseArtifacts() },
      async ({ commands: { niceeval } }) => {
        const run = await niceeval.run(["exp", "judge-retry-policy", "--rerun", "all", "--json"], {
          env: {
            NICEEVAL_E2E_RETRY_URL: `http://127.0.0.1:${address.port}/v1`,
            NICEEVAL_E2E_RETRY_MATCH: match,
            NICEEVAL_E2E_RETRY_DEADLINE: mode === "deadline" ? "short" : "normal",
          },
        });
        expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
        const event = only(run.expEvalEvents(), (item) => item.evalId === "judge-retry-policy", run.diagnostic());
        const locator = defined(event.locator);
        const read = await niceeval.run(["show", locator, "--json"]);
        const entry = only(
          read.inspectionSuccess("attempt.get").attempt.assertions.entries,
          (item) => item.display.label === "Retry policy",
        );
        const detail = await niceeval.run(["show", locator, entry.entryId, "--full", "--json"]);
        const assertion = detail.attemptAssertionDetail().assertion;
        expect(assertion, detail.diagnostic()).toMatchObject({ check: { state } });
        expect(sentAt).toHaveLength(count);
        if (mode === "backoff") expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(1900);
        if (mode === "recover") {
          expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(40);
          expect(sentAt[2]! - sentAt[1]!).toBeGreaterThanOrEqual(40);
        }
        if (state === "unavailable" || state === "errored") {
          expect(JSON.stringify(assertion)).toContain(mode === "protocol" ? "HTTP 400" : "HTTP 502");
        }
        const usageRead = await niceeval.run(["show", locator, "usage", "--json"]);
        const usage = usageRead.inspectionSuccess("attempt.usage").usage.judgeUsage;
        expect(usage.state).toBe("complete");
        if (usage.state !== "complete") throw new Error("Missing physical-request ledger");
        expect(usage.calls).toHaveLength(count);
        expect(usage.calls.map((call) => call.httpStatus)).toEqual(
          mode === "recover"
            ? [502, 429, 200]
            : mode === "backoff"
              ? [502, 200]
              : Array.from({ length: count }, () => (mode === "protocol" ? 400 : 502)),
        );
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    expect(server.listening).toBe(false);
  }
});
