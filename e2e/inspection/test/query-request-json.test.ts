import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { QUERY_PROTOCOL } from "niceeval/inspection";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @regression memory/query-request-json-and-member-shape.md
test.concurrent("machine caller sends the same complete request through argv or file", async () => {
  await inspectionE2E.case("query-request-json", {}, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const request = JSON.stringify({ protocol: QUERY_PROTOCOL, operation: { kind: "run.list" } });
    const path = join(projectRoot, "request.json");
    await writeFile(path, request);
    for (const action of ["run", "explain"] as const) {
      const inline = await niceeval.run(["query", action, "--request-json", request]);
      expect(inline.exitCode, inline.diagnostic()).toBe(0);
      const file = await niceeval.run(["query", action, "--request", path]);
      expect(file.exitCode, file.diagnostic()).toBe(0);
      expect(inline.json<unknown>()).toEqual(file.json<unknown>());
      if (action === "run") expect(inline.querySuccess("run.list").protocol).toBe("niceeval.query/v3");
      else expect(inline.queryExplanation("run.list").protocol).toBe("niceeval.query/v3");
    }
    for (const args of [
      ["run"], ["explain"],
      ["run", "--request", "-", "--request-json", request],
      ["explain", "--request", path, "--request-json", request],
      ["discover", "--request-json", request],
      ["run", "--request-json", "{"],
      ["run", "--request-json", JSON.stringify({ kind: "run.list" })],
      ["run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v2", operation: { kind: "run.list" } })],
    ]) {
      const invalid = await niceeval.run(["query", ...args]);
      expect(invalid.exitCode, invalid.diagnostic()).toBe(2);
      expect(invalid.queryFailure().failure).toMatchObject({ code: "inspection-request-invalid", correction: "fix-request" });
    }
  });
});
