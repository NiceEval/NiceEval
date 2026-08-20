import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
export default defineEval({ description: "orStop beta", async test(t) { await t.check("a", equals("b")).orStop(); } });
