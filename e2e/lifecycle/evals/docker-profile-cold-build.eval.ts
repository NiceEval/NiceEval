import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "profile-bound Dockerfile cold build starts an isolated DinD Attempt",
  async test(t) {
    const turn = await t.send("confirm the profile-bound Attempt started");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("profile-cold-build-ok"));
  },
});
