import { defineEval } from "niceeval";
export default defineEval({
  diff: { ignore: ["ignored.txt"] },
  async test(t) {
    for (const paths of [[], ["secrets/**"], ["secrets/?"]]) {
      let rejected = false;
      try {
        t.sandbox.unchangedWithin(paths as never);
      } catch (error) {
        rejected = error instanceof TypeError;
      }
      if (!rejected) throw new Error(`Expected construction TypeError: ${JSON.stringify(paths)}`);
    }
    t.sandbox.unchangedWithin(["agents"]).label("protected subtree").optional();
    t.sandbox.unchangedWithin(["single.ts"]).label("protected file").optional();
    t.sandbox.unchangedWithin(["agent", "agents/a", "ignored.txt"]).label("component boundary and ignored");
    await t.sandbox.runShellOrThrow("rm -f agents/a.ts single.ts agents-old/outside.ts ignored.txt");
    await t.send("change");
  },
});
