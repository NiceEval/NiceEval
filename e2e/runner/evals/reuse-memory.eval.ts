import { defineEval } from "niceeval";

export default defineEval({
  async test(t) {
    const checkpoint = "/tmp/niceeval-intentional-memory";
    const previous = (await t.sandbox.pathExists(checkpoint)) ? Number(await t.sandbox.readText(checkpoint)) : 0;
    await t.sandbox.writeText(checkpoint, String(previous + 1));
    if (previous > 0) throw new Error("Intentional memory fixture failure");
  },
});
