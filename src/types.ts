// niceeval 的核心类型契约 —— 聚合 facade。
//
// 类型按域住在各自目录(改哪个域的类型去哪个文件),这里只做 re-export,
// 模块代码统一 `import type { … } from "../types.ts"`,不必记住每个类型的家:
//   · shared/types.ts   跨域原子(JsonValue / Severity / SourceLoc / Cleanup / LocalizedText)
//   · o11y/types.ts     标准事件流 / DerivedFacts / TraceSpan / Usage / O11ySummary
//   · sandbox/types.ts  Sandbox 接口 / 后端 spec / 命令与文件 IO
//   · agents/types.ts   Agent / Adapter 契约 / 会话 / tracing 导出
//   · scoring/types.ts  断言(值级 / 记录 / 结果)/ ScoringContext / JudgeConfig
//   · context/types.ts  TestContext(t)与子句柄(turn / session / sandbox 视图)
//   · runner/types.ts   EvalResult / RunSummary / Reporter / eval・experiment・config 定义 / 调度编排
//
// 架构规矩不变:所有模块对着这里编程;agents/ 与 sandbox/ 之外不出现
// agent 名 / sandbox 名的行为分支(见 docs/architecture.md)。

export * from "./shared/types.ts";
export * from "./o11y/types.ts";
export * from "./sandbox/types.ts";
export * from "./agents/types.ts";
export * from "./scoring/types.ts";
export * from "./context/types.ts";
export * from "./runner/types.ts";
