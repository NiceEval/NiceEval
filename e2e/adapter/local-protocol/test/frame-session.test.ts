// rerun: pnpm e2e test --repo adapter/local-protocol -- --run test/frame-session.test.ts
import { createServer, type ServerResponse } from "node:http";
import { setTimeout } from "node:timers/promises";
import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent.each(["resume", "abandon", "approval-failure", "race"] as const)(
  "A waiting SSE session owns its connection through %s and Attempt cleanup",
  async (scenario) => {
    await localProtocolE2E.case(
      `frame-session-${scenario}`,
      localProtocolRecordArtifacts,
      async ({ commands: { niceeval } }) => {
        let stream: ServerResponse | undefined;
        let approval: ServerResponse | undefined;
        let opened = 0;
        let closed = 0;
        let waiting = 0;
        let approvals = 0;
        let raceReleased = false;
        const streamClosed = Promise.withResolvers<void>();
        const server = createServer((request, response) => {
          if (request.url === "/stream") {
            opened += 1;
            stream = response;
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.write('data: {"type":"approval"}\n\n');
            response.once("close", () => {
              closed += 1;
              streamClosed.resolve();
              // The approval response stays behind this barrier until cleanup closes
              // the original stream. This produces a late resume/cleanup collision.
              if (scenario === "race" && approval !== undefined) {
                raceReleased = true;
                approval.end("approved after transport cleanup");
              }
            });
            return;
          }
          if (request.url === "/waiting") {
            waiting += 1;
            response.writeHead(closed === 0 ? 200 : 409).end();
            return;
          }
          if (request.url === "/approve") {
            approvals += 1;
            if (scenario === "approval-failure") {
              response.writeHead(503).end("approval refused by fixture");
            } else if (scenario === "race") {
              approval = response;
            } else {
              stream?.end('data: {"type":"message","text":"same-connection-resumed"}\n\n');
              response.end("approved");
            }
            return;
          }
          response.writeHead(404).end();
        });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        try {
          const address = server.address();
          if (address === null || typeof address === "string") throw new Error("Fixture has no TCP address");
          const run = await niceeval.run(["exp", "frame-session", "--rerun", "all", "--json"], {
            env: {
              [FIXTURE_BASE_URL_ENV]: `http://127.0.0.1:${address.port}`,
              NICEEVAL_FRAME_SCENARIO: scenario,
            },
            timeoutMs: 40_000,
          });
          const succeeds = scenario === "resume" || scenario === "abandon";
          expect(run.exitCode, run.diagnostic()).toBe(succeeds ? 0 : 1);
          expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
          const expected = {
            experimentId: "frame-session",
            evalId: "frame-session",
            verdict: succeeds ? ("passed" as const) : ("errored" as const),
            attempts: 1,
            passed: succeeds ? 1 : 0,
          };
          const events = run.expEvalEvents();
          assertExpEvalOutcomes(events, [expected], () => run.diagnostic());
          expect(opened, "one HTTP connection spans both callbacks").toBe(1);
          expect(waiting, "the first callback delivered its waiting result").toBe(1);
          expect(approvals).toBe(scenario === "abandon" ? 0 : 1);
          await Promise.race([
            streamClosed.promise,
            setTimeout(5_000).then(() => {
              throw new Error("Attempt left its SSE transport open");
            }),
          ]);
          expect(closed, "Attempt cleanup closes the original response exactly once").toBe(1);
          if (scenario === "race") expect(raceReleased, "cleanup releases the approval barrier").toBe(true);
          const event = exactEval(events, expected, () => run.diagnostic());
          const queried = await niceeval.run(["show", event.locator, "execution", "--json"]);
          expect(queried.exitCode, queried.diagnostic()).toBe(0);
          const trace = JSON.stringify(queried.attemptTrace().trace);
          if (scenario === "resume") expect(trace).toContain("same-connection-resumed");
          if (scenario === "approval-failure") expect(trace).toContain("Frame session approval failed");
          if (scenario === "race") expect(trace).toContain("timeout");
        } finally {
          stream?.destroy();
          approval?.destroy();
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error === undefined ? resolve() : reject(error))),
          );
        }
      },
    );
  },
);
