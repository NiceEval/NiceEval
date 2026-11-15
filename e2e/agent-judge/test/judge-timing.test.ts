import { createE2EContext, defined, only } from "@niceeval/testkit";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const scenario = createE2EContext({
  repoId: "agent-judge",
  project: {
    from: process.cwd(),
    prefix: "judge-timing-",
    omitTopLevel: [".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [resolve("node_modules/.bin/niceeval")] },
});

// @feature docs/feature/judge/README.md
test.concurrent("Timing exposes Judge requests and real Sandbox tools under their Assertion entries", async () => {
  let ordinal = 0;
  let failed = false;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      ordinal++;
      if (!payload.stream && !failed) {
        failed = true;
        response.writeHead(503, { "Retry-After": "0" });
        response.end("temporary model failure");
        return;
      }
      const last = payload.messages.at(-1);
      const name = !payload.stream
        ? payload.tool_choice.function.name
        : last.role === "user"
          ? "read"
          : "submit_evaluation";
      const args =
        name === "read"
          ? { path: "application.txt" }
          : name === "submit_evaluation"
            ? {
                satisfied: true,
                rationale: "Evidence read",
                evidence: [{ kind: "file", ref: "application.txt", note: "Real file" }],
              }
            : { measurement: 1, rationale: "Evidence present" };
      const calls = [
        { id: `timing-${ordinal}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
      ];
      const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
      if (payload.stream) {
        response.setHeader("Content-Type", "text/event-stream");
        response.end(
          `data: ${JSON.stringify({ id: `generation-${ordinal}`, object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: calls.map((call, index) => ({ ...call, index })) }, finish_reason: "tool_calls" }], usage })}\n\ndata: [DONE]\n\n`,
        );
      } else {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            id: `generation-${ordinal}`,
            object: "chat.completion",
            model: payload.model,
            created: 0,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: null, tool_calls: calls },
                finish_reason: "tool_calls",
              },
            ],
            usage,
          }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing HTTP address");
    await scenario.case("judge-timing", async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "judge-timing", "--rerun", "all", "--json"], {
        timeoutMs: 90000,
        env: {
          ...process.env,
          NICEEVAL_E2E_AGENT_JUDGE_URL: `http://127.0.0.1:${address.port}/v1`,
          NICEEVAL_E2E_AGENT_JUDGE_KEY: "fixture-only-key",
        },
      });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const locator = defined(only(run.expEvalEvents(), () => true).locator);
      const read = await niceeval.run(["show", locator, "timing", "--json"]);
      expect(read.exitCode, read.diagnostic()).toBe(0);
      const activities = read.attemptTiming().timing.activities;
      const assertions = (await niceeval.run(["show", locator, "--json"])).attempt().attempt.assertions.entries;
      const evaluation = only(activities, (a) => a.label === "assertions.evaluate");
      const ordinary = only(activities, (a) => a.label === "judge.entry");
      expect(ordinary.parentActivityId).toBe(evaluation.activityId);
      const session = only(activities, (a) => a.label === "agent-judge.session");
      expect(session.parentActivityId).toBe(evaluation.activityId);
      const prompts = activities.filter((a) => a.label === "agent-judge.prompt");
      expect(prompts).toHaveLength(2);
      for (const [index, prompt] of prompts.entries()) {
        expect(prompt.parentActivityId).toBe(session.activityId);
        expect(prompt.entryId).toBe(assertions[index + 1]!.entryId);
        expect(prompt.assertionLabel).toBe(index === 0 ? "First timing review" : "Second timing review");
        expect(
          activities.some(
            (a) =>
              a.parentActivityId === prompt.activityId &&
              a.label === "judge.request" &&
              a.entryId === prompt.entryId &&
              a.transmissionOrdinal! >= 1,
          ),
        ).toBe(true);
        expect(activities.some((a) => a.parentActivityId === prompt.activityId && a.label === "sandbox.command")).toBe(
          true,
        );
      }
      expect(ordinary.entryId).toBe(assertions[0]!.entryId);
      expect(ordinary.assertionLabel).toBe("Ordinary review");
      const human = await niceeval.run(["show", locator, "timing"]);
      expect(human.exitCode, human.diagnostic()).toBe(0);
      expect(human.stdout).toContain(ordinary.entryId);
      expect(human.stdout).toContain("Ordinary review");
      const requests = activities.filter((a) => a.label === "judge.request");
      expect(requests).toHaveLength(ordinal);
      expect(
        requests
          .filter((a) => a.parentActivityId === ordinary.activityId)
          .map((a) => [a.transmissionOrdinal, a.outcome]),
      ).toEqual([
        [1, "failed"],
        [2, "completed"],
      ]);
      const byId = new Map(activities.map((activity) => [activity.activityId, activity]));
      for (const activity of activities) {
        if (activity.parentActivityId === null) continue;
        const parent = defined(byId.get(activity.parentActivityId));
        expect(activity.startOffsetMs).toBeGreaterThanOrEqual(parent.startOffsetMs);
        expect(activity.startOffsetMs + activity.durationMs).toBeLessThanOrEqual(
          parent.startOffsetMs + parent.durationMs,
        );
      }
      const execution = (await niceeval.run(["show", locator, "execution", "--json"])).inspectionSuccess(
        "attempt.trace",
      );
      expect(JSON.stringify(execution)).not.toContain("judge.request");
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
