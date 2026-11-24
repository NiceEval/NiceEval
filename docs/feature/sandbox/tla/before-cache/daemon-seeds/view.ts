type DaemonState = {
  readonly generation: "old" | "new";
  readonly admission: boolean;
  readonly installed: readonly string[];
  readonly pending: readonly string[];
};

export const title = "Docker daemon 换代后释放旧制品容量";
export const colors = { 换代前: "blue", 保留: "orange", 回收: "teal", 关闭: "pink" };

export function group(v: DaemonState): keyof typeof colors {
  if (v.generation === "old") return "换代前";
  if (!v.admission) return "关闭";
  return v.pending.length > 0 ? "保留" : "回收";
}

export function state(v: DaemonState): string {
  switch (group(v)) {
    case "换代前":
      return "daemon 尚未换代";
    case "关闭":
      return v.installed.length ? "准入关闭，旧制品仍占容量" : "准入关闭";
    case "保留":
      return "开放准入，保留仍在使用的旧制品";
    case "回收":
      return "开放准入，旧制品容量已释放";
  }
}

export function step(action: string, _from: DaemonState, to: DaemonState): string {
  switch (action) {
    case "Rotate":
      return "发现 daemon 已换代";
    case "Release":
      return to.pending.length === 0 ? "最后一个用户释放，回收旧制品" : "一个用户释放旧制品";
    case "Done":
      return "换代回收结束";
    default:
      throw new Error(`Unknown daemon action: ${action}`);
  }
}
