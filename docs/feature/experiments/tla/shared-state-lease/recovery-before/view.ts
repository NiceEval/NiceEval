type ModelState = {
  readonly phase: "active" | "recovering" | "free";
  readonly live: boolean;
  readonly after: "pending" | "running" | "completed";
  readonly gen: number;
  readonly lastCallGen: number;
};

export const title = "旧恢复顺序会在原 Run 仍显示运行中时执行 after";

export function state({ phase, live, after, gen, lastCallGen }: ModelState) {
  if (phase === "free") return "整组租约已释放，原 Run 仍显示运行中";
  if (phase === "active") return "原进程已停止，等待恢复";
  if (after === "completed") {
    return live ? "after 已确认，原 Run 仍显示运行中" : "after 已确认，等新进程接手";
  }
  if (after === "running") {
    if (!live) return "恢复中断，after 尚未确认";
    return lastCallGen === gen ? "after 已启动，原 Run 仍显示运行中" : "已重新接手，等待重试 after";
  }
  return live ? "已接手租约，原 Run 仍显示运行中" : "恢复中断，等待重新接手";
}

export function step(action: string, from: ModelState) {
  switch (action) {
    case "Claim":
      return from.phase === "active" ? "确认原进程已停止，接手整组租约" : "确认上次恢复已停止，重新接手整组租约";
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
      throw new Error(`Unknown historical recovery action: ${action}`);
  }
}

export function group({ phase, live }: ModelState) {
  if (phase === "free") return "完成";
  return live ? "恢复" : "等待";
}

export const colors = { 等待: "yellow", 恢复: "blue", 完成: "teal" };
