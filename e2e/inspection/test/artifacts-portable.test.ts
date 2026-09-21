// rerun: pnpm e2e test --repo inspection -- --run test/artifacts-portable.test.ts
import { only } from "@niceeval/testkit";
import { createHash } from "node:crypto";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

test.concurrent("附件随 Record 搬走后仍能按历史与 carry locator 分块读取 [necase_JAEBNT5NHZGJKR5F]", async () => {
  await inspectionE2E.case("artifacts-portable", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const expected = Buffer.from(Array.from({ length: 256 * 1024 + 13 }, (_, index) => index % 251));
    await writeFile(join(projectRoot, "attachment-input.bin"), expected);
    const origin = await niceeval.run(["exp", "artifacts-portable", "--rerun", "all", "--json"]);
    expect(origin.exitCode, origin.diagnostic()).toBe(0);
    const originRunId = only(origin.expReceipt().createdRunIds, () => true, origin.diagnostic());
    const locator = only(origin.expEvalEvents(), (entry) => entry.evalId === "artifacts-portable", origin.diagnostic()).locator;
    const canonicalLocator = locator.startsWith("@") ? locator : `@${locator}`;
    const receiptIds = (await readFile(join(projectRoot, "artifact-selectors.txt"), "utf8")).split("\n");
    expect(receiptIds).toHaveLength(16);
    expect(new Set(receiptIds).size).toBe(16);
    const carry = await niceeval.run(["exp", "artifacts-portable", "--json"]);
    expect(carry.exitCode, carry.diagnostic()).toBe(0);
    const carryRunId = only(carry.expReceipt().createdRunIds, () => true, carry.diagnostic());
    const rerun = await niceeval.run(["exp", "artifacts-portable", "--rerun", "all", "--json"]);
    expect(rerun.exitCode, rerun.diagnostic()).toBe(0);
    expect(only(rerun.expEvalEvents(), (entry) => entry.evalId === "artifacts-portable", rerun.diagnostic()).locator).not.toBe(locator);
    const recordPath = join(projectRoot, "portable.sqlite");
    await copyFile(join(projectRoot, ".niceeval", "record.sqlite"), recordPath);
    await rm(join(projectRoot, ".niceeval"), { recursive: true });
    await rm(join(projectRoot, "attachment-input.bin"));
    const requestPath = join(projectRoot, "artifact.request.json");
    await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "run.get", runId: originRunId } }));
    const originRead = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
    expect(originRead.exitCode, originRead.diagnostic()).toBe(0);
    const originAttempt = only(originRead.querySuccess("run.get").run.attempts, (item) => item.evalId === "artifacts-portable", originRead.diagnostic());
    expect(originAttempt.originRunId).toBe(originRunId);
    await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "run.get", runId: carryRunId } }));
    const carried = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
    expect(carried.exitCode, carried.diagnostic()).toBe(0);
    const carriedMember = only(carried.querySuccess("run.get").run.members, (item) => item.action === "carried", carried.diagnostic());
    expect(carriedMember.attempt).toEqual({ attemptId: originAttempt.attemptId, originRunId: originAttempt.originRunId });
    await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifacts", locator: canonicalLocator } }));
    const listed = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
    expect(listed.exitCode, listed.diagnostic()).toBe(0);
    const directory = listed.querySuccess("attempt.artifacts").artifacts;
    expect(directory.state).toBe("available");
    if (directory.state !== "available") throw new Error("Expected portable artifact directory");
    const descriptors = [...directory.value.artifacts];
    expect(directory.value.collection).toMatchObject({ state: "complete", limitations: [] });
    expect(directory.collection).toMatchObject({ state: "bounded-page", hasMore: true, total: 16, nextOffset: descriptors.length });
    expect(directory.collection.items).toEqual(directory.value.artifacts);
    expect(Buffer.byteLength(JSON.stringify(directory.value.artifacts))).toBeLessThanOrEqual(128 * 1024);
    expect(Buffer.byteLength(JSON.stringify(directory))).toBeLessThanOrEqual(512 * 1024);
    let next = directory.collection.nextOffset;
    while (next !== null) {
      await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifacts", locator: canonicalLocator, offset: next, limit: 3 } }));
      const readPage = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
      expect(readPage.exitCode, readPage.diagnostic()).toBe(0);
      const page = readPage.querySuccess("attempt.artifacts").artifacts;
      if (page.state !== "available") throw new Error("Expected artifact directory page");
      expect(page.value.artifacts.length).toBeGreaterThan(0);
      expect(page.value.artifacts.length).toBeLessThanOrEqual(3);
      expect(page.collection.items).toEqual(page.value.artifacts);
      expect(Buffer.byteLength(JSON.stringify(page.value.artifacts))).toBeLessThanOrEqual(128 * 1024);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512 * 1024);
      descriptors.push(...page.value.artifacts);
      expect(page.collection).toMatchObject({
        total: 16, hasMore: descriptors.length < 16, nextOffset: descriptors.length < 16 ? descriptors.length : null,
      });
      next = page.collection.nextOffset;
    }
    expect(descriptors.filter((item) => item.label === "L".repeat(16 * 1024))).toHaveLength(12);
    expect(descriptors.map((item) => item.artifactId).toSorted()).toEqual(receiptIds.toSorted());
    expect(descriptors.filter((item) => item.label === "same-label")).toHaveLength(2);
    const binary = only(descriptors, (item) => item.label === "same-label" && item.mediaType === "application/octet-stream", listed.diagnostic());
    const text = only(descriptors, (item) => item.label === "same-label" && item.mediaType === "text/plain", listed.diagnostic());
    const empty = only(descriptors, (item) => item.label === "empty", listed.diagnostic());
    const cleanup = only(descriptors, (item) => item.label === "cleanup.txt", listed.diagnostic());
    await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifacts", locator: canonicalLocator, offset: 16 } }));
    const eofList = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
    expect(eofList.exitCode, eofList.diagnostic()).toBe(0);
    expect(eofList.querySuccess("attempt.artifacts").artifacts).toMatchObject({
      state: "available", value: { artifacts: [] },
      collection: { state: "complete-page", items: [], total: 16, hasMore: false, nextOffset: null },
    });
    for (const bounds of [{ offset: 17 }, { offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 129 }]) {
      await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifacts", locator: canonicalLocator, ...bounds } }));
      const rejected = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
      expect(rejected.exitCode, rejected.diagnostic()).not.toBe(0);
      expect(rejected.queryFailure()).toMatchObject({ failure: { code: "inspection-request-invalid" } });
    }
    const binaryId = binary.artifactId;
    const digest = createHash("sha256").update(expected).digest("hex");
    expect(binary).toMatchObject({ byteLength: expected.length, sha256: digest });
    const chunks: Buffer[] = [];
    let offset = 0;
    do {
      await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator: canonicalLocator, artifactId: binaryId, offset } }));
      const read = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
      expect(read.exitCode, read.diagnostic()).toBe(0);
      const artifact = read.querySuccess("attempt.artifact").artifact;
      expect(artifact.state).toBe("available");
      if (artifact.state !== "available") throw new Error("Expected readable artifact");
      expect(artifact).toMatchObject({ name: "same-label", offset, byteLength: expected.length, sha256: digest });
      const bytes = Buffer.from(artifact.base64, "base64");
      expect(bytes.length).toBe(Math.min(64 * 1024, expected.length - offset));
      chunks.push(bytes);
      offset += bytes.length;
      expect(artifact.nextOffset).toBe(offset === expected.length ? null : offset);
    } while (offset < expected.length);
    expect(Buffer.concat(chunks)).toEqual(expected);
    await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator: canonicalLocator, artifactId: binaryId, limit: 256 * 1024 } }));
    const maximumPage = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
    expect(maximumPage.exitCode, maximumPage.diagnostic()).toBe(0);
    expect(maximumPage.querySuccess("attempt.artifact").artifact).toMatchObject({
      state: "available", offset: 0, base64: expected.subarray(0, 256 * 1024).toString("base64"), nextOffset: 256 * 1024,
    });
    for (const [artifactId, name, content] of [[text.artifactId, "same-label", "附件 snapshot\n"], [empty.artifactId, "empty", ""], [cleanup.artifactId, "cleanup.txt", "cleanup attachment"]] as const) {
      await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator: canonicalLocator, artifactId } }));
      const read = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
      expect(read.exitCode, read.diagnostic()).toBe(0);
      expect(read.querySuccess("attempt.artifact").artifact).toMatchObject({ state: "available", name, base64: Buffer.from(content).toString("base64"), nextOffset: null });
    }
    for (const operation of [
      { kind: "attempt.artifact", locator: canonicalLocator, artifactId: binaryId, offset: expected.length },
      { kind: "attempt.artifact", locator: canonicalLocator, artifactId: "art_00000000000000000000" },
    ]) {
      await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation }));
      const read = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
      expect(read.exitCode, read.diagnostic()).toBe(0);
      expect(read.querySuccess("attempt.artifact").artifact).toMatchObject(operation.artifactId === binaryId
        ? { state: "available", base64: "", nextOffset: null }
        : { state: "not-found", artifactId: operation.artifactId });
    }
    for (const bounds of [{ offset: expected.length + 1 }, { offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 256 * 1024 + 1 }]) {
      await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator: canonicalLocator, artifactId: binaryId, ...bounds } }));
      const read = await niceeval.run(["query", "run", "--record", recordPath, "--request", requestPath]);
      expect(read.exitCode, read.diagnostic()).not.toBe(0);
      expect(read.queryFailure()).toMatchObject({ failure: { code: "inspection-request-invalid" } });
    }
  });
});
