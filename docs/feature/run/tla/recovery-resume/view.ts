type RunPhase = "active" | "recovering" | "completed" | "interrupted";

type RunState = {
  phase: Record<string, RunPhase>;
  live: number[];
  actor: Record<string, number>;
  task: number[];
  failed: boolean;
  session: "active" | "completed" | "interrupted";
};

export const title = "恢复命令失败后再次恢复";

export function group(v: RunState) {
  if (v.session !== "active") return "已收口";
  if (!v.live.includes(1)) return "恢复";
  return "运行";
}

export const colors = { 运行: "blue", 恢复: "purple", 已收口: "teal" };

export function state(v: RunState) {
  if (v.session !== "active") return "会话已收口";
  const runs = Object.entries(v.phase);
  const recovering = runs.filter(([, phase]) => phase === "recovering");
  if (recovering.some(([id]) => v.task.includes(Number(id)))) return "正在恢复";
  if (recovering.some(([id]) => !v.live.includes(v.actor[id]))) return "恢复进程已退出，等待重新取证";
  if (recovering.length > 0 && v.failed) return "恢复命令已结束，等待重试";
  if (runs.every(([, phase]) => phase === "completed" || phase === "interrupted")) {
    return "运行均已收口，会话尚未收口";
  }
  return v.live.includes(1) ? "会话仍在运行" : "原运行已结束，等待恢复";
}

const labels: Readonly<Record<string, string>> = {
  Prepare: "准备发布结果",
  Publish: "发布一个结果",
  Replay: "重复或迟到的发布未生效",
  Seal: "准备结束一个运行",
  Close: "提交一个运行的终态",
  CloseSession: "正常收口会话",
  Crash: "运行或恢复进程退出",
  Fence: "证实原进程已结束，开始恢复",
  RepairSeal: "校验历史结果",
  Finish: "提交恢复结果",
  FailFinish: "收口失败，恢复命令结束",
  Resume: "同一恢复进程重试",
  RepairSession: "恢复遗留会话",
  Delete: "删除终态运行",
  Idle: "等待",
};

export const step = (action: string) => labels[action] ?? null;
