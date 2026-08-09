import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { ProjectCopyStagingOptions } from "@niceeval/testkit";

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
