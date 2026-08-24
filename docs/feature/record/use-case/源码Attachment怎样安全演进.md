---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 源码 Attachment 怎样安全演进

`niceeval.sources` 的 current persistence revision 是 `2`。它保存
origin Run 已经形成的源码闭包；ordinary reader 只解码这个已知 current Sources definition。

## 不能把今天的文件写成过去事实

假设后续 consumer 需要一项 Sources 没有保存的依赖信息。NiceEval 不能读取当前 worktree、网络或 package
installation，再把今天得到的值写进历史 Run。

```text
revision 1 Run
  └─ 使用历史 inline/blob 物理分支保留 Sources bytes

revision 2 Run
  └─ 按当前 Sources definition 保存 sealed content handle
```

缺失事实不能用空字符串、当前 path、猜测 digest 或 optional field 伪装。当前 consumer 只解码
revision `2` 的 Sources；revision `1` 只由对应 migration 的私有 parser 理解。

## 已知 Sources schema 的相邻步骤

revision `1` 是已知 predecessor，current persistence 提供固定的 `1 → 2` 步骤：

- 私有 revision-1 parser 严格校验历史 payload、byte length 和 digest；
- migration 从 Core 给出的 storage-neutral content 取回保存 bytes；
- target 通过 migration builder 创建 current sealed content，再由唯一的 current Schema 校验；
- 无法如实转换时 fail closed，不从当前 worktree 补造事实。

步骤只读取 Core 已验证的 storage-neutral document 和 family-private parser 所需的 closure。它不能运行 Eval、重新执行依赖发现、
读取当前 worktree 或动态加载 composition 外代码。目标 content 重新属于 revision `2` 的 own closure，不能把旧
handle、path 或 digest 冒充新 handle。

已知 `niceeval.sources` 的旧 revision 使 direct read 返回 `migration-required`；只有显式 `niceeval migrate`
可以运行相邻步骤。独立未贡献 family 不会被当成 Sources 的旧版本，也不阻塞无关局部读取；complete migration
仍要求调用方贡献对应 definition。

## Source identity 保持或整体改变

只要 `SourceItemId`、path、digest 和 source-site join 的语义不变，revision `2` 可以单独演进 Sources payload。
source-site reader 继续以相同 identity 连接 origin Run 的 manifest。

如果 `SourceItemId` 或 source-site join 的语义需要改变，migration plan 必须同时包含 Sources 与依赖该 identity 的
Assertions / diagnostics definitions。各 Attachment 仍以自己的 envelope 提交，只有全部 current 后才替换 Seal。
步骤不能按 path、digest、数组位置或当前 worktree 猜 mapping。

## 什么仍然不是 Sources migration

| 变化 | 正确 owner |
|---|---|
| source viewer 的 typed view 或 UI | Analysis / Report |
| 静态依赖发现和输入比较语义 | behavior identity |
| reuse 接受集合 | Experiment reuse policy |
| Sources payload 或 closure 的持久语义 | Sources persistence revision + private migration |
| Sources owner、跨 owner blob 或 Core reference | 下一 Record format |

Sources migration 不授权跨 Run blob pool、root 外文件或第三方 durable field。那些改变会破坏 portable closure
与 Core 公理。

## 相关阅读

- [Sources manifest](../architecture.md#sources-manifest)
- [显式 migration](显式迁移Record-major.md)
- [跨文件 Eval 怎样进入源码闭包](跨文件Eval怎样进入源码闭包.md)
