import * as nodeModule from "node:module";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createSimulatedUserProject,
  loadPi,
  openAIProvider,
  readAttempt,
  respondStream,
  runScenarios,
  startHttpServer,
  type Scenario,
} from "./fixtures/simulated-user-harness/harness.ts";
import { readPaginatedTrace, showJsonDocuments, narrowInspectionSuccess } from "./fixtures/judge-harness/harness.ts";

type Mode =
  | "provider"
  | "credential"
  | "dependency"
  | "session"
  | "tool"
  | "unknown"
  | "prompt"
  | "json"
  | "aborted"
  | "overflow"
  | "safe"
  | "usage"
  | "http-echo"
  | "timeout";

// Layer a fault is injected at -> the cause the simulated user must report.
const LAYERS: readonly { readonly mode: Mode; readonly code: string }[] = [
  { mode: "provider", code: "provider-unconfigured" },
  { mode: "credential", code: "provider-unconfigured" },
  { mode: "dependency", code: "pi-unavailable" },
  { mode: "session", code: "session-failed" },
  { mode: "tool", code: "defect" },
  { mode: "unknown", code: "defect" },
  { mode: "prompt", code: "defect" },
  { mode: "json", code: "transport" },
  { mode: "aborted", code: "transport" },
  { mode: "overflow", code: "context-overflow" },
  { mode: "safe", code: "transport" },
  { mode: "usage", code: "defect" },
  { mode: "http-echo", code: "transport" },
  { mode: "timeout", code: "timeout" },
];

// Credentials the project configures and a fault may echo back. Generated, not literal.
const secretToken = fc.string({
  unit: fc.constantFrom(..."0123456789abcdef".split("")),
  minLength: 16,
  maxLength: 24,
});
const [apiKey, headerSecret, hiddenBearer] = fc
  .sample(fc.tuple(secretToken, secretToken, secretToken), { numRuns: 1, seed: 99 })
  .flatMap(([a, b, c]) => [`key-${a}`, `hdr-${b}`, `bearer-${c}`]);
const SECRETS = [apiKey!, headerSecret!, hiddenBearer!];
const UNREACHABLE = "http://127.0.0.1:1/v1";

interface Observed {
  readonly outcome: Record<string, unknown>;
  readonly attempt: Awaited<ReturnType<typeof readAttempt>>;
  /** Attempt documents, execution diagnostics, the caught error and the run result, as text. */
  readonly surfaces: string;
  /** Sealed simulated-user audit evidence read through `show`, as text. */
  readonly evidence: string;
}

