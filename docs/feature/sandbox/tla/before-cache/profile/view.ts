type ProfileState = {
  readonly pc: Readonly<Record<number, string>>;
  readonly published: Readonly<Record<number, number>>;
  readonly live: boolean;
};

export const title = "Docker Profile 发布完整制品";
export const colors = { 准备: "blue", 发布: "teal", 恢复: "orange", 异常: "pink" };

export function group(v: ProfileState): keyof typeof colors {
  if (Object.values(v.pc).includes("falseUnknown")) return "异常";
  if (!v.live) return "恢复";
  if (Object.values(v.published).some((owner) => owner !== 0)) return "发布";
  return "准备";
}

export function state(v: ProfileState): string {
  const actors = Object.values(v.pc);
  switch (group(v)) {
    case "异常":
      return "已知制品已发布，另一方却收到结果未知";
    case "恢复":
      return "宿主进程中断，等待恢复";
    case "发布":
      if (actors.includes("lost")) return "制品已发布，等待确认回执";
      if (actors.includes("winner")) return "两方取得同一份已验证制品";
      return "已验证的制品可以恢复";
    case "准备":
      if (actors.includes("prepared")) return "候选制品验证完成";
      if (actors.some((phase) => ["intent", "copy", "verified"].includes(phase))) return "正在复制或验证制品";
      return "等待准备制品";
  }
}

const labels: Readonly<Record<string, string>> = {
  Begin: "开始准备制品",
  Copy: "复制并验证候选制品",
  Publish: "提交已验证的制品",
  WaitReply: "确认提交结果",
  Conflict: "另一方已发布同内容的制品",
  Fail: "清理未完成的复制",
  Expire: "租约到期",
  Crash: "宿主进程中断",
  Recover: "宿主恢复持久登记",
  Idle: "没有新请求",
};

export function step(action: string): string {
  return labels[action] ?? action;
}
