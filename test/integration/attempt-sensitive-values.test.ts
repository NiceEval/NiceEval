import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import fc from "fast-check";
import { beforeAll, expect, test } from "vitest";
import {
  HOST_SANDBOX_SOURCE,
  OpenAIProvider,
  chatToolResponse,
  createJudgeProject,
  invokeCli,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readFullAssertionEntry,
  readPaginatedTrace,
  showJsonDocuments,
  startHttpServer,
  validPngBytes,
} from "./fixtures/judge-harness/harness.ts";
import { respondStream } from "./fixtures/simulated-user-harness/harness.ts";

const examples: [string, string][] = [["fixture-key-1", "command-key-1"], ["eightkey", "command-key-1"], ['fixture"quote-key', "command-key-1"]];
const token = fc.stringMatching(/^[a-z][a-z0-9]{12,18}$/);
const placeholder = "<redacted>";

function containsText(value: unknown, secret: string, encodedLevels = 5): boolean {
  if (typeof value === "string") {
    if (value.includes(secret)) return true;
    if (encodedLevels === 0) return false;
    try {
      return containsText(JSON.parse(value), secret, encodedLevels - 1);
    } catch {
      return false;
    }
  }
  return value !== null && typeof value === "object" &&
    Object.values(value).some((part) => containsText(part, secret, encodedLevels));
}

function expectRedacted(text: string, secret: string) {
  expect(text).toContain(placeholder);
  expect(containsText(text, secret)).toBe(false);
}

function fixtureSource(secret: string, commandSecret: string) {
  return `
    import { strict as assert } from "node:assert";
    import { defineScoreEval, defineSimulatedUser } from "niceeval";
    import { defineAgentJudge, binaryJudge } from "niceeval/expect";
    import { judgeImage } from "niceeval/judge";
    const secret = ${JSON.stringify(secret)};
    const commandSecret = ${JSON.stringify(commandSecret)};
    export default defineScoreEval({ async test(t) {
      assert.throws(() => t.sensitiveValues(secret, "short"), /at least 8 characters/);
      const previous = await t.send("before " + secret);
      assert.equal(previous.reply, "echo before " + secret);
      assert.throws(() => t.sensitiveValues(""), /at least 8 characters/);
      assert.throws(() => t.sensitiveValues("1234567"), /at least 8 characters/);
      t.sensitiveValues(secret);
      const original = await t.newSession().send("later " + secret);
      assert.equal(original.reply, "echo later " + secret);
      const user = t.simulatedUser(defineSimulatedUser({ instructions: "Send the connection " + secret }));
      const question = await t.send("question " + secret);
      const answer = await user.reply(question);
      assert.equal(answer.reply, "echo response " + secret);
      const printed = await t.sandbox.runCommand("printf", ["%s %s", secret, commandSecret], { sensitiveValues: [commandSecret] });
      assert.equal(printed.stdout, secret + " " + commandSecret);
      await assert.rejects(t.sandbox.runShellOrThrow("printf '%s' '" + "x".repeat(150) + secret + "' >&2; exit 7"),
        (error) => error.message.includes("<redacted>") && !error.message.includes(secret));
      t.diagnostic({ code: "fixture-diagnostic", level: "warning", message: "Diagnostic " + secret + " " + commandSecret,
        data: { nested: { detail: secret } } });
      t.judge({ reply: answer.reply }, binaryJudge({ rubric: "Judge ordinary " + secret })).score(1).label("ordinary");
      answer.closeQA("Judge history " + secret).score(1).label("history");
      t.judge({ reply: answer.reply, image: judgeImage({ mediaType: "image/png", body: new Uint8Array(${JSON.stringify([...validPngBytes()])}) }) },
        binaryJudge({ rubric: "Judge image " + secret })).score(1).label("image");
      t.agentJudge(defineAgentJudge({ instructions: "Inspect connection " + secret }),
        { reply: answer.reply }).judge("Review " + secret).score(1);
    } });
  `;
}

