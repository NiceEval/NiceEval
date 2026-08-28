import { defineEval } from "niceeval";

export default defineEval({
  description: "Agent without setup still sends and tears down",
  async test(t) {
    const turn = await t.send("no setup");
    await turn.succeeded().orStop();
  },
});
