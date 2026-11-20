import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  OpenAIProvider,
  TypesafeProvider,
  createJudgeProject,
  narrowInspectionSuccess,
  planAndRunExperiment,
  showJsonDocuments,
  startHttpServer,
} from "../judge-harness/harness.ts";

export { OpenAIProvider, TypesafeProvider, narrowInspectionSuccess, planAndRunExperiment, showJsonDocuments, startHttpServer };

/** One pending request the fixture Agent raises while waiting for the user. */
export interface RequestSpec {
  readonly id: string;
  readonly prompt: string;
  readonly options?: readonly { readonly id: string; readonly label?: string }[];
}

/** One generated scenario: what the Agent asks, and how the eval drives the reply. */
export interface Scenario {
  readonly id: string;
  /** Empty means the Agent completes its Turn with a message and no pending input. */
  readonly requests: readonly RequestSpec[];
  readonly guard?: "stale" | "foreign" | "clone" | undefined;
  readonly timeoutMs?: number | undefined;
  /** Reply to the Agent's answer Turn a second time within the same simulated user. */
  readonly twice?: boolean | undefined;
  /** The Agent never finishes the Turn that answers the user, until the Attempt is cancelled. */
  readonly hangDrive?: boolean | undefined;
}

export const scenarioMarker = (id: string) => `scenario:${id}`;

/**
 * Fixture Agent: deterministic and driven only by the Turn input. The scenario id
 * appears in every request id, option id and answer text, so each drive can be
 * attributed to its scenario without shared state.
 */
export function agentSource(scenarios: readonly Scenario[], drivesPath: string): string {
  return `
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { appendFileSync } from "node:fs";
const SCENARIOS = ${JSON.stringify(Object.fromEntries(scenarios.map((s) => [s.id, s])))};
export default defineAgent({
  name: "su-agent",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    const id = JSON.stringify(input).match(/sc\\d+/u)?.[0];
    appendFileSync(${JSON.stringify(drivesPath)}, JSON.stringify({ id, text: input.text, responses: input.responses ?? null }) + "\\n");
    const scenario = SCENARIOS[id];
    if (scenario?.hangDrive && !input.text.startsWith("START"))
      await new Promise((resolve) => ctx.signal.addEventListener("abort", resolve, { once: true }));
    const waiting = scenario !== undefined && input.text.startsWith("START") && scenario.requests.length > 0;
    return waiting
      ? { status: "waiting", events: scenario.requests.map((request) => ({ type: "input.requested", request })) }
      : { status: "completed", events: [{ type: "message", role: "assistant", text: "Agent question " + input.text }] };
  },
});
`;
}

export function evalSource(scenario: Scenario, resultPath: string): string {
  return `
import { defineEval, defineSimulatedUser } from "niceeval";
import { writeFile } from "node:fs/promises";
const S = ${JSON.stringify(scenario)};
export default defineEval({ async test(t) {
  const user = t.simulatedUser(defineSimulatedUser({
    instructions: ${JSON.stringify(scenarioMarker(scenario.id))} + " Use only the supplied facts.",
    timeoutMs: S.timeoutMs ?? 20000,
  }));
  const first = await t.send("START " + S.id);
  let source = first;
  if (S.guard === "stale") await t.send("NEXT " + S.id);
  if (S.guard === "foreign") source = await t.newSession().send("START " + S.id);
  if (S.guard === "clone") source = { ...first };
  let outcome;
  try {
    const next = await user.reply(source);
    outcome = { ok: true, status: next.status };
    if (S.twice) await user.reply(next);
  } catch (error) {
    outcome = { ok: false, code: error.code, reason: error.reason, message: String(error.message), hasCause: error.cause !== undefined };
  }
  await writeFile(${JSON.stringify(resultPath)}, JSON.stringify(outcome));
} });
`;
}

export interface ProjectOptions {
  readonly scenarios: readonly Scenario[];
  readonly drivesPath: string;
  readonly resultDir: string;
  readonly config: string;
}

