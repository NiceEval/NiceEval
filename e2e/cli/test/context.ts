import { createE2EContext } from "@niceeval/testkit";
import type { Argv } from "@niceeval/testkit";

import { join, resolve } from "node:path";

export type InspectionOperation = Readonly<Record<string, unknown>> & { readonly kind: string };

/** Writes the public fixed-query protocol document; assertions stay in each owner. */

/**
 * Repo 级共享 E2E context：只冻结 source / invocation 身份与命令前缀，
 * 每个 `case()` 创建独占可写 projectRoot。产品 argv 与 expected 留在各测试正文。
 */
export const cliBinary: Argv = [join(process.cwd(), "node_modules", ".bin", "niceeval")];

export const cliE2E = createE2EContext({
  repoId: "cli",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-cli-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "junit", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: cliBinary,
  },
});
