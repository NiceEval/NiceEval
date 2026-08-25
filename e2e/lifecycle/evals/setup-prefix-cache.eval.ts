import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

// The lifecycle owner rewrites this literal in its private project copy between
// independent CLI Invocations. The Sandbox before inputs remain unchanged.
const DEMAND = "v1";

export default defineEval({
  description: "SetupPrefix restores preparation while the current Eval still runs",
  async test(t) {
    const turn = await t.send(`setup-prefix-demand:${DEMAND}`);
    await turn.succeeded().orStop();
    t.check(turn.message, includes(`setup-prefix-demand:${DEMAND}`));
    t.check(turn.message, includes("setup-prefix-evidence:"));
  },
});
