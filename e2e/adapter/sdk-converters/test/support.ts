import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  command,
  type ExpEvalEvent,
  type ExpEvent,
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
      // The terminal stream event is the Record v1 InvocationReceipt; it carries
      // no verdicts, so business results come from each eval event's identity
      // and verdict below (docs/feature/experiments/cli.md).
      const receipt = run.expReceipt();
      expect(receipt.completion).toBe("completed");
      expect(receipt.invocationId, run.diagnostic()).toBeTruthy();
      expect(receipt.runIds, run.diagnostic()).not.toHaveLength(0);
      const evalEvent = events.find(
        (event): event is ExpEvalEvent =>
          "event" in event && event.event === "eval" && event.evalId === options.evalId,
      );
      expect(evalEvent, run.diagnostic()).toBeDefined();
      expect(evalEvent).toMatchObject({
        evalId: options.evalId,
        experimentId: options.experimentId,
        verdict: "passed",
      });
      expect(evalEvent?.locator, run.diagnostic()).toBeTruthy();

      // receipt 的 runId 驱动公开读回(adapter/README.md「Live 验收说明」第 3 步)：
      // 运行已发布为完整 Run、slot included，selection 精确指向本轮 receipt。
      const shown = await niceeval.run(["show", "--run", receipt.runIds[0]!, "--json"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const selection = shown
        .json<{ sample: { selection: { runIds: readonly string[] } } }>()
        .sample.selection;
      expect(selection.runIds, shown.diagnostic()).toEqual([receipt.runIds[0]!]);
      expect(shown.stdout, shown.diagnostic()).toContain('"included"');

      // locator 驱动的公开读回：Attempt 的断言评估证据(含 Eval 内的工具/identity
      // 断言)已经随 Run 落盘，并通过 `show @<locator> --source` 可公开读回。
      const source = await niceeval.run(["show", evalEvent!.locator!, "--source"], { cwd: root });
      expect(source.exitCode, source.diagnostic()).toBe(0);
      expect(source.stdout).toContain("Assertions: available");
    },
    sdkConverterArtifactStaging(options.caseName),
  );
}
