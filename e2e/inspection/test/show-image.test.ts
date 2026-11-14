import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { judgeUsageChatResponse, judgeUsageHttp } from "../fixtures/judge-usage-http.ts";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("show 将已保存的断言图片写入文件且拒绝 JSON 输出", async () => {
  const response = judgeUsageChatResponse({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
  response.choices[0]!.message.tool_calls[0]!.function.arguments = JSON.stringify({
    measurement: 1,
    rationale: "Visible screenshot.",
  });
  const fixture = judgeUsageHttp([{ status: 200, body: response }]);
  try {
    const url = await fixture.listen();
    await inspectionE2E.case(
      "show-image",
      {
        artifacts: [
          { source: ".niceeval", target: ".niceeval", optional: true },
          { source: "image-detail.json", target: "image-detail.json", optional: true },
        ],
      },
      async ({ commands: { niceeval }, paths: { projectRoot } }) => {
        const run = await niceeval.run(["exp", "show-image", "--json"], {
          env: { NICEEVAL_E2E_JUDGE_USAGE_URL: url, NICEEVAL_E2E_IMAGE_KEY: "fixture-image-key" },
        });
        expect(run.exitCode, run.diagnostic()).toBe(0);
        const event = only(run.expEvalEvents(), (item) => item.evalId === "show-image");
        const overview = await niceeval.run(["show", event.locator, "--json"]);
        const entry = only(
          overview.inspectionSuccess("attempt.get").attempt.assertions.entries,
          (item) => item.display.label === "Screenshot",
        );
        const detail = await niceeval.run(["show", event.locator, "--full", "--json", entry.entryId]);
        await writeFile(join(projectRoot, "image-detail.json"), detail.stdout);
        const value = detail.inspectionSuccess("attempt.assertion.detail").assertion;
        if (
          !("entry" in value) ||
          value.entry.scoreMatchAudit?.state !== "available" ||
          value.entry.scoreMatchAudit.audit.kind !== "images"
        )
          throw new Error(detail.diagnostic());
        const image = only(value.entry.scoreMatchAudit.audit.images, () => true);
        const output = join(projectRoot, "screenshot.png");
        const saved = await niceeval.run([
          "show",
          event.locator,
          "--output",
          output,
          entry.entryId,
          "image",
          image.imageId,
        ]);
        expect(saved.exitCode, saved.diagnostic()).toBe(0);
        expect((await readFile(output)).byteLength).toBe(image.byteLength);
        expect((await readFile(output)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const rejected = await niceeval.run([
          "show",
          event.locator,
          "--output",
          output,
          "--json",
          entry.entryId,
          "image",
          image.imageId,
        ]);
        expect(rejected.exitCode).toBe(1);
        expect(rejected.stdout).toBe("");
      },
    );
  } finally {
    expect(await fixture.close()).toEqual({ listening: false, openConnections: 0 });
  }
});
