type WriterState = {
  ownerDead: boolean;
  authority: Record<string, "original" | "recovering" | "closed">;
  rpc: Record<string, "queued" | "staged" | "done">;
  publication: number[];
};

export const title = "恢复期间处理迟到的结果发布";

export function group(v: WriterState) {
  if (!v.ownerDead) return "运行";
  const runs = Object.values(v.authority);
  if (runs.every((status) => status === "original")) return "待恢复";
  if (runs.every((status) => status === "closed")) return "已中断";
  return "恢复";
}

export const colors = { 运行: "blue", 待恢复: "yellow", 恢复: "purple", 已中断: "teal" };

export function state(v: WriterState) {
  const phase = group(v);
  switch (phase) {
    case "运行":
      return v.publication.length === 0 ? "原运行仍在进行" : "原运行仍在进行，已有结果可读";
    case "待恢复":
      return v.publication.length === 0 ? "原运行已确认结束" : "原运行已确认结束，已有结果可读";
    case "恢复":
    case "已中断": {
      const closed = phase === "已中断" ? "运行已中断" : "正在恢复";
      const pending = Object.entries(v.authority).some(([id, status]) => status !== "original" && v.rpc[id] !== "done");
      return pending ? `${closed}，仍有迟到请求` : closed;
    }
  }
}

export function step(action: string, from: WriterState, to: WriterState) {
  switch (action) {
    case "Stage":
    case "Commit":
      if (to.publication.length > from.publication.length) return "发布先提交的结果";
      if (Object.entries(to.rpc).some(([id, status]) => status === "done" && from.rpc[id] !== "done")) {
        return "拒绝迟到的发布";
      }
      return "准备发布结果";
    case "Crash":
      return "原运行进程退出并得到确认";
    case "Fence":
      return "开始恢复一个运行";
    case "Close":
      return "提交一个运行的中断状态";
    case "Done":
      return "等待";
    default:
      return null;
  }
}
