import { defineExperiment } from "niceeval";
import agent from "../../agents/codex-sdk.ts";

// compare-sandbox 组的一格:read-only。判读要点:这个变体下 create-file 这类要写盘的
// eval **预期变红**——沙箱拦下写操作正是这个 flag 的行为差异,A/B 对照要看的就是
// "同一批 eval 在哪个变体下红"。基础问答、跑只读命令不受影响。
export default defineExperiment({
  description: "read-only: 只读沙箱(写盘类 eval 预期失败)",
  agent,
  flags: { sandboxMode: "read-only" },
  attempts: 1,
});
