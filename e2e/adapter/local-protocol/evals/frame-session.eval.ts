import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
import { fixtureBaseUrl } from "../src/fixture/address.ts";

export default defineEval({
  description: "An approval resumes the original HTTP stream; abandoned or failed work is closed",
  async test(t) {
    const draft = await t.send("open a stream and wait for approval");
    t.check(draft.status, equals("waiting"));
    t.requireInputRequest({ action: "continue" });
    // This external barrier records the public waiting checkpoint before any resume.
    const checkpoint = await fetch(`${fixtureBaseUrl()}/waiting`, { method: "POST" });
    if (!checkpoint.ok) throw new Error("The waiting callback closed its HTTP stream");
    if (process.env.NICEEVAL_FRAME_SCENARIO === "abandon") return;
    const resumed = await t.respond("approve");
    await resumed.succeeded().orStop();
    t.check(resumed.reply, equals("same-connection-resumed"));
  },
});
