# 错误助手 —— Library

Library 保留领域 typed error，不向 stdout/stderr 打印，也不退出宿主进程。Effect interruption、typed failure 与 defect
在所属运行边界保持区分；仅在呈现时产生错误说明，不把全部异常改写成一个通用异常类。

## 位置与迁移错误

```ts
type ErrorSource =
  | { readonly state: "located"; readonly file: string; readonly line: number; readonly column: number }
  | { readonly state: "unavailable"; readonly reason: "not-recorded" | "unresolvable" | "budget-exhausted" };
interface MigrationOccurrence {
  readonly guideId: string;
  readonly source: ErrorSource;
  readonly subject: string;
}
interface MigrationGuide {
  readonly id: string;
  readonly language: "en";
  readonly format: "markdown";
  readonly content: string;
}
```

行列从 1 开始。`subject` 是 owner 产生的安全 API 名或参数路径，例如 `defineConfig.judgeRuntime`，
不是旧值的序列化。位置指向用户调用、已经过求值的参数或导入声明，不用 NiceEval 内部抛错行冒充用户位置。
位置缺失时保留明确 unavailable；不得由相同字段名或错误消息猜测文件与行列。

`MigrationRequiredError` 从 `niceeval` 导出，是同步作者 API 可抛出的具名 Error。
其构造与 runtime 检测由功能 owner 拥有；公开读者使用以下实例字段，不能把它当作错误注册 API：

```ts
interface MigrationRequiredError extends Error {
  readonly name: "MigrationRequiredError";
  readonly code: "migration-required";
  readonly occurrences: readonly MigrationOccurrence[];
}
```

Effect Host 把它保留为所属 typed failure 的迁移原因。错误对象只持有 guide ID 与安全位置，
不在构造时读取 Markdown；渲染器或宿主显式读取指南时才定位对应发布资产。

## 人读聚合投影

领域 owner 交付的每条失败事实保持独立。交付层可以为终端建立下列短期投影：

```ts
interface ErrorAssistanceOccurrence {
  readonly code: string;
  readonly owner: string;
  readonly repairTarget?: string;
  readonly guideId?: string;
  readonly affectedObject: {
    readonly experimentId?: string;
    readonly evalId: string;
    readonly attempt: number;
  };
  readonly source: ErrorSource;
}
interface ErrorAssistanceGroup {
  readonly code: string;
  readonly owner: string;
  readonly repairTarget?: string;
  readonly guideId?: string;
  readonly count: number;
  readonly affectedObjects: readonly ErrorAssistanceOccurrence["affectedObject"][];
  readonly affectedObjectsOmitted: number;
  readonly sources: readonly ErrorSource[];
  readonly sourcesOmitted: number;
}
```

已知错误的聚合键是 code、owner、repair target 和 guide ID 的精确四元组。
任一值不同就是不同组。未知错误或缺少 owner 稳定分组身份的失败不按 message、stack 文本或字段名猜测，每条保持单例。

投影最多保留 32 组；每组最多列出 32 个受影响对象和 32 个源码位置状态。
超出部分只增加 omitted 计数，不丢弃 owner 保存的原始事实。
这些类型描述人读交付边界，不是新的持久错误 family 或全局注册 API。

## 领域与交付的边界

每个功能在自己的错误 owner 定义 code、已知事实和安全建议。只有具体证据足以支持时才提供修复动作；
无法区分网络、凭据或权限原因时不按 message 关键词猜测。错误助手不维护 message-key catalog 或通用翻译函数。

未知异常可以携带任意 thrown value。边界不得调用其 getter、`toJSON`、自定义 `toString` 或无限递归 cause。
默认公开输出使用具名的未知错误摘要；诊断模式也只输出有界、脱敏后的结构或 stack，不能绕过秘密过滤。
原始 cause 只在原有进程内错误通道保留，不自动写入 Record 或发送外部服务。

Run / Attempt 的持久诊断仍归原领域 owner；瞬时错误说明不创建另一套 durable error family。
固定历史 Inspection 与浏览器读回不依赖 CLI 本次增强缓存。
