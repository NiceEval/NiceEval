import { defineScoreEval } from "niceeval";
export default defineScoreEval({
  async test(t) {
    await t.sandbox.writeText("small.txt", "before\n");
    await t.sandbox.writeText("large.txt", "旧".repeat(10000) + "\n");
    await t.sandbox.writeBytes("binary.txt", new Uint8Array([0, 1, 2, 3]));
    await t.send("change files");
    t.score(1);
  },
});
