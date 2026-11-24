type RunState = {
  phase: { 1: "active" | "recovering" | "completed" | "interrupted" };
  live: number[];
  sealed: number[];
  deleted: number[];
  session: "active" | "completed" | "interrupted";
};

const ownerAlive = (v: RunState) => v.live.includes(1);
const hasRun = (v: RunState) => v.deleted.length === 0;

export const title = "保留最后一个会话恢复入口";

export function state(v: RunState) {
  if (v.session !== "active") {
    return hasRun(v) ? "运行与会话均已收口" : "会话已收口，运行已删除";
  }
  if (!hasRun(v)) {
    return ownerAlive(v) ? "最后一个运行已删除，会话未收口" : "原命令已结束，会话无法恢复";
  }
  if (v.phase[1] === "completed") {
    return ownerAlive(v) ? "运行已完成，会话仍在进行" : "运行已完成，遗留会话可恢复";
  }
  if (v.phase[1] === "recovering") return "正在恢复";
  if (!ownerAlive(v)) return "原运行已结束，等待恢复";
  return v.sealed.length === 0 ? "运行中，会话尚未收口" : "运行准备收口，会话尚未收口";
}

export function group(v: RunState) {
  if (v.session !== "active") return hasRun(v) ? "已收口" : "已删除";
  if (!ownerAlive(v)) return "恢复";
  return "运行";
}

export const colors = { 运行: "blue", 恢复: "purple", 已收口: "teal", 已删除: "tan" };

const labels: Readonly<Record<string, string>> = {
  Seal: "准备结束运行",
  Close: "提交运行终态",
  CloseSession: "正常收口会话",
  Crash: "原命令退出",
  Fence: "确认原运行已结束，开始恢复",
  RepairSeal: "校验历史结果",
  Finish: "收口运行与会话",
  RepairSession: "恢复遗留会话",
  Delete: "删除最后一个运行",
  Idle: "等待",
};

export const step = (action: string) => labels[action] ?? null;
