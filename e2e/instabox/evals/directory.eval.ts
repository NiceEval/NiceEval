import { defineEval } from "niceeval";
import { sandboxContent } from "niceeval/sandbox";
export default defineEval({
  description: "A directory arrives in one archive with its captured permission bits",
  async test(t) {
    const directory = sandboxContent.directory(new URL("../fixtures/tree/", import.meta.url));
    await t.sandbox.runCommandOrThrow("true", ["directory-upload-start"]);
    const startedAt = performance.now();
    await t.sandbox.upload(directory, "archive-target");
    const elapsed = performance.now() - startedAt;
    await t.sandbox.runCommandOrThrow("true", ["directory-upload-end", String(Math.round(elapsed))]);
    const mode = await t.sandbox.runCommandOrThrow("stat", ["-c", "%a", "archive-target/nested/run.sh"]);
    if (mode.stdout.trim() !== "751") throw new Error(`Executable mode was not preserved: ${mode.stdout}`);
    const data = await t.sandbox.readBytes("archive-target/nested/file-19.bin");
    if (Buffer.from(data).toString("hex") !== "00ff130a") throw new Error("Directory bytes changed");
  },
});
