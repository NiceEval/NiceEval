type PublicationState = {
  phase: "create" | "opening" | "dispatch" | "close" | "returned" | "error" | "dead";
  interrupted: boolean;
};

export const title = "发布运行、结束评测并生成回执";

export function state(v: PublicationState) {
  switch (v.phase) {
    case "create":
      return "等待创建运行";
    case "opening":
      return "全部运行及预期位置可读";
    case "dispatch":
      return v.interrupted ? "停止派发，等待在途工作" : "评测中，结果陆续可读";
    case "close":
      return v.interrupted ? "收口已中断的评测" : "收口已完成的评测";
    case "returned":
      return v.interrupted ? "已生成中断回执" : "已生成完成回执";
    case "error":
      return "收尾失败，保留已发布结果";
    case "dead":
      return "进程已退出";
  }
}

export function group(v: PublicationState) {
  if (v.phase === "dead" || v.phase === "error") return "异常";
  if (v.phase === "returned") return "回执";
  if (v.phase === "close" || v.interrupted) return "收尾";
  return "运行";
}

export const colors = { 运行: "blue", 收尾: "purple", 回执: "teal", 异常: "orange" };

const labels: Readonly<Record<string, string>> = {
  Create: "一次创建全部运行及预期位置",
  OpenWriters: "开始派发评测",
  Reserve: "预留一个执行位置",
  Signal: "收到中断信号",
  Seal: "确定一个执行结果",
  Absent: "为缺失结果保留位置",
  CompleteWriter: "准备发布结果",
  PublishOrigin: "发布一个执行结果",
  WriterFailure: "一个运行无法发布结果",
  Join: "在途工作已结束",
  SealAggregate: "准备提交运行终态",
  CloseRun: "提交一个运行的终态",
  CloseFailure: "一个运行无法收口",
  ReadCutoff: "读取结果版本并生成回执",
  Crash: "进程强制退出",
};

export const step = (action: string) => labels[action] ?? null;