describe("Simulated user failure attribution", () => {
  let current: Mode = "provider";
  const observed = new Map<Mode, Observed>();
  let root: string;
  let cwd: string;
  let echoServer: Awaited<ReturnType<typeof startHttpServer>>;
  const restore: (() => void)[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), "niceeval-su-failures-"));
    await mkdir(join(root, "results"));
    const { piCoding, piAi } = await loadPi();
    const proto = piCoding.AgentSession.prototype;
    const patch = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]) => {
      const original = target[key];
      target[key] = value;
      restore.push(() => {
        target[key] = original;
      });
    };

    // Dependency layer: the SDK cannot be resolved at all.
    const moduleExports = nodeModule as unknown as { findPackageJSON: (...args: unknown[]) => unknown };
    const originalFind = moduleExports.findPackageJSON;
    const requiredModule = (globalThis.process as unknown as { getBuiltinModule: (id: string) => typeof nodeModule })
      .getBuiltinModule("node:module") as unknown as { findPackageJSON: (...args: unknown[]) => unknown };
    const fakeFind = (...args: unknown[]) => {
      if (current === "dependency" && String(args[0]).includes("pi-coding-agent"))
        throw new Error("fixture missing pi dependency");
      return originalFind(...args);
    };
    requiredModule.findPackageJSON = fakeFind;
    nodeModule.syncBuiltinESMExports();
    restore.push(() => {
      requiredModule.findPackageJSON = originalFind;
      nodeModule.syncBuiltinESMExports();
    });

    const reload = piCoding.DefaultResourceLoader.prototype.reload;
    patch(piCoding.DefaultResourceLoader.prototype, "reload", async function (this: unknown, ...args: never[]) {
      if (current === "session") throw new Error("fixture session initialization");
      return (reload as (...a: never[]) => Promise<void>).apply(this, args);
    } as typeof reload);

    const setTools = proto.setActiveToolsByName;
    patch(proto, "setActiveToolsByName", function (this: unknown, ...args: Parameters<typeof setTools>) {
      if (current === "unknown") throw new Error("fixture unexpected binding failure");
      return setTools.apply(this as never, args);
    });

    const prompt = proto.prompt;
    patch(proto, "prompt", async function (this: typeof proto, ...args: Parameters<typeof prompt>) {
      if (current === "prompt") throw new Error("fixture prompt defect");
      if (current === "http-echo" || current === "timeout") return prompt.apply(this, args);
      this.agent.streamFunction = ((model: { api: string; provider: string; id: string }) => {
        const stream = piAi.createAssistantMessageEventStream();
        const message: Record<string, unknown> = {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: [],
          stopReason: "error",
          timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          errorMessage:
            current === "json"
              ? "JSON provider temporarily unavailable"
              : current === "overflow"
                ? "prompt is too long: 200000 tokens > 128000 maximum"
                : "fixture final request failure",
        };
        if (current === "safe")
          message.errorMessage = `fixture failure at ${UNREACHABLE} with ${apiKey} and ${headerSecret}\nAuthorization: Bearer ${hiddenBearer}\n${"x".repeat(3000)}`;
        if (current === "usage") (message.usage as { input: number }).input = -1;
        if (current === "aborted") message.stopReason = "aborted";
        if (current === "tool") {
          message.stopReason = "toolUse";
          message.content = [{ type: "toolCall", id: "answer", name: "reply_to_agent", arguments: { message: "Continue" } }];
          delete message.errorMessage;
          stream.push({ type: "done", reason: "toolUse", message } as never);
        } else {
          stream.push({ type: "error", reason: message.stopReason as "error" | "aborted", error: message } as never);
        }
        return stream;
      }) as never;
      const result = await prompt.apply(this, args);
      // The next reply finds its sole tool missing: a SDK defect, not a model failure.
      if (current === "tool") (this as unknown as { getToolDefinition: () => undefined }).getToolDefinition = () => undefined;
      return result;
    });

    echoServer = await startHttpServer((req, body, res) => {
      if (current === "timeout") return; // never answers; the reply budget must end it
      if (current !== "http-echo") {
        respondStream(res, JSON.parse(body), { id: "unused", text: "unused" });
        return;
      }
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: `rejected: Authorization: ${req.headers.authorization} X-Fixture: ${req.headers["x-fixture"]} key ${apiKey}`,
          },
        }),
      );
    });

    const scenario: Scenario = { id: "sc0", requests: [], twice: false };
    cwd = await createSimulatedUserProject("niceeval-su-failures-project-", {
      scenarios: [scenario],
      drivesPath: join(root, "drives.jsonl"),
      resultDir: join(root, "results"),
      config: "export default {};",
    });

    for (const { mode } of LAYERS) {
      current = mode;
      const live = mode === "http-echo" || mode === "timeout";
      const baseUrl = live ? echoServer.baseUrl : UNREACHABLE;
      const twice = mode === "tool";
      const timeoutMs = mode === "timeout" ? 300 : undefined;
      const providerSource = (url: string) => `OpenAIProvider({ model: "su-model", baseUrl: ${JSON.stringify(url)}, ${
        mode === "credential" ? `apiKeyEnv: "NICEEVAL_SU_FIXTURE_MISSING_CREDENTIAL"` : `apiKey: ${JSON.stringify(apiKey)}`
      }, contextWindow: 128000, maxOutputTokens: 128, headers: { "X-Fixture": ${JSON.stringify(headerSecret)} } })`;
      await writeFile(
        join(cwd, "niceeval.config.ts"),
        `import { defineConfig } from "niceeval";\nimport { OpenAIProvider } from "niceeval/judge";\nexport default defineConfig({ timeoutMs: 30000${
          mode === "provider" ? "" : `, judgeProvider: ${providerSource(baseUrl)}`
        } });\n`,
      );
      const evalSource = (await readFile(join(cwd, "evals", "sc0.eval.ts"), "utf8"))
        .replace(/const S = .*;/u, `const S = ${JSON.stringify({ ...scenario, twice, timeoutMs })};`);
      await writeFile(join(cwd, "evals", "sc0.eval.ts"), evalSource);
      const config =
        mode === "provider"
          ? {}
          : {
              judgeProvider: openAIProvider(baseUrl, {
                contextWindow: 128000,
                headers: { "X-Fixture": headerSecret },
                ...(mode === "credential" ? { apiKey: undefined, apiKeyEnv: "NICEEVAL_SU_FIXTURE_MISSING_CREDENTIAL" } : { apiKey }),
              }),
            };
      const { res, locators } = await runScenarios(cwd, config);
      const locator = locators.get("sc0")!;
      const attempt = await readAttempt(cwd, locator);
      // Sealed audit evidence is a public read surface too.
      const [traceDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
      const trace = narrowInspectionSuccess(traceDoc!, "attempt.trace");
      if (!trace.success) throw new Error(trace.reason);
      const evidence: string[] = [];
      for (const event of trace.value.trace.execution.events.filter((e) => e.source.id === "niceeval.simulated-user"))
        for (const item of event.evidence)
          evidence.push((await readPaginatedTrace(cwd, locator, item.evidenceId)).bytes.toString("utf8"));
      const outcome = JSON.parse(await readFile(join(root, "results", "sc0.json"), "utf8"));
      observed.set(mode, {
        outcome,
        attempt,
        surfaces: [...attempt.surfaces, JSON.stringify(outcome), JSON.stringify(res.receipt), JSON.stringify(res.run)].join("\n"),
        evidence: evidence.join("\n"),
      });
    }
  }, 180_000);

  afterAll(async () => {
    for (const undo of restore.reverse()) undo();
    await echoServer?.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
    if (root) await rm(root, { recursive: true, force: true });
  });

  // @feature docs/feature/eval/README.md#simulated-user-failures
  test.each(LAYERS)("a fault in layer $mode is attributed to cause $code", ({ mode, code }) => {
    const { outcome, attempt } = observed.get(mode)!;
    const context = JSON.stringify({ outcome, diagnostics: attempt.diagnostics });
    expect(outcome, context).toMatchObject({ ok: false, code: "simulated-user-failed", reason: code });
    expect(attempt.verdict, context).toBe("errored");
    const diagnostic = attempt.diagnostics.find((item) => item.code === "simulated-user-failed");
    expect(diagnostic?.phase, context).toBe("eval.run");
    expect(diagnostic?.causes[0]?.code, context).toBe(code);
    const message = String(outcome.message);
    if (mode === "provider") expect(message).toContain("Provider is not configured");
    if (mode === "credential") expect(message).toContain("credential is unresolved");
    if (["session", "prompt", "unknown", "tool", "json", "aborted", "safe", "usage"].includes(mode))
      expect(outcome.hasCause, context).toBe(true);
  });

  const credentialLayers = LAYERS.filter(({ mode }) => mode !== "provider" && mode !== "credential");
  const leaked = (text: string) => [...SECRETS, UNREACHABLE].filter((secret) => text.includes(secret));

  // @feature docs/feature/eval/README.md#simulated-user-failures
  test.each(credentialLayers)(
    "credentials configured for $mode never appear in Attempt reads, diagnostics or the caught error",
    ({ mode }) => {
      const { surfaces } = observed.get(mode)!;
      expect(leaked(surfaces), `${mode} leaked`).toEqual([]);
      expect(surfaces.includes(echoServer.baseUrl), `${mode} leaked the endpoint`).toBe(false);
    },
  );

  // The sealed `conversation` is the pi session history: a failure that echoes the key, a header
  // or the Authorization value must not reach it, as it must not reach the diagnostic.
  // @feature docs/feature/eval/README.md#simulated-user-failures
  test.each(credentialLayers)(
    "credentials configured for $mode never appear in sealed audit evidence",
    ({ mode }) => {
      expect(leaked(observed.get(mode)!.evidence), `${mode} leaked`).toEqual([]);
    },
  );

  // @feature docs/feature/eval/README.md#simulated-user-failures
  test("a long failure message is truncated while keeping its safe part", () => {
    const { outcome, surfaces } = observed.get("safe")!;
    expect(String(outcome.message).length).toBeLessThan(1100);
    expect(surfaces).toContain("fixture failure");
  });
});
