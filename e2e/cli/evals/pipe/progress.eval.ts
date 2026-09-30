import { existsSync } from "node:fs";
import { defineEval } from "niceeval";

export default defineEval({
  description: "pipe/progress:非 TTY 的有归属、合并与去重进度",
  async test(t) {
    for (let index = 0; index < 50; index++) {
      t.progress({ message: "pipe-progress-ready" });
    }
    while (!existsSync("pipe-progress-release")) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    for (let index = 0; index < 100; index++) {
      t.progress({ message: `pipe-progress-burst-${index}` });
    }
    while (!existsSync("pipe-progress-finish")) {
      t.progress({ message: "pipe-progress-latest" });
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  },
});
