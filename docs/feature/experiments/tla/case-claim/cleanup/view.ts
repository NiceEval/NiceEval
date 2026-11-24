type ModelState = {
  readonly key: Readonly<Record<number, number>>;
  readonly pc: Readonly<Record<number, string>>;
  readonly row: Readonly<Record<number, number>>;
};

export const title = "另一条恢复先释放用例";

export function state({ key, pc, row }: ModelState) {
  const owner = row[key[1]];
  const sameCase = Object.keys(pc).map(Number).filter((run) => run !== 1 && key[run] === key[1]);
  if (sameCase.length === 0) return "不同用例可独立运行";
  if (pc[1] === "lostrelease") return "释放回复丢失";
  if (pc[1] === "undoAcquire") return "取得回复丢失";
  if (sameCase.every((run) => pc[run] === "done")) return "当前运行已释放用例";
  if (owner !== 0 && owner !== 1) return "当前运行已取得用例";
  if (sameCase.some((run) => pc[run] === "cas")) {
    return owner === 0 ? "恢复已先释放用例" : "已确认前一条运行结束";
  }
  if (owner === 0) return "用例可用";
  if (pc[1] === "dead") return "前一条运行已退出但仍占用用例";
  if (pc[1] === "retry") return "前一条运行正在重试释放";
  if (sameCase.some((run) => pc[run] === "poll")) return "正在等另一条运行";
  return "前一条运行正在使用用例";
}

const steps: Readonly<Record<string, string>> = {
  Acquire: "取得用例",
  Inspect: "查看用例占用",
  Poll: "重新尝试取得用例",
  Take: "接替已结束的运行",
  Cleanup: "恢复中断的运行并释放用例",
  Receipt: "收到取得回复",
  Lost: "取得回复丢失",
  UndoAcquire: "释放未交付的占用",
  Release: "运行结束并释放用例",
  LostRelease: "释放后回复丢失",
  ConfirmRelease: "再次确认已经释放",
  Timeout: "释放超时",
  Crash: "前一条运行退出",
  Late: "拒绝已结束运行的迟到更新",
  ReadAgain: "重新查看用例是否可用",
  RetrySpent: "重试释放",
  Idle: "保持当前状态",
};

export function step(action: string, from: ModelState) {
  if (action === "Take" && from.row[from.key[1]] === 0) return "发现用例已释放后重新申请";
  const label = steps[action];
  if (label === undefined) throw new Error(`Unknown case action: ${action}`);
  return label;
}

export function group(model: ModelState) {
  const label = state(model);
  if (label === "当前运行已释放用例" || label === "用例可用") return "可用";
  if (label.includes("丢失") || label.includes("恢复") || label.includes("结束")) return "恢复";
  if (label.includes("等待") || label.includes("正在等") || label.includes("重试")) return "等待";
  return "运行";
}

export const colors = { 可用: "teal", 恢复: "orange", 等待: "yellow", 运行: "blue" };
