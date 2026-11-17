import { defineEval } from "niceeval";
export default defineEval({
  description: "Cancelling one command preserves the Machine and sibling agent process",
  async test(t) {
    await (await t.send("Exercise command cancellation and timeout")).succeeded().orStop();
  },
});
