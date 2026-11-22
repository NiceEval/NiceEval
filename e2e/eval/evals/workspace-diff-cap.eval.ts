import { defineEval } from "niceeval";

export default defineEval({
  description: "高基数及大文本 workspace 变化完整保存为可分页读取的 File Changes 证据",
  async test(t) {
    const turn = await t.send("workspace/diff-cap");
    turn.succeeded().label("bulk workspace edit completed");
    t.sandbox.fileChanged("bulk/30000.txt", { status: "added" }).label("last diff change remains a decisive witness");
    t.sandbox
      .notInDiff(/never-present-diff-token/, { content: "both" })
      .label("absence examines the complete evaluation source");
  },
});
