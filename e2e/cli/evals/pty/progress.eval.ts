import { defineEval } from "niceeval";
import { pattern } from "niceeval/expect";

const USER_SENTINEL = "pty-user-progress-sentinel";

/** The Agent holds this send open so Runner-owned user detail remains observable live. */
export default defineEval({
  description: "pty/progress:真实 TTY 中可见 Runner 投影的 user sentinel",
  async test(t) {
    const turn = await t.send(`${USER_SENTINEL}: Reply with exactly this sentence and nothing else: Hello, niceeval!`);
    await turn.succeeded().orStop();
    t.check(turn.message, pattern(/Hello/i));
  },
});
