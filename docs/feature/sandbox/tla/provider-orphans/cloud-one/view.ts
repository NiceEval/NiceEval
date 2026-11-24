type Phase = "ready" | "sent" | "owned" | "lookup" | "closing" | "end";

type ProviderState = {
  readonly pc: Readonly<Record<number, Phase>>;
  readonly live: readonly unknown[];
  readonly inflight: readonly unknown[];
  readonly stopReq: readonly unknown[];
};

export const title = "创建应答丢失后的服务端到期回收";
export const colors = { 创建: "blue", 使用: "teal", 清理: "orange", 结束: "tan" };

export function group(v: ProviderState): keyof typeof colors {
  if (v.stopReq.length > 0 || v.pc[1] === "closing" || v.pc[1] === "lookup") return "清理";
  if (v.pc[1] === "end") return v.live.length + v.inflight.length > 0 ? "清理" : "结束";
  return v.pc[1] === "owned" ? "使用" : "创建";
}

export function state(v: ProviderState): string {
  const phase = v.pc[1];
  if (v.stopReq.length > 0 || phase === "closing") return "已请求销毁";
  if (phase === "end") {
    if (v.live.length > 0) return "客户端已结束，等服务端到期";
    if (v.inflight.length > 0) return "客户端已结束，创建请求仍可完成";
    return "客户端已结束，服务端无实例";
  }
  if (phase === "lookup") return "创建应答丢失，准备按标签查找";
  if (phase === "owned") return "客户端已拿到实例 ID";
  if (v.live.length > 0) return "服务端已创建，客户端还没拿到 ID";
  if (phase === "sent") return "等待创建应答";
  return "可以发送创建请求";
}

export function step(action: string, from: ProviderState, to: ProviderState): string | null {
  const fromLabel = state(from);
  const toLabel = state(to);
  // A late first allocation can overlap a second request. The model still checks these edges.
  if (
    (fromLabel === "可以发送创建请求" && toLabel === "服务端已创建，客户端还没拿到 ID") ||
    (fromLabel === "服务端已创建，客户端还没拿到 ID" && toLabel === "可以发送创建请求") ||
    (fromLabel === "客户端已结束，等服务端到期" && toLabel === "客户端已结束，创建请求仍可完成")
  ) {
    return null;
  }
  switch (action) {
    case "Request":
      return "发送创建请求";
    case "Allocate":
      return "服务端创建实例";
    case "Reject":
      return "服务端拒绝创建";
    case "Receive":
      return "客户端收到实例 ID";
    case "Lost":
      return "创建应答丢失";
    case "Reconcile":
      return "按标签查找并销毁已找到的实例";
    case "EndEarly":
      return "客户端结束";
    case "SendStop":
      return "请求销毁该实例";
    case "ApplyStop":
      return "服务端销毁该实例";
    case "StopRejected":
      return "服务端拒绝销毁";
    case "Return":
      return "客户端结束";
    case "Signal":
      return "收到取消请求";
    case "Crash":
      return "客户端进程退出";
    case "Expire":
      return "服务端到期销毁";
    case "Done":
      return "创建与清理已结算";
    default:
      throw new Error(`Unknown Provider action: ${action}`);
  }
}
