import { rm } from "node:fs/promises";
import { beforeAll, expect, test } from "vitest";
import {
  HOST_SANDBOX_SOURCE,
  OpenAIProvider,
  chatToolResponse,
  createJudgeProject,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readAssertionsList,
  showJsonDocuments,
  startHttpServer,
} from "./fixtures/judge-harness/harness.ts";

type Request = {
  readonly model: string;
  readonly prompt_cache_key?: string;
  readonly stream?: boolean;
  readonly messages: readonly { readonly role: string; readonly content: unknown }[];
};

const marker = "shared-evaluation-material";
const credential = "private-provider-credential";

async function exercise(reject: "ordinary" | "pi" | "unrelated" | undefined) {
  const requests: Request[] = [];
  let rejected = false;
  const server = await startHttpServer((_req, body, res) => {
    const payload: Request = JSON.parse(body);
    requests.push(payload);
    if (
      !rejected &&
      ((reject === "ordinary" && !payload.stream && payload.prompt_cache_key !== undefined) ||
        (reject === "pi" && payload.stream && payload.prompt_cache_key !== undefined) ||
        (reject === "unrelated" && !payload.stream))
    ) {
      rejected = true;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: reject === "unrelated"
          ? { message: "Invalid model", param: "model" }
          : { message: "Unknown parameter: prompt_cache_key", param: "prompt_cache_key" },
      }));
      return;
    }
    const simulated = JSON.stringify(payload.messages).includes("Fixture simulated user instructions.");
    const measuredUsage = { prompt_tokens: 100, completion_tokens: 15, total_tokens: 115 };
    const lastMessage = JSON.stringify(payload.messages.at(-1)?.content);
    const cachedTokens = lastMessage.includes("first-rubric") || simulated
      ? 37
      : lastMessage.includes("agent-rubric-explicit-zero") ? 0 : undefined;
    const usage = cachedTokens === undefined
      ? measuredUsage
      : { ...measuredUsage, prompt_tokens_details: { cached_tokens: cachedTokens } };
    if (!payload.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(chatToolResponse("record_score_match", { choice: "satisfied", rationale: "Fixture" }, payload.model, usage));
      return;
    }
    const response = JSON.parse(chatToolResponse(
      simulated ? "reply_to_agent" : "submit_evaluation",
      simulated
        ? { message: "Fixture reply" }
        : { satisfied: true, rationale: "Fixture", evidence: [{ kind: "observation", ref: "material", note: "Seen" }] },
      payload.model,
      usage,
    ));
    const choice = response.choices[0];
    const tool = { ...choice.message.tool_calls[0], index: 0, id: `tool-${requests.length}` };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end([
      "data: " + JSON.stringify({
        ...response,
        id: `completion-${requests.length}`,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", tool_calls: [tool] }, finish_reason: "tool_calls" }],
      }),
      "data: [DONE]",
      "",
    ].join("\n\n"));
  });
  let cwd: string | undefined;
  try {
    cwd = await createJudgeProject("niceeval-judge-prompt-cache-", {
      sandbox: HOST_SANDBOX_SOURCE,
      agent: `
        import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
        import { shell } from "niceeval/sandbox";
        export default defineSandboxAgent({
          name: "prompt-cache-agent",
          evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "prompt-cache-agent", version: "1", revision: "1" }, probe: shell("true") },
          send: async () => ({ status: "completed", events: [{ type: "message", role: "assistant", text: "Fixture question" }] }),
        });
      `,
      evals: { "cache.eval.ts": `
        import { defineScoreEval, defineSimulatedUser } from "niceeval";
        import { binaryJudge, defineAgentJudge } from "niceeval/expect";
        export default defineScoreEval({ async test(t) {
          const material = ${JSON.stringify(marker)};
          const turn = await t.send("Begin");
          await t.simulatedUser(defineSimulatedUser({ instructions: "Fixture simulated user instructions." })).reply(turn);
          const first = t.judge(material, binaryJudge({ rubric: "first-rubric" })).score(1);
          ${reject === "unrelated" ? "" : "await first.orStop(1);"}
          t.judge(material, binaryJudge({ rubric: "second-rubric" })).score(1);
          const review = t.agentJudge(defineAgentJudge({}), { reviewMaterial: material });
          review.judge("agent-rubric-explicit-zero").score(1);
          review.judge("agent-rubric-unreported").score(1);
        } });
      ` },
      experiments: { "cache.ts": `
        import { defineExperiment } from "niceeval";
        import adapter from "../agent.ts";
        import sandbox from "../sandbox.ts";
        export default defineExperiment({ adapter, sandbox, evals: ["cache"], attempts: ${reject ? 1 : 2} });
      ` },
    });
    const result = await planAndRunExperiment(cwd, "cache", {
      config: {
        maxConcurrency: 1,
        judgeProvider: OpenAIProvider({ model: "cache-model", baseUrl: server.baseUrl, apiKey: credential }),
      },
      rerun: "all",
    });
    const attempts = [];
    for (const slot of result.run?.slots ?? []) {
      if (slot.publication.state !== "published") continue;
      const locator = slot.publication.attemptLocator;
      const [usageDoc] = await showJsonDocuments(cwd, [locator, "usage"]);
      const [traceDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
      const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
      const trace = narrowInspectionSuccess(traceDoc!, "attempt.trace");
      if (!usage.success || usage.value.usage.judgeUsage.state !== "complete" || !trace.success)
        throw new Error("Expected Judge usage and execution diagnostics");
      attempts.push({
        assertions: await readAssertionsList(cwd, locator),
        calls: usage.value.usage.judgeUsage.calls.map(({ operation, httpStatus, cacheReadTokens }) =>
          [operation, httpStatus, cacheReadTokens]),
        diagnostics: trace.value.trace.diagnostics.items,
      });
    }
    return { requests, attempts };
  } finally {
    await server.close();
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  }
}

