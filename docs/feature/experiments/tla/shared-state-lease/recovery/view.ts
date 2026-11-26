type ModelState = {
  readonly phase: "active" | "recovering" | "free";
  readonly live: boolean;
  readonly run: "active" | "recovering" | "interrupted";
  readonly after: "pending" | "running" | "completed";
  readonly gen: number;
  readonly lastCallGen: number;
};

export const title = "确认原 Run 的结局后执行 after 并释放整组租约";

export function state({ phase, live, run, after, gen, lastCallGen }: ModelState) {
  if (phase === "free") return "整组租约已释放";
  if (phase === "active") return "原进程已停止，等待恢复";

  if (after === "completed") {
    return live ? "after 已确认，等整组释放" : "after 已确认，等新进程接手";
  }
  if (after === "running") {
    if (!live) return "恢复中断，after 尚未确认";
    return lastCallGen === gen ? "after 已启动，结果尚未确认" : "已重新接手，等待重试 after";
  }

  if (!live) {
    return run === "interrupted" ? "原 Run 已关闭，等待重新接手" : "恢复中断，原 Run 尚未关闭";
  }
  if (run === "interrupted") return "原 Run 已关闭，等待执行 after";
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
    case "StartAfter":
      return from.after === "running" ? "重试未确认的 after" : "执行已登记的 after";
    case "FinishAfter":
      return "确认 after 并移除对应登记";
    case "Crash":
      return "恢复进程中断";
    case "Free":
      return "一次释放整组租约";
    case "Done":
      return "确认整组已释放";
    default:
      throw new Error(`Unknown recovery action: ${action}`);
  }
}

export function group({ phase, live, run, after }: ModelState) {
  if (phase === "free") return "完成";
  if (!live) return "等待";
  if (after === "completed") return "释放";
  return run === "interrupted" ? "补偿" : "收尾";
}

export const colors = { 等待: "yellow", 收尾: "blue", 补偿: "purple", 释放: "orange", 完成: "teal" };
