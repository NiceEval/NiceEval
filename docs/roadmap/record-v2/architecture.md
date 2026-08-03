# Record v2 —— 架构候选

## 设计目标

格式演进必须把损失限制在发生变化的事实切面。
一个 reader 不认识某个 diff schema 时，仍应能列出 Run、读取判定和对话；只有身份容器本身无法安全解析时，才拒绝整个 Run。

格式还必须区分“能解析”与“能用于某项任务”。
旧判定可以展示，不代表它具备当前结果携带要求的指纹、证据覆盖和审计信息。

## 两级版本

Record v2 使用两级版本：

| 层级 | 回答的问题 | 何时递增 |
|---|---|---|
| 容器 `schemaVersion` | 能否发现 Run、Attempt 和文档引用 | 稳定识别头、身份或引用模型发生无法兼容的变化 |
| 文档 `schema` | 能否解释某一类事实 | 该文档删除字段、改名、改变类型、判别方式或既有语义 |

新增可选字段仍不递增文档 schema。
新增文档类型不改变容器版本；旧 reader 会忽略未知的可选文档，并把依赖它的能力标为不可用。

容器版本不表达 npm 版本、发布时间或一次开发批次。
`producer` 只负责归因和生成可执行提示，不参与兼容判断。

## 稳定 Run 容器

`run.json` 只保存长期稳定的识别、身份和 Run → Attempt 索引，不承载频繁变化的运行配置与报告事实。

```ts
interface RunManifestV2 {
  format: "niceeval.record";
  schemaVersion: 2;
  producer: { name: string; version?: string; commit?: string };
  runId: string;
  experimentId: string;
  startedAt: string;
  completedAt?: string;
  attempts: Array<{
    attemptId: string;
    evalId: string;
    attempt: number;
    path: string;
  }>;
  documents?: Record<string, DocumentRef>;
}
```

`attemptId` 是持久化身份，locator 是它面向人的短投影。
目录路径只负责定位，移动、发布和可逆编码规则不会改变身份。

Run 配置、Run timings、diagnostics 和 Sandbox Build provenance 通过 `documents` 引用独立文档。
这些文档变化不会迫使 reader 放弃 Run 导航。

## Attempt 容器与文档目录

每个 Attempt 有一个小型 `attempt.json`。
它只保存身份、来源关系和文档描述符，不复制判定、用量或报告摘要。

```ts
interface AttemptManifestV1 {
  format: "niceeval.attempt";
  schemaVersion: 1;
  attemptId: string;
  locator: string;
  source?: { runId: string; attemptId: string };
  documents: Record<string, DocumentRef>;
}

interface DocumentRef {
  path: string;
  schema: string;
  mediaType: "application/json" | "application/x-ndjson";
  role: "fact" | "cache";
  sha256?: string;
  bytes?: number;
}
```

core 文档使用稳定标识，例如：

| 文档键 | schema 示例 | 权威内容 |
|---|---|---|
| `niceeval.result` | `niceeval.result/3` | verdict、断言、用量与证据覆盖 |
| `niceeval.events` | `niceeval.events/1` | Agent 行为事件 |
| `niceeval.sources` | `niceeval.sources/2` | 源码引用、角色与调用路径 |
| `niceeval.diff` | `niceeval.diff/2` | 逐窗口文件变化 |
| `niceeval.trace` | `niceeval.trace/1` | 外部 trace span |
| `niceeval.o11y` | `niceeval.o11y/1` | 可从 events 重算的缓存 |

第三方文档必须使用自己的命名空间。
不知道该 key 的 reader 保留描述符但不解析内容，发布工具仍可按描述符复制原字节。

`role: "cache"` 明确该文档不是权威事实。
它缺失、损坏或 schema 不受支持时，reader 可以从对应事实重算；`role: "fact"` 不允许用缓存反推并覆盖原始事实。

## 读取转换

读取分成三步：

1. 解析容器，建立 Run、Attempt 与文档引用索引。
2. 按请求加载文档，并由 `(key, schema)` 对应的 decoder 转成中性 Record 模型。
3. 根据消费方声明的能力需求，返回可用值或结构化不可用原因。

Decoder 是纯函数，不访问其它 Run，也不重写磁盘。
字段改名只需要在该文档的 decoder 内归一；Sample、Reports 和 CLI 永远只读当前中性模型。

```ts
type DocumentState<T> =
  | { state: "available"; value: T; sourceSchema: string }
  | { state: "missing" }
  | { state: "unsupported"; schema: string }
  | { state: "malformed"; detail: string };
```

`openRecord()` 不再用一个 `unreadable` 数组概括全部失败。
容器错误仍进入 Run 级 `unreadable`；文档错误挂在对应 Run 或 Attempt 的 `DocumentState` 上。
这样报告可以展示“判定可读、diff 版本不受支持”，而不是让整个 Attempt 消失。

## 消费能力

消费方用具名能力声明最低输入，不直接比较版本整数：

| 能力 | 最低需求 | 缺失时行为 |
|---|---|---|
| `navigate` | Run 与 Attempt 容器可读 | 整个 Run 不可读 |
| `show-assessment` | 可转换的 `niceeval.result` | Attempt 可列出，判定切面不可用 |
| `show-conversation` | 可转换的 `niceeval.events` | 只隐藏对话切面 |
| `show-diff` | 可转换的 `niceeval.diff` | 只隐藏 diff 切面 |
| `compare` | 判定语义、配置身份与口径都满足当前比较契约 | Sample 产生具名 Issue |
| `carry` | 判定语义、指纹、证据状态与审计字段满足当前携带契约 | 规划矩阵给出具名不兼容原因 |

能力需求由消费模块拥有。
Record 只报告事实文档的状态，不在底层决定某条旧判定是否值得比较或携带。

`carry` 不再等价于“整个 Run 与当前 schema 相同”。
例如 diff schema 变化不影响不依赖 diff 的 Attempt；断言判别语义或证据覆盖语义变化则会明确阻止携带，即使其它切面都能读取。

## 借用、发布与完整性

携带结果通过 `source` 引用原 Attempt，不再使用只有路径语义的 `artifactBase`。
读取时先按 `(runId, attemptId)` 解析身份，再从源 Attempt 的文档目录定位字节。
路径可以作为本地加速索引，但不是引用的权威内容。

`publish()` 遍历文档描述符，解开来源引用并复制被选择的事实文档。
它保留原 `schema` 和原始字节，不用当前 decoder 重新序列化历史事实。
若描述符带摘要，发布前后必须验证；未知扩展文档也可以完整复制。

## 过渡候选

新 writer 只写 Record v2。
新 reader 同时支持当前 v14 容器和 v2 容器：v14 通过一个隔离的 legacy decoder 转成同一中性模型，不让历史字段进入 Sample 与 Reports。

v1–v13 继续按稳定识别头给出对应 `npx niceeval@<producer.version>` 提示。
是否提供离线转换命令属于待裁决项；它必须写入新目录并保留原目录，不能原地覆盖付费运行留下的事实。

过渡完成后，容器版本应保持低频变化。
日常演进集中在独立文档 schema 与 decoder；每次破坏性变化都必须声明受影响的消费能力，并用旧文档 fixture 证明未受影响的切面仍可读。
