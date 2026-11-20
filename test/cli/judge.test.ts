import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  Effect,
  HOST_SANDBOX_SOURCE,
  chatToolResponse,
  createJudgeProject,
  invokeCli,
  narrowInspectionSuccess,
  runHost,
  showJsonDocuments,
  startHttpServer,
  validPngBytes,
} from "../integration/fixtures/judge-harness/harness.ts";

describe("Judge CLI presentation and credential loading", () => {
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let cwd: string;
  let locator: string;
  let ordinaryEntryId: string;
  let agentEntryId: string;
  let imageEntryId: string;
  let portableRecord: string;
  let portableDir: string;
  let portableEntryRes: Awaited<ReturnType<typeof invokeCli>>;
  let portableRecordRes: Awaited<ReturnType<typeof invokeCli>>;
  let sharedRejectedRes: Awaited<ReturnType<typeof invokeCli>>;
  let sharedCwd: string;
  const authHeaders: string[] = [];
  const prevCliKey = process.env.NICEEVAL_CLI_TEST_KEY;

  beforeAll(async () => {
    process.env.NICEEVAL_CLI_TEST_KEY = "cli-env-secret";
    let ordinal = 0;
    server = await startHttpServer((req, body, res) => {
      if (req.headers.authorization) authHeaders.push(req.headers.authorization);
      const payload = JSON.parse(body);
      ordinal++;
      const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
      if (!payload.stream) {
        const toolName = payload.tool_choice.function.name;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(chatToolResponse(toolName, { measurement: 0.75, rationale: "CLI checked" }, payload.model, usage));
        return;
      }
      const last = payload.messages.at(-1);
      const call =
        last.role === "user"
          ? { id: `cli-${ordinal}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path: "application.txt" }) } }
          : {
              id: `cli-${ordinal}`,
              type: "function",
              function: {
                name: "submit_evaluation",
                arguments: JSON.stringify({
                  satisfied: true,
                  rationale: "CLI observed Sandbox evidence",
                  evidence: [{ kind: "file", ref: "application.txt", note: "Read file" }],
                }),
              },
            };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({
          id: `cli-gen-${ordinal}`,
          object: "chat.completion.chunk",
          model: payload.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: null, tool_calls: [{ ...call, index: 0 }] },
              finish_reason: "tool_calls",
            },
          ],
          usage,
        })}\n\ndata: [DONE]\n\n`,
      );
    });

    const png = validPngBytes(1024);
    cwd = await createJudgeProject("niceeval-judge-cli-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          timeoutMs: 30_000,
          judgeProvider: OpenAIProvider({
            model: "cli-judge",
            baseUrl: ${JSON.stringify(server.baseUrl)},
            apiKeyEnv: "NICEEVAL_CLI_TEST_KEY",
            supportsImages: true,
            maxOutputTokens: 1024,
          }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
        import { shell } from "niceeval/sandbox";
        export default defineSandboxAgent({
          name: "cli-judge-agent",
          evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "cli-judge-agent", version: "1", revision: "1" }, probe: shell("true") },
          send: async (_input, ctx) => {
            await ctx.sandbox.writeText("application.txt", "application evidence");
            return { status: "completed", events: [] };
          },
        });
      `,
      sandbox: HOST_SANDBOX_SOURCE,
      extra: {
        ".env": "NICEEVAL_CLI_TEST_KEY=dotenv-cli-secret\n",
      },
      evals: {
        "cli-judge.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineAgentJudge, defineJudge } from "niceeval/expect";
          import { judgeImage } from "niceeval/judge";
          const png = new Uint8Array(${JSON.stringify([...png])});
          export default defineScoreEval({
            async test(t) {
              await t.send("run");
              t.judge({ text: "hello" }, defineJudge({ rubric: "Ordinary" })).score(1).label("Ordinary CLI");
              t.judge({ img: judgeImage({ body: png, mediaType: "image/png" }) }, defineJudge({ rubric: "Image" })).score(1).label("Image CLI");
              t.agentJudge(defineAgentJudge({ timeoutMs: 10_000 }), { fact: "cli" }).judge("Inspect").score(1).label("Agent CLI");
            },
          });
        `,
      },
      experiments: {
        "cli-judge.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          import sandbox from "../sandbox.ts";
          export default defineExperiment({ adapter: agent, sandbox, evals: ["cli-judge"], attempts: 1 });
        `,
      },
    });

    // Run via CLI
    const run = await invokeCli(cwd, ["exp", "cli-judge", "--rerun", "all", "--json"], {
      NICEEVAL_CLI_TEST_KEY: "cli-env-secret",
    });
    expect(run.code, run.stderr + run.stdout).toBe(0);
    const receiptEvent = run.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; receipt?: { createdRunIds?: string[] } })
      .find((ev) => ev.type === "receipt");
    const runId = receiptEvent?.receipt?.createdRunIds?.[0];
    if (!runId) throw new Error(`Missing runId in ${run.stdout}`);
    const runDetail = await Effect.runPromise(runHost.get({ cwd, runId }));
    const slot = runDetail.run.slots[0];
    if (slot?.publication.state !== "published") throw new Error("Expected published slot");
    locator = slot.publication.attemptLocator;

    const [attemptDoc] = await showJsonDocuments(cwd, [locator]);
    const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
    if (!attempt.success) throw new Error(attempt.reason);
    const entries = attempt.value.attempt.assertions.entries;
    ordinaryEntryId = entries[0]!.entryId;
    imageEntryId = entries[1]!.entryId;
    agentEntryId = entries[2]!.entryId;

    portableDir = await mkdtemp(join(tmpdir(), "niceeval-cli-portable-"));
    portableRecord = join(portableDir, "portable.sqlite");
    await copyFile(join(cwd, ".niceeval", "record.sqlite"), portableRecord);

    const sampledEntryId = fc.sample(fc.constantFrom(ordinaryEntryId, imageEntryId, agentEntryId), {
      numRuns: 1,
      seed: 2026,
    })[0]!;
    portableEntryRes = await invokeCli(portableDir, [
      "show",
      locator,
      sampledEntryId,
      "--full",
      "--record",
      portableRecord,
      "--json",
    ]);
    portableRecordRes = await invokeCli(portableDir, ["show", locator, "--record", portableRecord, "--json"]);

    sharedCwd = await createJudgeProject("niceeval-cli-shared-", {
      config: "export default {};",
      agent: `
        import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
        import { shell } from "niceeval/sandbox";
        export default defineSandboxAgent({
          name: "a",
          evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "a", version: "1", revision: "1" }, probe: shell("true") },
          send: async () => ({ status: "completed", events: [] }),
        });
      `,
      sandbox: HOST_SANDBOX_SOURCE,
      evals: {
        "e.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineAgentJudge } from "niceeval/expect";
          export default defineScoreEval({
            async test(t) { await t.send("hi"); t.agentJudge(defineAgentJudge({}), {}).judge("No reuse"); },
          });
        `,
      },
      experiments: {
        "e.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          import sandbox from "../sandbox.ts";
          export default defineExperiment({ adapter: agent, sandbox, sharedState: { key: "shared-key" }, evals: ["e"], attempts: 1 });
        `,
      },
    });
    sharedRejectedRes = await invokeCli(sharedCwd, ["exp", "e", "--json"]);
  }, 30_000);

  afterAll(async () => {
    if (prevCliKey === undefined) delete process.env.NICEEVAL_CLI_TEST_KEY;
    else process.env.NICEEVAL_CLI_TEST_KEY = prevCliKey;
    await server.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
    if (portableDir) await rm(portableDir, { recursive: true, force: true });
    if (sharedCwd) await rm(sharedCwd, { recursive: true, force: true });
  });

  // @feature docs/feature/judge/README.md#score-audit
  test("show renders human timing, full Agent Judge evidence, usage, and diff isolation", async () => {
    expect(authHeaders.length).toBeGreaterThan(0);
    expect(authHeaders.every((h) => h === "Bearer cli-env-secret")).toBe(true);

    const timingHuman = await invokeCli(cwd, ["show", locator, "timing"]);
    expect(timingHuman.code, timingHuman.stderr).toBe(0);
    expect(timingHuman.stdout).toContain(ordinaryEntryId);
    expect(timingHuman.stdout).toContain("Ordinary CLI");

    const agentHuman = await invokeCli(cwd, ["show", locator, "--full", agentEntryId]);
    expect(agentHuman.code, agentHuman.stderr).toBe(0);
    expect(agentHuman.stdout).toContain("Measurement");
    expect(agentHuman.stdout).toContain("CLI observed Sandbox evidence");
    expect(agentHuman.stdout).toContain("application evidence");

    const usageHuman = await invokeCli(cwd, ["show", locator, "usage"]);
    expect(usageHuman.code, usageHuman.stderr).toBe(0);
    expect(usageHuman.stdout).toContain("Judge usage");
    expect(usageHuman.stdout).toContain("Physical calls  4");

    const diffHuman = await invokeCli(cwd, ["show", locator, "diff"]);
    expect(diffHuman.code, diffHuman.stderr).toBe(0);
    expect(diffHuman.stdout).not.toContain("CLI observed Sandbox evidence");
  });

  // @feature docs/feature/judge/README.md#score-audit
  test("show --record reads sealed image and Judge details after relocation", () => {
    expect(portableEntryRes.code, portableEntryRes.stderr).toBe(0);
    expect(portableEntryRes.stdout).not.toContain("cli-env-secret");
    expect(portableRecordRes.code, portableRecordRes.stderr).toBe(0);
    expect(portableRecordRes.stdout).not.toContain("cli-env-secret");
  });

  // @feature docs/feature/judge/README.md#material-admission
  test("CLI rejects shared-sandbox Agent Judge before creating Sandbox or sending requests", () => {
    expect(sharedRejectedRes.code).not.toBe(0);
    expect(sharedRejectedRes.stdout + sharedRejectedRes.stderr).toContain("judge.agent-shared-sandbox");
  });
});
