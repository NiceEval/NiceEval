// rerun: pnpm e2e test --repo eval -- --run test/judge-image.test.ts
import { only } from "@niceeval/testkit";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { copyFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { screenshotBytes } from "../fixtures/judge-image.ts";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertion, inspectAttempt } from "./inspection.ts";

test.concurrent("截图以真实视觉材料参与判分，冻结原图与发送证据可随 Record 复查 [necase_ZK64TS7KYD0CH81W]", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (part: string) => { body += part; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const precheck = payload.messages.some((message: { content: unknown }) => message.content === "Precheck.");
      if (!precheck) requests.push(body);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ finish_reason: "tool_calls", message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "image-fixture-call", type: "function", function: {
            name: payload.tool_choice.function.name,
            arguments: JSON.stringify({ measurement: 0.75, rationale: "Screenshot supplements the described action." }),
          } }],
        } }],
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture has no TCP address");
  try {
    await evalE2E.case("judge-image", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "judge-image", "--rerun", "all", "--json"], { env: {
        ...process.env,
        NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        NICEEVAL_E2E_JUDGE_KEY: "image-fixture-key",
      } });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const evaluation = only(run.expEvalEvents(), (item) => item.evalId === "judge-image", run.diagnostic());
      expect(evaluation.verdict).toBe("passed");
      expect(requests).toHaveLength(1);
      const wire = JSON.parse(requests[0]!);
      expect(wire.model).toBe("fixture-vision");
      const parts = wire.messages[1].content;
      expect(Array.isArray(parts)).toBe(true);
      const images = parts.filter((part: { type: string }) => part.type === "image_url");
      expect(images).toHaveLength(1);
      expect(images[0].image_url.url).toMatch(/^data:image\/png;base64,/u);
      const original = screenshotBytes();
      expect(original.byteLength).toBeGreaterThan(512 * 1024);
      expect(Buffer.from(images[0].image_url.url.split(",")[1], "base64")).toEqual(Buffer.from(original));
      expect(requests[0]).not.toContain("MUTATED_AFTER_REGISTRATION");
      expect(requests[0]).toContain("original-action");
      const attempt = await inspectAttempt(niceeval, projectRoot, evaluation.locator, "attempt.get");
      const entry = only(attempt.document.attempt.assertions.entries, () => true, attempt.receipt.diagnostic());
      const portable = join(projectRoot, "judge-image-portable.sqlite");
      await copyFile(join(projectRoot, ".niceeval", "record.sqlite"), portable);
      await rm(join(projectRoot, ".niceeval"), { recursive: true });
      const requestPath = join(projectRoot, "image-inspection.json");
      await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
        kind: "attempt.assertion.detail", locator: evaluation.locator, entryId: entry.entryId,
      } }));
      const detail = await niceeval.run(["query", "run", "--record", portable, "--request", requestPath]);
      expect(detail.exitCode, detail.diagnostic()).toBe(0);
      const audit = assertionEntry(detail.attemptAssertionDetail(), detail.diagnostic()).scoreMatchAudit;
      expect(audit).toMatchObject({ state: "available", audit: { schemaVersion: 3, result: { state: "measured", value: 0.75 } } });
      expect(JSON.stringify(audit)).toContain(createHash("sha256").update(original).digest("hex"));
      expect(JSON.stringify(audit)).not.toContain("image-fixture-key");
      expect(Buffer.byteLength(detail.stdout)).toBeLessThan(512 * 1024);
      if (audit?.state !== "available" || audit.audit.schemaVersion !== 3) throw new Error(detail.diagnostic());
      const call = only(audit.audit.calls, () => true, detail.diagnostic());
      expect(call).toMatchObject({ state: "admitted", wireBody: {
        byteLength: Buffer.byteLength(requests[0]!),
        sha256: createHash("sha256").update(requests[0]!).digest("hex"),
      } });
      const image = only(audit.audit.images, () => true, detail.diagnostic());
      const chunks: Buffer[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
          kind: "attempt.assertion.image", locator: evaluation.locator, entryId: entry.entryId,
          imageId: image.imageId, offset, limit: 256 * 1024,
        } }));
        const page = await niceeval.run(["query", "run", "--record", portable, "--request", requestPath]);
        expect(page.exitCode, page.diagnostic()).toBe(0);
        const value = page.querySuccess("attempt.assertion.image").image;
        expect(value).toMatchObject({ state: "available", imageId: image.imageId, mediaType: "image/png", offset,
          byteLength: original.byteLength, sha256: createHash("sha256").update(original).digest("hex") });
        if (value.state !== "available") throw new Error(page.diagnostic());
        chunks.push(Buffer.from(value.base64, "base64"));
        if (value.nextOffset !== null) expect(value.nextOffset).toBeGreaterThan(offset);
        offset = value.nextOffset;
      }
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(original));
      expect(requests).toHaveLength(1);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test.concurrent("不支持图片的 Judge 在凭据检查前明确拒绝，封存图片不退化为文字判分 [necase_TB3PWT70ZK9BQWF1]", async () => {
  let requests = 0;
  const server = createServer((_request, response) => { requests += 1; response.writeHead(500); response.end(); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture has no TCP address");
  try {
    await evalE2E.case("judge-image-capability", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      for (const experiment of ["judge-image-unsupported", "judge-image-disabled"]) {
        const run = await niceeval.run(["exp", experiment, "--rerun", "all", "--json"], { env: {
          ...process.env,
          NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          NICEEVAL_E2E_ABSENT_IMAGE_KEY: "",
        } });
        expect(run.exitCode, run.diagnostic()).toBe(1);
        const evaluation = only(run.expEvalEvents(), (item) => item.evalId === "judge-image", run.diagnostic());
        expect(evaluation.verdict).toBe("errored");
        const attempt = await inspectAttempt(niceeval, projectRoot, evaluation.locator, "attempt.get");
        const entry = only(attempt.document.attempt.assertions.entries, () => true, attempt.receipt.diagnostic());
        const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator, entry.entryId);
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        expect(assertionEntry(detail.document, detail.receipt.diagnostic()).scoreMatchAudit).toMatchObject({
          state: "available", audit: {
            schemaVersion: 3,
            calls: [{ state: "rejected", transport: "not-sent", failure: { code: "judge-capability-unavailable" } }],
            result: { state: "unavailable", code: "judge-capability-unavailable" },
          },
        });
      }
      expect(requests).toBe(0);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
