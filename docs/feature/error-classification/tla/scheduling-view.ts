type ModelState = {
  readonly phase: Readonly<Record<string, keyof typeof states>>;
};

const states = {
  queued: "等待实验名额",
  local: "已有实验名额，等待全局名额",
  firstGlobal: "已取得全局名额",
  waitLane: "等待独占 Sandbox 名额",
  lane: "已有独占 Sandbox 名额，等待全局名额",
  sending: "正在发送",
  sleeping: "保留原 Sandbox，等待重试",
  resumeExp: "退避已结束，等待实验名额",
  resumeGlobal: "退避已结束，等待全局名额",
  done: "已收尾",
};

const steps: Readonly<Record<string, string>> = {
  TakeExperiment: "取得实验名额",
  TakeGlobal: "取得全局名额",
  AcquireLane: "取得独占 Sandbox 名额",
  StartExclusive: "取回全局名额，开始发送",
  Rejected: "请求未被受理，归还全局名额并退避",
  Timer: "退避到期",
  ResumeLocal: "取回实验名额",
  ResumeGlobal: "取回全局名额，重发原请求",
  Finish: "执行与收尾结束，归还名额",
};

export const title = "Agent 发送退避与并发名额";

export function state({ phase }: ModelState) {
  return Object.fromEntries(Object.entries(phase).map(([attempt, value]) => [`Attempt ${attempt}`, states[value]]));
}

export function step(action: string, _from: ModelState, { phase }: ModelState) {
  if (action === "Dispatch") {
    return Object.values(phase).includes("waitLane") ? "归还全局名额，等待独占 Sandbox" : "开始发送";
  }
  if (action === "Idle" || action === "Next") return "全部执行已收尾";
  const label = steps[action];
  if (label === undefined) throw new Error(`Unknown scheduling action: ${action}`);
  return label;
}

export function group({ phase }: ModelState) {
  const attempts = Object.values(phase);
  if (attempts.every((value) => value === "done")) return "收尾";
  if (attempts.some((value) => value === "sleeping" || value === "resumeExp" || value === "resumeGlobal")) return "重试";
  return "派发";
}

export const colors = { 派发: "blue", 重试: "orange", 收尾: "teal" };
