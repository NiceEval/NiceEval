type Instance = Readonly<Record<number, number>>;

type ProviderState = {
  readonly pc: Readonly<Record<number, string>>;
  readonly live: readonly Instance[];
  readonly stopReq: readonly Instance[];
};

export const title = "本地实例可按标签查找，迟到的销毁请求仍只指向原实例";
export const colors = { 创建: "blue", 清理: "orange", 可查: "teal", 结束: "tan" };

export function group(v: ProviderState): keyof typeof colors {
  if (v.stopReq.length > 0) return "清理";
  if (v.live.some((id) => v.pc[id[1]] === "end")) return "可查";
  return Object.values(v.pc).every((phase) => phase === "end") ? "结束" : "创建";
}

export function state(v: ProviderState): string {
  const successorLives = v.live.some((id) => id[1] === 2);
  const oldStopPending = v.stopReq.some((id) => id[1] === 1);
  if (oldStopPending && successorLives) return "原实例的销毁请求在途，后继实例已创建";
  if (v.stopReq.length > 0) return "已请求销毁指定实例";
  if (v.live.some((id) => v.pc[id[1]] === "end")) return "进程已结束，可按标签找到残留实例";
  if (successorLives) return "后继实例仍在";
  if (v.live.length > 0) return "原实例已创建";
  if (Object.values(v.pc).every((phase) => phase === "end")) return "两个进程已结束，没有残留实例";
  return "等待实例创建";
}

export function step(action: string): string {
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
      return "结束本次创建";
    case "SendStop":
      return "请求销毁该实例";
    case "ApplyStop":
      return "迟到的请求只销毁原实例";
    case "StopRejected":
      return "服务端拒绝销毁";
    case "Return":
      return "客户端结束清理";
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
