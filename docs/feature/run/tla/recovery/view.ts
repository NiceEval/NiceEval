type RunState = {
  phase: { 1: "active" | "recovering" | "completed" | "interrupted" };
  live: number[];
  pub: { 1: number[] };
  deleted: number[];
  session: "active" | "completed" | "interrupted";
};

const phase = (v: RunState) => v.phase[1];

export const title = "运行结果发布与中断恢复";

export function state(v: RunState) {
  if (v.deleted.length > 0) return "运行已删除";
  switch (phase(v)) {
    case "active":
      if (!v.live.includes(1)) return "原运行已结束，等待恢复";
      if (v.pub[1].length === 0) return "运行中，结果待发布";
      if (v.pub[1].length === 1) return "运行中，一个结果可读";
      return "运行中，全部结果可读";
    case "recovering":
      return "正在恢复";
    case "completed":
      return v.session === "active" ? "运行已完成，会话待收口" : "运行已完成，会话已收口";
    case "interrupted":
      return "运行已中断，会话已收口";
  }
}

export function group(v: RunState) {
  if (v.deleted.length > 0) return "已删除";
  if (phase(v) === "active" && !v.live.includes(1)) return "待恢复";
  return {
    active: "运行",
    recovering: "恢复",
    completed: "已完成",
    interrupted: "已中断",
  }[phase(v)];
}

export const colors = {
  运行: "blue",
  恢复: "purple",
  已完成: "teal",
  已中断: "orange",
  待恢复: "yellow",
  已删除: "tan",
};

const labels: Readonly<Record<string, string>> = {
  Prepare: "准备发布结果",
  Publish: "发布一个结果",
  Replay: "重复或迟到的发布未生效",
  Seal: "准备结束运行",
  Close: "提交运行终态",
  CloseSession: "正常收口会话",
  Crash: "原运行进程退出",
  Fence: "确认原运行已结束，开始恢复",
  RepairSeal: "校验历史结果",
  Finish: "保留结果并记录缺失位置",
  RepairSession: "原进程退出后，恢复会话",
  Delete: "删除终态运行",
  Idle: "等待",
};

export const step = (action: string) => labels[action] ?? null;
