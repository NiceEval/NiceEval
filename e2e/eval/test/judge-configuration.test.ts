import { createServer } from "node:http";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertion, inspectAttempt } from "./inspection.ts";

function provider() {
  const requests: Array<{ model: string; tokens: number; authorization: string | undefined }> = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push({ model: input.model, tokens: input.max_completion_tokens, authorization: request.headers.authorization });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      id: "configuration-response", object: "chat.completion", created: 0, model: input.model,
      choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: null,
        tool_calls: [{ id: "configuration-call", type: "function", function: {
          name: input.tool_choice.function.name,
          arguments: JSON.stringify({ measurement: 1, rationale: "The fixture answer is Paris." }),
        } }],
      } }],
    }));
  });
  return { server, requests };
}

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No fixture address");
  return `http://127.0.0.1:${address.port}/v1`;
}
async function close(server: ReturnType<typeof createServer>) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test.concurrent("Judge 配置逐字段继承并按 Eval 与 Experiment 覆盖 [necase_SBN2ZSD6AQ22YFAE]", async () => {
  const { server, requests } = provider();
  const baseUrl = await listen(server);
  try {
    await evalE2E.case("judge-configuration", async ({ commands: { niceeval } }) => {
      const env = { ...process.env, NICEEVAL_E2E_JUDGE_BASE_URL: baseUrl, NICEEVAL_E2E_JUDGE_KEY: "configuration-fixture-key" };
      const inherited = await niceeval.run(["exp", "judge-configuration", "--rerun", "all", "--json"], { env });
      expect(inherited.exitCode, inherited.diagnostic()).toBe(0);
      expect(inherited.expEvalEvents().map(({ evalId, verdict }) => ({ evalId, verdict })).sort((a, b) => a.evalId.localeCompare(b.evalId))).toEqual([
        { evalId: "judge-configuration/inherited", verdict: "passed" },
        { evalId: "judge-configuration/overridden", verdict: "passed" },
      ]);
      expect(requests.splice(0).sort((a, b) => a.model.localeCompare(b.model))).toEqual([
        { model: "eval-specific-model", tokens: 256, authorization: "Bearer configuration-fixture-key" },
        { model: "judge-e2e", tokens: 128, authorization: "Bearer configuration-fixture-key" },
      ]);
      const overridden = await niceeval.run(["exp", "judge-configuration-experiment", "--rerun", "all", "--json"], { env });
      expect(overridden.exitCode, overridden.diagnostic()).toBe(0);
      expect(overridden.expEvalEvents().map(({ verdict }) => verdict)).toEqual(["passed", "passed"]);
      expect(requests.sort((a, b) => a.tokens - b.tokens)).toEqual([
        { model: "experiment-specific-model", tokens: 128, authorization: "Bearer configuration-fixture-key" },
        { model: "experiment-specific-model", tokens: 256, authorization: "Bearer configuration-fixture-key" },
      ]);
    });
  } finally { await close(server); }
});

test.concurrent("仅普通断言的 Eval 不探测已配置的 Judge [necase_PERJXXND67KH9RNJ]", async () => {
  const { server, requests } = provider();
  const baseUrl = await listen(server);
  try {
    await evalE2E.case("judge-no-probe", async ({ commands: { niceeval } }) => {
      const result = await niceeval.run(["exp", "judge-configuration-pure", "--rerun", "all", "--json"], {
        env: { ...process.env, NICEEVAL_E2E_JUDGE_BASE_URL: baseUrl, NICEEVAL_E2E_JUDGE_KEY: "configuration-fixture-key" },
      });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.expEvalEvents().map(({ verdict }) => verdict)).toEqual(["passed"]);
      expect(requests).toEqual([]);
    });
  } finally { await close(server); }
});

test.concurrent("已配置模型缺少 Judge 凭据时不发送请求 [necase_HKVK56KKNX4BTM4D]", async () => {
  const { server, requests } = provider();
  const baseUrl = await listen(server);
  try {
    await evalE2E.case("judge-no-key", async ({ commands: { niceeval }, paths: { projectRoot } }) => {
      const result = await niceeval.run(["exp", "judge-configuration", "--rerun", "all", "--json"], {
        env: { ...process.env, NICEEVAL_E2E_JUDGE_BASE_URL: baseUrl, NICEEVAL_E2E_JUDGE_KEY: "", OPENAI_API_KEY: "must-not-borrow-adapter-key" },
      });
      expect(result.exitCode, result.diagnostic()).toBe(1);
      const attempts = result.expEvalEvents();
      expect(attempts.map(({ verdict }) => verdict)).toEqual(["errored", "errored"]);
      for (const { locator } of attempts) {
        const attempt = await inspectAttempt(niceeval, projectRoot, locator!, "attempt.get");
        expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
        const entries = attempt.document.attempt.assertions.entries;
        expect(entries).toHaveLength(1);
        const detail = await inspectAssertion(niceeval, projectRoot, locator!, entries[0]!.entryId);
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        const entry = assertionEntry(detail.document, detail.receipt.diagnostic());
        expect(entry.scoreMatchAudit).toMatchObject({ state: "available", audit: { result: { state: "unavailable", code: "judge-key-unresolved" } } });
      }
      expect(requests).toEqual([]);
    });
  } finally { await close(server); }
});
