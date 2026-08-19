import { defineEval } from "niceeval";

export default defineEval({
  description: "Judge endpoint 预检失败时不应进入 Eval body",
  judge: true,
  async test() {
    throw new Error("judge precheck fixture unexpectedly reached the Eval body");
  },
});
