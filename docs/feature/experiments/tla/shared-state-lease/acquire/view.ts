type ModelState = {
  readonly pc: Readonly<Record<string, "waiting" | "held" | "done">>;
};

export const title = "等齐所需状态后一次取得整组租约";

export function state({ pc }: ModelState) {
  const requests = Object.values(pc);
  const waiting = requests.filter((request) => request === "waiting").length;
  if (waiting === 0) {
    return requests.includes("held") ? "最后一个 Experiment 持有整组租约" : "全部 Experiment 已释放租约";
  }
  return requests.includes("held")
    ? `一个 Experiment 持有整组租约，${waiting} 个等待`
    : `${waiting} 个 Experiment 等齐所需状态`;
}

export function step(action: string) {
  switch (action) {
    case "Acquire":
      return "所需状态均空闲，一次取得整组租约";
    case "Release":
      return "本次工作结束，一次释放整组租约";
    case "LateWrite":
      return "旧持有者的迟到更新被拒绝";
    case "Done":
      return "所有请求已结束";
    default:
      throw new Error(`Unknown lease action: ${action}`);
  }
}

export function group({ pc }: ModelState) {
  const requests = Object.values(pc);
  if (requests.includes("held")) return "持有";
  return requests.includes("waiting") ? "等待" : "完成";
}

export const colors = { 持有: "blue", 等待: "yellow", 完成: "teal" };