export async function createSimulatedUserProject(prefix: string, options: ProjectOptions): Promise<string> {
  const evals: Record<string, string> = {};
  for (const scenario of options.scenarios)
    evals[`${scenario.id}.eval.ts`] = evalSource(scenario, join(options.resultDir, `${scenario.id}.json`));
  return createJudgeProject(prefix, {
    config: options.config,
    agent: agentSource(options.scenarios, options.drivesPath),
    evals,
    experiments: {
      "su.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: "*", attempts: 1, earlyExit: false });`,
    },
  });
}

export function openAIConfigSource(baseUrl: string | undefined, extra = ""): string {
  return `
import { defineConfig } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";
export default defineConfig({ timeoutMs: 30000, ${
    baseUrl === undefined
      ? ""
      : `judgeProvider: OpenAIProvider({ model: "su-model", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "fixture-key", maxOutputTokens: 128${extra} }),`
  } });
`;
}

export function openAIProvider(baseUrl: string, extra: Record<string, unknown> = {}) {
  return OpenAIProvider({ model: "su-model", baseUrl, apiKey: "fixture-key", maxOutputTokens: 128, ...extra });
}

/** Writes one streamed chat completion, optionally calling the reply tool. */
export function respondStream(
  res: ServerResponse,
  payload: { model: string },
  options: { readonly toolArguments?: unknown; readonly text?: string; readonly id: string },
): void {
  const calls =
    options.toolArguments === undefined
      ? []
      : [
          {
            index: 0,
            id: `call-${options.id}`,
            type: "function",
            function: { name: "reply_to_agent", arguments: JSON.stringify(options.toolArguments) },
          },
        ];
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(
    `data: ${JSON.stringify({
      id: `gen-${options.id}`,
      object: "chat.completion.chunk",
      model: payload.model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: calls.length ? null : (options.text ?? "No answer."), ...(calls.length ? { tool_calls: calls } : {}) },
          finish_reason: calls.length ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    })}\n\ndata: [DONE]\n\n`,
  );
}

/** Finds which scenario a model request belongs to, from the system prompt marker. */
export function scenarioOfRequest(body: string): string | undefined {
  return body.match(/scenario:(sc\d+)/u)?.[1];
}

export type ModelHandler = (request: IncomingMessage, body: string, response: ServerResponse) => void | Promise<void>;

export async function loadPi() {
  const manifest = new URL("../../../../packages/niceeval/package.json", import.meta.url);
  const codingPkg = findPackageJSON("@earendil-works/pi-coding-agent", manifest)!;
  const aiPkg = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(codingPkg))!;
  const piCoding = (await import(
    pathToFileURL(join(dirname(codingPkg), "dist/index.js")).href
  )) as typeof import("../../../../packages/niceeval/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
  const piAi = (await import(
    pathToFileURL(join(dirname(aiPkg), "dist/index.js")).href
  )) as typeof import("../../../../packages/niceeval/node_modules/@earendil-works/pi-ai/dist/index.js");
  return { piCoding, piAi };
}

export interface TraceDiagnostic {
  readonly code: string;
  readonly phase?: string;
  readonly causes: readonly { readonly code?: string }[];
}

/** Reads execution diagnostics and every other public surface of one Attempt as JSON text. */
export async function readAttempt(cwd: string, locator: string) {
  const [attemptDoc] = await showJsonDocuments(cwd, [locator]);
  const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
  if (!attempt.success) throw new Error(attempt.reason);
  const [traceDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
  const trace = narrowInspectionSuccess(traceDoc!, "attempt.trace");
  if (!trace.success) throw new Error(trace.reason);
  const surfaces = [JSON.stringify(attemptDoc), JSON.stringify(traceDoc)];
  for (const view of ["usage", "timing", "assertions"]) {
    surfaces.push(JSON.stringify(await showJsonDocuments(cwd, [locator, view])));
  }
  return {
    verdict: attempt.value.attempt.verdict,
    diagnostics: trace.value.trace.diagnostics.items as readonly TraceDiagnostic[],
    surfaces,
  };
}

export async function runScenarios(cwd: string, config: Record<string, unknown>, signal?: AbortSignal) {
  const res = await planAndRunExperiment(cwd, "su", { config, rerun: "all", ...(signal ? { signal } : {}) });
  const locators = new Map<string, string>();
  for (const slot of res.run?.slots ?? [])
    if (slot.publication.state === "published") locators.set(slot.evalId, slot.publication.attemptLocator);
  return { res, locators };
}
