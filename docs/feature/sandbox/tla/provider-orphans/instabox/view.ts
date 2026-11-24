const phases = {
  ready: { label: "可以请求创建 Machine", group: "创建" },
  sent: { label: "等待创建应答", group: "创建" },
  unknown: { label: "创建应答丢失，分配结果未知", group: "对账" },
  replayed: { label: "已用原幂等键重取应答", group: "对账" },
  initializing: { label: "已拿到 Machine ID，正在初始化", group: "创建" },
  usable: { label: "Machine 已就绪", group: "结束" },
  deleting: { label: "初始化失败，等待确认旧 Machine 已删除", group: "对账" },
  retryable: { label: "已确认旧分配无需清理", group: "可重试" },
  renewed: { label: "已用新幂等键请求创建", group: "可重试" },
  awaitDeadline: { label: "客户端放弃重试，等服务端到期", group: "对账" },
  ended: { label: "服务端没有遗留 Machine", group: "结束" },
} satisfies Record<string, { readonly label: string; readonly group: "创建" | "对账" | "可重试" | "结束" }>;

type RetryState = { readonly phase: keyof typeof phases };

export const title = "Instabox 确认旧分配已处置后才创建下一台 Machine";
export const colors = { 创建: "blue", 对账: "orange", 可重试: "teal", 结束: "tan" };

export function group(v: RetryState): keyof typeof colors {
  return phases[v.phase].group;
}

export function state(v: RetryState): string {
  return phases[v.phase].label;
}

export function step(action: string): string {
  switch (action) {
    case "Submit":
      return "发送创建请求";
    case "Allocate":
      return "服务端分配原 Machine";
    case "Rejected":
      return "服务端明确拒绝创建";
    case "LoseReply":
      return "创建应答丢失";
    case "ReplaySameRequest":
      return "用原幂等键重取应答";
    case "Receive":
      return "收到原 Machine ID";
    case "Unresolved":
      return "重取后仍无法确认分配";
    case "Ready":
      return "初始化成功";
    case "InitializationFailed":
      return "初始化失败，请求删除";
    case "ConfirmDeletion":
      return "确认旧 Machine 已删除";
    case "CannotConfirmDeletion":
      return "无法确认删除";
    case "Renew":
      return "用新幂等键创建下一台 Machine";
    case "Expire":
      return "服务端到期销毁";
    case "RejectAfterExit":
      return "服务端最终未分配";
    case "Done":
      return "本轮创建已结束";
    default:
      throw new Error(`Unknown Instabox action: ${action}`);
  }
}
