// 单 attempt 超时的解析链单源(契约见 docs/feature/experiments/architecture.md
// 「配置解析链:一次求值,处处同源」):`--timeout` → experiment → eval → niceeval.config.ts,
// 默认无上限。链里 config 是**缺省底,不是覆盖层**:把 config 的值提前物化进 run 配置,
// eval 自己声明的上限就永远走不到(真机 bug 与修法见
// memory/multi-source-field-resolution-order.md)。
//
// 因此 CLI 只求值到 experiment 那一层(resolveRunTimeout),eval 与 config 两层由
// resolveAttemptTimeout 在派发 attempt 时接上;两处共用这一个文件,`??` 链不在第二处
// 被重写一遍。解析的赢家随结果带出来(`source`),让超时消息说得出「这个上限是哪一层给的」。
//
// **链末端没有内置默认**:四层都没声明就是没有上限——attempt 不挂 deadline,同一个未设状态在
// 携带资格判据里记作 `Infinity`(见 fingerprint.ts 的 resolvedTimeoutMsForCarry)。链末端偷偷
// 兜一个毫秒数就是又一个隐藏来源层:它不在文档声明的链里,也没法在报错里说出自己是谁给的。

/** 有效超时上限来自哪一层;进人读消息,不另立结构化字段。 */
export type TimeoutSource = "flag" | "experiment" | "eval" | "config";

/** 运行侧(CLI flag + experiment 字段)求值结果;两层都没有时是空对象,下游继续往 eval / config 落。 */
export interface RunTimeout {
  timeoutMs?: number;
  timeoutSource?: "flag" | "experiment";
}

/**
 * 运行侧的两层:`--timeout` 压过 experiment 字段。**不带 config 兜底**——config 是解析链的
 * 缺省底,由 resolveAttemptTimeout 承接;在这里 `?? config.timeoutMs` 会让 eval 层永久短路。
 */
export function resolveRunTimeout(flagTimeoutMs: number | undefined, experimentTimeoutMs: number | undefined): RunTimeout {
  if (flagTimeoutMs !== undefined) return { timeoutMs: flagTimeoutMs, timeoutSource: "flag" };
  if (experimentTimeoutMs !== undefined) return { timeoutMs: experimentTimeoutMs, timeoutSource: "experiment" };
  return {};
}

export interface ResolvedAttemptTimeout {
  timeoutMs: number;
  source: TimeoutSource;
}

/**
 * 一条 attempt 实际生效的超时上限与它的出处;**四层都没声明时返回 `undefined` = 无上限**,
 * 调用方不挂 deadline,不替用户发明一条线。`run` 是运行侧已求值的结果(`timeoutSource` 区分
 * flag 与 experiment);直接构造 `AgentRun` 而没带出处的调用方(库用法、测试)按 `experiment`
 * 标注——run 配置本身就是实验层的投影。
 */
export function resolveAttemptTimeout(
  run: { timeoutMs?: number; timeoutSource?: "flag" | "experiment" },
  evalDef: { timeoutMs?: number },
  config: { timeoutMs?: number },
): ResolvedAttemptTimeout | undefined {
  if (run.timeoutMs !== undefined) return { timeoutMs: run.timeoutMs, source: run.timeoutSource ?? "experiment" };
  if (evalDef.timeoutMs !== undefined) return { timeoutMs: evalDef.timeoutMs, source: "eval" };
  if (config.timeoutMs !== undefined) return { timeoutMs: config.timeoutMs, source: "config" };
  return undefined;
}
