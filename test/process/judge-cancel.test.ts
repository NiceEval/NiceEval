// 跨进程保证：进程终止与信号——中断真实 niceeval CLI 进程时终止在途 Judge HTTP 请求与 Sandbox 工具进程并退出，不发出后续模型请求
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, test } from "vitest";
import {
  Effect,
  HOST_SANDBOX_SOURCE,
  createJudgeProject,
  narrowInspectionSuccess,
  runHost,
  showJsonDocuments,
  startHttpServer,
} from "../integration/fixtures/judge-harness/harness.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));

describe("Judge real-process SIGINT cancellation", () => {
  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test.each(["cancel-tool", "cancel-http"] as const)(
    "SIGINT terminates in-flight Judge process (%s) without further requests",
    async (mode) => {
      let bodiesCount = 0;
      let requestArrived!: () => void;
      const arrived = new Promise<void>((r) => {
        requestArrived = r;
      });
      let markerPath: string | undefined;

      const server = await startHttpServer((_req, body, res) => {
        bodiesCount++;
        const payload = JSON.parse(body);
        if (mode === "cancel-http") {
          requestArrived();
          // Hold response open until client aborts on SIGINT
          return;
        }
        // cancel-tool: instruct pi to run a long sleep command that touches judge-running first
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const call = {
          index: 0,
          id: "call-cancel-tool",
          type: "function",
          function: {
            name: "bash",
            arguments: JSON.stringify({
              command: `touch ${JSON.stringify(markerPath!)}; sleep 30; touch ${JSON.stringify(markerPath! + ".late")}`,
            }),
          },
        };
        res.end(
          `data: ${JSON.stringify({
            id: "gen-cancel",
            object: "chat.completion.chunk",
            model: payload.model,
            choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [call] }, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          })}\n\ndata: [DONE]\n\n`,
        );
      });

      const cwd = await createJudgeProject(`niceeval-proc-${mode}-`, {
        config: `
          import { defineConfig } from "niceeval";
          import { OpenAIProvider } from "niceeval/judge";
          export default defineConfig({
            timeoutMs: 30_000,
            judgeProvider: OpenAIProvider({
              model: "proc-cancel",
              baseUrl: ${JSON.stringify(server.baseUrl)},
              apiKey: "fixture-key",
              timeoutMs: 25_000,
              maxOutputTokens: 1024,
            }),
          });
        `,
        agent: `
          import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
          import { shell } from "niceeval/sandbox";
          export default defineSandboxAgent({
            name: "proc-agent",
            evidenceCoverage: completeEvidenceCoverage,
            install: { identity: { agent: "proc-agent", version: "1", revision: "1" }, probe: shell("true") },
            send: async () => ({ status: "completed", events: [] }),
          });
        `,
        sandbox: HOST_SANDBOX_SOURCE,
        evals: {
          "cancel.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineAgentJudge } from "niceeval/expect";
            export default defineScoreEval({
              async test(t) {
                await t.send("go");
                t.agentJudge(defineAgentJudge({ timeoutMs: 20_000 }), { mode: ${JSON.stringify(mode)} }).judge("Cancel").score(1);
              },
            });
          `,
        },
        experiments: {
          "cancel.ts": `
            import { defineExperiment } from "niceeval";
            import agent from "../agent.ts";
            import sandbox from "../sandbox.ts";
            export default defineExperiment({ adapter: agent, sandbox, evals: ["cancel"], attempts: 1 });
          `,
        },
      });
      markerPath = join(cwd, "judge-running");

      const child = execa(process.execPath, [...process.execArgv, cli, "exp", "cancel", "--rerun", "all", "--json"], {
        cwd,
        env: { ...process.env, NO_COLOR: "1" },
        reject: false,
      });
      let childSettled = false;
      void child.finally(() => {
        childSettled = true;
      });

      try {
        if (mode === "cancel-http") {
          await arrived;
        } else {
          const deadline = Date.now() + 8_000;
          while (Date.now() < deadline) {
            const exists = await access(markerPath).then(
              () => true,
              () => false,
            );
            if (exists) break;
            await new Promise((r) => setTimeout(r, 25));
          }
          expect(
            await access(markerPath).then(
              () => true,
              () => false,
            ),
          ).toBe(true);
        }

        const countAtInterrupt = bodiesCount;
        child.kill("SIGINT");
        const finished = await child;
        const receiptEvent = finished.stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as { type?: string; receipt?: { completion?: string; createdRunIds?: string[] } };
            } catch {
              return undefined;
            }
          })
          .find((ev) => ev?.type === "receipt");
        expect(receiptEvent?.receipt?.completion, finished.stderr + "\n" + finished.stdout).toBe("interrupted");
        expect(bodiesCount).toBe(countAtInterrupt);

        // No late write happened from the killed bash process
        expect(
          await access(`${markerPath}.late`).then(
            () => true,
            () => false,
          ),
        ).toBe(false);

        const runId = receiptEvent?.receipt?.createdRunIds?.[0];
        if (mode === "cancel-http" && runId) {
          const runDetail = await Effect.runPromise(runHost.get({ cwd, runId }));
          const slot = runDetail.run.slots[0];
          if (slot?.publication.state === "published") {
            const [timingDoc] = await showJsonDocuments(cwd, [slot.publication.attemptLocator, "timing"]);
            const timing = narrowInspectionSuccess(timingDoc!, "attempt.timing");
            if (timing.success) {
              expect(timing.value.timing.activities).toEqual(
                expect.arrayContaining([expect.objectContaining({ label: "judge.request", outcome: "cancelled" })]),
              );
            }
          }
        }
      } finally {
        if (!childSettled) child.kill("SIGKILL");
        await server.close();
        await rm(cwd, { recursive: true, force: true });
      }
    },
    15_000,
  );
});
