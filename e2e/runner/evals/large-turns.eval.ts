import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    await (await t.send("first turn")).succeeded().orStop();
    await (await t.send("second turn")).succeeded().orStop();
  },
});
