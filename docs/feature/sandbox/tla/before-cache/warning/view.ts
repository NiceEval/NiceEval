type WarningState = {
  readonly pc: "plan" | "done";
  readonly inputs: Readonly<Record<number, { readonly base: number; readonly decl: number }>>;
  readonly output: boolean;
};

export const title = "同一替换位置的前缀冲突告警";
export const colors = { 比较: "blue", 一致: "teal", 告警: "orange", 异常: "pink" };

function conflict(v: WarningState): boolean {
  return v.inputs[1].base !== v.inputs[2].base || v.inputs[1].decl !== v.inputs[2].decl;
}

export function group(v: WarningState): keyof typeof colors {
  if (v.pc === "plan") return "比较";
  if (v.output !== conflict(v)) return "异常";
  return v.output ? "告警" : "一致";
}

export function state(v: WarningState): string {
  if (v.pc === "plan") return conflict(v) ? "同一位置有不同前缀内容" : "同一位置的前缀内容一致";
  if (v.output) return conflict(v) ? "报告前缀冲突" : "前缀内容一致却收到告警";
  return conflict(v) ? "有前缀冲突却没有告警" : "无需告警";
}

export function step(action: string): string {
  switch (action) {
    case "Check":
      return "比较同一位置的前缀";
    case "End":
      return "比较结束";
    default:
      throw new Error(`Unknown warning action: ${action}`);
  }
}