async function observe(secret: string, commandSecret: string) {
  const requests = new Map<string, string>();
  const server = await startHttpServer((_req, body, res) => {
    const payload = JSON.parse(body);
    if (payload.stream) {
      if (payload.tools.some((tool: { function: { name: string } }) => tool.function.name === "reply_to_agent")) {
        requests.set("simulated", body);
        respondStream(res, payload, { id: "simulated", toolArguments: { message: "response " + secret } });
        return;
      }
      requests.set("agentJudge", body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({
        id: "agent-judge-generation",
        object: "chat.completion.chunk",
        model: payload.model,
        choices: [{
          index: 0,
          delta: { role: "assistant", content: null, tool_calls: [{
            index: 0, id: "agent-judge-call", type: "function",
            function: { name: "submit_evaluation", arguments: JSON.stringify({
              satisfied: true, rationale: "Review found " + secret,
              evidence: [{ kind: "observation", ref: "local", note: secret }],
            }) },
          }] },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })}\n\ndata: [DONE]\n\n`);
      return;
    }
    const criteria = JSON.parse(payload.messages[2].content);
    const variant = body.includes("data:image/png") ? "image" : body.includes("Judge history") ? "history" : "ordinary";
    requests.set(variant, body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(chatToolResponse("record_score_match", {
      choice: "satisfied", rationale: "Model found " + secret,
      ...(criteria.evidenceIds === undefined ? {} : { citations: [criteria.evidenceIds[0]] }),
    }, payload.model));
  });
  let cwd: string | undefined;
  try {
    cwd = await createJudgeProject("niceeval-sensitive-values-", {
      agent: `
        import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
        import { shell } from "niceeval/sandbox";
        export default defineSandboxAgent({ name: "redaction-agent", evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "redaction-agent", version: "1", revision: "1" }, probe: shell("true") },
          send: async (input) => ({ status: "completed",
            events: [{ type: "message", role: "assistant", text: "echo " + input.text }] }) });
      `,
      sandbox: HOST_SANDBOX_SOURCE,
      evals: { "record.eval.ts": fixtureSource(secret, commandSecret) },
      experiments: { "record.ts": `
        import { defineExperiment } from "niceeval";
        import agent from "../agent.ts";
        import sandbox from "../sandbox.ts";
        export default defineExperiment({ adapter: agent, sandbox, evals: ["record"], attempts: 1 });
      ` },
    });
    const result = await planAndRunExperiment(cwd, "record", {
      config: { judgeProvider: OpenAIProvider({
        model: "redaction-fixture", baseUrl: server.baseUrl, apiKey: "test-provider-key",
        maxOutputTokens: 128, contextWindow: 128_000,
        // Enable the image request path without calling a real model.
        supportsImages: true,
      }) },
      rerun: "all",
    });
    const slot = result.run?.slots[0];
    if (slot?.publication.state !== "published") throw new Error("Missing redaction Attempt");
    const locator = slot.publication.attemptLocator;
    const [attemptDoc] = await showJsonDocuments(cwd, [locator]);
    const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
    if (!attempt.success) throw new Error(attempt.reason);
    const [executionDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
    const execution = narrowInspectionSuccess(executionDoc!, "attempt.trace");
    if (!execution.success) throw new Error(execution.reason);
    const { trace } = execution.value;
    const diagnostics = trace.diagnostics.items.filter((item) => item.code === "fixture-diagnostic");
    const commands = await Promise.all(trace.identityIndex.commandIds.map(async (id) =>
      (await showJsonDocuments(cwd!, [locator, id]))[0]));
    const turns = await Promise.all(trace.conversation.turns.map(async ({ turnId }) =>
      JSON.stringify((await showJsonDocuments(cwd!, [locator, turnId]))[0])));

    const simulated = trace.execution.events.filter((event) => event.source.id === "niceeval.simulated-user");
    if (simulated.length !== 1 || simulated[0]?.evidence.length !== 1) {
      throw new Error("Expected one simulated user evidence source");
    }
    const { bytes } = await readPaginatedTrace(cwd, locator, simulated[0].evidence[0]!.evidenceId);
    const activity = JSON.parse(bytes.toString("utf8"));

    const entries = await Promise.all(attempt.value.attempt.assertions.entries.map(async ({ entryId }) =>
      (await readFullAssertionEntry(cwd!, locator, entryId)).entry));
    const agentJudge = entries.find((entry) => entry.agentJudgeAudit?.state === "available");
    const audit = agentJudge?.agentJudgeAudit;
    const agentTrace = audit?.state === "available"
      ? (await readPaginatedTrace(cwd, locator, audit.audit.trace.id)).bytes.toString("utf8")
      : "";
    const image = entries.find((entry) =>
      entry.scoreMatchAudit?.state === "available" && entry.scoreMatchAudit.audit.kind === "images");
    const imageEntry = attempt.value.attempt.assertions.entries[entries.indexOf(image!)];
    const imageDetail = imageEntry === undefined ? "" : (await invokeCli(cwd, ["show", locator, imageEntry.entryId, "--full"])).stdout;
    return { secret, commandSecret, requests, diagnostics, commands, turns, activity, entries, agentTrace, imageDetail,
      executionDiagnostics: trace.diagnostics.items };
  } finally {
    await server.close();
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  }
}

const observations: Awaited<ReturnType<typeof observe>>[] = [];
beforeAll(async () => {
  const generated = fc.sample(fc.tuple(token, token).filter(([a, b]) => a !== b && !a.includes(b)), {
    numRuns: 3,
    seed: 20261121,
  });
  for (const [secret, commandSecret] of [...examples, ...generated]) {
    observations.push(await observe(secret, commandSecret));
  }
}, 60_000);

// @feature docs/feature/eval/README.md#progress-redaction
test("sealed Turn inputs and messages use the registration that applied when they sealed", () => {
  for (const { turns, secret } of observations) {
    expect(turns).toHaveLength(4);
    const earlier = turns.find((doc) => containsText(doc, "before " + secret));
    expect(containsText(earlier, "echo before " + secret)).toBe(true);
    for (const doc of turns.filter((doc) => doc !== earlier)) expectRedacted(doc, secret);
    expect(turns.some((doc) => doc.includes("response <redacted>"))).toBe(true);
  }
});

// @feature docs/feature/eval/library/context.md#登记敏感值
test("command evidence and diagnostics use the union of Attempt and command registrations", () => {
  for (const { diagnostics, commands, secret, commandSecret } of observations) {
    expect(diagnostics).toHaveLength(1);
    expectRedacted(JSON.stringify(diagnostics), secret);
    expectRedacted(JSON.stringify(diagnostics), commandSecret);
    const printed = commands.find((command) => JSON.stringify(command).includes("%s %s"));
    expectRedacted(JSON.stringify(printed), secret);
    expectRedacted(JSON.stringify(printed), commandSecret);
    expect(JSON.stringify(printed)).toContain("<redacted> <redacted>");
  }
});

// @feature docs/feature/eval/library/context.md#登记敏感值
test("the simulated user's raw model input and reply survive while its question, conversation and answer are redacted", () => {
  for (const { activity, requests, secret } of observations) {
    expectRedacted(activity.question, secret);
    expectRedacted(activity.conversation, secret);
    expectRedacted(activity.answer, secret);
    expect(containsText(requests.get("simulated"), secret)).toBe(true);
    expect(requests.get("simulated")).not.toContain(placeholder);
  }
});

// @feature docs/feature/eval/library/context.md#登记敏感值
test("complete Judge audits redact inputs and calls while all models receive the original material", () => {
  for (const { entries, agentTrace, secret, requests, executionDiagnostics, imageDetail } of observations) {
    expect(entries, JSON.stringify(executionDiagnostics)).toHaveLength(4);
    const chatAudits = entries.filter((entry) =>
      entry.scoreMatchAudit?.state === "available" && entry.scoreMatchAudit.audit.kind === "chat");
    expect(chatAudits).toHaveLength(2);
    for (const entry of chatAudits) expectRedacted(JSON.stringify(entry), secret);
    const image = entries.find((entry) =>
      entry.scoreMatchAudit?.state === "available" && entry.scoreMatchAudit.audit.kind === "images");
    const agentJudge = entries.find((entry) => entry.agentJudgeAudit?.state === "available");
    expectRedacted(JSON.stringify(image), secret);
    expectRedacted(JSON.stringify(agentJudge), secret);
    expectRedacted(agentTrace, secret);
    for (const action of ["ordinary", "history", "image", "agentJudge"]) {
      expect(containsText(requests.get(action), secret), action).toBe(true);
      expect(requests.get(action), action).not.toContain(placeholder);
    }
    const imageAudit = image?.scoreMatchAudit;
    if (imageAudit?.state !== "available" || imageAudit.audit.kind !== "images") throw new Error("Missing image audit");
    expect(imageDetail.replace(/\s+/g, " ")).toContain("The template was redacted. The digest identifies the original bytes sent");
    const wire = requests.get("image")!;
    expect(imageAudit.audit.calls[0]).toMatchObject({
      wireBodyVerification: "unavailable-redacted-template",
      wireBody: { byteLength: Buffer.byteLength(wire), sha256: createHash("sha256").update(wire).digest("hex") },
    });
  }
});
