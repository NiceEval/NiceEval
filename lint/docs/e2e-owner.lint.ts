import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

describe("E2E case relation owner lint", () => {
  it("正式 Trace compiler 接受受管 sidecar、owner 与 contract", () => {
    const output = execFileSync(
      "pnpm",
      ["run", "repo", "docs", "feature", "list", "--json"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const receipt = JSON.parse(output) as { format?: unknown; findings?: unknown };
    expect(receipt.format).toBe("niceeval.docs-trace/list-v1");
    expect(receipt.findings ?? []).toEqual([]);
  }, 60_000);
});
