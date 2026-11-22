import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  externalInspectionSource,
  openInspectionSource,
  selectInspectionOperation,
} from "../../packages/niceeval/src/inspection/index.ts";
import { withOperational } from "./fixtures/adapter-trace-usage-harness/harness.ts";
import {
  Effect,
  HOST_SANDBOX_SOURCE,
  OpenAIProvider,
  VercelProvider,
  chatToolResponse,
  createJudgeProject,
  experimentHost,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readAssertionDetail,
  readAssertionsList,
  readFullAssertionEntry,
  readPaginatedTrace,
  runHost,
  showJsonDocuments,
  startHttpServer,
  validPngBytes,
} from "./fixtures/judge-harness/harness.ts";

type AssertionDetail = import("../../packages/niceeval/src/inspection/public.ts").InspectionOperationFor<"attempt.assertion.detail">;

describe("Judge score reconciliation, presets, headers, and image relocation", () => {
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  const capturedRequests: Array<{
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> = [];
  const projects: string[] = [];
  const origEnv = { ...process.env };

  let presetCwd: string;
  let presetLocator: string;
  let typesafeLocator: string;
  let imageCwd: string;
  let imageLocator: string;
  let imageEntryId: AssertionDetail["entryId"];
  let imageWireBody: string;
  let originalPng: Uint8Array;

  beforeAll(async () => {
    process.env.CF_ACCESS_CLIENT_ID = "cf-env-id";
    process.env.CF_ACCESS_CLIENT_SECRET = "cf-env-secret";

    server = await startHttpServer((req, body, res) => {
      capturedRequests.push({ url: req.url ?? "", headers: req.headers, body });
      const payload = JSON.parse(body);

      // TypeSafe /systemone protocol
      if (req.url?.endsWith("/systemone")) {
        const answers: Record<string, unknown> = {};
        for (const [id, rawQ] of Object.entries(payload.questions as Record<string, unknown>)) {
          const q = rawQ as { type: string; criteria: string[] | Record<string, unknown> };
          if (q.type === "score") {
            const levels = q.criteria as string[];
            const legend = Object.fromEntries(levels.map((desc, idx) => [String(idx), desc]));
            answers[id] = {
              type: "score",
              score: (levels.length - 1) * 0.75,
              legend,
              probabilities: { "0": 0.25, "1": 0, "2": 0.75 },
              confidence: 0.9,
            };
          } else {
            const choices = Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria);
            const chosen = choices.includes("supported")
              ? "supported"
              : choices.includes("satisfied")
                ? "satisfied"
                : choices[0]!;
            const probabilities = Object.fromEntries(choices.map((c) => [c, c === chosen ? 1 : 0]));
            answers[id] = { type: "choice", choice: chosen, probabilities, confidence: 0.9 };
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: payload.model,
            answers,
            usage: { input_tokens: 20, output_tokens: 10 },
          }),
        );
        return;
      }

      // Chat Completions protocol
      const toolName = payload.tool_choice?.function?.name as string;
      const sys = JSON.parse(payload.messages[2].content as string) as {
        operation: "score" | "classify" | "extract" | "batchClassify";
        choices?: string[];
      };
      let args: unknown;
      if (sys.operation === "score") {
        args = { measurement: 0.75, rationale: "Rubric reconciled" };
      } else if (sys.operation === "classify") {
        const choices = sys.choices ?? [];
        const choice = choices.includes("satisfied")
          ? "satisfied"
          : choices.includes("consistent")
            ? "consistent"
            : choices.includes("candidate")
              ? "candidate"
              : choices[0];
        args = { choice, rationale: `Classified as ${choice}` };
      } else if (sys.operation === "extract") {
        args = { items: ["Claim A", "Claim B"], complete: true, rationale: "Extracted 2 claims" };
      } else {
        // batchClassify
        const userObj = JSON.parse(payload.messages[1].content as string) as {
          items: Array<{ id: string }>;
        };
        const choices = sys.choices ?? [];
        const firstChoice = choices.includes("supported") ? "supported" : "followed";
        const secondChoice = choices.includes("unsupported") ? "unsupported" : "not-followed";
        args = {
          items: userObj.items.map(({ id }, i) => ({
            id,
            choice: i === 0 ? firstChoice : secondChoice,
            rationale: `Checked item ${id}`,
          })),
        };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(chatToolResponse(toolName, args, payload.model));
    });

    // 1. Presets, headers, overrides, and TypeSafe non-equidistant anchor scoring
    presetCwd = await createJudgeProject("niceeval-judge-presets-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          judgeProvider: OpenAIProvider({
            model: "base-model",
            baseUrl: ${JSON.stringify(server.baseUrl)},
            apiKey: "secret-should-not-leak",
            headers: { "X-Custom": "custom-val", "cf-access-client-id": "explicit-cf-id" },
            maxOutputTokens: 256,
          }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({ name: "preset-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });
      `,
      evals: {
        "presets.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { binaryJudge, defineJudge, factuality, faithfulness, instructionFollowing, pairwisePreference } from "niceeval/expect";
          export default defineScoreEval({
            async test(t) {
              await t.send("run");
              const mat: Record<string, string> = { marker: "ORIGINAL_SNAPSHOT" };
              t.judge(mat, defineJudge({ rubric: "Check", anchors: [{ measurement: 0, description: "Bad" }, { measurement: 0.5, description: "Mid" }, { measurement: 1, description: "Good" }] })).score(4).label("rubric");
              mat.marker = "MUTATED_AFTER_REGISTRATION";
              t.judge({ ans: "ok" }, binaryJudge({ rubric: "Is satisfied" })).score(2).label("binary");
              t.judge({ input: "q", output: "a", expected: "a" }, factuality()).score(2).label("factuality");
              t.judge({ input: "q", output: "a", context: "ctx" }, faithfulness()).score(2).label("faithfulness");
              t.judge({ instructions: ["i1", "i2"], output: "o" }, instructionFollowing()).score(2).label("instructions");
              t.judge({ instructions: "i", output: "a", reference: "b" }, pairwisePreference()).score(2).label("pairwise");
            },
          });
        `,
        "typesafe-anchors.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineJudge } from "niceeval/expect";
          export default defineScoreEval({
            async test(t) {
              await t.send("run");
              t.judge({ text: "hello" }, defineJudge({
                rubric: "Non-equidistant anchors",
                anchors: [
                  { measurement: 0, description: "Zero" },
                  { measurement: 0.2, description: "Low" },
                  { measurement: 1, description: "High" },
                ],
              })).score(10).label("non-equidistant");
            },
          });
        `,
      },
      experiments: {
        "chat-override.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          export default defineExperiment({ adapter: agent, judge: "overridden-model", evals: ["presets"], attempts: 1 });
        `,
        "typesafe.ts": `
          import { defineExperiment } from "niceeval";
          import { TypesafeProvider } from "niceeval/judge";
          import agent from "../agent.ts";
          export default defineExperiment({
            adapter: agent,
            judge: TypesafeProvider({ model: "jev-1", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "ts-secret" }),
            evals: ["typesafe-anchors"],
            attempts: 1,
          });
        `,
      },
    });
    projects.push(presetCwd);

    const plannedPresets = await Effect.runPromise(experimentHost.invocation.plan({
      cwd: presetCwd,
      experimentIds: ["chat-override", "typesafe"],
      config: {
        judgeProvider: OpenAIProvider({
          model: "base-model",
          baseUrl: server.baseUrl,
          apiKey: "secret-should-not-leak",
          headers: { "X-Custom": "custom-val", "cf-access-client-id": "explicit-cf-id" },
          maxOutputTokens: 256,
        }),
      },
      overrides: { rerun: "all", earlyExit: false },
    }));
    if (plannedPresets.status !== "ready") throw new Error("Expected presets and TypeSafe Experiments");
    const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: plannedPresets.plan }));
    const locators = new Map(await Promise.all(receipt.createdRunIds.map(async (runId) => {
      const { run } = await Effect.runPromise(runHost.get({ cwd: presetCwd, runId }));
      const publication = run.slots[0]?.publication;
      if (publication?.state !== "published") throw new Error(`Missing ${run.experimentId} slot`);
      return [run.experimentId, publication.attemptLocator] as const;
    })));
    presetLocator = locators.get("chat-override")!;
    typesafeLocator = locators.get("typesafe")!;

    // 2. Image material & Record relocation (>512 KiB PNG so detail stays bounded)
    originalPng = validPngBytes(520 * 1024);
    const pngArrayLiteral = `new Uint8Array(${JSON.stringify([...originalPng.slice(0, 64)])})`;
    imageCwd = await createJudgeProject("niceeval-judge-image-", {
      config: `
        import { defineConfig } from "niceeval";
        import { VercelProvider } from "niceeval/judge";
        export default defineConfig({
          judgeProvider: VercelProvider({
            model: "fixture-vision",
            baseUrl: ${JSON.stringify(server.baseUrl)},
            apiKey: "image-secret-key",
            supportsImages: true,
          }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({ name: "img-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });
      `,
      extra: { "screenshot.png": Buffer.from(originalPng).toString("binary") },
      evals: {
        "image.eval.ts": `
          import { readFileSync } from "node:fs";
          import { fileURLToPath } from "node:url";
          import { defineScoreEval } from "niceeval";
          import { defineJudge } from "niceeval/expect";
          import { judgeImage } from "niceeval/judge";
          const _unused = ${pngArrayLiteral};
          const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("../screenshot.png", import.meta.url))));
          export default defineScoreEval({
            async test(t) {
              await t.send("screenshot");
              const img = judgeImage({ body: bytes, mediaType: "image/png" });
              bytes.fill(0); // Mutating source array after judgeImage() must not change sealed bytes
              const mat: Record<string, unknown> = { action: "original-action", screenshot: img };
              t.judge(mat, defineJudge({ rubric: "Check screenshot" })).score(4).label("vision");
              mat.action = "MUTATED_AFTER_REGISTRATION";
            },
          });
        `,
      },
      experiments: {
        "image.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["image"], attempts: 1 });`,
      },
    });
    projects.push(imageCwd);
    // Write raw binary PNG cleanly
    await writeFile(join(imageCwd, "screenshot.png"), originalPng);

    const reqBefore = capturedRequests.length;
    const imgRes = await planAndRunExperiment(imageCwd, "image", {
      config: {
        judgeProvider: VercelProvider({
          model: "fixture-vision",
          baseUrl: server.baseUrl,
          apiKey: "image-secret-key",
          supportsImages: true,
        }),
      },
      rerun: "all",
    });
    const imgSlot = imgRes.run?.slots[0];
    if (imgSlot?.publication.state !== "published") throw new Error("Missing image slot");
    imageLocator = imgSlot.publication.attemptLocator;
    imageWireBody = capturedRequests[reqBefore]!.body;

    imageEntryId = await withOperational(imageCwd, (facts) => {
      const { assertions } = selectInspectionOperation(facts, { kind: "attempt.assertions", locator: imageLocator });
      const entry = assertions[0];
      if (entry === undefined || !("entry" in entry)) throw new Error("Expected image assertion");
      return entry.entryId;
    });
  }, 30_000);

  afterAll(async () => {
    process.env = { ...origEnv };
    await server.close();
    await Promise.all(projects.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // @feature docs/feature/judge/README.md#score-audit
  test("presets, headers, CF Access auto-injection, and snapshot immutability reconcile with scores", async () => {
    const entries = await readAssertionsList(presetCwd, presetLocator);
    expect(
      entries.map((e) => [e.display.label, "entry" in e ? e.entry.contribution : undefined]),
    ).toEqual([
      ["rubric", { state: "earned", points: 4, earned: 3 }],
      ["binary", { state: "earned", points: 2, earned: 2 }],
      ["factuality", { state: "earned", points: 2, earned: 2 }],
      ["faithfulness", { state: "earned", points: 2, earned: 1 }],
      ["instructions", { state: "earned", points: 2, earned: 1 }],
      ["pairwise", { state: "earned", points: 2, earned: 2 }],
    ]);

    // Model override inherited custom headers & CF Access (without overwriting explicit case-insensitive cf-access-client-id)
    const chatReqs = capturedRequests.filter((r) => !r.url.endsWith("/systemone") && !r.body.includes("original-action"));
    expect(chatReqs.length).toBeGreaterThanOrEqual(6);
    for (const req of chatReqs) {
      expect(JSON.parse(req.body).model).toBe("overridden-model");
      expect(req.headers["x-custom"]).toBe("custom-val");
      expect(req.headers["cf-access-client-id"]).toBe("explicit-cf-id");
      expect(req.headers["cf-access-client-secret"]).toBe("cf-env-secret");
      expect(req.body).not.toContain("MUTATED_AFTER_REGISTRATION");
      expect(req.body).not.toContain("secret-should-not-leak");
    }

    // Audit reconciliation & no secret leak
    const rubricDetail = await readAssertionDetail(presetCwd, presetLocator, entries[0]!.entryId);
    expect(JSON.stringify(rubricDetail)).toContain("ORIGINAL_SNAPSHOT");
    expect(JSON.stringify(rubricDetail)).not.toContain("secret-should-not-leak");
  });

  // @feature docs/feature/judge/README.md#score-audit
  test("TypeSafe weighted anchor probabilities preserve non-equidistant scores", async () => {
    const locator = typesafeLocator;
    await withOperational(presetCwd, (facts) => {
      const { assertions } = selectInspectionOperation(facts, { kind: "attempt.assertions", locator });
      const entry = assertions[0];
      if (entry === undefined || !("entry" in entry)) throw new Error("Expected compact assertion entry");
      // 0.25 * 0 + 0 * 0.2 + 0.75 * 1 = 0.75 => 0.75 * 10 = 7.5
      expect(entry.entry.contribution).toEqual({ state: "earned", points: 10, earned: 7.5 });
      const detail = selectInspectionOperation(facts, { kind: "attempt.assertion.detail", locator, entryId: entry.entryId });
      const full = detail.assertion;
      if (!("entry" in full) || !("scoreMatchAudit" in full.entry) || full.entry.scoreMatchAudit?.state !== "available") {
        throw new Error("Expected typed audit");
      }
      expect(full.entry.scoreMatchAudit.audit.kind).toBe("typed");
      expect(JSON.stringify(detail)).toContain("TypeSafe result summary (generated by NiceEval):");
      expect(JSON.stringify(detail)).not.toContain("ts-secret");
    });
  });

  // @feature docs/feature/judge/README.md#score-audit
  test("the Judge request uses the image and action snapshotted at registration", () => {
    const wire = JSON.parse(imageWireBody);
    const parts = wire.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    const imgPart = parts.find((p) => p.type === "image_url");
    expect(imgPart?.image_url?.url).toMatch(/^data:image\/png;base64,/u);
    expect(Buffer.from(imgPart!.image_url!.url.split(",")[1]!, "base64")).toEqual(Buffer.from(originalPng));
    expect(imageWireBody).not.toContain("MUTATED_AFTER_REGISTRATION");
    expect(imageWireBody).toContain("original-action");
  });

  // @feature docs/feature/judge/README.md#score-audit
  test("sealed image materials remain bounded in detail and readable after Record relocation", async () => {
    // Relocate record.sqlite to a completely separate directory and delete original project files
    const relocatedDir = await mkdtemp(join(tmpdir(), "niceeval-relocated-record-"));
    try {
      const portable = join(relocatedDir, "portable.sqlite");
      await copyFile(join(imageCwd, ".niceeval", "record.sqlite"), portable);
      await rm(join(imageCwd, "screenshot.png"));
      await rm(join(imageCwd, ".niceeval"), { recursive: true, force: true });

      await Effect.runPromise(
        Effect.scoped(openInspectionSource(externalInspectionSource(relocatedDir, portable)).pipe(Effect.map((facts) => {
          const target = { locator: imageLocator, entryId: imageEntryId };
          const detail = selectInspectionOperation(facts, { kind: "attempt.assertion.detail", ...target });
          expect(Buffer.byteLength(JSON.stringify(detail))).toBeLessThan(512 * 1024);
          const full = detail.assertion;
          const audit = "entry" in full && "scoreMatchAudit" in full.entry ? full.entry.scoreMatchAudit : undefined;
          if (audit?.state !== "available" || audit.audit.kind !== "images") throw new Error("Expected images audit");
          expect(audit.audit.result).toEqual({ state: "measured", value: 0.75 });
          expect(audit.audit.calls[0]).toMatchObject({
            state: "admitted",
            wireBody: {
              byteLength: Buffer.byteLength(imageWireBody),
              sha256: createHash("sha256").update(imageWireBody).digest("hex"),
            },
          });
          const imgMeta = audit.audit.images[0]!;
          fc.assert(
            fc.property(fc.constant(imgMeta.imageId), (imageId) => {
              expect(imgMeta.mediaType).toBe("image/png");
              expect(imgMeta.byteLength).toBe(originalPng.byteLength);
              expect(imgMeta.sha256).toBe(createHash("sha256").update(originalPng).digest("hex"));
              const chunks: Buffer[] = [];
              const readImage = (offset: number) =>
                selectInspectionOperation(facts, { kind: "attempt.assertion.image", ...target, imageId, offset }).image;
              let offset: number | null = 0;
              while (offset !== null) {
                const image = readImage(offset);
                if (image.state !== "available") throw new Error("Expected recorded image");
                if (image.nextOffset !== null) expect(image.nextOffset).toBeGreaterThan(offset);
                chunks.push(Buffer.from(image.base64, "base64"));
                offset = image.nextOffset;
              }
              expect(Buffer.concat(chunks)).toEqual(Buffer.from(originalPng));
            }),
            { numRuns: 1 },
          );
        }))),
      );
    } finally {
      await rm(relocatedDir, { recursive: true, force: true });
    }
  });
});

describe("Agent Judge audit, pagination, Sandbox isolation, timing, and identity", () => {
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let cwd: string;
  let locator: string;
  let barrierLocator: string;
  const bodies: string[] = [];
  let totalServerRequests = 0;

  beforeAll(async () => {
    let ordinal = 0;
    server = await startHttpServer((_req, body, res) => {
      const payload = JSON.parse(body);
      bodies.push(body);
      totalServerRequests++;
      ordinal++;

      const send = (text: string | null, calls: unknown[] = []) => {
        const finish_reason = calls.length > 0 ? "tool_calls" : "stop";
        const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
        if (payload.stream) {
          res.setHeader("Content-Type", "text/event-stream");
          const delta = {
            role: "assistant",
            content: text,
            ...(calls.length > 0 ? { tool_calls: calls.map((c, i) => ({ ...(c as object), index: i })) } : {}),
          };
          res.end(
            `data: ${JSON.stringify({ id: `gen-${ordinal}`, object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta, finish_reason }], usage })}\n\ndata: [DONE]\n\n`,
          );
        } else {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: `gen-${ordinal}`,
              object: "chat.completion",
              model: payload.model,
              created: 0,
              usage,
              choices: [
                {
                  index: 0,
                  finish_reason,
                  message: { role: "assistant", content: text, ...(calls.length > 0 ? { tool_calls: calls } : {}) },
                },
              ],
            }),
          );
        }
      };

      // Ordinary Judge in same Attempt
      if (!payload.stream) {
        const toolName = payload.tool_choice.function.name;
        send(null, [
          {
            id: `ord-${ordinal}`,
            type: "function",
            function: { name: toolName, arguments: JSON.stringify({ measurement: 1, rationale: "Ordinary checked" }) },
          },
        ]);
        return;
      }

      const lastUser = payload.messages.findLast((m: { role: string }) => m.role === "user");
      const step = JSON.parse(
        typeof lastUser.content === "string"
          ? lastUser.content
          : lastUser.content
              .filter((p: { type: string }) => p.type === "text")
              .map((p: { text: string }) => p.text)
              .join("\n"),
      );
      const last = payload.messages.at(-1);
      const call = (name: string, args: unknown, suffix = "") => ({
        id: `call-${ordinal}${suffix}`,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      });
      const submit = call("submit_evaluation", {
        ...(step.kind === "judge" ? { satisfied: true } : { measurement: 1 }),
        rationale: "Observed real Sandbox evidence",
        evidence: [{ kind: "file", ref: "application.txt", note: "Read application evidence" }],
      });

      if (step.kind === "chat") {
        send("AUDIT_BEGIN\n" + "Complete audit evidence. ".repeat(12_000) + "\nAUDIT_END");
      } else if (step.message === "First question" && last.role === "user") {
        send(null, [call("read", { path: "large.txt" })]);
      } else if (step.message === "First question" && last.role === "tool" && last.content.includes("exceeds 50.0KB limit")) {
        send(null, [call("write", { path: "review.txt", content: "review evidence" })]);
      } else if (step.message === "First question" && last.role === "tool" && last.content.includes("review.txt")) {
        // Deliberately send invalid submission schema (measurement on a judge question) to test recovery
        send(null, [
          call("submit_evaluation", {
            measurement: 1,
            rationale: "Wrong question type",
            evidence: [{ kind: "observation", ref: "schema", note: "must be rejected" }],
          }),
        ]);
      } else if (step.message === "Second question" && last.role === "user") {
        send(null, [
          call("submit_evaluation", {
            satisfied: true,
            rationale: "Wrong question type for grade",
            evidence: [{ kind: "observation", ref: "schema", note: "must be rejected" }],
          }),
        ]);
      } else if (step.message.includes("preceding") && last.role === "user") {
        send(null, [call("read", { path: "review.txt" })]);
      } else {
        // Valid submission + trailing tool in same batch (must stay not-started)
        send(null, [submit, call("write", { path: "MUST_NOT_WRITE", content: "forbidden" }, "-skipped")]);
      }
    });

    cwd = await createJudgeProject("niceeval-aj-audit-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          timeoutMs: 60_000,
          judgeProvider: OpenAIProvider({
            model: "aj-audit-model",
            baseUrl: ${JSON.stringify(server.baseUrl)},
            apiKey: "fixture-key",
            maxOutputTokens: 1024,
          }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
        import { shell } from "niceeval/sandbox";
        export default defineSandboxAgent({
          name: "aj-audit-agent",
          evidenceCoverage: {
            ...completeEvidenceCoverage,
            usage: { status: "unavailable", reason: "deterministic fixture has no model usage" },
          },
          install: { identity: { agent: "aj-audit-agent", version: "1", revision: "1" }, probe: shell("true") },
          send: async (_input, ctx) => {
            await ctx.sandbox.writeText("application.txt", "application evidence");
            await ctx.sandbox.writeText("large.txt", "中".repeat(40_000));
            return { status: "completed", events: [{ type: "message", role: "assistant", text: "application evidence" }] };
          },
        });
      `,
      sandbox: HOST_SANDBOX_SOURCE,
      evals: {
        "audit.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineAgentJudge, defineJudge, equals } from "niceeval/expect";
          const reviewer = defineAgentJudge({ maxTurns: 8, timeoutMs: 20_000 });
          export default defineScoreEval({
            async test(t) {
              const turn = await t.send("Write evidence.");
              t.judge("application evidence", defineJudge({ rubric: "Ordinary check" })).score(1).label("Ordinary review");
              const mat: Record<string, string> = { marker: "ORIGINAL_MATERIAL" };
              const first = t.agentJudge(reviewer, mat);
              mat.marker = "MUTATED_MATERIAL";
              first.chat("Inspect the application before grading.");
              first.judge("First question").score(2).label("First review");
              first.grade("Second question", {
                anchors: [
                  { measurement: 0, description: "None" },
                  { measurement: 1, description: "Full" },
                ],
              }).score(3).label("Second review");
              first.chat("TRAILING_CHAT_MUST_NOT_SEND");
              const second = turn.agentJudge(reviewer, { marker: "SECOND_SESSION" });
              second.judge("Check the preceding review's file").score(1).label("Following session");
              // Ordinary assertion registered last still executes before Agent Judge
              t.sandbox.unchangedWithin(["review.txt"]).label("Before review");
            },
          });
        `,
        "barrier.eval.ts": `
          import { defineEval } from "niceeval";
          import { defineAgentJudge, equals } from "niceeval/expect";
          export default defineEval({
            async test(t) {
              await t.send("Write evidence.");
              const first = t.agentJudge(defineAgentJudge({ maxTurns: 8 }), { marker: "B" });
              first.judge("First question").label("First review");
              await t.check(false, equals(true)).orStop();
              first.judge("Skipped after stop").label("Skipped after stop");
            },
          });
        `,
      },
      experiments: {
        "audit.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          import sandbox from "../sandbox.ts";
          export default defineExperiment({ adapter: agent, sandbox, evals: ["audit"], attempts: 1 });
        `,
        "barrier.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          import sandbox from "../sandbox.ts";
          export default defineExperiment({ adapter: agent, sandbox, evals: ["barrier"], attempts: 1 });
        `,
      },
    });

    const auditConfig = {
      timeoutMs: 60_000,
      judgeProvider: OpenAIProvider({
        model: "aj-audit-model",
        baseUrl: server.baseUrl,
        apiKey: "fixture-key",
        maxOutputTokens: 1024,
      }),
    };
    const res = await planAndRunExperiment(cwd, "audit", { config: auditConfig, rerun: "all" });
    const slot = res.run?.slots[0];
    if (slot?.publication.state !== "published") throw new Error("Missing audit slot");
    locator = slot.publication.attemptLocator;

    const barrierRes = await planAndRunExperiment(cwd, "barrier", { config: auditConfig, rerun: "all" });
    const barrierSlot = barrierRes.run?.slots[0];
    if (barrierSlot?.publication.state !== "published") throw new Error("Missing barrier slot");
    barrierLocator = barrierSlot.publication.attemptLocator;
  }, 45_000);

  afterAll(async () => {
    await server.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/judge/README.md#score-audit
  test("Agent Judge shares paginated trace, preserves diff/usage isolation, and executes after ordinary assertions", async () => {
    const entries = await readAssertionsList(cwd, locator);
    expect(
      entries.map((e) => [e.display.label, "entry" in e ? e.entry.decision.result : undefined]),
    ).toEqual([
      ["Ordinary review", "matched"],
      ["First review", "matched"],
      ["Second review", "matched"],
      ["Following session", "matched"],
      ["Before review", "matched"],
    ]);

    const { detail: firstDetail, entry: firstEntry } = await readFullAssertionEntry(cwd, locator, entries[1]!.entryId);
    const { entry: secondEntry } = await readFullAssertionEntry(cwd, locator, entries[2]!.entryId);
    const { entry: thirdEntry } = await readFullAssertionEntry(cwd, locator, entries[3]!.entryId);
    const firstAudit = firstEntry.agentJudgeAudit;
    const secondAudit = secondEntry.agentJudgeAudit;
    const thirdAudit = thirdEntry.agentJudgeAudit;
    if (firstAudit?.state !== "available" || secondAudit?.state !== "available" || thirdAudit?.state !== "available") {
      throw new Error("Missing available Agent Judge audits");
    }

    // Bounded detail + shared paginated trace across questions in same session
    expect(JSON.stringify(firstDetail).length).toBeLessThan(128 * 1024);
    expect(secondAudit.audit.trace.id).toBe(firstAudit.audit.trace.id);
    expect(thirdAudit.audit.trace.id).not.toBe(firstAudit.audit.trace.id);

    const tracePage = await readPaginatedTrace(cwd, locator, firstAudit.audit.trace.id);
    expect(tracePage.byteLength).toBe(firstAudit.audit.trace.byteLength);
    expect(createHash("sha256").update(tracePage.bytes).digest("hex")).toBe(firstAudit.audit.trace.sha256);
    const traceText = tracePage.bytes.toString("utf8");
    expect(traceText).toContain("AUDIT_BEGIN");
    expect(traceText).toContain("AUDIT_END");
    const firstTrace = JSON.parse(traceText);
    // Truncation without replacement characters, invalid schema recovery, and skipped trailing tool
    const readTool = firstTrace.tools.find((t: { name: string }) => t.name === "read");
    expect(readTool.result).toContain("exceeds 50.0KB limit");
    expect(readTool.result).not.toContain("\uFFFD");
    expect(firstTrace.tools.some((t: { name: string; validation: string }) => t.name === "submit_evaluation" && t.validation === "invalid")).toBe(true);
    expect(firstTrace.tools.some((t: { state: string }) => t.state === "not-started")).toBe(true);

    // Second session sees review.txt written by first session
    const thirdTrace = JSON.parse((await readPaginatedTrace(cwd, locator, thirdAudit.audit.trace.id)).bytes.toString("utf8"));
    expect(thirdTrace.tools.some((t: { name: string; result: string | null }) => t.name === "read" && t.result?.includes("review evidence"))).toBe(true);

    // Diff excludes Agent Judge writes
    const [diffDoc] = await showJsonDocuments(cwd, [locator, "diff"]);
    expect(JSON.stringify(diffDoc)).not.toContain("review evidence");
    expect(JSON.stringify(diffDoc)).not.toContain("MUST_NOT_WRITE");

    // Mutated material & trailing chat never sent
    const serializedBodies = JSON.stringify(bodies);
    expect(serializedBodies).not.toContain("MUTATED_MATERIAL");
    expect(serializedBodies).not.toContain("TRAILING_CHAT_MUST_NOT_SEND");

    // Timing hierarchy & isolation from execution trace
    const [timingDoc] = await showJsonDocuments(cwd, [locator, "timing"]);
    const timing = narrowInspectionSuccess(timingDoc!, "attempt.timing");
    if (!timing.success) throw new Error(timing.reason);
    const activities = timing.value.timing.activities;
    const evalAct = activities.find((a) => a.label === "assertions.evaluate")!;
    const ordAct = activities.find((a) => a.label === "judge.entry")!;
    const sessions = activities.filter((a) => a.label === "agent-judge.session");
    expect(ordAct.parentActivityId).toBe(evalAct.activityId);
    expect(ordAct.entryId).toBe(entries[0]!.entryId);
    expect(sessions).toHaveLength(2);
    const prompts = activities.filter((a) => a.label === "agent-judge.prompt");
    expect(prompts).toHaveLength(4);
    for (const prompt of prompts) {
      const requests = activities.filter((a) => a.parentActivityId === prompt.activityId && a.label === "judge.request");
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.map((a) => a.outcome)).toEqual(requests.map(() => "completed"));
    }
    expect(prompts.filter((p) => activities.some((a) => a.parentActivityId === p.activityId && a.label === "sandbox.command"))).toHaveLength(2);
    const [execDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
    expect(JSON.stringify(execDoc)).not.toContain("judge.request");

    // Barrier stopped at ordinary .orStop() before Agent Judge ran
    const [barrierDoc] = await showJsonDocuments(cwd, [barrierLocator]);
    const barrierAttempt = narrowInspectionSuccess(barrierDoc!, "attempt.get");
    if (!barrierAttempt.success) throw new Error(barrierAttempt.reason);
    expect(barrierAttempt.value.attempt.verdict).toBe("failed");
    const barrierAssertions = await readAssertionsList(cwd, barrierLocator);
    expect(barrierAssertions.map((e) => e.display.label)).toEqual(["First review", undefined]);

    // Usage records ordinary + agent calls
    const [usageDoc] = await showJsonDocuments(cwd, [locator, "usage"]);
    const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
    if (!usage.success) throw new Error(usage.reason);
    expect(usage.value.usage.judgeUsage.state).toBe("complete");
    if (usage.value.usage.judgeUsage.state === "complete") {
      expect(usage.value.usage.judgeUsage.calls.some((c) => c.operation === "agent")).toBe(true);
    }
  });

  describe("Agent Judge cache reuse", () => {
    let countBeforeReuse: number;
    let countAfterReuse: number;
    let beforeSlotState: unknown;
    let reusedCompletion: string | undefined;
    let questionGapState: string;
    let maxTurnsGapState: string;
    let modelGapState: string;

    beforeAll(async () => {
      const checkPreview = async (model = "aj-audit-model") => {
        const planned = await Effect.runPromise(
          experimentHost.invocation.plan({
            cwd,
            experimentSelector: "audit",
            config: {
              timeoutMs: 60_000,
              judgeProvider: OpenAIProvider({
                model,
                baseUrl: server.baseUrl,
                apiKey: "fixture-key",
                maxOutputTokens: 1024,
              }),
            },
            preview: true,
          }),
        );
        if (planned.status !== "ready" || planned.dry === undefined) throw new Error("Expected dry plan");
        return planned.dry.slots[0]!;
      };

      countBeforeReuse = totalServerRequests;
      beforeSlotState = (await checkPreview()).state;
      const reusedRun = await planAndRunExperiment(cwd, "audit", {
        config: {
          timeoutMs: 60_000,
          judgeProvider: OpenAIProvider({
            model: "aj-audit-model",
            baseUrl: server.baseUrl,
            apiKey: "fixture-key",
            maxOutputTokens: 1024,
          }),
        },
      });
      countAfterReuse = totalServerRequests;
      reusedCompletion = reusedRun.receipt?.completion;

      const evalPath = join(cwd, "evals", "audit.eval.ts");
      const original = await readFile(evalPath, "utf8");
      try {
        await writeFile(evalPath, original.replace("First question", "Revised question"));
        questionGapState = (await checkPreview()).state;

        await writeFile(evalPath, original.replace("maxTurns: 8", "maxTurns: 9"));
        maxTurnsGapState = (await checkPreview()).state;
      } finally {
        await writeFile(evalPath, original);
      }
      modelGapState = (await checkPreview("revised-model")).state;
    }, 30_000);

    // @feature docs/feature/judge/README.md#score-audit
    test("Agent Judge cache reuse tracks question, budget, and effective model changes", () => {
      expect(beforeSlotState).toBe("reuse");
      expect(reusedCompletion).toBe("completed");
      expect(countAfterReuse).toBe(countBeforeReuse);
      expect(questionGapState).toBe("gap");
      expect(maxTurnsGapState).toBe("gap");
      expect(modelGapState).toBe("gap");
    });
  });
});
