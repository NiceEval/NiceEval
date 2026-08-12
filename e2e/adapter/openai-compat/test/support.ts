import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  command,
  type ExpEvalEvent,
  type ExpEvent,
  type ProcessReceipt,
  withProjectCopy,
} from "@niceeval/testkit";
import { expect } from "vitest";

const requiredSecrets = ["OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;
const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

type ProcessWithLocalInvocation = NodeJS.Process & {
  __niceevalOpenAiCompatArtifactInvocationId?: string;
};

const processWithLocalInvocation = process as ProcessWithLocalInvocation;
const localInvocationId = processWithLocalInvocation.__niceevalOpenAiCompatArtifactInvocationId ??=
  `local-${process.pid}-${randomUUID()}`;

function safePathSegment(value: string, label: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)
  ) {
    throw new Error(`${label} must be one safe path segment`);
  }
  return value;
}

function artifactInvocationId(): string {
  const injected = process.env.NICEEVAL_E2E_INVOCATION_ID;
  return injected === undefined || injected.length === 0
    ? localInvocationId
    : safePathSegment(injected, "NICEEVAL_E2E_INVOCATION_ID");
}

const invocationId = artifactInvocationId();

export interface OpenAiLiveEvidence {
  readonly receipt: ProcessReceipt;
  readonly evalEvent: ExpEvalEvent;
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
  const safeCaseName = safePathSegment(options.caseName, "artifact caseName");
  const artifactRoot = join(
    process.cwd(),
    ".niceeval",
    "e2e-artifacts",
    invocationId,
    safeCaseName,
  );
  let evidence: OpenAiLiveEvidence | undefined;

  await withProjectCopy(
    {
      from: process.cwd(),
      prefix: `niceeval-openai-${options.caseName}-`,
      omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
      links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
    },
    async ({ root }) => {
      const run = await niceeval.run(
        ["exp", options.experimentId, "--rerun", "all", "--json"],
        { cwd: root, timeoutMs: 4 * 60_000 },
      );
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const events = run.ndjson<ExpEvent>();
      const evalEvent = events.find(
        (event): event is ExpEvalEvent =>
          "event" in event && event.event === "eval" && event.evalId === options.evalId,
      );
      if (evalEvent === undefined || evalEvent.locator === undefined) {
        throw new Error(`live ${options.evalId} eval has no public locator: ${run.diagnostic()}`);
      }
      evidence = {
        receipt: run,
        evalEvent,
        experimentId: options.experimentId,
        evalId: options.evalId,
        executionMarkers: options.executionMarkers,
        recordRoot: join(artifactRoot, "record"),
      };
    },
    {
      stageArtifacts: {
        destinationRoot: process.cwd(),
        entries: [
          {
            source: ".niceeval",
            target: join(
              ".niceeval",
              "e2e-artifacts",
              invocationId,
              safeCaseName,
            ),
            optional: true,
          },
        ],
        collision: "error",
      },
    },
  );

  if (evidence === undefined) throw new Error(`live ${options.evalId} evidence was not produced`);
  return evidence;
}

export async function showOpenAiLiveEvidence(
  evidence: OpenAiLiveEvidence,
  args: readonly string[],
): Promise<ProcessReceipt> {
  return await niceeval.run(["show", ...args, "--record", evidence.recordRoot]);
}
