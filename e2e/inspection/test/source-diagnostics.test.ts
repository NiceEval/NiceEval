import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @regression memory/inspection-source-diagnostics-hidden.md
test.concurrent("Record 读取失败保留具体原因且不凭空归因旧版本", async () => {
  await inspectionE2E.case("source-diagnostics", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const record = join(projectRoot, "invalid.sqlite");

    await writeFile(record, "This is not a SQLite Record.");

    const result = await niceeval.run(["show", "--record", record, "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("inspection-source-invalid");
    expect(result.stderr).toContain("[record-sqlite-error; import-record]");
    expect(result.stderr).toContain("file is not a database");
    expect(result.stderr).not.toMatch(/older.*NiceEval/i);
    expect(result.stderr).not.toContain("run a normal experiment");

    // The capture boundary reports its input-size limit separately from corruption.
    await writeFile(record, "");
    const limited = await niceeval.run(["show", "--record", record, "--json"]);
    expect(limited.exitCode, limited.diagnostic()).toBe(1);
    expect(limited.stdout).toBe("");
    expect(limited.stderr).toContain("inspection-operation-failed");
    expect(limited.stderr).toContain("[record-resource-limit-exceeded; capture-record]");
    expect(limited.stderr).toContain("Record source size must be between 1 and");
    expect(limited.stderr).not.toContain("file is not a database");
    expect(limited.stderr).not.toMatch(/older.*NiceEval/i);
  });
});
