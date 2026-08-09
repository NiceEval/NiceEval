import { randomUUID } from "node:crypto";
import type { ProjectCopyStagingOptions } from "@niceeval/testkit";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

/**
 * 每个 owner 自己在这个副本内写入 `.niceeval`；这里仅声明副本生命周期和
 * 已安装 candidate 的 node_modules 链接，不封装任何产品 argv 或 expected。
 */
export const reportProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-report-",
  omitTopLevel: [".niceeval", "evidence", "node_modules", "site-export", "test", "test-results"],
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

function assertCanonicalRelativeDirectory(value: string): string {
  if (value.length === 0 || isAbsolute(value) || value.includes("\\") || value.includes("\0")) {
    throw new Error("artifact extra directory must be a canonical relative path");
  }
  const canonical = normalize(value);
  if (
    canonical !== value ||
    canonical === "." ||
    canonical === ".." ||
    canonical.startsWith(`..${sep}`) ||
    isAbsolute(canonical)
  ) {
    throw new Error("artifact extra directory must stay within the case namespace");
  }
  return canonical;
}

function invocationIdForArtifactNamespace(): string {
  const injected = process.env.NICEEVAL_E2E_INVOCATION_ID;
  if (injected === undefined || injected.length === 0) return localInvocationId;
  return assertSafePathSegment(injected, "NICEEVAL_E2E_INVOCATION_ID");
}

const invocationId = invocationIdForArtifactNamespace();

export function reportArtifactStaging(
  caseName: string,
  extraDirectories: readonly string[] = [],
): ProjectCopyStagingOptions {
  const safeCaseName = assertSafePathSegment(caseName, "artifact caseName");
  const safeExtraDirectories = extraDirectories.map(assertCanonicalRelativeDirectory);
  const namespace = join("evidence", invocationId, safeCaseName);
  return {
    stageArtifacts: {
      destinationRoot: process.cwd(),
      entries: [
        {
          source: ".niceeval",
          target: join(namespace, ".niceeval"),
          optional: true,
        },
        ...safeExtraDirectories.map((directory) => ({
          source: directory,
          target: join(namespace, directory),
          optional: true,
        })),
      ],
      collision: "error",
    },
  };
}
