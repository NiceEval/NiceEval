import { join, resolve } from "node:path";
import {
  command,
  createE2EContext,
  type ExpEvalEvent,
  type ProcessReceipt,
  only,
} from "@niceeval/testkit";
import { expect } from "vitest";

const requiredSecrets = ["OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;
const niceevalBin = [join(process.cwd(), "node_modules", ".bin", "niceeval")] as const;

const e2e = createE2EContext({
  repoId: "openai-compat",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-openai-compat-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "junit", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: niceevalBin,
  },
});

// show 读回发生在 case 之外：--record 指向已暂存的 case artifact root，
// 完整 argv 与 recordRoot 语义留在调用点，不进入 Testkit。
const niceevalShow = command(niceevalBin);

export interface OpenAiLiveEvidence {
  readonly receipt: ProcessReceipt;
  readonly evalEvent: ExpEvalEvent;
  readonly evalEvents: readonly ExpEvalEvent[];
  readonly experimentId: string;
  readonly evalId: string;
  readonly executionMarkers: readonly string[];
  readonly recordRoot: string;
}

function requireLiveSecrets(): void {
  const missing = requiredSecrets.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`[configuration] OpenAI converter live E2E requires ${missing.join(", ")}`);
  }
}

export async function runOpenAiLiveEvidence(options: {
  experimentId: string;
  evalId: string;
  caseName: string;
  executionMarkers: readonly string[];
}): Promise<OpenAiLiveEvidence> {
  requireLiveSecrets();
  let evidence: OpenAiLiveEvidence | undefined;

  await e2e.case(
    options.caseName,
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const run = await niceeval.run(
        ["exp", options.experimentId, "--rerun", "all", "--json"],
        { timeoutMs: 4 * 60_000 },
      );
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const evalEvents = run.expEvalEvents();
      const evalEvent = only(
        evalEvents,
        (event) => event.evalId === options.evalId,
        () => run.diagnostic(),
      );
      evidence = {
        receipt: run,
        evalEvent,
        evalEvents,
        experimentId: options.experimentId,
        evalId: options.evalId,
        executionMarkers: options.executionMarkers,
        recordRoot: join(paths.artifactRoot, ".niceeval", "record"),
      };
    },
  );

  if (evidence === undefined) throw new Error(`live ${options.evalId} evidence was not produced`);
  return evidence;
}

export async function showOpenAiLiveEvidence(
  evidence: OpenAiLiveEvidence,
  args: readonly string[],
): Promise<ProcessReceipt> {
  return await niceevalShow.run(["show", ...args, "--record", evidence.recordRoot]);
}
