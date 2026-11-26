type AttemptPhase = "wait" | "creating" | "probe" | "using" | "cleanup" | "returning" | "done";

type PoolState = {
  readonly pc: Readonly<Record<number, AttemptPhase>>;
  readonly box: Readonly<Record<number, "gone" | "creating" | "idle" | "leased">>;
  readonly attemptResult: Readonly<Record<number, "open" | "passed" | "errored">>;
  readonly interrupt: boolean;
  readonly swept: boolean;
};

export const title = "Sandbox 复用池";
export const colors = { 等待: "blue", 租用: "teal", 收尾: "orange", 结束: "purple" };

export function state(v: PoolState): string {
  if (v.swept) return "复用池已关闭";
  if (v.interrupt) return "Invocation 已中断，等待收尾";

  const phases = Object.values(v.pc);
  const finished = phases.every((phase) => phase === "done");
  if (phases.includes("cleanup")) return "当前 Attempt 清理中，下一条仍须等待";
  if (phases.includes("returning")) return "Attempt 收尾完成，正在归还 Sandbox";
  if (phases.includes("using")) return "Sandbox 正由一条 Attempt 使用";
  if (phases.includes("creating")) return "正在创建 Sandbox，名额已占用";
  if (finished) return "所有 Attempt 已结束，等待关池";
  if (Object.values(v.box).includes("idle")) return "Sandbox 空闲，等待确认寿命";
  if (Object.values(v.attemptResult).some((result) => result !== "open")) {
    return "此实例已退休，下次重建";
  }
  return "Attempt 等待 Sandbox";
}

export function group(v: PoolState): keyof typeof colors {
  if (v.swept) return "结束";
  const phases = Object.values(v.pc);
  if (v.interrupt || phases.includes("cleanup") || phases.includes("returning")) return "收尾";
  if (phases.every((phase) => phase === "done")) return "结束";
  return phases.includes("using") ? "租用" : "等待";
}

const labels: Readonly<Record<string, string>> = {
  BeginCreate: "为等待中的 Attempt 创建 Sandbox",
  Ready: "新 Sandbox 就绪并借出",
  CreateFailed: "创建或准备失败，结束这条 Attempt",
  Probe: "请求 Provider 确认剩余寿命",
  Confirm: "寿命足够，借出空闲 Sandbox",
  Rotate: "剩余寿命不足，退休此实例",
  Sigint: "中断 Invocation",
  CancelWaiter: "结束尚未取得 Sandbox 的 Attempt",
  CancelBody: "当前 Attempt 结束执行，开始清理",
  Seal: "当前 Attempt 结束执行，开始清理",
  CloseFacade: "完成清理，关闭这条 Attempt 的 Sandbox 接口",
  Sweep: "等待中的收尾均已完成，关闭复用池",
  Next: "复用池已关闭",
};

export function step(action: string, from: PoolState, to: PoolState): string | null {
  if (action === "Return") {
    const stillAvailable = Object.values(to.box).includes("idle");
    if (state(to) === "所有 Attempt 已结束，等待关池") return "归还 Sandbox，最后一条 Attempt 结束";
    return stillAvailable ? "重置完成，可以再次借用" : "此实例无法安全复用，予以退休";
  }
  if (action === "Confirm" && !Object.values(to.pc).includes("using")) return null;
  if (action === "Sigint" && Object.values(from.pc).every((phase) => phase === "done")) return null;
  return labels[action] ?? null;
}
