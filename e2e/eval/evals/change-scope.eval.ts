import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  diff: { ignore: ["ignored.txt"] },
  async test(t) {
    for (const paths of [[], ["secrets/**"], ["secrets/?"]]) {
      let rejected = false;
      try {
        t.sandbox.changedOnlyWithin(paths as never);
      } catch (error) {
        rejected = error instanceof TypeError;
      }
      if (!rejected) throw new Error(`Expected construction TypeError: ${JSON.stringify(paths)}`);
    }
    await t.send("change");
    t.sandbox.changedOnlyWithin(["agents", "single.ts", "agents-old"]).label("allowed subtrees");
    t.sandbox.changedOnlyWithin(["agents", "single.ts"]).label("component boundary");
    t.sandbox.changedPaths(["agents/a.ts", "single.ts", "agents-old/outside.ts"]).label("legacy exact set");
    // A later stop barrier must not settle the post-run entries above before the diff is frozen.
    await t.check("ready", equals("ready")).label("later stop barrier").orStop();
  },
});
