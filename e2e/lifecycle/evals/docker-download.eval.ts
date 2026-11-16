import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { defineEval } from "niceeval";

export default defineEval({
  async test(t) {
    await t.sandbox.runCommandOrThrow("node", [
      "-e",
      `
      const fs = require("node:fs");
      const root = "/tmp/download-source";
      for (const dir of ["nested/node_modules", "[cache]", "*literal*"]) fs.mkdirSync(root+"/"+dir,{recursive:true});
      fs.writeFileSync(root+"/nested/node_modules/large.bin",Buffer.alloc(8*1024*1024,120));
      fs.writeFileSync(root+"/[cache]/ignored.txt","ignored");
      fs.writeFileSync(root+"/*literal*/ignored.txt","ignored");
      fs.writeFileSync(root+"/cache","keep literal neighbor");
      fs.writeFileSync(root+"/keep.txt","kept 中");
    `,
    ]);
    await writeFile("download-ready", "ready");
    while (!existsSync("download-release")) {
      t.signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await t.sandbox.downloadDirectory("/tmp/download-source", new URL("../download-output/", import.meta.url), {
      ignore: ["node_modules", "[cache]", "*literal*", "download-source"],
    });
    await writeFile("download-done", "done");
    while (!existsSync("download-finish")) {
      t.signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  },
});
