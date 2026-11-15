import { createE2EContext, defined, only } from "@niceeval/testkit";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const scenario = createE2EContext({
  repoId: "agent-judge",
  project: {
    from: process.cwd(),
    prefix: "judge-concurrency-",
    omitTopLevel: [".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [resolve("node_modules/.bin/niceeval")] },
});

// @feature docs/feature/judge/README.md
test.concurrent.each([
  { limit: 1, selection: "base", peak: 1 },
  { limit: 2, selection: "model", peak: 2 },
  { limit: 4, selection: "base", peak: 4 },
  { limit: 1, selection: "provider", peak: 4 },
  { limit: 4, selection: "http400", peak: 3 },
])(
  "Managed Judge entries respect limit $limit ($selection) without changing registration order",
  async ({ limit, selection, peak: expectedPeak }) => {
    let active = 0;
    let peak = 0;
    let ordinal = 0;
    const pending: Array<() => void> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        const payload = JSON.parse(body);
        const id = ++ordinal;
        if (selection === "http400" && JSON.stringify(payload.messages).includes("ordinary-0")) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Invalid fixture input" } }));
          return;
        }
        active++;
        peak = Math.max(peak, active);
        const reply = () => {
          active--;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              id: `call-${id}`,
              object: "chat.completion",
              model: payload.model,
              created: 0,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: `call-${id}`,
                        type: "function",
                        function: {
                          name: payload.tool_choice.function.name,
                          arguments: JSON.stringify({ measurement: 1, rationale: "Present" }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
            }),
          );
        };
        pending.push(reply);
        if (pending.length === expectedPeak) for (const done of pending.splice(0)) done();
        else
          setTimeout(() => {
            const index = pending.indexOf(reply);
            if (index >= 0) {
              pending.splice(index, 1);
              reply();
            }
          }, 700);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Missing HTTP address");
      await scenario.case("judge-concurrency", async ({ commands: { niceeval } }) => {
        const run = await niceeval.run(["exp", "judge-concurrency", "--rerun", "all", "--json"], {
          timeoutMs: 90000,
          env: {
            ...process.env,
            NICEEVAL_E2E_AGENT_JUDGE_URL: `http://127.0.0.1:${address.port}/v1`,
            NICEEVAL_E2E_AGENT_JUDGE_KEY: "fixture-only-key",
            NICEEVAL_E2E_JUDGE_CONCURRENCY: String(limit),
            NICEEVAL_E2E_JUDGE_SELECTION: selection,
          },
        });
        expect(run.exitCode, run.diagnostic()).toBe(selection === "http400" ? 1 : 0);
        const locator = defined(only(run.expEvalEvents(), () => true).locator);
        const attempt = (await niceeval.run(["show", locator, "--json"])).attempt().attempt;
        expect(attempt.assertions.entries.map((entry) => entry.display.label)).toEqual([
          "ordinary-0",
          "ordinary-1",
          "ordinary-2",
          "ordinary-3",
        ]);
        expect(attempt.score).toMatchObject(
          selection === "http400"
            ? { state: "unavailable", earned: 3, possible: 4, unavailable: 1 }
            : { state: "complete", earned: 4, possible: 4 },
        );
        expect(attempt.verdict).toBe(selection === "http400" ? "errored" : "passed");
        const usage = (await niceeval.run(["show", locator, "usage", "--json"])).inspectionSuccess("attempt.usage")
          .usage.judgeUsage;
        if (usage.state !== "complete") throw new Error("Missing complete Judge usage");
        expect(usage.calls.map((call) => [call.entryIndex, call.entryId])).toEqual(
          attempt.assertions.entries.map((entry, index) => [index, entry.entryId]),
        );
        expect(ordinal).toBe(4);
        expect(peak).toBe(expectedPeak);
        if (selection === "base" && limit === 4) {
          const dry = await niceeval.run(["exp", "judge-concurrency", "--dry", "--json"], {
            env: {
              ...process.env,
              NICEEVAL_E2E_AGENT_JUDGE_URL: `http://127.0.0.1:${address.port}/v1`,
              NICEEVAL_E2E_AGENT_JUDGE_KEY: "fixture-only-key",
              NICEEVAL_E2E_JUDGE_CONCURRENCY: "1",
            },
          });
          expect(dry.exitCode, dry.diagnostic()).toBe(0);
          expect(decodeExpPlanDocument(JSON.parse(dry.stdout))).toMatchObject({ total: 1, reused: 1 });
        }
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

// @feature docs/feature/judge/README.md
test.concurrent.each(["overlap", "timeout", "cancel", "queue"])(
  "Independent review sessions keep their questions and batch boundaries: %s",
  async (mode) => {
    let ordinary = 0;
    let ordinal = 0;
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    const completed: string[] = [];
    const errors: string[] = [];
    const waiting = new Map<string, () => void>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let notifyInFlight: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      notifyInFlight = resolve;
    });
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        const payload = JSON.parse(body);
        const id = ++ordinal;
        const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
        if (!payload.stream) {
          ordinary++;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              id: `call-${id}`,
              object: "chat.completion",
              model: payload.model,
              created: 0,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: `call-${id}`,
                        type: "function",
                        function: {
                          name: payload.tool_choice.function.name,
                          arguments: JSON.stringify({ measurement: 1, rationale: "Present" }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage,
            }),
          );
          return;
        }
        const user = payload.messages.findLast((message: { role: string }) => message.role === "user");
        const step = JSON.parse(
          typeof user.content === "string"
            ? user.content
            : user.content
                .filter((part: { type: string }) => part.type === "text")
                .map((part: { text: string }) => part.text)
                .join("\n"),
        );
        const question: string = step.message;
        const name = question.split("-")[0]!;
        const first = question.endsWith("first");
        const tool = payload.messages.at(-1).role === "user" ? "read" : "submit_evaluation";
        if (ordinary !== 4) errors.push("review started before ordinary group completed");
        if (tool === "read") {
          started.push(question);
          if (!first && !completed.includes(`${name}-first`)) errors.push("second question overtook first");
          if (
            name === "boundary" &&
            !["alpha-second", "beta-second"].every((q) => completed.includes(q)) &&
            mode !== "timeout"
          )
            errors.push("boundary started early");
          if (["gamma", "delta"].includes(name) && !completed.includes("boundary-second"))
            errors.push("later batch started early");
        }
        active++;
        peak = Math.max(peak, active);
        const send = () => {
          active--;
          if (tool === "submit_evaluation") completed.push(question);
          const args =
            tool === "read"
              ? { path: "application.txt" }
              : {
                  satisfied: true,
                  rationale: "Evidence read",
                  evidence: [{ kind: "file", ref: "application.txt", note: "Real file" }],
                };
          response.setHeader("Content-Type", "text/event-stream");
          response.end(
            `data: ${JSON.stringify({
              id: `call-${id}`,
              object: "chat.completion.chunk",
              model: payload.model,
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        index: 0,
                        id: `call-${id}`,
                        type: "function",
                        function: { name: tool, arguments: JSON.stringify(args) },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage,
            })}\n\ndata: [DONE]\n\n`,
          );
        };
        if (mode === "cancel" || (mode === "timeout" && name === "alpha")) {
          if (mode === "cancel" && active === 2) notifyInFlight();
          response.on("close", () => {
            active--;
          });
          return;
        }
        // A server-side latch, rather than elapsed duration, proves the two first prompts overlap.
        if (mode === "overlap" && first && tool === "read" && name !== "boundary") {
          waiting.set(name, send);
          const pair = ["alpha", "beta"].includes(name) ? ["alpha", "beta"] : ["gamma", "delta"];
          if (pair.every((key) => waiting.has(key)))
            for (const key of pair) {
              const done = waiting.get(key)!;
              waiting.delete(key);
              done();
            }
          return;
        }
        const timer = setTimeout(
          () => {
            timers.delete(timer);
            send();
          },
          mode === "timeout" && name === "beta" ? 350 : mode === "queue" ? 150 : 10,
        );
        timers.add(timer);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Missing HTTP address");
      await scenario.case(`concurrent-sessions-${mode}`, async ({ commands: { niceeval } }) => {
        const controlled = niceeval.start(["exp", "judge-concurrency", "--rerun", "all", "--json"], {
          timeoutMs: 90000,
          env: {
            ...process.env,
            NICEEVAL_E2E_AGENT_JUDGE_URL: `http://127.0.0.1:${address.port}/v1`,
            NICEEVAL_E2E_AGENT_JUDGE_KEY: "fixture-only-key",
            NICEEVAL_E2E_CONCURRENT_AGENT: mode,
            NICEEVAL_E2E_JUDGE_CONCURRENCY: mode === "queue" ? "1" : "2",
          },
        });
        if (mode === "cancel") {
          await Promise.race([
            inFlight,
            controlled.done.then((receipt) => {
              throw new Error(receipt.diagnostic());
            }),
          ]);
          expect(controlled.signal("SIGINT")).toBe(true);
        }
        const run = await controlled.done;
        if (mode === "cancel") {
          expect(run.expReceipt().completion, run.diagnostic()).toBe("interrupted");
          expect(started).toHaveLength(2);
          expect(completed).toHaveLength(0);
          expect(ordinal).toBe(6);
          return;
        }
        expect(run.exitCode, run.diagnostic()).toBe(mode === "timeout" ? 1 : 0);
        const locator = defined(only(run.expEvalEvents(), () => true).locator);
        const attempt = (await niceeval.run(["show", locator, "--json"])).attempt().attempt;
        expect(attempt.assertions.entries.map((entry) => entry.display.label)).toEqual([
          "ordinary-0",
          "ordinary-1",
          "ordinary-2",
          "ordinary-3",
          ...["alpha", "beta", "boundary", "gamma", "delta"].flatMap((name) => [`${name}-first`, `${name}-second`]),
        ]);
        expect(errors).toEqual([]);
        expect(peak).toBe(mode === "queue" ? 1 : 2);
        expect(started).toHaveLength(mode === "timeout" ? 9 : 10);
        expect(completed).toHaveLength(mode === "timeout" ? 8 : 10);
        const timing = (await niceeval.run(["show", locator, "timing", "--json"])).attemptTiming().timing.activities;
        const sessions = timing.filter((activity) => activity.label === "agent-judge.session");
        expect(sessions).toHaveLength(5);
        // One session spans both prompt settlements, including real Sandbox read tools.
        for (const session of sessions) {
          const prompts = timing.filter(
            (activity) => activity.parentActivityId === session.activityId && activity.label === "agent-judge.prompt",
          );
          expect(prompts.length).toBeGreaterThanOrEqual(1);
          expect(prompts.length).toBeLessThanOrEqual(2);
        }
        expect(attempt.verdict).toBe(mode === "timeout" ? "errored" : "passed");
        expect(attempt.score).toMatchObject(
          mode === "timeout"
            ? { state: "unavailable", earned: 12, possible: 14, unavailable: 2 }
            : { state: "complete", earned: 14, possible: 14 },
        );
        const usage = (await niceeval.run(["show", locator, "usage", "--json"])).inspectionSuccess("attempt.usage")
          .usage.judgeUsage;
        if (usage.state !== "complete") throw new Error("Missing complete Judge usage");
        const agentCalls = usage.calls.filter((call) => call.operation === "agent");
        expect(agentCalls).toHaveLength(mode === "timeout" ? 16 : 20);
        expect(agentCalls.map((call) => call.entryIndex)).toEqual(
          (mode === "timeout" ? [6, 8, 10, 12] : [4, 6, 8, 10, 12]).flatMap((index) => [index, index, index, index]),
        );
        for (const call of agentCalls) expect(call.entryId).toBe(attempt.assertions.entries[call.entryIndex]!.entryId);
        const traceOwners = new Map<string, string>();
        for (const entry of attempt.assertions.entries.slice(4)) {
          const read = await niceeval.run(["show", locator, entry.entryId, "--full", "--json"]);
          const detail = read.attemptAssertionDetail();
          if (!("entry" in detail.assertion)) throw new Error(read.diagnostic());
          const audit = detail.assertion.entry.agentJudgeAudit;
          expect(audit?.state).toBe("available");
          if (audit?.state === "available") {
            const name = entry.display.label!.split("-")[0]!;
            const previous = traceOwners.get(name);
            if (previous === undefined) traceOwners.set(name, audit.audit.trace.id);
            else expect(audit.audit.trace.id).toBe(previous);
          }
          if (audit?.state === "available" && !entry.display.label?.startsWith(mode === "timeout" ? "alpha" : "__none"))
            expect(audit.audit.result.state).toBe("measured");
          if (mode === "timeout" && entry.display.label?.startsWith("alpha"))
            expect(audit?.state === "available" ? audit.audit.result.state : undefined).toBe("unavailable");
        }
      });
    } finally {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
