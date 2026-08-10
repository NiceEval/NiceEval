import { randomUUID } from "node:crypto";
import type { ProjectCopyStagingOptions } from "@niceeval/testkit";
import { join, resolve } from "node:path";

/**
 * Each test gets a fully independent consumer and result root. The source
 * project itself is never used as evidence input: retained evidence is omitted
 * from every next copy and exists solely for runner artifact collection.
 */
export const evalProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-eval-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

type ProcessWithLocalInvocation = NodeJS.Process & {
  __niceevalE2eLocalArtifactInvocationId?: string;
};

const processWithLocalInvocation = process as ProcessWithLocalInvocation;
const localInvocationId = processWithLocalInvocation.__niceevalE2eLocalArtifactInvocationId ??=
  `local-${process.pid}-${randomUUID()}`;

function assertSafePathSegment(value: string, label: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)
  ) {
    throw new Error(`${label} must be one safe path segment`);
  }
  return value;
}

function invocationIdForArtifactNamespace(): string {
  const injected = process.env.NICEEVAL_E2E_INVOCATION_ID;
  if (injected === undefined || injected.length === 0) return localInvocationId;
  return assertSafePathSegment(injected, "NICEEVAL_E2E_INVOCATION_ID");
}

const invocationId = invocationIdForArtifactNamespace();

export function evalArtifactStaging(caseName: string): ProjectCopyStagingOptions {
  const safeCaseName = assertSafePathSegment(caseName, "artifact caseName");
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
