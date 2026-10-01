import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @regression memory/inspection-source-diagnostics-hidden.md
test.concurrent("Record 读取失败保留具体原因且不凭空归因旧版本", async () => {
  await inspectionE2E.case("source-diagnostics", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const record = join(projectRoot, "invalid.sqlite");
    const request = join(projectRoot, "source.request.json");
    await writeFile(record, "This is not a SQLite Record.");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "overview.get" } }));
    const result = await niceeval.run(["query", "run", "--record", record, "--request", request]);
    expect(result.exitCode, result.diagnostic()).toBe(2);
    const failure = result.queryFailure().failure;
    expect(failure.code).toBe("inspection-source-invalid");
    expect(failure.reason).toContain("[record-sqlite-error; import-record]");
    expect(failure.reason).toContain("file is not a database");
    expect(failure.reason).not.toContain("older NiceEval");
    expect(failure.reason).not.toContain("run a normal experiment");

    // The capture boundary reports its input-size limit separately from corruption.
    await writeFile(record, "");
    const limited = await niceeval.run(["query", "run", "--record", record, "--request", request]);
    expect(limited.exitCode, limited.diagnostic()).toBe(2);
    expect(limited.queryFailure().failure).toMatchObject({
      code: "inspection-operation-failed",
      correction: "upgrade-or-report",
      reason: expect.stringContaining("record-resource-limit-exceeded"),
    });
  });
});
