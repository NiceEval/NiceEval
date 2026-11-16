// rerun: pnpm e2e test --repo inspection -- --run test/artifacts-portable.test.ts
import { only } from "@niceeval/testkit";
import { createHash } from "node:crypto";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("附件随 Record 搬走后仍能按历史与 carry locator 分块读取", async () => {
  await inspectionE2E.case(
    "artifacts-portable",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const expected = Buffer.from(Array.from({ length: 256 * 1024 + 13 }, (_, index) => index % 251));
      await writeFile(join(projectRoot, "attachment-input.bin"), expected);
      const origin = await niceeval.run(["exp", "artifacts-portable", "--rerun", "all", "--json"]);
      expect(origin.exitCode, origin.diagnostic()).toBe(0);
      const originRunId = only(origin.expReceipt().createdRunIds, () => true, origin.diagnostic());
      const locator = only(
        origin.expEvalEvents(),
        (entry) => entry.evalId === "artifacts-portable",
        origin.diagnostic(),
      ).locator;
      const canonicalLocator = locator.startsWith("@") ? locator : `@${locator}`;
      const receiptIds = (await readFile(join(projectRoot, "artifact-selectors.txt"), "utf8")).split("\n");
      expect(receiptIds).toHaveLength(16);
      expect(new Set(receiptIds).size).toBe(16);
      const carry = await niceeval.run(["exp", "artifacts-portable", "--json"]);
      expect(carry.exitCode, carry.diagnostic()).toBe(0);
      const carryRunId = only(carry.expReceipt().createdRunIds, () => true, carry.diagnostic());
      const rerun = await niceeval.run(["exp", "artifacts-portable", "--rerun", "all", "--json"]);
      expect(rerun.exitCode, rerun.diagnostic()).toBe(0);
      expect(
        only(rerun.expEvalEvents(), (entry) => entry.evalId === "artifacts-portable", rerun.diagnostic()).locator,
      ).not.toBe(locator);
      const recordPath = join(projectRoot, "portable.sqlite");
      await copyFile(join(projectRoot, ".niceeval", "record.sqlite"), recordPath);
      await rm(join(projectRoot, ".niceeval"), { recursive: true });
      await rm(join(projectRoot, "attachment-input.bin"));
      const runList = await niceeval.run(["show", "runs", "--json", "--record", recordPath]);
      const directRuns = await niceeval.run(["show", "runs", "--record", recordPath, "--json"]);
      expect(runList.exitCode, runList.diagnostic()).toBe(0);
      expect(runList.stdout).toBe(directRuns.stdout);
      expect(runList.inspectionSuccess("run.list").runs.some((run) => run.runId === originRunId)).toBe(true);

      const originRead = await niceeval.run(["show", `run:${originRunId}`, "--record", recordPath, "--json"]);
      expect(originRead.exitCode, originRead.diagnostic()).toBe(0);
      const originAttempt = only(
        originRead.inspectionSuccess("run.get").run.attempts,
        (item) => item.evalId === "artifacts-portable",
        originRead.diagnostic(),
      );
      expect(originAttempt.originRunId).toBe(originRunId);

      const carried = await niceeval.run(["show", `run:${carryRunId}`, "--record", recordPath, "--json"]);
      expect(carried.exitCode, carried.diagnostic()).toBe(0);
      const carriedMember = only(
        carried.inspectionSuccess("run.get").run.members,
        (item) => item.action === "carried",
        carried.diagnostic(),
      );
      expect(carriedMember.attempt).toEqual({
        attemptId: originAttempt.attemptId,
        originRunId: originAttempt.originRunId,
      });

      const listed = await niceeval.run(["show", canonicalLocator, "artifacts", "--record", recordPath, "--json"]);
      expect(listed.exitCode, listed.diagnostic()).toBe(0);
      const shownList = await niceeval.run(["show", canonicalLocator, "--json", "--record", recordPath, "artifacts"]);
      expect(shownList.exitCode, shownList.diagnostic()).toBe(0);
      expect(shownList.stdout).toBe(listed.stdout);
      const directory = listed.inspectionSuccess("attempt.artifacts").artifacts;
      expect(directory.state).toBe("available");
      if (directory.state !== "available") throw new Error("Expected portable artifact directory");
      const descriptors = [...directory.value.artifacts];
      expect(directory.value.collection).toMatchObject({ state: "complete", limitations: [] });
      expect(directory.collection).toMatchObject({
        state: "bounded-page",
        hasMore: true,
        total: 16,
        nextOffset: descriptors.length,
      });
      expect(directory.collection.items).toEqual(directory.value.artifacts);
      expect(Buffer.byteLength(JSON.stringify(directory.value.artifacts))).toBeLessThanOrEqual(128 * 1024);
      expect(Buffer.byteLength(JSON.stringify(directory))).toBeLessThanOrEqual(512 * 1024);
      let nextLink = listed.inspectionSuccess("attempt.artifacts").links.find((link) => link.rel === "next-page");
      while (nextLink !== undefined) {
        const token = nextLink.command.match(/--continuation ([^ ]+)/)![1]!;
        const readPage = await niceeval.run([
          "show",
          canonicalLocator,
          "artifacts",
          "--record",
          recordPath,
          "--continuation",
          token,
          "--json",
        ]);
        expect(readPage.exitCode, readPage.diagnostic()).toBe(0);
        const document = readPage.inspectionSuccess("attempt.artifacts");
        if (document.artifacts.state !== "available") throw new Error(readPage.diagnostic());
        descriptors.push(...document.artifacts.value.artifacts);
        nextLink = document.links.find((link) => link.rel === "next-page");
      }
      expect(descriptors.filter((item) => item.label === "L".repeat(16 * 1024))).toHaveLength(12);
      expect(descriptors.map((item) => item.artifactId).toSorted()).toEqual(receiptIds.toSorted());
      expect(descriptors.filter((item) => item.label === "same-label")).toHaveLength(2);
      const binary = only(
        descriptors,
        (item) => item.label === "same-label" && item.mediaType === "application/octet-stream",
        listed.diagnostic(),
      );
      const text = only(
        descriptors,
        (item) => item.label === "same-label" && item.mediaType === "text/plain",
        listed.diagnostic(),
      );
      const empty = only(descriptors, (item) => item.label === "empty", listed.diagnostic());
      const cleanup = only(descriptors, (item) => item.label === "cleanup.txt", listed.diagnostic());
      const binaryId = binary.artifactId;
      const digest = createHash("sha256").update(expected).digest("hex");
      expect(binary).toMatchObject({ byteLength: expected.length, sha256: digest });
      const chunks: Buffer[] = [];
      let offset = 0;
      let continuation: string | undefined;
      do {
        const read = await niceeval.run([
          "show",
          canonicalLocator,
          binaryId,
          "--record",
          recordPath,
          ...(continuation === undefined ? [] : ["--continuation", continuation]),
          "--json",
        ]);
        if (offset === 0) {
          const shown = await niceeval.run(["show", canonicalLocator, "--json", "--record", recordPath, binaryId]);
          expect(shown.exitCode, shown.diagnostic()).toBe(0);
          expect(shown.stdout).toBe(read.stdout);
        }
        expect(read.exitCode, read.diagnostic()).toBe(0);
        const document = read.inspectionSuccess("attempt.artifact");
        const artifact = document.artifact;
        continuation = document.links
          .find((link) => link.rel === "next-page")
          ?.command.match(/--continuation ([^ ]+)/)?.[1];
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
      for (const [artifactId, name, content] of [
        [text.artifactId, "same-label", "附件 snapshot\n"],
        [empty.artifactId, "empty", ""],
        [cleanup.artifactId, "cleanup.txt", "cleanup attachment"],
      ] as const) {
        const read = await niceeval.run([
          "show",
          canonicalLocator,
          "artifacts",
          artifactId,
          "--record",
          recordPath,
          "--json",
        ]);
        expect(read.exitCode, read.diagnostic()).toBe(0);
        expect(read.inspectionSuccess("attempt.artifact").artifact).toMatchObject({
          state: "available",
          name,
          base64: Buffer.from(content).toString("base64"),
          nextOffset: null,
        });
      }
      const rejected = await niceeval.run([
        "show",
        canonicalLocator,
        binaryId,
        "--record",
        recordPath,
        "--continuation",
        "invalid",
        "--json",
      ]);
      expect(rejected.exitCode, rejected.diagnostic()).not.toBe(0);
    },
  );
});
