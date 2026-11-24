type PrefixState = {
  readonly pc: "search" | "probe" | "execute" | "capture" | "done";
  readonly cursor: number;
  readonly satisfied: number;
  readonly data: readonly number[];
  readonly seed: Readonly<Record<number, readonly number[]>>;
};

export const title = "每次发布都包含完整前缀";
export const colors = { 查找: "blue", 准备: "purple", 发布: "orange", 完成: "teal", 不完整: "pink" };

export function group(v: PrefixState): keyof typeof colors {
  if (Object.entries(v.seed).some(([key, layers]) => layers.length > 0 && layers.length !== Number(key))) {
    return "不完整";
  }
  if (v.pc === "execute" && v.data.length !== v.cursor - 1) return "不完整";
  if (v.pc === "done") return "完成";
  if (v.pc === "capture") return "发布";
  if (v.pc === "execute") return "准备";
  return "查找";
}

export function state(v: PrefixState): string {
  const layer = `第 ${v.cursor} 层`;
  switch (v.pc) {
    case "search":
      return `查找${layer}`;
    case "probe":
      return v.satisfied > 0 ? "上一层已准备好，重查下一层" : "从干净 Base 重查第一层";
    case "execute":
      return v.data.length === v.cursor - 1 ? `准备执行${layer}` : `缺少父层，仍准备执行${layer}`;
    case "capture":
      return v.data.length === v.cursor ? `${layer}及全部父层齐备` : `${layer}已执行，实例缺少父层`;
    case "done":
      return group(v) === "不完整" ? "已发布的前缀缺少父层" : "完整前缀已就绪";
  }
}

export function step(action: string, from: PrefixState, to: PrefixState): string {
  switch (action) {
    case "Search":
      return to.satisfied > 0 ? "恢复命中的前缀" : "这一层未命中";
    case "Probe":
      if (from.satisfied === 0) return "第一层仍未命中";
      return to.data.length === to.cursor - 1 ? "下一层未命中，保留上一层" : "下一层未命中，清掉了上一层";
    case "Action":
      return "当前 action 执行成功";
    case "Capture":
      return "发布当前前缀";
    case "End":
      return "before 完成";
    default:
      throw new Error(`Unknown prefix action: ${action}`);
  }
}
