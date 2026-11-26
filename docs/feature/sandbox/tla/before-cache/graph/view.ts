type Phase = "unclaimed" | "lookup" | "parent" | "defer" | "gate" | "working" | "waitChild" | "retired";
type Outcome = "pending" | "hit" | "prepared" | "degraded" | "failed";
type GraphState = {
  readonly phase: Readonly<Record<number, Phase>>;
  readonly result: Readonly<Record<number, Outcome>>;
  readonly waiting: Readonly<Record<number, number>>;
};

export const title = "共享准备与配对放行";
export const colors = { 查找: "blue", 准备: "orange", 结算: "teal", 停滞: "pink" };

function stalled(v: GraphState): boolean {
  return v.phase[1] === "waitChild" && v.phase[v.waiting[1]] === "unclaimed" && v.phase[4] === "gate";
}

export function group(v: GraphState): keyof typeof colors {
  if (stalled(v)) return "停滞";
  if (v.result[3] !== "pending" && v.result[4] !== "pending") return "结算";
  if (Object.values(v.phase).some((phase) => ["gate", "working", "waitChild"].includes(phase))) return "准备";
  return "查找";
}

export function state(v: GraphState): string {
  if (stalled(v)) return "冷分支等额度，共同前缀等无人准备的中间层";
  if (v.result[3] !== "pending" && v.result[4] !== "pending") return "两个配对均已放行或明确失败";
  if (v.phase[1] === "waitChild") {
    return v.phase[v.waiting[1]] === "unclaimed"
      ? "共同前缀把准备实例留给无人准备的中间层"
      : "共同前缀把准备实例交给等候的子层";
  }
  if (v.phase[1] === "working") return "共同前缀占用准备额度";
  if (v.phase[1] === "gate") return "共同前缀可开始准备";
  if (v.phase[1] === "parent") return "共同前缀也未命中";
  if (v.phase[1] === "lookup") return "查找共同前缀";
  if (v.result[3] === "hit") {
    return v.phase[4] === "parent" ? "深分支已就绪，冷分支需要共同前缀" : "深分支已就绪，冷分支继续准备";
  }
  if (v.phase[4] === "parent") {
    return v.result[3] === "failed" ? "深分支已失败，冷分支需要共同前缀" : "冷分支需要共同前缀，深分支仍在查找";
  }
  if (v.result[3] !== "pending" || v.result[4] !== "pending") return "一个配对已结算，另一配对继续准备";
  return "两个配对查找前缀";
}

export function step(action: string, from: GraphState, to: GraphState): string {
  switch (action) {
    case "Lookup":
      if (to.result[3] === "hit" && from.result[3] !== "hit") return "深分支命中，配对可开始";
      if (to.result[3] === "failed" && from.result[3] !== "failed") return "深分支查找失败";
      if (to.phase[4] === "parent" && from.phase[4] !== "parent") return "冷分支未命中";
      if (to.phase[1] === "parent" && from.phase[1] !== "parent") return "共同前缀未命中";
      return "查找返回结果";
    case "Demand":
      return "请求准备上一层";
    case "Ready":
      return stalled(to) ? "冷分支等唯一的准备额度" : "依赖已结算";
    case "Start":
      return "开始准备";
    case "Settle":
      return to.phase[1] === "waitChild" && from.phase[1] !== "waitChild"
        ? "发布共同前缀并留下准备实例"
        : "完成这一层准备";
    case "Release":
      return "子层结束，归还准备额度";
    case "End":
      return "本轮准备结束";
    default:
      throw new Error(`Unknown graph action: ${action}`);
  }
}
