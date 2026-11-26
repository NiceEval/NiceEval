type ReservationState = {
  readonly state: Readonly<Record<number, "fresh" | "prepared" | "published" | "scrubbed">>;
  readonly released: readonly number[];
};

export const title = "释放预约只清理这一份准备";
export const colors = { 等待: "blue", 准备: "purple", 留存: "teal", 清理: "orange", 异常: "pink" };

export function group(v: ReservationState): keyof typeof colors {
  if (Object.entries(v.state).some(([id, phase]) => phase === "scrubbed" && !v.released.includes(Number(id)))) {
    return "异常";
  }
  const phases = Object.values(v.state);
  if (phases.includes("scrubbed")) return "清理";
  if (phases.includes("published")) return "留存";
  return phases.includes("prepared") ? "准备" : "等待";
}

export function state(v: ReservationState): string {
  const phases = Object.values(v.state);
  const prepared = phases.filter((phase) => phase === "prepared").length;
  if (group(v) === "异常") return "仍有效的准备也被清除了";
  if (prepared === 2) return "两份准备均可发布";
  if (prepared === 1) {
    if (phases.includes("scrubbed")) return "释放了一份，另一份仍可发布";
    if (phases.includes("published")) return "一份已发布，另一份仍可发布";
    return "一份准备可发布";
  }
  if (phases.includes("published")) return phases.includes("fresh") ? "一份已发布" : "发布结果已保留";
  if (phases.includes("scrubbed")) return phases.includes("fresh") ? "一份已释放并清除" : "两份均已释放并清除";
  return "等待准备";
}

const labels: Readonly<Record<string, string>> = {
  Prepare: "验证一份待发布制品",
  Release: "释放一份预约并清除其副本",
  Publish: "发布一份已验证制品",
  End: "没有新请求",
};

export function step(action: string): string {
  return labels[action] ?? action;
}