const scenarios = new Map<Parameters<typeof exercise>[0], Awaited<ReturnType<typeof exercise>>>();
beforeAll(async () => {
  for (const mode of [undefined, "ordinary", "pi", "unrelated"] as const) {
    scenarios.set(mode, await exercise(mode));
  }
}, 30_000);

// @feature docs/feature/judge/library.md#prompt-cache
test("managed calls share the Attempt key and repeated material shares a request prefix", () => {
  const { requests, attempts } = scenarios.get(undefined)!;
  expect(attempts).toHaveLength(2);
  expect(requests.map(({ stream }) => stream === true)).toEqual([true, false, false, true, true, true, false, false, true, true]);
  const firstKey = requests[0]!.prompt_cache_key;
  const secondKey = requests[5]!.prompt_cache_key;
  expect(firstKey).toMatch(/^[a-f0-9]{64}$/u);
  expect(secondKey).toMatch(/^[a-f0-9]{64}$/u);
  expect(firstKey).not.toBe(secondKey);
  expect(requests.map(({ prompt_cache_key }) => prompt_cache_key)).toEqual([
    firstKey, firstKey, firstKey, firstKey, firstKey, secondKey, secondKey, secondKey, secondKey, secondKey,
  ]);
  expect(firstKey).not.toContain(marker);
  expect(firstKey).not.toContain(credential);
  for (const index of [1, 6]) {
    const first = requests[index]!.messages;
    const second = requests[index + 1]!.messages;
    expect(first.slice(0, 2)).toEqual(second.slice(0, 2));
    expect(JSON.stringify(first[1])).toContain(marker);
    expect(JSON.stringify(first.slice(0, 2))).not.toContain("first-rubric");
    expect(JSON.stringify(first[2])).toContain("first-rubric");
  }
  for (const attempt of attempts) {
    expect(attempt.calls).toEqual([
      ["classify", 200, 37],
      ["classify", 200, null],
      ["agent", 200, 0],
      ["agent", 200, null],
    ]);
  }
});

// @feature docs/feature/judge/library.md#prompt-cache
test.each(["ordinary", "pi", "unrelated"] as const)("HTTP 400 fallback respects the rejected parameter (%s)", (reject) => {
  const { requests, attempts } = scenarios.get(reject)!;
  expect(attempts).toHaveLength(1);
  const keyed = requests.map(({ prompt_cache_key }) => prompt_cache_key !== undefined);
  expect(keyed).toEqual(
    reject === "ordinary" ? [true, true, false, false, false, false]
      : reject === "pi" ? [true, false, false, false, false, false]
      : [true, true, true, true, true],
  );
  expect(attempts[0]!.diagnostics.filter(({ code }) => code === "judge-prompt-cache-key-rejected"))
    .toHaveLength(reject === "unrelated" ? 0 : 1);
  if (reject !== "unrelated")
    expect(attempts[0]!.assertions.map(({ entry }) => "decision" in entry ? entry.decision.result : undefined)).toEqual(["matched", "matched", "matched", "matched"]);
});
