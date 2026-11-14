import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    await (await t.send("emit trace")).succeeded().orStop();
  },
});
