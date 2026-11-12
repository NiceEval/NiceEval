import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    await t.send("noop");
    t.sandbox.changedOnlyWithin(["agents"]).label("zero changes allowed");
    t.sandbox.changedPaths(["agents/a.ts"]).label("legacy exact requires change");
    t.sandbox.noChanges().label("legacy no changes");
  },
});
