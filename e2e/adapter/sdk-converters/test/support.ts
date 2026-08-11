import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  command,
  type ExpEvalEvent,
  type ExpEvent,
  type ExpResultEvent,
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
      ],
      collision: "error",
    },
  };
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
      const run = await niceeval.run(
        ["exp", options.experimentId, "--rerun", "all", "--json"],
        { cwd: root },
      );
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const events = run.ndjson<ExpEvent>();
      const result: ExpResultEvent = run.expResult();
      expect(result).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        completion: "complete",
      });
      const evalEvent = events.find(
        (event): event is ExpEvalEvent => event.event === "eval" && event.evalId === options.evalId,
      );
      expect(evalEvent, run.diagnostic()).toBeDefined();

      const history = await niceeval.run(
        ["show", options.evalId, "--exp", options.experimentId, "--history"],
        { cwd: root },
      );
      expect(history.exitCode, history.diagnostic()).toBe(0);
      expect(history.stdout).toContain("passed");
      expect(history.stdout).toContain("@");

      const execution = await niceeval.run(["show", evalEvent!.locator!, "--execution"], { cwd: root });
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      for (const marker of options.executionMarkers) expect(execution.stdout).toContain(marker);
    },
    sdkConverterArtifactStaging(options.caseName),
  );
}
