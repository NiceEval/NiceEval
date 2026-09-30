import { defineAdapter } from "niceeval";
import { appendFile, readFile, writeFile } from "node:fs/promises";

export const artifactAdapter = defineAdapter({
  name: "artifact-fixture",
  behaviorRevision: "1",
  create(ctx) {
    ctx.onCleanup(async () => {
      if (ctx.flags.mode === "portable") {
        const receipt = await ctx.attach({ name: "cleanup.txt", mediaType: "text/plain", body: "cleanup attachment" });
        await appendFile("artifact-selectors.txt", `\n${receipt.artifactId}`);
      }
    });
    return {
      async produce() {
        const bytes = await readFile("attachment-input.bin");
        const accepted = ctx.attach({ name: "same-label", mediaType: "application/octet-stream", body: bytes });
        bytes.fill(0);
        const first = await accepted;
        const second = await ctx.attach({ name: "same-label", mediaType: "text/plain", body: "附件 snapshot\n" });
        const empty = await ctx.attach({ name: "empty", mediaType: "application/octet-stream", body: new Uint8Array() });
        const ids = [first.artifactId, second.artifactId, empty.artifactId];
        for (let index = 0; index < 12; index += 1) {
          const extra = await ctx.attach({ name: "L".repeat(16 * 1024), mediaType: "application/octet-stream", body: new Uint8Array() });
          ids.push(extra.artifactId);
        }
        await writeFile("artifact-selectors.txt", ids.join("\n"));
        return first.artifactId !== second.artifactId;
      },
      async rejectOverBudget() {
        const bytes = new Uint8Array([1, 2, 3]);
        const accepted = ctx.attach({ name: "retained", mediaType: "application/octet-stream", body: bytes });
        bytes.fill(255);
        const receipt = await accepted;
        // This fixture-owned file conveys only a public attach receipt's selector.
        await writeFile("accepted-artifact-id.txt", receipt.artifactId);
        const mode = ctx.flags.mode;
        if (mode === "count") {
          for (let index = 1; index < 4000; index += 1) {
            await ctx.attach({ name: "same-label", mediaType: "application/octet-stream", body: new Uint8Array() });
          }
        } else if (mode === "total") {
          const block = new Uint8Array(64 * 1024 * 1024);
          for (let index = 0; index < 3; index += 1) {
            await ctx.attach({ name: "block", mediaType: "application/octet-stream", body: block });
          }
          await ctx.attach({ name: "last-block", mediaType: "application/octet-stream", body: block.subarray(3) });
        }
        try {
          await ctx.attach({
            name: mode === "invalid" ? "invalid\u0000label" : "rejected",
            mediaType: "application/octet-stream",
            body: mode === "item" ? new Uint8Array(64 * 1024 * 1024 + 1) : new Uint8Array([1]),
          });
          return false;
        } catch (cause) {
          await writeFile("attachment-rejection.txt", cause instanceof Error ? String(Reflect.get(cause, "code")) : "non-error");
          return true;
        }
      },
    };
  },
});
