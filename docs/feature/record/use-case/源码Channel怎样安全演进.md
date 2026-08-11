# 源码 Channel 怎样安全演进

本用例说明已经发布的 source schema 缺少未来 consumer 所需事实时怎样演进。例子使用一般性的 `niceeval.sources/vN`，不预告具体下一个版本。

## 不能补写历史事实

假设旧 source payload 没有保存一种后来需要的依赖事实。升级后的 NiceEval 不能读取当前 worktree，再把今天的文件写成过去 Run 的事实。

旧 Run、Channel payload 与 blob closure 保持 immutable。新 producer 为未来 Run 发布新的 `RecordChannelSchemaId`：

```text
历史 Run → niceeval.sources/vN   保持原样
未来 Run → niceeval.sources/vN+1 写入新契约要求的事实
```

这属于 Channel schema 演进，不改变 Run、Attempt、Member、owner 或原子发布单位，因此不触发 Record major migration。

## projector 不伪造缺失事实

旧 projector 继续读取旧 schema。既有 projector 只有在新 schema 能无损形成同一个 typed `Value` 时，才增加一个 schema case。

新 typed view 需要旧 payload 没有的事实时，它对旧 schema 返回 `unsupported`。它不能：

- 从当前 worktree、网络或其它 Channel 补值；
- 把历史 `collection.complete` 倒改成 partial；
- 凭空增加 limitation，伪装成同一个 Value；
- 用 optional 字段猜 payload 代际。

需要兼容旧 view 与新 view 时，Library 分别发布对应 projector export。一个 Report 只受自己声明的 projection 状态影响。

## schema identity 与 reuse identity 分开判断

| 变化 | 应更新什么 |
|---|---|
| source payload bytes 的 shape 或语义 | 新 `RecordChannelSchemaId` |
| typed view 的类型或解释 | 新 projector export / Library API |
| source discovery 或输入比较语义 | input / behavior identity domain |
| reuse gate 或接受集合 | reuse identity / policy domain |
| owner、跨 owner 引用、路径或 portable unit | 新 `RecordFormatId` |

新增只用于展示的 source 字段不自动使旧 Attempt 失去 reuse 资格。反过来，依赖发现算法改变时，即使展示 payload 不变，也可能必须切换 behavior 或 reuse identity。

Channel schema 与 behavior identity 可以同批升级，但不能互相代替。两者本身都不要求运行 `niceeval migrate`。

## 何时才是 Record major

保持 Run-owned sources 和 Channel-local blobs 时，增加新的 source payload schema 不改变 Record Core。

如果改成跨 Run 全局 blob pool、允许 Channel 引用 root 外文件，或改变 sources owner，portable closure 与路径公理随之改变。此时才发布新的 Record major，并由相邻 converter 证明无损迁移。

## 相关阅读

- [三个 durable 演进边界](../architecture.md#三个-durable-演进边界)
- [选择正确的演进边界](未来功能不扩张核心格式.md)
- [显式迁移 Record major](显式迁移Record-major.md)
