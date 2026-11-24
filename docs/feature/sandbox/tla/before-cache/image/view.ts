type ImageState = {
  readonly phase: Readonly<Record<number, string>>;
  readonly disk: readonly number[];
  readonly lease: Readonly<Record<number, number>>;
  readonly hold: Readonly<Record<number, number>>;
  readonly active: readonly number[];
  readonly head: number;
  readonly del: readonly number[];
};

export const title = "Docker 镜像发布、租用与回收";
export const colors = { 构建: "blue", 可用: "teal", 持有: "purple", 回收: "orange", 异常: "pink" };

function references(v: ImageState): number[] {
  return [...Object.values(v.lease), ...Object.values(v.hold)].filter((image) => image !== 0);
}

export function group(v: ImageState): keyof typeof colors {
  if (
    v.active.some((reader) => [v.lease[reader], v.hold[reader]].some((image) => image !== 0 && !v.disk.includes(image)))
  ) {
    return "异常";
  }
  if (v.del.length > 0) return "回收";
  if (references(v).length > 0) return "持有";
  if (Object.values(v.phase).includes("indexed")) return "可用";
  return "构建";
}

export function state(v: ImageState): string {
  switch (group(v)) {
    case "异常":
      return "读者仍在使用的镜像已删除";
    case "回收":
      return "未被使用的旧镜像正在回收";
    case "持有":
      return v.head !== 0 && references(v).some((image) => image !== v.head)
        ? "旧镜像还有用户"
        : "读者正在使用已发布的镜像";
    case "可用":
      return "已发布的镜像可以租用";
    case "构建":
      return v.disk.length > 0 ? "镜像已创建，等候登记" : "等待镜像创建";
  }
}

const labels: Readonly<Record<string, string>> = {
  Reserve: "登记构建请求",
  Make: "创建镜像",
  Publish: "确认镜像已经发布",
  Index: "开放镜像租用",
  Acquire: "读者租用镜像",
  PrepareHold: "读者登记使用",
  Release: "读者释放租约",
  DropHold: "读者结束使用",
  Abort: "生产者的私有副本创建失败",
  Cleanup: "清除未验证的镜像",
  GcReserve: "确认旧镜像已无人使用",
  Remove: "删除旧镜像",
  Settle: "记录删除结果",
  Complete: "生产者完成交接",
  Crash: "进程退出",
  Recover: "接手退出进程的登记",
  Idle: "没有新请求",
};

export function step(action: string): string {
  return labels[action] ?? action;
}
