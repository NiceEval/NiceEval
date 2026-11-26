type Snapshot = {
  readonly oldRow: "preparing" | "deleting" | "deleted";
  readonly provider: "unrequested" | "may-arrive" | "pending" | "ready" | "absent" | "deleted";
  readonly window: "open" | "ended";
  readonly gc: "idle" | "early-empty" | "settled-empty" | "pending" | "found" | "deleted";
  readonly absentAfterSettle: boolean;
};

export const title = "结果不明的快照仍可按名称回收";
export const colors = { 准备: "blue", 等待: "yellow", 回收: "orange", 结束: "teal" };

export function group(v: Snapshot): keyof typeof colors {
  if (v.oldRow === "preparing") return "准备";
  if (v.oldRow === "deleted") return "结束";
  return v.gc === "idle" ? "等待" : "回收";
}

export function state(v: Snapshot): string {
  if (v.oldRow === "preparing") return v.provider === "unrequested" ? "等待发出创建请求" : "已登记创建请求";
  if (v.oldRow === "deleted") {
    if (v.provider === "deleted") return "已确认快照删除";
    return v.absentAfterSettle ? "期限后查不到，结算回收" : "凭期限内的空结果结算";
  }
  if (v.gc === "early-empty")
    return v.window === "open" ? "期限内查不到，仍可能出现" : "期限已过，手上仍只有早前的空结果";
  if (v.gc === "settled-empty") return "期限后查不到";
  if (v.gc === "pending") return "按名称查到快照还在创建";
  if (v.gc === "found") return "已按名称找到快照";
  if (v.gc === "deleted") return "远端已删除，等待确认";
  if (v.provider === "ready") return "保留登记，快照已出现";
  if (v.window === "ended") return "保留登记，等待期限后查询";
  return "结果不明，保留登记";
}

const labels: Readonly<Record<string, string>> = {
  RecordAndSend: "先登记，再发出请求",
  RetireUnknown: "创建答复不明，交给回收",
  LateReady: "快照稍后出现在远端",
  WindowEnds: "等待期限到达",
  ClaimAndQuery: "领取回收并按名称查询",
  AcceptAbsent: "使用这次查询结果结算",
  ReleaseClaim: "继续保留登记，留待下一轮回收",
  DeleteFound: "删除找到的快照",
  SettleDelete: "记录远端删除结果",
};

export function step(action: string): string | null {
  return labels[action] ?? null;
}
