// rerun: pnpm e2e test --repo eval -- --run test/judge-image.test.ts
import { only } from "@niceeval/testkit";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { screenshotBytes } from "../fixtures/judge-image.ts";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertion, inspectAttempt } from "./inspection.ts";

// @feature docs/feature/judge/README.md
test.concurrent("截图以真实视觉材料参与判分，冻结原图与发送证据可随 Record 复查", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (part: string) => {
      body += part;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const precheck = payload.messages.some((message: { content: unknown }) => message.content === "Precheck.");
      if (!precheck) requests.push(body);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "image-fixture-call",
                    type: "function",
                    function: {
                      name: payload.tool_choice.function.name,
                      arguments: JSON.stringify({
                        measurement: 0.75,
                        rationale: "Screenshot supplements the described action.",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture has no TCP address");
  try {
    await evalE2E.case("judge-image", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "judge-image", "--rerun", "all", "--json"], {
        env: {
          ...process.env,
          NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          NICEEVAL_E2E_JUDGE_KEY: "image-fixture-key",
        },
      });
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

      const detail = await niceeval.run([
        "show",
        evaluation.locator,
        entry.entryId,
        "--full",
        "--record",
        portable,
        "--json",
      ]);
      expect(detail.exitCode, detail.diagnostic()).toBe(0);
      const audit = assertionEntry(detail.attemptAssertionDetail(), detail.diagnostic()).scoreMatchAudit;
      expect(audit).toMatchObject({
        state: "available",
        audit: { kind: "images", result: { state: "measured", value: 0.75 } },
      });
      expect(JSON.stringify(audit)).toContain(createHash("sha256").update(original).digest("hex"));
      expect(JSON.stringify(audit)).not.toContain("image-fixture-key");
      expect(Buffer.byteLength(detail.stdout)).toBeLessThan(512 * 1024);
      if (audit?.state !== "available" || audit.audit.kind !== "images") throw new Error(detail.diagnostic());
      const call = only(audit.audit.calls, () => true, detail.diagnostic());
      expect(call).toMatchObject({
        state: "admitted",
        wireBody: {
          byteLength: Buffer.byteLength(requests[0]!),
          sha256: createHash("sha256").update(requests[0]!).digest("hex"),
        },
      });
      const image = only(audit.audit.images, () => true, detail.diagnostic());
      const output = join(projectRoot, "recovered-image.png");
      const saved = await niceeval.run([
        "show",
        evaluation.locator,
        entry.entryId,
        "image",
        image.imageId,
        "--output",
        output,
        "--record",
        portable,
      ]);
      expect(saved.exitCode, saved.diagnostic()).toBe(0);
      expect(await readFile(output)).toEqual(Buffer.from(original));
      expect(requests).toHaveLength(1);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

// @feature docs/feature/judge/README.md
test.concurrent("不支持图片的 Judge 在凭据检查前明确拒绝，封存图片不退化为文字判分", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(500);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture has no TCP address");
  try {
    await evalE2E.case("judge-image-capability", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      for (const experiment of ["judge-image-unsupported", "judge-image-disabled"]) {
        const run = await niceeval.run(["exp", experiment, "--rerun", "all", "--json"], {
          env: {
            ...process.env,
            NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            NICEEVAL_E2E_ABSENT_IMAGE_KEY: "",
          },
        });
        expect(run.exitCode, run.diagnostic()).toBe(1);
        const evaluation = only(run.expEvalEvents(), (item) => item.evalId === "judge-image", run.diagnostic());
        expect(evaluation.verdict).toBe("errored");
        const attempt = await inspectAttempt(niceeval, projectRoot, evaluation.locator, "attempt.get");
        const entry = only(attempt.document.attempt.assertions.entries, () => true, attempt.receipt.diagnostic());
        const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator, entry.entryId);
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        expect(assertionEntry(detail.document, detail.receipt.diagnostic()).scoreMatchAudit).toMatchObject({
          state: "available",
          audit: {
            kind: "images",
            calls: [{ state: "rejected", transport: "not-sent", failure: { code: "judge-capability-unavailable" } }],
            result: { state: "unavailable", code: "judge-capability-unavailable" },
          },
        });
      }
      expect(requests).toBe(0);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
