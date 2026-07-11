// 真正跨域的原子类型:序列化 / 严重度 / 源码位置 / 生命周期。
// 各域的类型住在各自目录的 types.ts(o11y / sandbox / agents / scoring / context / runner),
// src/types.ts 是聚合 facade —— 模块代码统一从那里 import,不必记住每个类型的家。

/** JSON 可表达的任意值(递归定义),用于事件流 / 工具输入输出等跨进程/跨语言传递的数据。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** 断言的严重度:"gate" 失败必判整轮 failed;"soft" 默认只记录不拦截,仅在 `--strict` 模式或显式设阈值未达标时才计入失败。 */
export type Severity = "gate" | "soft";

/**
 * eval 源码里一次调用的位置(`t.send` / 各断言),运行期从栈回溯抠出来(见 src/source-loc.ts)。
 * view 据此把运行结果叠回真实源码行(github-diff 式代码视图)。`file` 为相对项目根的路径。
 */
export interface SourceLoc {
  file: string;
  line: number;
  column?: number;
}

/** 随结果回传的一份 eval 源码(相对项目根的路径 + 文本),供 view 渲染代码视图。 */
export interface SourceArtifact {
  path: string;
  content: string;
}

/** 通用清理闭包(setup 返回值 / teardown 的形状),异步同步皆可,统一在 finally 里执行。 */
export type Cleanup = () => Promise<void> | void;

/**
 * 可本地化文案:纯字符串,或按 locale 代码(如 "en"、"zh-CN")映射多语言。
 * view 按当前界面语言挑一条,挑不到回退到 en / 第一条。
 */
export type LocalizedText = string | Record<string, string>;
