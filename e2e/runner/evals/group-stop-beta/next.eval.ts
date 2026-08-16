import { defineEval } from "niceeval"; export default defineEval({ description: "beta successor", async test(t) { await t.send("beta"); } });
