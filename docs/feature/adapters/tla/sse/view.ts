type Turn =
  | "idle"
  | "opening"
  | "first"
  | "pauseReady"
  | "waiting"
  | "waitingForAnswer"
  | "approving"
  | "second"
  | "eof"
  | "completed"
  | "closing"
  | "rejecting"
  | "rejected"
  | "closed";

type ModelState = {
  turn: Turn;
  transport: { phase: string };
  read: { decoded: boolean };
  receipt: { phase: string; repeated: string };
  observed: { postCloseFrame: boolean };
};

export const title = "SSE 审批与流的关闭";

export function state({ turn, transport, read, receipt, observed }: ModelState): string {
  if (receipt.repeated === "different" && observed.postCloseFrame) return "关闭后收到帧和不同的回执";
  if (receipt.repeated === "different") return "重复关闭拿到不同的回执";
  if (observed.postCloseFrame) return "关闭后仍收到帧";
  switch (turn) {
    case "idle":
      return "尚未发请求";
    case "opening":
      return "等候响应";
    case "first":
      return read.decoded ? "首轮有帧待交付" : "首轮读取";
    case "pauseReady":
      return "已收到审批请求";
    case "waiting":
    case "waitingForAnswer":
      return "等待审批答复";
    case "approving":
      return "提交审批答复";
    case "second":
      return "续读原响应";
    case "eof":
      return "收到流结束";
    case "completed":
      return "本轮完成";
    case "closing":
    case "rejecting":
      if (read.decoded) return "关闭时有帧待结算";
      return transport.phase === "late" ? "已关闭并等待请求结算" : "正在关闭响应";
    case "rejected":
      return "本轮拒绝";
    case "closed":
      return "本地收尾结束";
  }
}

const labels: Readonly<Record<string, string>> = {
  StartRequest: "发起 HTTP 请求",
  ReceiveBody: "收到 HTTP 响应",
  HandOffCursor: "响应可读",
  StartRead: "请求下一帧",
  ReceiveFrame: "收到待解码消息",
  DecodeFrame: "解码消息",
  DeliverPending: "读取结果结算",
  PauseTurn: "交付等待结果，保留连接",
  TakeApprovalSlot: "提交审批答复",
  ResumeAfterApproval: "审批成功，续读",
  ReceiveEof: "流自然结束",
  CompleteTurn: "交付完成结果",
  ExplicitClose: "调用者关闭",
  ApproveFailed: "审批失败，关闭响应",
  ObserveAbort: "观察到本轮取消",
  ShutDownAttempt: "Attempt 收尾",
  RepeatReturn: "关闭期间再次调用关闭",
  ReceiveLateBody: "迟到响应到达并取消",
  OpenSettlesWithoutBody: "请求结束",
  FinishClose: "结束本方等待",
};

export function step(action: string): string | null {
  return labels[action] ?? null;
}

export function group({ turn }: ModelState): keyof typeof colors {
  switch (turn) {
    case "waiting":
    case "waitingForAnswer":
    case "approving":
      return "审批";
    case "closing":
    case "rejecting":
    case "rejected":
    case "closed":
      return "关闭";
    default:
      return "读取与交付";
  }
}

export const colors = {
  读取与交付: "blue",
  审批: "yellow",
  关闭: "teal",
};
