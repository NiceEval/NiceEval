import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    await t.send("exercise cleanup");
  },
});
