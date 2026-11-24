const states = {
  search: ["查找最深可用前缀", "查找"],
  probe: ["检查下一层是否已经可用", "查找"],
  recover: ["先创建一份干净的 Base", "回退"],
  replay: ["直接执行剩余 action", "回退"],
  action: ["执行当前 action", "准备"],
  capture: ["当前 action 已成功，尝试保存", "准备"],
  done: ["before 已完成", "完成"],
  failed: ["Attempt 失败", "失败"],
} as const;

type AttemptState = {
  readonly phase: keyof typeof states;
};

export const title = "前缀无法恢复时继续执行";
export const colors = { 查找: "blue", 回退: "orange", 准备: "purple", 完成: "teal", 失败: "pink" };

export const state = (v: AttemptState): string => states[v.phase][0];
export const group = (v: AttemptState): string => states[v.phase][1];

export function step(action: string, _from: AttemptState, to: AttemptState): string {
  switch (action) {
    case "Search":
    case "Probe":
      if (to.phase === "recover") return "恢复失败，尚未执行 action";
      if (to.phase === "failed") return "无法证实已执行的 action 状态";
      if (to.phase === "replay") return "缓存不可用，继续执行";
      if (to.phase === "done") return "命中最后一层";
      if (to.phase === "action") return "未命中，执行这一层";
      return "继续查找";
    case "Action":
      return "action 执行成功";
    case "Capture":
      if (to.phase === "failed") return "无法证实当前实例完整";
      if (to.phase === "replay") return "保存失败，当前实例仍完整";
      return "保存结果已结算";
    case "Recover":
      return to.phase === "failed" ? "无法创建干净实例" : "干净实例已就绪";
    case "End":
      return "结束";
    default:
      throw new Error(`Unknown replay action: ${action}`);
  }
}
