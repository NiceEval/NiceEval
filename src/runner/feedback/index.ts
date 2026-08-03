// `niceeval exp` 的 human / json 反馈模型:公开入口。
// 见 docs/feature/experiments/cli.md,裁决见 memory/exp-output-two-forms-ruling.md。
//
// - profile.ts   —— `--json` 的两选一形态解析。
// - reducer.ts   —— 事件 → RunFeedbackState 的纯 reducer(与本文件同目录,类型见 ../types.ts)。
// - renderer.ts  —— human/json 各实现一份的插件契约。
// - coordinator.ts —— 一个 run 内唯一的终端协调者,renderer 的唯一调用方。
// - sink.ts      —— 供尚未拿到 coordinator 引用的底层模块(sandbox provider、budget 记账、
//                    reporter 兜底……)使用的迁移出口。
// - io.ts        —— 可注入的终端 I/O 面;testing.ts(仅测试用,不在这个条形码出口里)提供假实现。

export { resolveOutputForm, type ResolveOutputFormInput } from "./profile.ts";
export { createInitialRunFeedbackState, reduceRunFeedback } from "./reducer.ts";
export type { FeedbackRenderer } from "./renderer.ts";
export {
  createFeedbackCoordinator,
  type FeedbackCoordinator,
  type FeedbackCoordinatorOptions,
} from "./coordinator.ts";
export {
  reportActivity,
  reportDiagnostic,
  reportInterrupted,
  reportReporterError,
  reportAttemptLifecycle,
  reportFailure,
  reportBudgetExhausted,
  reportRunActivity,
  activateFeedbackSink,
  activeFeedbackSinkCount,
  type DiagnosticInput,
  type FailureInput,
  type BudgetExhaustedInput,
  type RunActivityInput,
  type FeedbackSink,
} from "./sink.ts";
export {
  createNodeFeedbackIO,
  type FeedbackIO,
  type FeedbackStream,
  type FeedbackClock,
  type FeedbackTimerHandle,
} from "./io.ts";
export {
  createHumanRenderer,
  renderDurableLines,
  renderHumanDryPlan,
  formatElapsed,
  formatTokenCount,
  type HumanRendererOptions,
  type HumanDryPlanInput,
  type HumanDryPlanRow,
} from "./human.ts";
export {
  createJsonRenderer,
  computeExitCode,
  renderJsonPlanDocument,
  type JsonRendererOptions,
  type JsonPlanInput,
  type JsonPlanRow,
  type JsonPlanDispatch,
  type JsonPlanDelta,
  type JsonPlanDiagnostic,
  type JsonPlanDiagnosticFact,
  type JsonPlanFingerprintComparison,
  type JsonPlanFingerprintComparisonChanged,
  type JsonPlanFingerprintComparisonUnexplained,
  type ExpEvent,
  type StartEvent,
  type ProgressEvent,
  type FailureEvent,
  type ErrorEvent,
  type EvalEvent,
  type KeptEvent,
  type WarningEvent,
  type BudgetExhaustedEvent,
  type ReporterErrorEvent,
  type InterruptedEvent,
  type JudgePrecheckEvent,
  type ExperimentSetupEvent,
  type ExperimentTeardownEvent,
  type LockWaitEvent,
  type ResultEvent,
} from "./json.ts";
