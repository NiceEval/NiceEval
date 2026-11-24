type Snapshot = {
  readonly row: "preparing" | "ready" | "deleting" | "claimed" | "deleted";
  readonly lease: "producer" | "expired" | "waiter";
  readonly remoteReady: boolean;
  readonly runHold: boolean;
  readonly producerHold: boolean;
  readonly sandboxHold: boolean;
  readonly instance: "none" | "creating" | "live" | "unconfirmed" | "deleted";
};

export const title = "谁能发布和删除快照";
export const colors = { 准备: "blue", 可用: "teal", 保护: "purple", 回收: "orange", 结束: "teal" };

export function group(v: Snapshot): keyof typeof colors {
  if (v.row === "preparing") return "准备";
  if (v.row === "ready") return "可用";
  if (v.row === "deleted") return "结束";
  if (v.sandboxHold || v.runHold || v.producerHold) return "保护";
  return "回收";
}

export function state(v: Snapshot): string {
  switch (v.row) {
    case "preparing":
      if (v.lease === "expired") return "原运行的发布权已过期";
      if (v.lease === "waiter") return "另一轮运行接手准备";
      return "原运行准备快照";
    case "ready":
      if (v.instance === "creating" || v.instance === "live") return "快照可用，实例受保护";
      if (v.instance === "unconfirmed") return "快照可用，实例删除未确认";
      return "快照已发布，可以命中";
    case "deleting":
      if (v.instance === "unconfirmed")
        return v.sandboxHold ? "旧快照保留，实例删除未确认" : "旧快照失去仍需的保护";
      if (v.sandboxHold || v.runHold || v.producerHold) return "旧快照仍受保护";
      return "旧快照等待回收";
    case "claimed":
      return v.instance === "unconfirmed" ? "回收已开始，实例删除未确认" : "旧快照开始回收";
    case "deleted":
      return v.instance === "unconfirmed" ? "快照已删除，实例删除未确认" : "旧快照已删除";
  }
}

const labels: Readonly<Record<string, string>> = {
  ProviderReady: "远端快照已可用",
  InstanceStarts: "实例启动",
  Expire: "原运行暂停至发布权过期",
  TakeOver: "等候的运行接手",
  ProducerPublishes: "发布并保留给本轮运行",
  WaiterPublishes: "找到远端快照，发布并保留给本轮运行",
  Handoff: "为实例保留快照",
  ReleaseProducerHold: "本轮不再等候派发",
  ReleaseRunHold: "本轮不再等候派发",
  Retire: "旧快照退出缓存",
  InstanceDeleteFails: "删除实例失败",
  RecloseFailedInstance: "再次收尾时提前解除保护",
  ConfirmInstanceDeleted: "确认实例已删除",
  ClaimDelete: "领取回收",
  DeleteSnapshot: "远端确认快照已删除",
};

export function step(action: string, from: Snapshot): string | null {
  if (action === "Publish") return from.lease === "waiter" ? labels.WaiterPublishes! : labels.ProducerPublishes!;
  return labels[action] ?? null;
}
