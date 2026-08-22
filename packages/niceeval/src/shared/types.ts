// 真正跨域的原子类型:序列化 / 源码位置 / 生命周期。
// 各域的类型住在各自目录的 types.ts(o11y / sandbox / agents / assertions / context / runner),
// src/types.ts 是聚合 facade —— 模块代码统一从那里 import,不必记住每个类型的家。

/** JSON 可表达的任意值(递归定义),用于事件流 / 工具输入输出等跨进程/跨语言传递的数据。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JSON 值的递归匹配小语言。对象是深度部分匹配，数组逐项精确匹配；RegExp 与谓词可出现在
 * 任意层级。`unknown` 只存在于谓词接收动态运行时值的边界，不作为可存储的匹配值。
 */
export type JsonMatch =
  | string
  | number
  | boolean
  | null
  | RegExp
  | ((value: unknown) => boolean)
  | readonly JsonMatch[]
  | { readonly [key: string]: JsonMatch };

/** 一次 Attempt 的互斥终态；跳过是已结束但不构成可执行结论的结果。 */
export type Verdict = "passed" | "failed" | "errored" | "skipped";

/**
 * eval 源码里一次调用的位置(`t.send` / 各断言),运行期从栈回溯抠出来(见 src/source-loc.ts)。
 * view 据此把运行结果叠回真实源码行(github-diff 式代码视图)。`file` 为相对项目根的路径。
 */
export interface SourceLoc {
  file: string;
  line: number;
  column?: number;
  /** 从 eval 入口到声明位置的调用路径；声明位置本身不在数组中。 */
  callers?: SourcePathFrame[];
}

export type SourcePathFrame =
  | { kind: "project"; file: string; line: number; column?: number }
  | { kind: "package"; package: string };

/** 随结果回传的一份 eval 源码(相对项目根的路径 + 文本),供 view 渲染代码视图。 */
export interface SourceArtifact {
  path: string;
  content: string;
  /** 入口 eval 源码或运行时引用的项目文件。 */
  role?: "entry" | "referenced";
}

/**
 * 内部收尾闭包类型:供运行器内部的清理注册表使用(如 `postSetup` 钩子内部累积待收尾动作),
 * 不出现在任何公开的生命周期钩子签名里——`SandboxHook`/`AgentSetup`/`AgentTeardown` 等公开
 * 钩子一律 `void | Promise<void>`,setup 不返回值,收尾靠成对的 teardown(见
 * docs/runner.md「环境预置不进运行器,但按顺序调它」)。
 */
export type Cleanup = () => Promise<void> | void;

/** `ScopedFeedback.progress` 的入参:此刻正在做什么(短命状态,可被后续更新覆盖)。 */
export interface ProgressUpdate {
  message: string;
  current?: number;
  total?: number;
}

/** `ScopedFeedback.diagnostic` 的入参:运行结束后仍应保留的问题(永久事件)。 */
export interface DiagnosticInput {
  code: string;
  level: "warning" | "error";
  message: string;
  data?: Readonly<globalThis.Record<string, JsonValue>>;
  /** 并发 attempt 产生同一问题时的去重键;相同 key 折叠成一条并累计次数。 */
  dedupeKey?: string;
}

/**
 * 作用域反馈 API(见 docs/feature/experiments/library.md「生命周期代码怎样向这次运行反馈」):
 * sandbox provider、sandbox hook、eval 与 Agent Adapter 从 runner 注入的上下文获得同一套入口。
 * - `progress` 是短命状态:human profile 更新 active 行,JSON 不逐条输出,不进最终结果;
 * - `diagnostic` 是永久事件:进 human/JSON 的永久输出流并落进 attempt 的 diagnostics;
 *   即使 level 为 "error" 也不自动改变 verdict(要 errored 抛异常,要 failed 用断言)。
 * 两个方法都不接受 phase / scope / 颜色 / 输出流——runner 知道当前回调属于哪个生命周期阶段,
 * 调用方不能冒充其它阶段。
 */
export interface ScopedFeedback {
  progress(update: ProgressUpdate): void;
  diagnostic(input: DiagnosticInput): void;
}

/**
 * 可本地化文案:纯字符串,或按 locale 代码(如 "en"、"zh-CN")映射多语言。
 * view 按当前界面语言挑一条,挑不到回退到 en / 第一条。
 */
export type LocalizedText = string | globalThis.Record<string, string>;
