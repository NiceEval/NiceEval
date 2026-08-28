import { defineEval } from "niceeval";

export default defineEval({
  description: "setup failure remains primary when teardown also fails",
  test() {
    throw new Error("setup failure fixture unexpectedly reached the Eval body");
  },
});
