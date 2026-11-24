type JournalState = {
  readonly state: "idle" | "append" | "ack" | "failed" | "down" | "recovered" | "closed";
  readonly record: "old" | "full" | "part";
  readonly acknowledged: boolean;
};

export const title = "Docker Profile 日志确认与恢复";
export const colors = { 写入: "blue", 已确认: "teal", 恢复: "orange", 拒绝: "pink" };

export function group(v: JournalState): keyof typeof colors {
  if (v.state === "down") return "恢复";
  if (v.state === "closed" || v.state === "failed") return "拒绝";
  if (v.state === "ack" || v.state === "recovered") return "已确认";
  return "写入";
}

export function state(v: JournalState): string {
  switch (v.state) {
    case "idle":
      return "等待写入新记录";
    case "append":
      return v.record === "part" ? "只写入了部分记录" : "完整记录已写入，等待确认";
    case "ack":
      return v.record === "part" ? "部分记录已被误确认" : "完整记录已确认";
    case "failed":
      return "写入失败，保留原记录";
    case "down":
      return v.record === "part" ? "宿主中断，留下不完整记录" : "宿主中断，日志仍完整";
    case "recovered":
      return v.acknowledged ? "已确认的记录可恢复" : "恢复完整日志，开放准入";
    case "closed":
      return "末条记录不完整，拒绝准入";
  }
}

const labels: Readonly<Record<string, string>> = {
  Write: "写入新记录",
  Complete: "继续写完剩余字节",
  Sync: "同步并回复成功",
  Rollback: "撤回本次写入",
  Crash: "宿主进程中断",
  Read: "重新读取日志",
  End: "恢复已结算",
};

export function step(action: string): string {
  return labels[action] ?? action;
}
