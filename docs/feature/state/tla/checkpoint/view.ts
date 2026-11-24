type Phase = "new" | "staging" | "interrupted" | "skipped" | "reply" | "retry" | "unknown" | "done";

type CheckpointState = {
  writer: number;
  pc: Record<number, Phase>;
  bytes: Record<number, number[]>;
  ready: Record<number, number[]>;
  saved: number[];
};

export const title = "一组 State 检查点怎样保存与恢复";
export const colors = { 准备: "blue", 核对: "purple", 待恢复: "yellow", 已确定: "teal", 部分提交: "orange" };

const display = {
  new: { label: "等待读取上次保存的检查点", group: "准备" },
  capture: { label: "已确定本次恢复起点", group: "准备" },
  oneStaged: { label: "已备好一个目录的内容", group: "准备" },
  staged: { label: "已备好两个目录的内容", group: "准备" },
  interrupted: { label: "原运行中断，等待核对保存结果", group: "待恢复" },
  skipped: { label: "确认未保存，沿用原检查点", group: "已确定" },
  reply: { label: "两个目录的检查点一起可恢复", group: "核对" },
  retry: { label: "保存回复丢失，等待重读", group: "核对" },
  unknown: { label: "尚不知道是否已保存，继续阻止后续运行", group: "待恢复" },
  done: { label: "已确认保存结果", group: "已确定" },
  onePublished: { label: "只有一个目录能恢复到本次状态", group: "部分提交" },
  twoPublished: { label: "两个目录已可恢复，缺少本次保存记录", group: "部分提交" },
  interruptedSplit: { label: "原运行中断，已公开的部分无法撤回", group: "部分提交" },
  skippedSplit: { label: "保存已跳过，未完成的一组仍可读", group: "部分提交" },
  previousSplit: { label: "前一次保存留下不完整的记录", group: "部分提交" },
};

function displayFor(v: CheckpointState) {
  const phase = v.pc[v.writer];
  const published = v.ready[v.writer].length;
  const previousSplit = Object.entries(v.ready).some(
    ([execution, checkpoints]) =>
      Number(execution) < v.writer && checkpoints.length > 0 && !v.saved.includes(Number(execution)),
  );
  if (previousSplit) return display.previousSplit;
  if (published > 0 && !v.saved.includes(v.writer)) {
    if (phase === "interrupted") return display.interruptedSplit;
    if (phase === "skipped") return display.skippedSplit;
    return published === 1 ? display.onePublished : display.twoPublished;
  }
  if (phase !== "staging") return display[phase];
  const staged = v.bytes[v.writer].length;
  if (staged === 0) return display.capture;
  return staged === 1 ? display.oneStaged : display.staged;
}

export function state(v: CheckpointState) {
  return displayFor(v).label;
}

export function group(v: CheckpointState) {
  return displayFor(v).group;
}

export function step(action: string, _from: CheckpointState, to: CheckpointState) {
  switch (action) {
    case "Observe":
      return "读取并固定恢复起点";
    case "Stage":
      return to.bytes[to.writer].length === 1 ? "校验第一个目录的内容" : "校验第二个目录的内容";
    case "PublishAll":
      return "一起保存两个目录并登记结果";
    case "PublishOne":
      return "单独公开一个目录";
    case "FinishOneAtATime":
      return "补记保存结果";
    case "CrashUncommitted":
      return "原运行中断，恢复者接管";
    case "LateWrite":
      return "拒绝原运行迟到的保存";
    case "Discard":
      return "清理暂存内容并记录跳过";
    case "LoseReply":
      return "保存回复丢失";
    case "ReadUnavailable":
      return "无法重读，继续保留租约";
    case "Ack":
      return "收到保存回复";
    case "RereadSaved":
      return "重读同一次保存的结果";
    case "RecoverSaved":
      return "数据库恢复可读，核对并保留保存记录";
    case "NextRun":
      return "允许下一次运行";
    case "Done":
      return "结束";
    default:
      return null;
  }
}
