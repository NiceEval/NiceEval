import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { readFixture, sharedNote } from "./read-fixture.ts";

const fixture = await readFixture(new URL("./fixtures/beta.txt", import.meta.url));

export default defineEval({
  description: "helper loader beta",
  async test(t) {
    const turn = await t.send(`${fixture.trim()} ${sharedNote.trim()}`);
    await turn.succeeded().orStop();
    t.check(turn.reply, includes("runner-fixture-ok"));
  },
});
