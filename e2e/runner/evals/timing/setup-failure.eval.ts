import { defineEval } from "niceeval";

export default defineEval({
  description: "setup failure prevents the Eval body",
  test() {
    throw new Error("setup failure fixture unexpectedly reached the Eval body");
  },
});
