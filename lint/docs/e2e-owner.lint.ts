import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

describe("E2E case relation owner lint", () => {
  it("公开 Concord CLI 返回 Feature owners", () => {
    const output = execFileSync(
      "concord",
      ["--json", "list", "feature"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const receipt = JSON.parse(output) as { operation?: unknown; documents: readonly unknown[] };
    expect(receipt).toMatchObject({ operation: "list", documents: expect.any(Array) });
    expect(receipt.documents.length).toBeGreaterThan(0);
    for (const document of receipt.documents) {
      expect(document).toMatchObject({ format: "concord.document/v1", kind: "feature", path: expect.any(String) });
    }
  }, 60_000);
});
