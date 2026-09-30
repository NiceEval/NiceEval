// rerun: pnpm e2e test --repo inspection -- --run test/file-attachments.test.ts
import { only } from "@niceeval/testkit";
import { createHash } from "node:crypto";
import { open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("280 MiB 文件归档使用有界内存且源改写后保留原始摘要及字节", async () => {
  await inspectionE2E.case("file-attachments", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const block = Buffer.alloc(64 * 1024, 0x61);
    block[block.length - 1] = 10;
    const hash = createHash("sha256");
    const file = await open(join(projectRoot, "journal.ndjson"), "w");
    try { for (let index = 0; index < 4480; index++) { await file.write(block); hash.update(block); } }
    finally { await file.close(); }
    await writeFile(join(projectRoot, "small.txt"), "cleanup bytes");
    const run = await niceeval.run(["exp", "file-attachments", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const [artifactId, sha256, byteLength, rssGrowth] = (await readFile(join(projectRoot, "receipt.txt"), "utf8")).split("\n");
    expect(sha256).toBe(hash.digest("hex"));
    expect(Number(byteLength)).toBe(280 * 1024 * 1024);
    expect(Number(rssGrowth)).toBeLessThan(128 * 1024 * 1024);
    expect(await readdir(join(projectRoot, ".niceeval", "attachment-staging"))).toEqual([]);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "file-attachments", run.diagnostic());
    const locator = event.locator.startsWith("@") ? event.locator : `@${event.locator}`;
    const request = join(projectRoot, "request.json");
    // All stored chunks are authenticated by the public reader; sample both ends and the middle.
    for (const offset of [0, 140 * 1024 * 1024, 280 * 1024 * 1024 - block.length]) {
      await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator, artifactId, offset } }));
      const read = await niceeval.run(["query", "run", "--request", request]);
      expect(read.exitCode, read.diagnostic()).toBe(0);
      expect(read.querySuccess("attempt.artifact").artifact).toMatchObject({ state: "available", sha256, byteLength: 280 * 1024 * 1024, base64: block.toString("base64") });
    }
  });
}, 180_000);

// @feature docs/feature/adapters/README.md
test.concurrent("文件归档失败和取消后保留已接纳附件且 cleanup 仍可归档", async () => {
  await inspectionE2E.case("file-attachment-failure", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    await writeFile(join(projectRoot, "small.txt"), "retained bytes");
    const run = await niceeval.run(["exp", "stream-failure", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).not.toBe(0);
    expect(await readFile(join(projectRoot, "failures.txt"), "utf8")).toBe("adapter-attachment-failed\nadapter-attachment-invalid\nadapter-attachment-limit\nadapter-attachment-failed");
    expect(await readdir(join(projectRoot, ".niceeval", "attachment-staging"))).toEqual([]);
    expect(await readFile(join(projectRoot, "source-cleanup.txt"), "utf8")).toBe("3,true,true");
    const event = only(run.expEvalEvents(), (item) => item.evalId === "stream-failure", run.diagnostic());
    expect(event.verdict).toBe("errored");
    const locator = event.locator.startsWith("@") ? event.locator : `@${event.locator}`;
    const request = join(projectRoot, "request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifacts", locator } }));
    const listed = await niceeval.run(["query", "run", "--request", request]);
    const directory = listed.querySuccess("attempt.artifacts").artifacts;
    expect(directory.state).toBe("available");
    if (directory.state !== "available") throw new Error("Expected attachments");
    expect(directory.value.collection.state).toBe("partial");
    expect(directory.value.artifacts.map((item) => item.label).sort()).toEqual(["cleanup", "retained"]);
    for (const selector of ["retained-id.txt", "cleanup-id.txt"]) {
      const artifactId = await readFile(join(projectRoot, selector), "utf8");
      await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator, artifactId } }));
      const read = await niceeval.run(["query", "run", "--request", request]);
      expect(read.querySuccess("attempt.artifact").artifact).toMatchObject({ state: "available", base64: Buffer.from("retained bytes").toString("base64") });
    }
  });
}, 60_000);

// @feature docs/feature/adapters/README.md
test.concurrent("Attempt 超时取消流后 cleanup 独立归档诊断材料", async () => {
  await inspectionE2E.case("stream-timeout", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    await writeFile(join(projectRoot, "small.txt"), "timeout diagnostics");
    const run = await niceeval.run(["exp", "stream-timeout", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).not.toBe(0);
    expect(await readFile(join(projectRoot, "cancel-source-closed.txt"), "utf8")).toBe("closed");
    expect(await readdir(join(projectRoot, ".niceeval", "attachment-staging"))).toEqual([]);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "stream-timeout", run.diagnostic());
    expect(event.verdict).toBe("errored");
    const locator = event.locator.startsWith("@") ? event.locator : `@${event.locator}`;
    const request = join(projectRoot, "request.json");
    const artifactId = await readFile(join(projectRoot, "cleanup-id.txt"), "utf8");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator, artifactId } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.querySuccess("attempt.artifact").artifact).toMatchObject({ state: "available", base64: Buffer.from("timeout diagnostics").toString("base64") });
  });
});
