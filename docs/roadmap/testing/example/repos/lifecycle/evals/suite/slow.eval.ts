import { defineEval } from "niceeval";

export default defineEval({
  description: "慢速 eval：跑在拥有 backend 的实验里，等待 SIGINT",
  async test(t) {
    await t.send("保持运行，直到测试发送 SIGINT");
    t.succeeded();
  },
});
