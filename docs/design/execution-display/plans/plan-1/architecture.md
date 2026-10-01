# 执行轨迹的应用展示 · plan-1 —— Architecture

## 数据建模

```text
Attempt
 ├─ niceeval.execution-traces                       → Events section
 │    └─ Trace snapshot (traceId)
 │         └─ Event (eventId)
 │              ├─ payload       领域事实
 │              ├─ evidence[]    → JSON Attachment + pointer
 │              └─ display?      展示块数组
 │                   └─ image    → Attachment（artifactId + descriptor + sha256）
 ├─ niceeval.agent-turns / niceeval.turn-contexts   → Conversation section
 ├─ niceeval.sandbox-commands                       → Commands section
 ├─ niceeval.runner-diagnostics                     → Diagnostics section
 └─ Attachments
```

- 展示块嵌在事件里，没有独立身份，不能被单独选择；精确读取用所属事件的 `eventId`。
- `image` 块持久保存 `artifactId`、`mediaType`、`byteLength` 与 `sha256`。这些值在接纳时从同 Attempt 已接纳附件的 descriptor 复制并固定。
- 写入形状见 [Library · 展示块](library.md#展示块)，读取形状见 [CLI · 机器输出](cli.md#机器输出)。

## 数据流

1. Adapter 在 `create(ctx)` 中解释领域事件并构造展示块。转换逻辑只存在于 Adapter。
2. `recordTrace` 接纳快照：验证 envelope、payload 与展示块，校验 `image` 引用并固定 descriptor，规范化后按 `traceId` 判定幂等。
3. Attempt publication 把快照封存进 `niceeval.execution-traces`，并按 evidence 引用的同一规则验证 `image` 附件闭合。
4. Inspection `attempt.trace` 在固定 cutoff 下关闭四个 section；Events section 交付每个事件的 envelope 与展示块有界预览。
5. `query` 编码 result；`show` 与 View 按 section 与 `kind` 呈现。三者都不读取 Record 之外的内容，也不运行 Adapter。

## Section

`attempt.trace` 的 outline 由四个 section 组成，按固定顺序排列。顺序只是展示约定，不表示跨 source 因果。

| 顺序 | section | source family | 稳定 selector | outline 预算 |
|---|---|---|---|---|
| 1 | Events | `niceeval.execution-traces`；没有该 family 时为 Conversation 投影 | `eventId`、`evidenceId` | 每页最多 32 个事件，序列化后最多 64 KiB |
| 2 | Conversation | `niceeval.agent-turns`、`niceeval.turn-contexts` | `itemId`、`toolOccurrenceId` | 最多 32 个 Turn、64 个 item；每段文本预览 1 KiB |
| 3 | Commands | `niceeval.sandbox-commands` | `commandId` | 最多 8 条命令；命令文本与每流预览各 1 KiB |
| 4 | Diagnostics | `niceeval.runner-diagnostics` | — | 最多 16 条 |

每个 section 的预算独立，互不挤占。Events 的展示块计入 Events 自己的 64 KiB 页预算，不消耗 Conversation 或 Commands 的额度。

**状态。** 每个 section 都出现在 outline 中，并带一个状态：

| 状态 | 含义 |
|---|---|
| `not-recorded` | 该 source family 没有任何已发布事实，也没有登记采集失败 |
| `complete` | 已发布事实完整，limitations 为空 |
| `partial` | 已发布事实有缺口；即使零项也显示 limitations |
| `invalid` | 已发布事实未通过严格解码或闭合校验；显示原因，不显示部分内容 |

空页、从未采集、采集失败与 invalid 是不同的事实，各自以上表状态呈现，不合并成“缺席”。

**Events 的内容。** Attempt 有 `niceeval.execution-traces` collection 时，Events 只包含它的事件。
没有这个 collection、但有 Conversation 事实时，Events 由 Conversation item 投影而成。每个 item 一个事件，类型为 `agent.<item kind>`，`display` 为 `absent`。
这让只写 Turn 的 Adapter 也能用 `--actor`、`--type` 与 continuation 分页浏览全部 item。

**筛选与分页。** `--actor`、`--type` 与 continuation 只作用于 Events。
continuation 绑定筛选、Attempt origin、source、publication cutoff、family revision 与 behavior version，只推进 Events 的下一页。
Conversation、Commands 与 Diagnostics 每次读取都交付自己的有界首段，用 omitted 计数报告剩余，超出部分用稳定 selector 精确展开。
每页至少交付一个事件。单个事件的序列化投影上限是 8 KiB，因此总能装入一页。

**Stable identities。** index 按类型分组，每类最多 256 个，超出部分报告遗漏数量。
index 遗漏不妨碍按已知稳定 ID 精确展开。

Section 按 source family 选择。Renderer 与 Inspection 不读取 Adapter 名。

## 不变量

- 读取路径不执行 Adapter、作者代码或项目配置；同一 NiceEval 版本对同一 Record 给出相同展示。
- Events section 的 renderer 只按 `kind` 分支；`kind` 集合由 NiceEval 定义。
- NiceEval 不根据展示块评分。展示块不进入 Assertion、Judge 材料、Verdict、score 或 usage。
- 展示块不是 HTML、Markdown 或 ANSI。View 以文本节点插入，不进入 HTML、属性拼接或 URL 执行位置。
- 预览的 `omittedBytes` 由 Inspection 计算，renderer 不重算。

## 生命周期与错误

| 阶段 | 失败 | 终态 |
|---|---|---|
| `recordTrace` 接纳 | 展示块非法、`image` 未接纳或 mediaType 不是图片 | 整份快照被拒绝，code `execution-display-invalid`；Events 显示 partial 与采集失败 limitation |
| publication | `image` 附件闭合校验失败 | 阻止 Attempt publication，与 evidence 引用同一规则 |
| 读取 | 图片附件的 descriptor、长度或 SHA-256 与固定值不符 | `inspection-record-integrity-failure`，与 `attempt.artifact` 的完整性错误相同；不报成 `not-found` |
| View 呈现 | 图片 bytes 无法解码 | 显示 `alt` 与 “Image could not be decoded”，事件其它块正常呈现 |

`recordTrace` 返回的 Promise 被拒绝后如何处理由 Adapter 决定。
Adapter 不捕获时，它与作者代码中其它未处理的拒绝一样成为执行错误；捕获后，Attempt 只在 Events 显示 partial。

View 经 `attempt.artifact` 分块读取图片 bytes，只在事件进入视口时请求。
`byteLength` 超过 16 MiB 的图片不内联，只显示 `alt` 与读取指引。读取共享 `attempt.artifact` 的既有预算；同一 `artifactId` 只读取一次。

## 身份与复用

三类身份分开处理：

| 身份 | 展示块是否参与 |
|---|---|
| 执行资格身份（eval、config、execution identity 与 reuse 判定） | 否。展示块不新增任何资格依赖 |
| 持久实体身份（`traceId`、`eventId`、`evidenceId`） | 否。展示块没有独立身份 |
| 内容完整性身份（规范化快照、幂等比较、Seal 与 Snapshot content identity） | 是。展示块及其 `image` descriptor 都在内容摘要内 |

Adapter 的转换代码属于受追踪源码时，修改它会按既有规则改变 Eval sourceClosure 并触发重跑；这与展示块本身无关。

**持久格式。** `display` 是 `niceeval.execution-traces` revision 1 事件上的可选字段，不新增 family revision，也不需要迁移。

- 读取侧只接受与当前 revision 相等的 attachment。新增 revision 会让全部历史轨迹变为 `unsupported`，因此按 header 扩宽读取规则的先例，在 revision 1 内扩宽事件形状。
- 没有 `display` 的事件读取投影为 `display: absent`。
- 存在 `display` 时按严格形状解码：未知 `kind`、未知字段或越过上限的值使该 collection 为 `invalid`。
- 旧 reader 不保证能读取带 `display` 的新事件。
- 已封存的 Record 与 Snapshot 只读，不重写、不回填展示块。
