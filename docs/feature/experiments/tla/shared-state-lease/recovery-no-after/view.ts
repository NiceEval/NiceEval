type ModelState = {
  readonly phase: "active" | "recovering" | "free";
  readonly live: boolean;
  readonly run: "active" | "recovering" | "interrupted";
};

export const title = "无 after 登记的纯自动 State 集合在原 Run 关闭后释放";

export function state({ phase, live, run }: ModelState) {
  if (phase === "free") return "整组租约已释放";
  if (phase === "active") return "原进程已停止，等待恢复";
  if (run === "interrupted") return live ? "原 Run 已关闭，等整组释放" : "原 Run 已关闭，等待重新接手";
  if (!live) return "恢复中断，原 Run 尚未关闭";
  return run === "active" ? "已接手，等待确认原 Run" : "正在收尾原 Run";
}

export function step(action: string, from: ModelState) {
  switch (action) {
    case "Claim":
      return from.phase === "active" ? "确认原进程已停止，接手整组租约" : "确认上次恢复已停止，重新接手整组租约";
    case "RunFence":
      return "禁止原进程继续写入 Run";
    case "RunClose":
      return "将原 Run 标记为已中断";
    case "Crash":
      return "恢复进程中断";
    case "Free":
      return "一次释放整组租约";
    case "Done":
      return "确认整组已释放";
    default:
      throw new Error(`Unknown recovery action without after: ${action}`);
  }
}

export function group({ phase, live, run }: ModelState) {
  if (phase === "free") return "完成";
  if (!live) return "等待";
  return run === "interrupted" ? "释放" : "收尾";
}

export const colors = { 等待: "yellow", 收尾: "blue", 释放: "orange", 完成: "teal" };
