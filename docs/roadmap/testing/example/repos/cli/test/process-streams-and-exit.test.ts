// feature: docs/feature/experiments/cli.md
import { resolve } from "node:path";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// NiceEval 根目录：pnpm e2e --repo cli -- --run test/process-streams-and-exit.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test --run test/process-streams-and-exit.test.ts

interface InvocationReceiptRecord {
  type: "receipt";
  receipt: {
    completion: "complete" | "incomplete" | "interrupted";
    record: { state: "complete" | "partial" | "not-recorded" };
  };
}

type InvocationMachineRecord =
  | { type: "snapshot" | "observation" | "claim" | "heartbeat" }
  | InvocationReceiptRecord;

function invocationReceipt(
  records: readonly InvocationMachineRecord[],
  diagnostic: string,
): InvocationReceiptRecord {
  const receipts = records.filter((record): record is InvocationReceiptRecord => record.type === "receipt");
  return only(receipts, () => true, diagnostic);
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-streams-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("JSON 模式保持 stdout、stderr 与 exit code 的公开分工", async () => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    const passed = await niceeval.run(["exp", "passing", "--rerun", "all", "--json"], { cwd: root });
    expect(passed.exitCode, passed.diagnostic()).toBe(0);
    expect(passed.stderr).toBe("");
    expect(invocationReceipt(passed.ndjson<InvocationMachineRecord>(), passed.diagnostic()))
      .toMatchObject({ type: "receipt", receipt: { completion: "complete", record: { state: "complete" } } });

    const failed = await niceeval.run(["exp", "failing", "--rerun", "all", "--json"], { cwd: root });
    expect(failed.exitCode, failed.diagnostic()).toBe(1);
    expect(failed.stderr).toBe("");
    expect(invocationReceipt(failed.ndjson<InvocationMachineRecord>(), failed.diagnostic()))
      .toMatchObject({ type: "receipt", receipt: { completion: "complete", record: { state: "complete" } } });

    const usageError = await niceeval.run(["show", "missing-eval", "--json"], { cwd: root });
    expect(usageError.exitCode, usageError.diagnostic()).not.toBe(0);
    expect(usageError.stdout).toBe("");
    expect(usageError.stderr).toContain("No results matched");
  });
});
