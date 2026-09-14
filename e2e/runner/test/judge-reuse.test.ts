import { createServer } from "node:http";
import { only } from "@niceeval/testkit";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

test.concurrent("Judge 模型不变时沿用，修改 Eval 模型后重新评价 [necase_GCCD96SAN8ZJTEM5]", async () => {
  const models: string[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    models.push(input.model);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      id: "reuse-response", object: "chat.completion", created: 0, model: input.model,
      choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: null,
        tool_calls: [{ id: "reuse-call", type: "function", function: {
          name: input.tool_choice.function.name,
          arguments: JSON.stringify({ measurement: 1, rationale: "The fixture value is 42." }),
        } }],
      } }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No fixture address");
    await runnerE2E.case("judge-reuse", async ({ commands: { niceeval } }) => {
      const env = {
        ...process.env,
        NICEEVAL_E2E_ADAPTER_REVISION: "1",
        NICEEVAL_E2E_REUSE_JUDGE_URL: `http://127.0.0.1:${address.port}/v1`,
        NICEEVAL_E2E_REUSE_JUDGE_KEY: "reuse-fixture-key",
        NICEEVAL_E2E_REUSE_JUDGE_MODEL: "first-model",
      };
      const first = await niceeval.run(["exp", "judge-reuse", "--json"], { env });
      expect(first.exitCode, first.diagnostic()).toBe(0);
      const original = only(first.expEvalEvents(), () => true, first.diagnostic());
      expect(original.verdict).toBe("passed");
      const stable = await niceeval.run(["exp", "judge-reuse", "--dry", "--json"], { env });
      expect(stable.exitCode, stable.diagnostic()).toBe(0);
      expect(decodeExpPlanDocument(stable.json<unknown>())).toMatchObject({ total: 1, reused: 1 });
      const carried = await niceeval.run(["exp", "judge-reuse", "--json"], { env });
      expect(carried.exitCode, carried.diagnostic()).toBe(0);
      expect(only(carried.expEvents(), (event) => event.event === "start", carried.diagnostic())).toMatchObject({ reused: 1 });
      expect(models).toEqual(["first-model"]);
      const changedEnv = { ...env, NICEEVAL_E2E_REUSE_JUDGE_MODEL: "second-model" };
      const changed = await niceeval.run(["exp", "judge-reuse", "--dry", "--json"], { env: changedEnv });
      expect(changed.exitCode, changed.diagnostic()).toBe(0);
      expect(decodeExpPlanDocument(changed.json<unknown>())).toMatchObject({ total: 1, reused: 0 });
      const rerun = await niceeval.run(["exp", "judge-reuse", "--json"], { env: changedEnv });
      expect(rerun.exitCode, rerun.diagnostic()).toBe(0);
      const current = only(rerun.expEvalEvents(), () => true, rerun.diagnostic());
      expect(current.verdict).toBe("passed");
      expect(current.locator).not.toEqual(original.locator);
      expect(models).toEqual(["first-model", "second-model"]);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
