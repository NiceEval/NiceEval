import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

// Deterministic evidence fixture: this Report Repo owns the result states it reads
// back; it does not require a provider, network, or secret.
export default defineEval({
  description: "tool-call:签入确定性 Agent 生成可读的通过证据",

  async test(t) {
    const turn = await t.send("report fixture");
    await turn.succeeded().orStop();
    t.check("fixture", equals("fixture"));
  },
});
