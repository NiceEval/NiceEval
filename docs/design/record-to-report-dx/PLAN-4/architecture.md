# PLAN-4 Architecture

## 什么才算一层

Runtime 责任层至少拥有以下一项，且无法由相邻层无损承担：

- 独立领域身份与不变量；
- 独立资源 scope 或执行阶段；
- 独立错误隔离与重试边界；
- 可被多个上层消费者复用的稳定契约。

只有 namespace、文件夹、builder 或查找函数不构成层。反过来，如果 host 已经静态收集、调度和缓存
派生，只是不公开名称，它仍然事实性地形成了 Derivation 层，应把边界写明。

## 依赖方向

```text
Report -> [Derivation] -> Analysis -> Record -> durable bytes
```

依赖只向 facts 方向。Record 不知道 selection，Analysis 不知道页面，Derivation 不知道 route，Report 不
拥有 reader。方括号表示三层形态中它不是 runtime layer，而是 Report load 使用的纯函数库。

Record 负责 frozen physical read、owner-local address/schema/migration 与完整 blob materialization。
Analysis 负责 selection、immutable base population、logical slots、selected/origin owner resolution，并把
Record 的六态 read results 对齐为穷尽 cells。`analysis.attemptSlots()` 可以把两者包装成一次作者调用，
但不能因此把物理读取与 population 语义算作同一责任。

## Scope 与闭合

Record reader scope 包含 Analysis reads，以及四层形态下的 Derivation execution。进入 renderer 前，
`ReportExecution` 必须闭合：后续页面切换与下载不能重新访问 Record path。

四层 executor 可以按 consumer 计算 dependency closure 并隔离错误。三层 executor 只知道一个整体
`load()`，因此其最小失败单元是整个 model。文档和类型不得承诺比实际执行边界更细的隔离。

## 中立性

Built-in 与第三方 Report 只能使用相同 `FrozenRecord`、`Analysis`，以及四层形态下相同
`Derivation`。官方组件不得获得 `evidence(locator)`、private reader、legacy backfill 或绕过 logical
slots 的快捷通道。

## 不由层数解决的问题

当前 reader 会把一个 blob 的完整 snapshot 读入内存。把 API 分为三层或四层都不能让单个大 trace
变成 range read；这需要未来 Record reader/storage capability 单独演进。
