import { writeFile } from "node:fs/promises";
import { defineEval } from "niceeval";

export default defineEval({
  async test() {
    await writeFile("interrupt-feedback-ready", "ready");
    await new Promise<void>(() => {});
  },
});
