import { defineEval } from "niceeval";
import { sandboxContent } from "niceeval/sandbox";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const downloaded = await mkdtemp(join(tmpdir(), "niceeval-directory-download-"));
    try {
      await t.sandbox.downloadDirectory("archive-target", downloaded, { ignore: ["file-18.bin"] });
      if ((await readFile(join(downloaded, "nested/file-19.bin"))).toString("hex") !== "00ff130a") throw new Error("Downloaded directory bytes changed");
      if (((await stat(join(downloaded, "nested/run.sh"))).mode & 0o777) !== 0o751) throw new Error("Downloaded executable mode changed");
      const ignored = await stat(join(downloaded, "nested/file-18.bin")).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      if (ignored) throw new Error("Directory download did not ignore the requested basename");
    } finally { await rm(downloaded, { recursive: true, force: true }); }
  },
});
