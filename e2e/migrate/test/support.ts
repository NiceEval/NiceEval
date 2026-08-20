import { createHash } from "node:crypto";
import { cpSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createE2EContext } from "@niceeval/testkit";
import { expect } from "vitest";

export const RUN_ID = "2ce48d15-5278-46f7-a512-7235a3362c24";
export const ATTEMPT_ID = "ae2047b7-d0ef-4f1d-8a2f-ae2b27e7b4ad";
const installedNiceeval = [join(process.cwd(), "node_modules", ".bin", "niceeval")] as const;

export const e2e = createE2EContext({
  repoId: "migrate",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-migrate-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { candidate: installedNiceeval, producer: installedNiceeval },
});

export function copyV1Fixture(sourceRoot: string, recordRoot: string): void {
  cpSync(join(sourceRoot, "fixtures", "observability-v1-record"), recordRoot, { recursive: true });
}

export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export async function commitRecord(
  run: (command: readonly [string, ...string[]]) => Promise<{
    readonly exitCode: number | null;
    readonly diagnostic: () => string;
  }>,
  message: string,
): Promise<void> {
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "e2e@niceeval.local"],
    ["config", "user.name", "NiceEval E2E"],
    ["add", "-f", ".niceeval/record"],
    ["commit", "-qm", message],
  ] as const) {
    const git = await run(["git", ...args]);
    expect(git.exitCode, git.diagnostic()).toBe(0);
  }
}
