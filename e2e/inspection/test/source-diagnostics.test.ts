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
    expect(result.exitCode, result.diagnostic()).toBe(2);
    const failure = result.inspectionFailure().failure;
    expect(failure.code).toBe("inspection-source-invalid");
    expect(failure.reason).toContain("[record-sqlite-error; import-record]");
    expect(failure.reason).toContain("file is not a database");
    expect(failure.reason).not.toContain("older NiceEval");
    expect(failure.reason).not.toContain("run a normal experiment");

    // The capture boundary reports its input-size limit separately from corruption.
    await writeFile(record, "");
    const limited = await niceeval.run(["show", "--record", record, "--json"]);
    expect(limited.exitCode, limited.diagnostic()).toBe(2);
    expect(limited.inspectionFailure().failure).toMatchObject({
      code: "inspection-operation-failed",
      correction: "upgrade-or-report",
      reason: expect.stringContaining("record-resource-limit-exceeded"),
    });
  });
});
