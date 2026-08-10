import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  command,
  type ProcessReceipt,
  type ProjectCopyStagingOptions,
  withProjectCopy,
} from "@niceeval/testkit";
import { expect } from "vitest";

/**
 * Tests run concurrently by default. Every body gets a disposable project and
 * every retained artifact has a runner invocation + case namespace, so no two
 * workers can write the source scenario's .niceeval or JUnit roots.
 */
export const sdkConverterProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-sdk-converters-",
  omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

type ProcessWithLocalInvocation = NodeJS.Process & {
  __niceevalSdkConverterArtifactInvocationId?: string;
};

const processWithLocalInvocation = process as ProcessWithLocalInvocation;
const localInvocationId = processWithLocalInvocation.__niceevalSdkConverterArtifactInvocationId ??=
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

export function sdkConverterArtifactStaging(caseName: string): ProjectCopyStagingOptions {
  const safeCaseName = safePathSegment(caseName, "artifact caseName");
  return {
    stageArtifacts: {
      destinationRoot: process.cwd(),
      entries: [
        {
          source: ".niceeval",
          target: join(".niceeval", "e2e-artifacts", invocationId, safeCaseName),
          optional: true,
        },
        {
          source: "junit",
          target: join("junit", "e2e-artifacts", invocationId, safeCaseName),
          optional: true,
        },
      ],
      collision: "error",
    },
  };
}

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  status?: string;
  passed?: number;
  failed?: number;
  errored?: number;
  completion?: string;
}

function expectCliSuccess(receipt: ProcessReceipt): void {
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.signal, receipt.diagnostic()).toBeNull();
  expect(receipt.timedOut, receipt.diagnostic()).toBe(false);
  expect(receipt.stdout, receipt.diagnostic()).not.toMatch(/[\x1b\x08]/);
}

/**
 * Common public readback shell for one converter owner. Domain expectations
 * stay in each Eval; this helper only proves the owner was run, persisted and
 * readable through installed CLI entry points.
 */
export async function proveSdkConverterOwner(options: {
  experimentId: string;
  evalId: string;
  caseName: string;
  executionMarkers: readonly string[];
}): Promise<void> {
  const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
  await withProjectCopy(
    sdkConverterProjectCopy,
    async ({ root }) => {
      await mkdir(join(root, "junit"), { recursive: true });
      const junitPath = `junit/${options.caseName}.xml`;
      const run = await niceeval.run(
        ["exp", options.experimentId, "--rerun", "all", "--json", "--junit", junitPath],
        { cwd: root },
      );
      expectCliSuccess(run);
      const events = run.ndjson<ExpEvent>();
      expect(events.at(-1)).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        completion: "complete",
      });
      const evalEvent = events.find(
        (event) => event.event === "eval" && event.evalId === options.evalId && event.locator !== undefined,
      );
      expect(evalEvent, run.diagnostic()).toBeDefined();

      const junit = await readFile(join(root, junitPath), "utf8");
      expect(junit).toContain("<testsuite");
      expect(junit).not.toContain("<failure");
      expect(junit).not.toContain("<error");

      const board = await niceeval.run(["show", "--exp", options.experimentId, "--json"], { cwd: root });
      expectCliSuccess(board);
      expect(board.stdout).toContain(options.evalId);

      const history = await niceeval.run(
        ["show", options.evalId, "--exp", options.experimentId, "--history"],
        { cwd: root },
      );
      expectCliSuccess(history);
      expect(history.stdout).toContain("passed");
      expect(history.stdout).toContain("@");

      const execution = await niceeval.run(["show", evalEvent!.locator!, "--execution"], { cwd: root });
      expectCliSuccess(execution);
      for (const marker of options.executionMarkers) expect(execution.stdout).toContain(marker);
    },
    sdkConverterArtifactStaging(options.caseName),
  );
}
